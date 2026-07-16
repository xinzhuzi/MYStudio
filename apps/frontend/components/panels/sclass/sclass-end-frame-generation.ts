import { getStylePrompt } from "@/lib/constants/visual-styles";
import type { SplitScene } from "@/stores/director-store";
import { normalizeStoryboardReferenceImages } from "../director/storyboard-reference-image-normalizer";
import {
  createStoryboardEndFrameGenerator,
  type StoryboardEndFrameGenerationOptions,
} from "../director/storyboard-end-frame-generation";

type SClassEndFrameGenerationOptions = Omit<
  StoryboardEndFrameGenerationOptions,
  "prepareRequest" | "aspectRatio" | "resolution"
> & {
  currentStyleId: string;
  aspectRatio: "16:9" | "9:16";
  resolution: "1K" | "2K" | "4K";
  readImage: (url: string) => Promise<string | null | undefined>;
  getCharacterReferenceImages: (
    characterIds: string[],
    variationMap?: Record<string, string>,
  ) => string[];
};

export function createSClassEndFrameGenerator(options: SClassEndFrameGenerationOptions) {
  return createStoryboardEndFrameGenerator({
    getScene: options.getScene,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    prepareRequest: async ({ scene, promptToUse }) => {
      const stylePrompt = getStylePrompt(options.currentStyleId);
      const prompt = stylePrompt ? `${promptToUse}. Style: ${stylePrompt}` : promptToUse;
      const references: string[] = [];
      if (scene.endFrameSceneReferenceImage) {
        references.push(scene.endFrameSceneReferenceImage);
      } else if (scene.sceneReferenceImage) {
        references.push(scene.sceneReferenceImage);
      }
      if (scene.imageDataUrl) references.push(scene.imageDataUrl);
      if (scene.characterIds?.length) {
        references.push(...options.getCharacterReferenceImages(
          scene.characterIds,
          scene.characterVariationMap,
        ));
      }
      const processedReferences = await normalizeStoryboardReferenceImages(references, {
        readLocalImage: options.readImage,
        max: 14,
        onReadError: (url, error) => console.warn("[SplitScenes] Failed to read local image:", url, error),
      });
      return { prompt, referenceImages: processedReferences };
    },
    updateStatus: options.updateStatus,
    updateEndFrame: options.updateEndFrame,
    setGenerating: options.setGenerating,
    folderId: options.folderId,
    projectId: options.projectId,
    addMedia: options.addMedia,
    createAbortController: options.createAbortController,
  });
}

export type { SplitScene };
