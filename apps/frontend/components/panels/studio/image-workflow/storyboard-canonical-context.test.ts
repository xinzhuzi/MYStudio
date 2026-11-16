// @vitest-environment jsdom
/**
 * 第六病理单姿裁切语义测试(1116 回归钉):
 *  - 竖幅(已是单姿立绘)→ 原图保留(2d312474 原语义;旧实现返回 null=丢槽,
 *    会把主角 image_1 抽走,身份参考归零);
 *  - 横幅多视图卡 → 裁最左连续内容块为正面单姿;
 *  - 横幅裁不出 → null(调用方丢槽留痕,宁缺勿染,禁整卡入参考);
 *  - 场景/前帧 → 恒不裁。
 */
import { describe, expect, it, vi } from "vitest";
import {
  cropSlotReferenceToSinglePose,
  type StoryboardCropImageSource,
} from "./storyboard-canonical-context";

const VERTICAL: StoryboardCropImageSource = { naturalWidth: 800, naturalHeight: 1200 };
const BANNER: StoryboardCropImageSource = { naturalWidth: 1248, naturalHeight: 832 };

const loader = (image: StoryboardCropImageSource | null) => vi.fn(async () => image);

/** 512 探针列:除 [contentStart, contentEnd) 外均为背景色。 */
function stubCanvas(contentStart: number, contentEnd: number) {
  const drawImage = vi.fn();
  const fillPixels = (width: number, height: number): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const foreground = x >= contentStart && x < contentEnd;
        data[at] = foreground ? 20 : 200;
        data[at + 1] = foreground ? 20 : 200;
        data[at + 2] = foreground ? 20 : 200;
        data[at + 3] = 255;
      }
    }
    return data;
  };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: fillPixels(width, height),
      }),
    } as unknown as CanvasRenderingContext2D;
  } as never);
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,CROPPED");
  return { drawImage, getContext, toDataURL };
}

describe("cropSlotReferenceToSinglePose", () => {
  it("竖幅单姿立绘原图保留,不丢槽", async () => {
    const load = loader(VERTICAL);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,VERTICAL", "character", load);
    expect(result).toBe("data:image/png;base64,VERTICAL");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("横幅多视图卡裁出最左连续内容块", async () => {
    const { toDataURL } = stubCanvas(100, 200);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BANNER", "character", loader(BANNER));
    expect(result).toBe("data:image/png;base64,CROPPED");
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it("横幅全背景无法定位单姿=丢槽(null)", async () => {
    stubCanvas(0, 0);
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BANNER", "character", loader(BANNER));
    expect(result).toBeNull();
  });

  it("场景与前帧恒不裁,原样透传", async () => {
    const sceneLoad = loader(BANNER);
    await expect(cropSlotReferenceToSinglePose("data:image/png;base64,SCENE", "scene", sceneLoad))
      .resolves.toBe("data:image/png;base64,SCENE");
    const frameLoad = loader(BANNER);
    await expect(cropSlotReferenceToSinglePose("data:image/png;base64,FRAME", "previous-frame", frameLoad))
      .resolves.toBe("data:image/png;base64,FRAME");
    expect(sceneLoad).not.toHaveBeenCalled();
    expect(frameLoad).not.toHaveBeenCalled();
  });

  it("解码失败=丢槽(null)", async () => {
    const result = await cropSlotReferenceToSinglePose("data:image/png;base64,BROKEN", "character", loader(null));
    expect(result).toBeNull();
  });
});
