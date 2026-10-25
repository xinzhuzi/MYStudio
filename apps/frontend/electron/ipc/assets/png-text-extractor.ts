import nodeFs from "node:fs";

/**
 * PNG tEXt 只读扫描器(10-25-asset-prompt-layered-panel B-1,PRD §4.2):
 * 自写 PNG chunk 结构扫描(零第三方库)——fs 只读字节流逐 chunk 走查,
 * 不整图读入内存(IDAT 等大块仅按长度跳过),提取 keyword=`prompt` 的
 * tEXt 文本(ComfyUI SaveImage 元数据约定=引擎实收工作流 JSON)。
 *
 * 护栏与错误分类(PRD §4.2 B-1,如实分型不吞错):
 * - not-png:文件头 8 字节 PNG 签名不符(含 JPEG/截断到不足 8 字节);
 * - no-texr:结构完整走查完毕但无 keyword=prompt 的 tEXt(PRD 实证 31/32 覆盖,
 *   降级矩阵「该图无提示词元数据」;reason 串沿用 PRD §4.2 原文拼写);
 * - oversize:tEXt 文本载荷超过 256KB 护栏(现测实盘 ~16KB,超限=异常态拒回);
 * - read-failed:签名合法但结构损坏(非法块长/块类型/越界跳读)或 fs 读错误。
 */

/** tEXt 文本载荷护栏:256KB(PRD §4.2;实盘 ~16KB)。 */
const MAX_PROMPT_TEXT_BYTES = 256 * 1024;
/** tEXt 块数据段上限=护栏+keyword/NUL 余量(超限块不缓冲,直接 oversize)。 */
const MAX_TEXT_CHUNK_DATA_BYTES = MAX_PROMPT_TEXT_BYTES + 1024;
/** PNG 规范块长上限 2^31-1,超出按结构损坏处理。 */
const MAX_CHUNK_LENGTH = 0x7fffffff;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PngPromptTextResult =
  | { status: "ok"; text: string }
  | { status: "not-png" | "no-texr" | "read-failed" | "oversize" };

class PngStructuralError extends Error {}

const isChunkTypeAscii = (type: string) => type.length === 4 && /^[A-Za-z]{4}$/.test(type);

/** 从 fd 自 position 起读满 length 字节;EOF 短读=结构损坏(调用方收 PngStructuralError)。 */
function readExactly(fd: number, buffer: Buffer, length: number, position: number): number {
  let filled = 0;
  while (filled < length) {
    const bytesRead = nodeFs.readSync(fd, buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) {
      throw new PngStructuralError(`PNG 结构损坏:位置 ${position + filled} 处意外 EOF`);
    }
    filled += bytesRead;
  }
  return filled;
}

/** tEXt 数据段=data 前 NUL 之前为 keyword,其后为文本(Latin-1 域;ComfyUI 写 UTF-8 字节,先严格 UTF-8 后 Latin-1 兜底)。 */
function decodeTextChunkText(data: Buffer): { keyword: string; textBytes: Buffer } {
  const separator = data.indexOf(0);
  if (separator === -1) {
    throw new PngStructuralError("tEXt 块缺少 keyword/text 分隔 NUL");
  }
  return {
    keyword: data.toString("latin1", 0, separator),
    textBytes: data.subarray(separator + 1),
  };
}

/**
 * 只读扫描 PNG 文件的 tEXt 块,返回 keyword=prompt 的文本。
 * 全程仅 openSync/readSync/fstatSync/closeSync,无任何写路径。
 */
export function readPngPromptText(filePath: string): PngPromptTextResult {
  let fd: number | undefined;
  try {
    fd = nodeFs.openSync(filePath, "r");
    const fileSize = nodeFs.fstatSync(fd).size;

    const signature = Buffer.alloc(8);
    let signatureBytes = 0;
    while (signatureBytes < 8) {
      const bytesRead = nodeFs.readSync(fd, signature, signatureBytes, 8 - signatureBytes, signatureBytes);
      if (bytesRead === 0) break;
      signatureBytes += bytesRead;
    }
    if (signatureBytes < 8 || !signature.equals(PNG_SIGNATURE)) {
      return { status: "not-png" };
    }

    let position = 8;
    const header = Buffer.alloc(8);
    while (position < fileSize) {
      readExactly(fd, header, 8, position);
      position += 8;
      const chunkLength = header.readUInt32BE(0);
      const chunkType = header.toString("latin1", 4, 8);
      if (!isChunkTypeAscii(chunkType)) {
        throw new PngStructuralError(`PNG 结构损坏:非法块类型 ${JSON.stringify(chunkType)}`);
      }
      if (chunkLength > MAX_CHUNK_LENGTH) {
        throw new PngStructuralError(`PNG 结构损坏:块 ${chunkType} 长度越界(${chunkLength})`);
      }

      if (chunkType === "tEXt") {
        if (chunkLength > MAX_TEXT_CHUNK_DATA_BYTES) {
          return { status: "oversize" };
        }
        const data = Buffer.alloc(chunkLength);
        readExactly(fd, data, chunkLength, position);
        position += chunkLength + 4; // 数据段+CRC
        const { keyword, textBytes } = decodeTextChunkText(data);
        if (keyword === "prompt") {
          if (textBytes.length > MAX_PROMPT_TEXT_BYTES) {
            return { status: "oversize" };
          }
          // 严格 UTF-8 解码(实盘=ComfyUI 写 UTF-8 JSON 字节);非法 UTF-8 退 Latin-1 逐字节保真。
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(textBytes);
          } catch {
            text = textBytes.toString("latin1");
          }
          return { status: "ok", text };
        }
        continue;
      }

      // 非 tEXt 块(IDAT 等大块)不缓冲:按长度跳过数据段+CRC。
      position += chunkLength + 4;
      if (position > fileSize) {
        throw new PngStructuralError(`PNG 结构损坏:块 ${chunkType} 越过文件尾`);
      }
      if (chunkType === "IEND") break;
    }
    return { status: "no-texr" };
  } catch {
    // PngStructuralError(结构损坏)与 fs 读错误同为 read-failed:签名合法但走查失败。
    return { status: "read-failed" };
  } finally {
    if (typeof fd === "number") nodeFs.closeSync(fd);
  }
}
