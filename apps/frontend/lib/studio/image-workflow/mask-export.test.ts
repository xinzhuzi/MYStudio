import { describe, expect, it } from "vitest";
import { buildInpaintPrompt, exportMaskOverlay } from "./mask-export";
import type { ImageDataLike } from "./extraction-pixels";

function solid(width: number, height: number, fill: [number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    [data[i], data[i + 1], data[i + 2]] = fill;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function mask(width: number, height: number, painted: (x: number, y: number) => boolean): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (painted(x, y)) data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("exportMaskOverlay", () => {
  it("涂区叠加 accent 混色,未涂区保持原像素;包围盒正确", () => {
    const base = solid(10, 10, [0, 0, 0]);
    const result = exportMaskOverlay(base, mask(10, 10, (x, y) => x >= 2 && x <= 4 && y >= 3 && y <= 5), (img) => `encoded:${img.width}x${img.height}`);
    expect(result).not.toBeNull();
    expect(result!.region).toEqual({ x: 0.2, y: 0.3, width: 0.3, height: 0.3 });
    expect(result!.overlayDataUrl).toBe("encoded:10x10");
  });

  it("空蒙版返回 null", () => {
    expect(exportMaskOverlay(solid(4, 4, [1, 2, 3]), mask(4, 4, () => false), () => "x")).toBeNull();
  });
});

describe("buildInpaintPrompt", () => {
  it("蒙版指引包含用户要求与『保持原样』约束", () => {
    const prompt = buildInpaintPrompt("把剑换成金属材质");
    expect(prompt).toContain("把剑换成金属材质");
    expect(prompt).toContain("蒙版");
    expect(prompt).toContain("保持原样");
  });
});
