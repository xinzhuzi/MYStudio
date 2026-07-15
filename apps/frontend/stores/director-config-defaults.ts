import type { GenerationConfig } from "@opencut/ai-core";

export const DEFAULT_DIRECTOR_GENERATION_CONFIG: GenerationConfig = {
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
};
