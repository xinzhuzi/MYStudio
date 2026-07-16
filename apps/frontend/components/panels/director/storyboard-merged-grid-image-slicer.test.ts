// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { sliceStoryboardMergedGridImage } from "./storyboard-merged-grid-image-slicer";

const OriginalImage = globalThis.Image;

afterEach(() => {
  globalThis.Image = OriginalImage;
  vi.restoreAllMocks();
});

describe("sliceStoryboardMergedGridImage", () => {
  it("center-crops every requested tile to a strict target aspect", async () => {
    const drawImage = vi.fn();
    const canvases: Array<{ width: number; height: number }> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push({ width: this.width, height: this.height });
      return `data:image/png;base64,tile-${canvases.length}`;
    });
    globalThis.Image = class {
      width = 2000;
      height = 1000;
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    } as unknown as typeof Image;

    const result = await sliceStoryboardMergedGridImage("https://image.test/grid.png", 3, 2, 2, "16:9");

    expect(result).toHaveLength(3);
    expect(canvases).toEqual([
      { width: 888, height: 500 },
      { width: 888, height: 500 },
      { width: 888, height: 500 },
    ]);
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(drawImage.mock.calls[0].slice(1)).toEqual([60, 2, 880, 496, 0, 0, 888, 500]);
  });

  it("preserves the existing load failure error", async () => {
    globalThis.Image = class {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onerror?.();
      }
    } as unknown as typeof Image;

    await expect(sliceStoryboardMergedGridImage("broken", 1, 1, 1, "9:16"))
      .rejects.toThrow("加载九宫格图片失败");
  });
});
