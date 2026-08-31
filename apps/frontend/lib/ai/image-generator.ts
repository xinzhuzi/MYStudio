import { generateImage } from "./image-generator-core";
import { ImageGenerationParams, ImageGenerationResult } from "./image-generator-shared";

export async function generateCharacterImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'character_generation');
}
export async function generateSceneImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'scene_generation');
}

/**
 * Generate image for prop/tool assets
 */
export async function generatePropImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  return generateImage(params, 'prop_generation');
}



export { IMAGE_SUBMIT_TIMEOUT_MS, imageUrlToBase64, isAuthStatusError, isMikotoImageProvider, withDescribedFetchError } from "./image-generator-shared";
export type { ImageGenerationFeature, ImageGenerationParams, ImageGenerationResult } from "./image-generator-shared";
export { augmentErrorWithChannelFailures, generateImage, tryGptImageFallbackChannels } from "./image-generator-core";
export { submitImageJobTask, submitImageTask } from "./image-generator-task";
export { pollTaskStatus, submitGridImageRequest, submitViaKlingImages } from "./image-generator-grid";
