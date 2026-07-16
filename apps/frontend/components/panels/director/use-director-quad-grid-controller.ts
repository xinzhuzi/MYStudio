import { useCallback } from "react";
import type { QuadVariationType } from "@/components/quad-grid";
import { aiManager } from "@/lib/ai/ai-manager";
import type { DirectorProjectData, EmotionTag, SplitScene } from "@/stores/director-store";
import { toast } from "sonner";
import type { StoryboardGenerationUiController } from "./use-storyboard-generation-ui";
import { executeStoryboardGridGeneration } from "./storyboard-grid-generation-executor";
import { buildStoryboardQuadGridPrompt } from "./storyboard-quad-grid-prompt";
import type { SceneCharacterContext } from "./storyboard-reference-utils";

type StoryboardConfig = DirectorProjectData["storyboardConfig"];
type QuadGridController = Pick<
  StoryboardGenerationUiController,
  | "quadGridTarget"
  | "setQuadGridTarget"
  | "setQuadGridOpen"
  | "setQuadGridResultOpen"
  | "setQuadGridResult"
  | "setIsQuadGridGenerating"
>;

type AddMediaFromUrl = (options: {
  url: string;
  name: string;
  type: "image";
  source: "ai-image";
  folderId?: string | null;
  projectId?: string;
}) => string;

export type UseDirectorQuadGridControllerOptions = {
  scenes: SplitScene[];
  storyboardConfig: StoryboardConfig;
  defaultAspectRatio: StoryboardConfig["aspectRatio"];
  defaultResolution: StoryboardConfig["resolution"];
  controller: QuadGridController;
  mediaProjectId?: string;
  getImageFolderId: () => string;
  addMediaFromUrl: AddMediaFromUrl;
  buildEmotionDescription: (emotionTags: EmotionTag[]) => string;
  getSceneCharacterContexts: (
    characterIds: string[],
    variationMap?: Record<string, string>,
  ) => SceneCharacterContext[];
  getCharacterReferenceImages: (
    characterIds: string[],
    variationMap?: Record<string, string>,
  ) => string[];
  buildPromptWithIdentityLock: (
    prompt: string,
    scene: SplitScene,
    model?: string,
    hasCharacterRefs?: boolean,
  ) => string;
  optimizeReferenceImagesForModel: (
    model: string,
    groups: Array<{ kind: "anchor" | "character" | "scene"; images: string[] }>,
  ) => string[];
  processReferenceImagesForApi: (
    images: string[],
    label: string,
    validateLocalDataUri?: boolean,
  ) => Promise<string[]>;
};

export function useDirectorQuadGridController({
  scenes,
  storyboardConfig,
  defaultAspectRatio,
  defaultResolution,
  controller,
  mediaProjectId,
  getImageFolderId,
  addMediaFromUrl,
  buildEmotionDescription,
  getSceneCharacterContexts,
  getCharacterReferenceImages,
  buildPromptWithIdentityLock,
  optimizeReferenceImagesForModel,
  processReferenceImagesForApi,
}: UseDirectorQuadGridControllerOptions) {
  const {
    quadGridTarget,
    setQuadGridTarget,
    setQuadGridOpen,
    setQuadGridResultOpen,
    setQuadGridResult,
    setIsQuadGridGenerating,
  } = controller;

  const handleQuadGridClick = useCallback((sceneId: number, type: "start" | "end") => {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const imageUrl = type === "start"
      ? scene.imageDataUrl || scene.imageHttpUrl
      : scene.endFrameImageUrl || scene.endFrameHttpUrl;
    if (!imageUrl) {
      toast.error(`请先生成${type === "start" ? "首帧" : "尾帧"}`);
      return;
    }
    setQuadGridTarget({ sceneId, type });
    setQuadGridOpen(true);
  }, [scenes, setQuadGridOpen, setQuadGridTarget]);

  const handleQuadGridGenerate = useCallback(async (
    variationType: QuadVariationType,
    useCharacterRef = false,
  ) => {
    if (!quadGridTarget) return;
    const scene = scenes.find((item) => item.id === quadGridTarget.sceneId);
    if (!scene) return;
    const sourceImage = quadGridTarget.type === "start"
      ? scene.imageDataUrl || scene.imageHttpUrl
      : scene.endFrameImageUrl || scene.endFrameHttpUrl;
    if (!sourceImage) {
      toast.error("找不到原图");
      return;
    }

    const featureConfig = aiManager.featureConfig("character_generation");
    if (!featureConfig) {
      toast.error("请先在设置中配置图片生成 API");
      setQuadGridOpen(false);
      return;
    }
    const keyManager = featureConfig.keyManager;
    const apiKey = keyManager.getCurrentKey() || "";
    if (!apiKey) {
      toast.error("请先在设置中配置图片生成服务映射");
      setQuadGridOpen(false);
      return;
    }
    const platform = featureConfig.platform;
    const model = featureConfig.models?.[0];
    if (!model) {
      toast.error("请先在设置中配置图片生成模型");
      setQuadGridOpen(false);
      return;
    }
    const imageBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    if (!imageBaseUrl) {
      toast.error("请先在设置中配置图片生成服务映射");
      setQuadGridOpen(false);
      return;
    }

    console.log("[QuadGrid] Using image config:", { platform, model, imageBaseUrl });
    setIsQuadGridGenerating(true);
    try {
      const styleTokens = storyboardConfig.styleTokens || [];
      const aspect = storyboardConfig.aspectRatio || defaultAspectRatio;
      const contexts = getSceneCharacterContexts(scene.characterIds || [], scene.characterVariationMap);
      const characterRefs = useCharacterRef
        ? getCharacterReferenceImages(scene.characterIds || [], scene.characterVariationMap)
        : [];
      const hasCharacterRefs = contexts.some((context) => context.referenceImages.length > 0);
      const { variationLabels, prompt: baseGridPrompt } = buildStoryboardQuadGridPrompt({
        scene,
        variationType,
        useCharacterRef,
        aspect,
        styleTokens,
        emotionDescription: buildEmotionDescription(scene.emotionTags || []),
        includeDialogueBoxConstraint: true,
      });
      const gridPrompt = buildPromptWithIdentityLock(baseGridPrompt, scene, model, hasCharacterRefs);
      console.log("[QuadGrid] Grid prompt:", `${gridPrompt.substring(0, 200)}...`);

      const optimizedRefs = optimizeReferenceImagesForModel(model, [
        { kind: "anchor", images: [sourceImage] },
        { kind: "character", images: characterRefs },
        { kind: "scene", images: scene.sceneReferenceImage ? [scene.sceneReferenceImage] : [] },
      ]);
      const apiReferenceImages = await processReferenceImagesForApi(optimizedRefs, "[QuadGrid]");
      const references = [sourceImage];
      if (useCharacterRef && scene.characterIds?.length) {
        references.push(...getCharacterReferenceImages(scene.characterIds, scene.characterVariationMap));
      }
      if (scene.sceneReferenceImage) references.push(scene.sceneReferenceImage);
      const processedReferences = await processReferenceImagesForApi(references.slice(0, 14), "[QuadGrid]", false);

      const { gridImageUrl, slicedImages } = await executeStoryboardGridGeneration({
        request: {
          model,
          prompt: gridPrompt,
          apiKey,
          baseUrl: imageBaseUrl,
          aspectRatio: aspect,
          resolution: storyboardConfig.resolution || defaultResolution,
          referenceImages: apiReferenceImages.length > 0
            ? apiReferenceImages
            : (processedReferences.length > 0 ? processedReferences : undefined),
          keyManager,
        },
        poll: { apiKey, baseUrl: imageBaseUrl },
        layout: { columns: 2, rows: 2, actualCount: 4 },
      });
      console.log("[QuadGrid] Grid image URL:", gridImageUrl.substring(0, 80));
      console.log("[QuadGrid] Sliced into", slicedImages.length, "images");

      const variationTypeLabel = variationType === "angle"
        ? "视角变体"
        : variationType === "composition"
          ? "构图变体"
          : "时刻变体";
      setQuadGridResult({
        originalImage: sourceImage,
        images: slicedImages,
        variationType: variationTypeLabel,
        variationLabels,
      });
      const folderId = getImageFolderId();
      slicedImages.forEach((image, index) => {
        addMediaFromUrl({
          url: image,
          name: `四宫格-${variationTypeLabel}-${variationLabels[index]}`,
          type: "image",
          source: "ai-image",
          folderId,
          projectId: mediaProjectId,
        });
      });
      setQuadGridOpen(false);
      setQuadGridResultOpen(true);
      toast.success("四宫格生成完成，已自动保存到素材库");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      console.error("[QuadGrid] Failed:", error);
      toast.error(`四宫格生成失败: ${message}`);
    } finally {
      setIsQuadGridGenerating(false);
    }
  }, [
    addMediaFromUrl,
    buildEmotionDescription,
    buildPromptWithIdentityLock,
    defaultAspectRatio,
    defaultResolution,
    getCharacterReferenceImages,
    getImageFolderId,
    getSceneCharacterContexts,
    mediaProjectId,
    optimizeReferenceImagesForModel,
    processReferenceImagesForApi,
    quadGridTarget,
    scenes,
    setIsQuadGridGenerating,
    setQuadGridOpen,
    setQuadGridResult,
    setQuadGridResultOpen,
    storyboardConfig,
  ]);

  return { handleQuadGridClick, handleQuadGridGenerate };
}
