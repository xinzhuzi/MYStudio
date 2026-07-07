import { describe, expect, it } from "vitest";

import {
  GPT_IMAGE_SIZE_MAP,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  getImageSizeLabel,
  resolveGptImageSize,
  validateGptImageSize,
} from "./image-size-presets";

describe("image size presets", () => {
  it("exposes the full GPT image aspect ratio and resolution matrix", () => {
    expect(IMAGE_ASPECT_RATIOS).toEqual([
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "9:21",
    ]);
    expect(IMAGE_RESOLUTIONS).toEqual(["1K", "2K", "4K"]);
    expect(GPT_IMAGE_SIZE_MAP["16:9"]["2K"]).toBe("2048x1152");
  });

  it("validates every preset as a legal gpt-image size", () => {
    for (const ratio of IMAGE_ASPECT_RATIOS) {
      for (const resolution of IMAGE_RESOLUTIONS) {
        expect(validateGptImageSize(GPT_IMAGE_SIZE_MAP[ratio][resolution])).toEqual({ valid: true });
      }
    }
  });

  it("resolves labels from aspect ratio and resolution", () => {
    expect(resolveGptImageSize({ aspectRatio: "16:9", resolution: "2K" })).toEqual({
      size: "2048x1152",
      templateName: "openai-size",
    });
    expect(getImageSizeLabel({ aspectRatio: "1:1", resolution: "1K" })).toBe("1024x1024");
  });
});
