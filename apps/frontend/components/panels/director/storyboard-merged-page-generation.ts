import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";
import type { PersistResult } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";
import { sliceStoryboardMergedGridImage } from "./storyboard-merged-grid-image-slicer";
import {
  calculateMergedGridLayout,
  type MergedFrameTask,
} from "./storyboard-merged-grid-utils";
import { writeStoryboardMergedImages } from "./storyboard-merged-image-writeback";
import {
  buildReferencePriorityHint,
  type SceneCharacterContext,
} from "./storyboard-reference-utils";

type FeatureKeyManager = NonNullable<ReturnType<typeof aiManager.featureConfig>>["keyManager"];

type MediaWritebackInput = {
  url: string;
  name: string;
  type: "image";
  source: "ai-image";
  folderId: string;
  projectId?: string;
};

type StoryboardMergedPageGeneratorOptions = {
  aspect: "16:9" | "9:16";
  resolution: "1K" | "2K" | "4K";
  fullStylePrompt: string;
  fullStyleNegative: string;
  model: string;
  apiKey: string;
  imageBaseUrl: string;
  keyManager: FeatureKeyManager;
  signal: AbortSignal;
  getSceneCharacterContexts: (
    characterIds: string[],
    variationMap?: Record<string, string>,
  ) => SceneCharacterContext[];
  getSceneIdentityLockLines: (
    scene: SplitScene,
    model: string,
    hasCharacterReferences: boolean,
  ) => string[];
  processReferenceImagesForApi: (references: string[], label: string) => Promise<string[]>;
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
};

export function createStoryboardMergedPageGenerator(options: StoryboardMergedPageGeneratorOptions) {
  const {
    aspect,
    resolution,
    fullStylePrompt,
    fullStyleNegative,
    model,
    apiKey,
    imageBaseUrl,
    keyManager,
    signal,
    getSceneCharacterContexts,
    getSceneIdentityLockLines,
    processReferenceImagesForApi,
    updateFirstFrameStatus,
    updateEndFrameStatus,
    folderId,
    projectId,
    persistImage,
    updateFirstFrame,
    updateEndFrame,
    addMedia,
  } = options;

  return async (pageTasks: MergedFrameTask[], references: string[]): Promise<string[]> => {
    const actualCount = pageTasks.length;
    const { cols, rows, paddedCount } = calculateMergedGridLayout(actualCount);
    const emptySlots = paddedCount - actualCount;
    console.log(`[MergedGen] Grid: ${actualCount} scenes → ${paddedCount} cells (${rows}×${cols}), ${emptySlots} empty slots, grid aspect: ${aspect}`);

    const gridPromptParts: string[] = [
      "<instruction>",
      `Generate a clean ${rows}x${cols} storyboard grid with exactly ${paddedCount} equal-sized panels.`,
      `Overall Image Aspect Ratio: ${aspect}.`,
      `Each individual panel must have a ${aspect === "16:9" ? "16:9 (horizontal landscape)" : "9:16 (vertical portrait)"} aspect ratio.`,
    ];
    if (fullStylePrompt) {
      gridPromptParts.push(`MANDATORY Visual Style for ALL panels: ${fullStylePrompt}`);
    }
    const pageHasCharacterRefs = pageTasks.some((task) =>
      getSceneCharacterContexts(task.scene.characterIds || [], task.scene.characterVariationMap)
        .some((context) => context.referenceImages.length > 0),
    );
    const referencePriorityHint = buildReferencePriorityHint(model, pageHasCharacterRefs);
    if (referencePriorityHint) gridPromptParts.push(referencePriorityHint);
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
      const sceneCharacterContexts = getSceneCharacterContexts(
        scene.characterIds || [],
        scene.characterVariationMap,
      );
      const identityInline = getSceneIdentityLockLines(
        scene,
        model,
        sceneCharacterContexts.some((context) => context.referenceImages.length > 0),
      )
        .map((line) => line.replace(/^- /, "").trim())
        .join(" ");
      const characterCount = scene.characterIds?.length || 0;
      const characterConstraint = characterCount === 0
        ? "(no people)"
        : characterCount === 1
          ? "(1 person)"
          : `(${characterCount} people)`;
      const frameLabel = task.type === "end" ? "[END FRAME]" : "[FIRST FRAME]";
      const styleAnchor = fullStylePrompt ? " [same style]" : "";
      const identitySuffix = identityInline ? ` Identity lock: ${identityInline}` : "";
      gridPromptParts.push(`Panel [row ${row}, col ${column}] ${frameLabel} ${characterConstraint}: ${description}${styleAnchor}${identitySuffix}`);
    });

    for (let index = actualCount; index < paddedCount; index++) {
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
    console.log("[MergedGen] Grid prompt:", `${gridPrompt.substring(0, 200)}...`);

    pageTasks.forEach((task) => {
      if (task.type === "end") {
        updateEndFrameStatus(task.scene.id, { endFrameStatus: "generating", endFrameProgress: 10 });
      } else {
        updateFirstFrameStatus(task.scene.id, { imageStatus: "generating", imageProgress: 10 });
      }
    });
    const apiReferenceImages = await processReferenceImagesForApi(references, "[MergedGen]");
    const finalReferences = references.slice(0, 14);
    const processedReferences = await processReferenceImagesForApi(finalReferences, "[MergedGen]");
    console.log("[MergedGen] Processed refs:", processedReferences.length, "valid from", finalReferences.length, "total");
    processedReferences.forEach((reference, index) => {
      console.log(`[MergedGen] Ref[${index}] format:`, `${reference.substring(0, 50)}...`);
    });

    console.log("[MergedGen] Calling API with", apiReferenceImages.length, "reference images, model:", model);
    const apiResult = await aiManager.imageGrid({
      model,
      prompt: gridPrompt,
      apiKey,
      baseUrl: imageBaseUrl,
      aspectRatio: aspect,
      resolution,
      referenceImages: apiReferenceImages.length > 0
        ? apiReferenceImages
        : (processedReferences.length > 0 ? processedReferences : undefined),
      keyManager,
      signal,
    });
    signal.throwIfAborted();

    let gridImageUrl = apiResult.imageUrl;
    const taskId = apiResult.taskId;
    console.log("[MergedGen] API result: gridImageUrl=", gridImageUrl?.substring(0, 50), "taskId=", taskId);
    if (!gridImageUrl && taskId) {
      console.log("[MergedGen] Polling task:", taskId);
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
      console.error("[MergedGen] 无法获取图片 URL, apiResult:", apiResult);
      if (taskId) {
        throw new Error(`九宫格生成超时（任务 ${taskId} 在 3 分钟内未完成），API 服务可能繁忙，请稍后重试`);
      }
      throw new Error("未获取到九宫格图片 URL，请检查 API 响应");
    }

    console.log("[MergedGen] Grid image URL:", gridImageUrl.substring(0, 80));
    const slicedImages = await sliceStoryboardMergedGridImage(
      gridImageUrl,
      actualCount,
      cols,
      rows,
      aspect,
    );
    signal.throwIfAborted();
    console.log("[MergedGen] Sliced into", slicedImages.length, "images (from", paddedCount, "grid cells, target aspect:", aspect, ")");
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
