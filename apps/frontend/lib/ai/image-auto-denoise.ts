// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 生图落库自动轻度去噪(噪点治理 08-29 方案 3)。
 *
 * 与 apps/build/scripts/image_lowfreq_denoise.py / upscale adapter 同源算法:
 * 双边滤波(表面模糊)取低频 + 高频软阈值保线稿。任何失败一律返回原图
 * (fail-open,绝不断生图链)。滤波本体在 lowfreq-denoise.ts(纯函数单源),
 * 大图经 denoise-worker.ts 在 Worker 执行(09-03 主线程冻结根修)。
 *
 * 1121 tEXt 中转修复:canvas 重编码会蒸发 PNG tEXt(prompt/workflow),去噪
 * 前抽源文本块、去噪后字节级拼回 IHDR 之后(见下方「PNG tEXt 保元」段),
 * 保证去噪产物仍可被「图↔词溯源」读到提示词元数据。
 */
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { lowfreqDenoiseRgba } from "./lowfreq-denoise";

export { lowfreqDenoiseRgba } from "./lowfreq-denoise";

const DENOISE_MAX_LONG_SIDE = 2048;

// ===== PNG tEXt 保元(1121 tEXt中转修复) =====
// 去噪链必经 canvas 重编码(loadToCanvas → toDataURL),PNG 的 tEXt(prompt/
// workflow)在重编码中整块蒸发——「生成结果弹窗读不到提示词元数据」的根因
// (11-21 实弹定谳:装机 autoDenoiseEnabled=true,落盘产物只剩 IHDR+IDAT+IEND,
// 零 ancillary chunk,长边被 2048 帽缩放,引擎侧同批产物 tEXt 完好)。
// 修法=去噪前抽源 PNG 的 tEXt/zTXt/iTXt 原始块字节(含原 CRC),重编码后
// 拼回 IHDR 之后——拼回的是原始字节,零重算零内容改写,字节级保真;PNG 规范
// 允许文本块出现在 IHDR 与 IEND 之间任意位置(首 IDAT 前最稳)。

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_TEXT_CHUNK_TYPES = new Set(["tEXt", "zTXt", "iTXt"]);

function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function readPngChunkLength(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
}

function readPngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

/** 抽 PNG 文本元数据块的原始字节(12+len,含原 CRC)。非 PNG/结构损坏返回 []。 */
export function extractPngTextChunkBytes(bytes: Uint8Array): Uint8Array[] {
  if (!isPngBytes(bytes)) return [];
  const chunks: Uint8Array[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = readPngChunkLength(bytes, pos);
    if (pos + 12 + length > bytes.length) break; // 截断/损坏:不猜,放弃保元
    const type = readPngChunkType(bytes, pos);
    if (type === "IEND") break;
    if (PNG_TEXT_CHUNK_TYPES.has(type)) {
      chunks.push(bytes.slice(pos, pos + 12 + length));
    }
    pos += 12 + length;
  }
  return chunks;
}

/** 把文本元数据块拼回重编码后 PNG 的 IHDR 之后。输出已自带文本块时不重复拼。 */
export function splicePngTextChunks(pngBytes: Uint8Array, textChunks: Uint8Array[]): Uint8Array {
  if (!textChunks.length || !isPngBytes(pngBytes)) return pngBytes;
  if (extractPngTextChunkBytes(pngBytes).length > 0) return pngBytes;
  // 定位首块(IHDR)末尾——不写死 13,按实际 length 解析
  const firstLength = readPngChunkLength(pngBytes, 8);
  if (readPngChunkType(pngBytes, 8) !== "IHDR" || 8 + 12 + firstLength > pngBytes.length) return pngBytes;
  const insertAt = 8 + 12 + firstLength;
  const extra = textChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(pngBytes.length + extra);
  out.set(pngBytes.subarray(0, insertAt), 0);
  let offset = insertAt;
  for (const chunk of textChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(pngBytes.subarray(insertAt), offset);
  return out;
}

function decodeDataUrlBytes(url: string): Uint8Array | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0 || !url.slice(5, comma).includes("base64")) return null;
  try {
    const binary = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function encodePngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** 去噪前抓源图 PNG 文本元数据块:只读字节,任何失败按无元数据处理(fail-open)。 */
async function extractSourcePngTextChunks(url: string): Promise<Uint8Array[]> {
  try {
    if (url.startsWith("data:")) {
      const bytes = decodeDataUrlBytes(url);
      return bytes ? extractPngTextChunkBytes(bytes) : [];
    }
    if (url.startsWith("http")) {
      const response = await fetch(url);
      if (!response.ok) return [];
      return extractPngTextChunkBytes(new Uint8Array(await response.arrayBuffer()));
    }
  } catch {
    // 取不到源字节(如 CORS):与修复前行为一致,仅像素去噪不保元
  }
  return [];
}

export function isAutoDenoiseEnabled(): boolean {
  try {
    return useAppSettingsStore.getState().imageGenerationSettings.autoDenoiseEnabled === true;
  } catch {
    return false;
  }
}


async function loadToCanvas(url: string): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || img.width === 0 || img.height === 0) return null;
  let { width, height } = img;
  if (Math.max(width, height) > DENOISE_MAX_LONG_SIDE) {
    const scale = DENOISE_MAX_LONG_SIDE / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** 落库前自动去噪入口(读设置开关):项目内落图消费方共用。 */
export async function maybeAutoDenoiseUrl(url: string): Promise<string> {
  return applyAutoDenoise(url, isAutoDenoiseEnabled());
}

/** 小图阈值:≤512² 主线程同步滤波(<1s);更大图一律 Worker,无 Worker
 * 环境直接跳过——绝不重演 1024² 主线程同步冻结(09-03 图生图卡死实弹)。 */
const SMALL_IMAGE_PIXELS = 512 * 512;

/** Worker 内执行滤波;失败/超时返回 null(fail-open 原图落库)。 */
function denoiseInWorker(image: ImageData): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./denoise-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 30_000);
    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      try {
        resolve(new Uint8ClampedArray((event.data as { rgba: ArrayBuffer }).rgba));
      } catch {
        resolve(null);
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    // transferable:零拷贝移交(主线程 image.data 随之 detach,失败走原图)
    const buffer = image.data.buffer as ArrayBuffer;
    worker.postMessage({ rgba: buffer, width: image.width, height: image.height }, [buffer]);
  });
}

/** 落库前自动去噪入口:失败/未启用/非图一律原样返回。
 * 09-03 根修:大图(生图产物基本都 ≥1024²)双边滤波搬进 Web Worker——
 * 主线程同步跑 8400 万次 exp 会把 UI 冻结约 1 分钟(图生图卡死实弹),
 * 用户三次重启连试三次、每次生成即卡。 */
export async function applyAutoDenoise(url: string, enabled: boolean): Promise<string> {
  if (!enabled || !url || !(url.startsWith("data:image") || url.startsWith("http"))) return url;
  try {
    // 保元第一步:canvas 重编码前抓源 PNG 的 tEXt/zTXt/iTXt 原始块(失败=无元数据)
    const sourceTextChunks = await extractSourcePngTextChunks(url);
    const canvas = await loadToCanvas(url);
    if (!canvas) return url;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = canvas.width * canvas.height;
    if (pixels > SMALL_IMAGE_PIXELS) {
      if (typeof Worker === "undefined") return url; // 无 Worker 环境:大图跳过
      const denoised = await denoiseInWorker(image);
      if (!denoised) return url;
      const out = new ImageData(new Uint8ClampedArray(denoised), canvas.width, canvas.height);
      ctx.putImageData(out, 0, 0);
    } else {
      lowfreqDenoiseRgba(image.data, canvas.width, canvas.height);
      ctx.putImageData(image, 0, 0);
    }
    const encoded = canvas.toDataURL("image/png");
    // 保元第二步:把源文本块字节级拼回重编码产物;任何解码失败仅影响保元,
    // 去噪结果(encoded)原样交付,绝不断链
    try {
      const encodedBytes = decodeDataUrlBytes(encoded);
      if (encodedBytes) {
        return encodePngDataUrl(splicePngTextChunks(encodedBytes, sourceTextChunks));
      }
    } catch {
      // 保元失败:回落纯去噪产物
    }
    return encoded;
  } catch {
    // CORS(tainted canvas)/解码失败等:原图落库,绝不断链
    return url;
  }
}
