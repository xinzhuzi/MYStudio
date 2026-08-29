import { describe, expect, it } from "vitest";

import { lowfreqDenoiseRgba } from "./image-auto-denoise";

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
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += data[(y * width + x) * 4];
      count += 1;
    }
  }
  return sum / count;
}
