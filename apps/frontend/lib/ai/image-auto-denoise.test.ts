import { describe, expect, it } from "vitest";

import { extractPngTextChunkBytes, lowfreqDenoiseRgba, splicePngTextChunks } from "./image-auto-denoise";

/** 合成 64x64:左半平坦底(叠加 ±8 细颗粒),右半纯色;x=32 处一条 0→255 锐边。 */
function makeSynthetic(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const base = x < 32 ? 128 : 200;
      const grain = x < 32 ? (rand() - 0.5) * 10 : 0; // 仅左半有细颗粒噪点(幅值<strength=12)
      data[i] = base + grain;
      data[i + 1] = base + grain;
      data[i + 2] = base + grain;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function regionStd(data: Uint8ClampedArray, width: number, x0: number, x1: number, y0: number, y1: number): number {
  const values: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      values.push(data[(y * width + x) * 4]);
    }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

describe("lowfreqDenoiseRgba", () => {
  it("压低平坦区细颗粒噪点(噪区 std 显著下降)", () => {
    const { data, width, height } = makeSynthetic();
    const before = regionStd(data, width, 4, 28, 4, 60);
    lowfreqDenoiseRgba(data, width, height);
    const after = regionStd(data, width, 4, 28, 4, 60);
    // 幅值 5 的细颗粒软阈值后理论残留 ≈ keep + 0.7·(5/12) ≈ 0.59,
    // 叠加双边低频平滑,阈值 0.75 留裕量
    expect(after).toBeLessThan(before * 0.75);
  });

  it("保留两侧平坦区原有亮度(无色偏/无变黑)", () => {
    const { data, width, height } = makeSynthetic();
    lowfreqDenoiseRgba(data, width, height);
    expect(regionStd(data, width, 4, 28, 4, 60)).toBeGreaterThan(0.5); // 不糊成死平
    const leftMean = meanOf(data, width, 4, 28, 4, 60);
    const rightMean = meanOf(data, width, 36, 60, 4, 60);
    expect(Math.abs(leftMean - 128)).toBeLessThan(6);
    expect(Math.abs(rightMean - 200)).toBeLessThan(6);
  });

  it("保留强边缘(左右亮度差仍在)", () => {
    const { data, width, height } = makeSynthetic();
    lowfreqDenoiseRgba(data, width, height);
    const leftMean = meanOf(data, width, 26, 31, 4, 60);
    const rightMean = meanOf(data, width, 33, 38, 4, 60);
    expect(rightMean - leftMean).toBeGreaterThan(40);
  });
});

function meanOf(data: Uint8ClampedArray, width: number, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      sum += data[(y * width + x) * 4];
      count += 1;
    }
  }
  return sum / count;
}

// ===== PNG tEXt 保元(1121 tEXt中转修复) =====

const PNG_SIGNATURE_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 造一个合法 chunk 字节(length+type+data+crc=占位 4 字节)。 */
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(Uint8Array.from([...type].map((c) => c.charCodeAt(0))), 4);
  out.set(data, 8);
  return out;
}

function assemblePng(chunks: Uint8Array[]): Uint8Array {
  const total = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE_BYTES, 0);
  let offset = 8;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 模拟引擎产物:signature + IHDR + tEXt(prompt) + tEXt(workflow) + IDAT + IEND。 */
function makeEnginePngWithText(): { png: Uint8Array; textChunks: Uint8Array[] } {
  const ihdr = makeChunk("IHDR", new Uint8Array(13));
  const promptText = makeChunk("tEXt", Uint8Array.from([..."prompt\0", ..."生图提示词全文"].map((c) => c.charCodeAt(0))));
  const workflowText = makeChunk("tEXt", Uint8Array.from([..."workflow\0", ...'{"nodes":[]}'].map((c) => c.charCodeAt(0))));
  const idat = makeChunk("IDAT", new Uint8Array([1, 2, 3, 4]));
  const iend = makeChunk("IEND", new Uint8Array(0));
  const textChunks = [promptText, workflowText];
  return { png: assemblePng([ihdr, promptText, workflowText, idat, iend]), textChunks };
}

/** 模拟 canvas 重编码产物:signature + IHDR + IDAT + IEND,零 ancillary(实弹指纹)。 */
function makeCanvasReencodedPng(): Uint8Array {
  return assemblePng([
    makeChunk("IHDR", new Uint8Array(13)),
    makeChunk("IDAT", new Uint8Array([9, 9, 9, 9])),
    makeChunk("IEND", new Uint8Array(0)),
  ]);
}

function chunkTypeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function chunkLengthAt(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

describe("extractPngTextChunkBytes / splicePngTextChunks(PNG tEXt 保元)", () => {
  it("从源 PNG 抽出 tEXt 块原始字节(含原 CRC),非文本块不抽", () => {
    const { png, textChunks } = makeEnginePngWithText();
    const extracted = extractPngTextChunkBytes(png);
    expect(extracted).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(extracted[i]).toEqual(textChunks[i]); // 字节级一致(含 CRC)
    }
  });

  it("非 PNG 字节(JPEG 头)返回空,不抛", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2]);
    expect(extractPngTextChunkBytes(jpeg)).toEqual([]);
  });

  it("截断 PNG(首 tEXt 块中途中断)返回空,不猜", () => {
    const { png } = makeEnginePngWithText();
    // 8(签名)+25(IHDR)+17:切进首个 tEXt 块中段,声称长度越界
    expect(extractPngTextChunkBytes(png.slice(0, 50))).toEqual([]);
  });

  it("拼回:重编码产物 IHDR 之后逐字节插入源文本块,总长与内容精确", () => {
    const { textChunks } = makeEnginePngWithText();
    const canvasPng = makeCanvasReencodedPng();
    const spliced = splicePngTextChunks(canvasPng, textChunks);
    expect(spliced.length).toBe(canvasPng.length + textChunks[0].length + textChunks[1].length);
    // 块序:IHDR → tEXt → tEXt → IDAT → IEND
    expect(chunkTypeAt(spliced, 8)).toBe("IHDR");
    let pos = 8 + 12 + 13;
    expect(chunkTypeAt(spliced, pos)).toBe("tEXt");
    expect(chunkLengthAt(spliced, pos)).toBe(textChunks[0].length - 12);
    pos += textChunks[0].length;
    expect(chunkTypeAt(spliced, pos)).toBe("tEXt");
    pos += textChunks[1].length;
    expect(chunkTypeAt(spliced, pos)).toBe("IDAT");
    // 插入块与源块逐字节一致(CRC 未重算、内容未改写)
    expect(spliced.slice(8 + 25, 8 + 25 + textChunks[0].length)).toEqual(textChunks[0]);
    // 尾部(IDAT+IEND)原样保留
    expect(spliced.slice(spliced.length - (canvasPng.length - 33))).toEqual(canvasPng.slice(33));
  });

  it("输出已自带文本块时不重复拼(幂等防重)", () => {
    const { png, textChunks } = makeEnginePngWithText();
    expect(splicePngTextChunks(png, textChunks)).toBe(png); // 原引用返回,零改动
  });

  it("空文本块列表/非 PNG 输出原样返回", () => {
    const canvasPng = makeCanvasReencodedPng();
    expect(splicePngTextChunks(canvasPng, [])).toBe(canvasPng);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(splicePngTextChunks(jpeg, [makeChunk("tEXt", new Uint8Array(4))])).toBe(jpeg);
  });

  it("zTXt/iTXt 同样收发(引擎元数据块族全覆盖)", () => {
    const ztxt = makeChunk("zTXt", Uint8Array.from([..."workflow\0\0"].map((c) => c.charCodeAt(0))));
    const itxt = makeChunk("iTXt", new Uint8Array(6));
    const png = assemblePng([makeChunk("IHDR", new Uint8Array(13)), ztxt, itxt, makeChunk("IDAT", new Uint8Array(1)), makeChunk("IEND", new Uint8Array(0))]);
    const extracted = extractPngTextChunkBytes(png);
    expect(extracted).toHaveLength(2);
    const spliced = splicePngTextChunks(makeCanvasReencodedPng(), extracted);
    expect(spliced.slice(33, 33 + ztxt.length)).toEqual(ztxt);
  });

  it("端到端字节模拟:引擎产物 → 抽块 → canvas 重编码 → 拼回,再抽仍可得同块", () => {
    const { png } = makeEnginePngWithText();
    const chunks = extractPngTextChunkBytes(png);
    const reencoded = makeCanvasReencodedPng();
    const restored = splicePngTextChunks(reencoded, chunks);
    expect(extractPngTextChunkBytes(restored)).toEqual(chunks);
  });
});
