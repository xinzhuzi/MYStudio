import type { MergedFrameTask } from "./storyboard-merged-grid-utils";
import { optimizeReferenceImagesForModel } from "./storyboard-reference-utils";

export type MergedReferenceStrategy = "cluster" | "minimal" | "none";

type GetCharacterReferenceImages = (
  characterIds: string[],
  variationMap?: Record<string, string>,
) => string[];

interface MergedReferenceOptions {
  strategy: MergedReferenceStrategy;
  getCharacterReferenceImages: GetCharacterReferenceImages;
}

interface OptimizedMergedReferenceOptions extends MergedReferenceOptions {
  model?: string;
  exemplar: boolean;
}

const deduplicate = (images: string[]) => Array.from(new Set(images.filter(Boolean)));

export function collectMergedFrameReferenceImages(
  tasks: MergedFrameTask[],
  { strategy, getCharacterReferenceImages }: MergedReferenceOptions,
): string[] {
  if (strategy === "none") return [];
  const images: string[] = [];
  const seenSceneIds = new Set<number>();

  for (const task of tasks) {
    if (seenSceneIds.has(task.scene.id)) continue;
    seenSceneIds.add(task.scene.id);
    if (task.scene.sceneReferenceImage) images.push(task.scene.sceneReferenceImage);
    if (task.scene.characterIds?.length) {
      images.push(...getCharacterReferenceImages(
        task.scene.characterIds,
        task.scene.characterVariationMap,
      ));
    }
  }

  return deduplicate(images).slice(0, strategy === "minimal" ? 2 : 14);
}

export function collectOptimizedMergedFrameReferenceImages(
  tasks: MergedFrameTask[],
  {
    strategy,
    model,
    exemplar,
    getCharacterReferenceImages,
  }: OptimizedMergedReferenceOptions,
): string[] {
  if (strategy === "none") return [];
  const sceneImages: string[] = [];
  const characterImages: string[] = [];
  const anchorImages: string[] = [];
  const seenSceneIds = new Set<number>();

  for (const task of tasks) {
    if (seenSceneIds.has(task.scene.id)) continue;
    seenSceneIds.add(task.scene.id);
    const sceneImage = task.type === "end"
      ? task.scene.endFrameSceneReferenceImage || task.scene.sceneReferenceImage
      : task.scene.sceneReferenceImage;
    if (sceneImage) sceneImages.push(sceneImage);

    if (task.scene.characterIds?.length) {
      characterImages.push(...getCharacterReferenceImages(
        task.scene.characterIds,
        task.scene.characterVariationMap,
      ));
    }

    if (exemplar) {
      const anchorImage = task.type === "end"
        ? task.scene.imageDataUrl || task.scene.imageHttpUrl || undefined
        : task.scene.endFrameImageUrl || task.scene.endFrameHttpUrl || undefined;
      if (anchorImage) anchorImages.push(anchorImage);
    }
  }

  const optimizedImages = optimizeReferenceImagesForModel(model, [
    { kind: "anchor", images: deduplicate(anchorImages) },
    { kind: "character", images: deduplicate(characterImages) },
    { kind: "scene", images: deduplicate(sceneImages) },
  ]);
  return strategy === "minimal" ? optimizedImages.slice(0, 2) : optimizedImages;
}
