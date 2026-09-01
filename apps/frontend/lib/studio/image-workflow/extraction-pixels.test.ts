import { describe, expect, it } from "vitest";
import {
  cellRect,
  cropImageData,
  normRectToPixelWindow,
  selectionBoundingBox,
  splitImageData,
  type ImageDataLike,
} from "./extraction-pixels";

/** 造 WxH 纯色测试图:像素值 = (x, y, 标记, 255) */
function solidImage(width: number, height: number, tag: number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = x % 256;
      data[i + 1] = y % 256;
      data[i + 2] = tag;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function imageDataLike(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe("normRectToPixelWindow", () => {
  it("归一化框映射整像素窗口,越界 clamp", () => {
    expect(normRectToPixelWindow({ x: 0, y: 0, width: 1, height: 1 }, { width: 100, height: 50 }))
      .toEqual({ left: 0, top: 0, width: 100, height: 50 });
    expect(normRectToPixelWindow({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, { width: 100, height: 50 }))
      .toEqual({ left: 50, top: 13, width: 25, height: 25 });
    // 出界框收缩回界内,至少 1px
    expect(normRectToPixelWindow({ x: 0.95, y: 0.95, width: 0.2, height: 0.2 }, { width: 100, height: 50 }))
      .toEqual({ left: 95, top: 48, width: 5, height: 2 });
  });
});

describe("cropImageData", () => {
  it("逐像素正确:裁出区域与源图同坐标像素逐一相等", () => {
    const source = solidImage(10, 8, 7);
    const cropped = cropImageData(source, { x: 0.2, y: 0.25, width: 0.5, height: 0.5 });
    expect(cropped.width).toBe(5);
    expect(cropped.height).toBe(4);
    for (let y = 0; y < cropped.height; y += 1) {
      for (let x = 0; x < cropped.width; x += 1) {
        const src = (Math.round(2 + y) * 10 + Math.round(2 + x)) * 4;
        const dst = (y * cropped.width + x) * 4;
        expect([...cropped.data.subarray(dst, dst + 4)]).toEqual([...source.data.subarray(src, src + 4)]);
      }
    }
  });
});

describe("splitImageData", () => {
  it("2x2 切分:四份尺寸正确且无缝拼回覆盖全图", () => {
    const source = solidImage(10, 10, 9);
    const pieces = splitImageData(source, 2, 2);
    expect(pieces).toHaveLength(4);
    expect(pieces.map((p) => [p.width, p.height])).toEqual([[5, 5], [5, 5], [5, 5], [5, 5]]);
    // cellRect 行优先且无缝
    const rects = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => cellRect(2, 2, r, c));
    expect(rects[1]).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("3x3 非整除尺寸每格至少 1px", () => {
    const source = solidImage(10, 10, 9);
    const pieces = splitImageData(source, 3, 3);
    expect(pieces).toHaveLength(9);
    for (const piece of pieces) {
      expect(piece.width).toBeGreaterThanOrEqual(1);
      expect(piece.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("范围钳制:rows/cols 超界收敛到 1-4", () => {
    expect(splitImageData(solidImage(4, 4, 1), 0, 99)).toHaveLength(4);
  });
});

describe("selectionBoundingBox", () => {
  it("alpha>0 涂抹区归一化包围盒;空选区 null", () => {
    const mask = imageDataLike(10, 10, (x, y) => (x >= 2 && x <= 4 && y >= 3 && y <= 5 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(selectionBoundingBox(mask)).toEqual({ x: 0.2, y: 0.3, width: 0.3, height: 0.3 });
    expect(selectionBoundingBox(imageDataLike(4, 4, () => [0, 0, 0, 0]))).toBeNull();
  });
});
