import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";
import type { PersistResult } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";
import { normalizeStoryboardReferenceImages } from "../director/storyboard-reference-image-normalizer";
import { sliceStoryboardMergedGridImage } from "../director/storyboard-merged-grid-image-slicer";
import { writeStoryboardMergedImages } from "../director/storyboard-merged-image-writeback";
import {
  calculateMergedGridLayout,
  type MergedFrameTask,
} from "../director/storyboard-merged-grid-utils";

type FeatureKeyManager = NonNullable<ReturnType<typeof aiManager.featureConfig>>["keyManager"];

type MediaWritebackInput = {
  url: string;
  name: string;
  type: "image";
  source: "ai-image";
  folderId: string;
  projectId?: string;
};

export interface SClassMergedPageGeneratorOptions {
  aspect: "16:9" | "9:16";
  fullStylePrompt: string;
  fullStyleNegative: string;
  model: string;
  apiKey: string;
  imageBaseUrl: string;
  resolution: "1K" | "2K" | "4K";
  keyManager: FeatureKeyManager;
  signal: AbortSignal;
  updateFirstFrameStatus: (
    sceneId: number,
    update: { imageStatus?: "generating"; imageProgress?: number },
  ) => void;
  updateEndFrameStatus: (
    sceneId: number,
    update: { endFrameStatus?: "generating"; endFrameProgress?: number },
  ) => void;
  folderId: () => string;
  projectId?: string;
  persistImage: (
    image: string,
    sceneId: number,
    frameType: "first" | "end",
  ) => Promise<PersistResult>;
  updateFirstFrame: (
    sceneId: number,
    localPath: string,
    width?: number,
    height?: number,
    httpUrl?: string,
  ) => void;
  updateEndFrame: (
    sceneId: number,
    localPath: string,
    source: "ai-generated",
    httpUrl?: string,
  ) => void;
  addMedia: (input: MediaWritebackInput) => unknown;
  setLastGridImage: (imageUrl: string, sceneIds: number[]) => void;
  readImage: (imagePath: string) => Promise<string | null>;
}

export function createSClassMergedPageGenerator(options: SClassMergedPageGeneratorOptions) {
  const {
    aspect,
    fullStylePrompt,
    fullStyleNegative,
    model,
    apiKey,
    imageBaseUrl,
    resolution,
    keyManager,
    signal,
    updateFirstFrameStatus,
    updateEndFrameStatus,
    folderId,
    projectId,
    persistImage,
    updateFirstFrame,
    updateEndFrame,
    addMedia,
    setLastGridImage,
    readImage,
  } = options;

  return async (pageTasks: MergedFrameTask[], references: string[]): Promise<string[]> => {
    const actualCount = pageTasks.length;
    const { cols, rows, paddedCount } = calculateMergedGridLayout(actualCount);
    const emptySlots = paddedCount - actualCount;
    const gridAspect = aspect;

    console.log(`[MergedGen] Grid: ${actualCount} scenes → ${paddedCount} cells (${rows}×${cols}), ${emptySlots} empty slots, grid aspect: ${gridAspect}`);

    const gridPromptParts: string[] = [];
    gridPromptParts.push("<instruction>");
    gridPromptParts.push(`Generate a clean ${rows}x${cols} storyboard grid with exactly ${paddedCount} equal-sized panels.`);
    gridPromptParts.push(`Overall Image Aspect Ratio: ${aspect}.`);
    const panelAspect = aspect === "16:9" ? "16:9 (horizontal landscape)" : "9:16 (vertical portrait)";
    gridPromptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);
    if (fullStylePrompt) {
      gridPromptParts.push(`MANDATORY Visual Style for ALL panels: ${fullStylePrompt}`);
    }
    gridPromptParts.push("Structure: No borders between panels, no text, no watermarks, no speech bubbles.");
    gridPromptParts.push("Consistency: Maintain consistent character appearance, lighting, color grading, and visual style across ALL panels.");
    gridPromptParts.push("</instruction>");
    gridPromptParts.push(`Layout: ${rows} rows, ${cols} columns, reading order left-to-right, top-to-bottom.`);

    pageTasks.forEach((task, index) => {
      const scene = task.scene;
      const row = Math.floor(index / cols) + 1;
      const column = (index % cols) + 1;
      const description = task.type === "end"
        ? scene.endFramePromptZh?.trim()
          || scene.endFramePrompt?.trim()
          || `${scene.imagePromptZh || scene.imagePrompt || ""} end state`
        : scene.imagePromptZh?.trim()
          || scene.imagePrompt?.trim()
          || scene.videoPromptZh?.trim()
          || scene.videoPrompt?.trim()
          || `scene ${index + 1}`;
      const characterCount = scene.characterIds?.length || 0;
      const characterConstraint = characterCount === 0
        ? "(no people)"
        : characterCount === 1 ? "(1 person)" : `(${characterCount} people)`;
      const frameLabel = task.type === "end" ? "[END FRAME]" : "[FIRST FRAME]";
      const styleAnchor = fullStylePrompt ? " [same style]" : "";
      gridPromptParts.push(`Panel [row ${row}, col ${column}] ${frameLabel} ${characterConstraint}: ${description}${styleAnchor}`);
    });

    for (let index = actualCount; index < paddedCount; index += 1) {
      const row = Math.floor(index / cols) + 1;
      const column = (index % cols) + 1;
      gridPromptParts.push(`Panel [row ${row}, col ${column}]: empty placeholder, solid gray background`);
    }
    if (fullStylePrompt) {
      gridPromptParts.push(`IMPORTANT - Apply this EXACT style uniformly to every panel: ${fullStylePrompt}`);
    }
    const styleNegative = fullStyleNegative ? `, ${fullStyleNegative}` : "";
    gridPromptParts.push(`Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy${styleNegative}`);
    const gridPrompt = gridPromptParts.join("\n");

    pageTasks.forEach((task) => {
      if (task.type === "end") {
        updateEndFrameStatus(task.scene.id, { endFrameStatus: "generating", endFrameProgress: 10 });
      } else {
        updateFirstFrameStatus(task.scene.id, { imageStatus: "generating", imageProgress: 10 });
      }
    });

    const finalReferences = references.slice(0, 14);
    const processedReferences = await normalizeStoryboardReferenceImages(finalReferences, {
      readLocalImage: readImage,
      validateLocalDataUri: true,
      onReadError: (url) => console.warn("[MergedGen] Failed to read local image:", url),
    });
    console.log("[MergedGen] Processed refs:", processedReferences.length, "valid from", finalReferences.length, "total");

    const apiResult = await aiManager.imageGrid({
      model,
      prompt: gridPrompt,
      apiKey,
      baseUrl: imageBaseUrl,
      aspectRatio: gridAspect,
      resolution,
      referenceImages: processedReferences.length > 0 ? processedReferences : undefined,
      keyManager,
      signal,
    });
    signal.throwIfAborted();

    let gridImageUrl = apiResult.imageUrl;
    const taskId = apiResult.taskId;
    if (!gridImageUrl && taskId) {
      gridImageUrl = await pollImageTaskUrl({
        taskId,
        apiKey,
        baseUrl: imageBaseUrl,
        maxAttempts: 90,
        signal,
        onProgress: (pollProgress) => {
          const progress = Math.min(10 + Math.floor(pollProgress * 0.8), 90);
          pageTasks.forEach((task) => {
            if (task.type === "end") {
              updateEndFrameStatus(task.scene.id, { endFrameProgress: progress });
            } else {
              updateFirstFrameStatus(task.scene.id, { imageProgress: progress });
            }
          });
        },
      });
      signal.throwIfAborted();
    }

    if (!gridImageUrl) {
      if (taskId) {
        throw new Error(`九宫格生成超时（任务 ${taskId} 在 3 分钟内未完成），API 服务可能繁忙，请稍后重试`);
      }
      throw new Error("未获取到九宫格图片 URL，请检查 API 响应");
    }

    const pageSceneIds = pageTasks.filter((task) => task.type === "first").map((task) => task.scene.id);
    if (pageSceneIds.length > 0) {
      setLastGridImage(gridImageUrl, pageSceneIds);
    }
    signal.throwIfAborted();

    const slicedImages = await sliceStoryboardMergedGridImage(gridImageUrl, actualCount, cols, rows, aspect);
    signal.throwIfAborted();
    await writeStoryboardMergedImages({
      tasks: pageTasks,
      images: slicedImages,
      signal,
      folderId: folderId(),
      projectId,
      persistImage,
      updateFirstFrame,
      updateEndFrame,
      addMedia,
    });
    return slicedImages;
  };
}
