import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECTOR_GENERATION_CONFIG } from "./director-config-defaults";

describe("director generation defaults", () => {
  it("preserves the established generation contract", () => {
    expect(DEFAULT_DIRECTOR_GENERATION_CONFIG).toEqual({
      styleTokens: ["anime style", "manga art", "2D animation", "cel shaded"],
      qualityTokens: ["high quality", "detailed", "professional"],
      negativePrompt: "blurry, low quality, watermark, realistic, photorealistic, 3D render",
      aspectRatio: "9:16",
      imageSize: "1K",
      videoSize: "480p",
      sceneCount: 5,
      concurrency: 1,
      imageProvider: "memefast",
      videoProvider: "memefast",
      chatProvider: "memefast",
    });
  });
});
