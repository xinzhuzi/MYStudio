import { useCallback } from "react";
import type { QuadVariationType } from "@/components/features/storyboard/quad-grid";
import { aiManager } from "@/lib/ai/ai-manager";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import type { EmotionTag } from "@/stores/director/director-presets";
import type { DirectorProjectData, SplitScene } from "@/stores/director/director-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { toast } from "sonner";
import type { StoryboardGenerationUiController } from "../director/use-storyboard-generation-ui";
import { executeStoryboardGridGeneration } from "../director/storyboard-grid-generation-executor";
import { compileActiveDaojieStoryboardFramePrompt } from "@/lib/studio/visual-manual-style-tokens";
import { normalizeStoryboardReferenceImages } from "../director/storyboard-reference-image-normalizer";
import { buildStoryboardQuadGridPrompt } from "../director/storyboard-quad-grid-prompt";

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

type UseSClassQuadGridControllerOptions = {
  scenes: SplitScene[];
  storyboardConfig: StoryboardConfig;
  defaultAspectRatio: StoryboardConfig["aspectRatio"];
  defaultResolution: StoryboardConfig["resolution"];
  controller: QuadGridController;
  mediaProjectId?: string;
  getImageFolderId: () => string;
  addMediaFromUrl: AddMediaFromUrl;
  buildEmotionDescription: (emotionTags: EmotionTag[]) => string;
};

export function collectSClassCharacterReferenceImages(
  characterIds: string[],
  variationMap?: Record<string, string>,
): string[] {
  const { characters } = useCharacterLibraryStore.getState();
  const refs: string[] = [];
  const seen = new Set<string>();
  const maxRefs = 14;

  const pushRef = (value?: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    refs.push(value);
  };

  for (const charId of characterIds) {
    const character = characters.find((item) => item.id === charId);
    if (!character) continue;

    const variationId = variationMap?.[charId];
    const selectedVariation = variationId
      ? character.variations?.find((variation) => variation.id === variationId)
      : undefined;

    pushRef(selectedVariation?.referenceImage);

    for (const view of character.views || []) {
      pushRef(view.imageBase64 || view.imageUrl);
      if (refs.length >= maxRefs) return refs;
    }

    for (const image of character.referenceImages || []) {
      pushRef(image);
      if (refs.length >= maxRefs) return refs;
    }

    for (const image of selectedVariation?.clothingReferenceImages || []) {
      pushRef(image);
      if (refs.length >= maxRefs) return refs;
    }
  }

  return refs.slice(0, maxRefs);
}

export function useSClassQuadGridController({
  scenes,
  storyboardConfig,
  defaultAspectRatio,
  defaultResolution,
  controller,
  mediaProjectId,
  getImageFolderId,
  addMediaFromUrl,
  buildEmotionDescription,
}: UseSClassQuadGridControllerOptions) {
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

    setIsQuadGridGenerating(true);

    try {
      const styleTokens = storyboardConfig.styleTokens || [];
      const aspect = storyboardConfig.aspectRatio || defaultAspectRatio;
      const emotionDescription = buildEmotionDescription(scene.emotionTags || []);
      const { variationLabels, prompt: gridPrompt } = buildStoryboardQuadGridPrompt({
        scene,
        variationType,
        useCharacterRef,
        aspect,
        styleTokens,
        emotionDescription,
        includeDialogueBoxConstraint: true,
      });

      const references = [sourceImage];
      if (useCharacterRef && scene.characterIds?.length) {
        references.push(...collectSClassCharacterReferenceImages(
          scene.characterIds,
          scene.characterVariationMap,
        ));
      }
      if (scene.sceneReferenceImage) references.push(scene.sceneReferenceImage);

      const processedReferences = await normalizeStoryboardReferenceImages(references, {
        readLocalImage: readImageAsBase64,
        max: 14,
        onReadError: (url) => console.warn("[QuadGrid] Failed to read local image:", url),
      });
      // 道劫手册:宫格最终正文经 ma-gongbi-v1 分镜帧编译(唯一 Avoid+800 门)后 raw 直传
      const compiledGridPrompt = await compileActiveDaojieStoryboardFramePrompt(gridPrompt);
 const { slicedImages } = await executeStoryboardGridGeneration({
        request: {
          model,
          prompt: compiledGridPrompt?.providerPrompt ?? gridPrompt,
          promptPolicy: compiledGridPrompt ? "raw" : undefined,
          apiKey,
          baseUrl: imageBaseUrl,
          aspectRatio: aspect,
          resolution: storyboardConfig.resolution || defaultResolution,
          referenceImages: processedReferences.length > 0 ? processedReferences : undefined,
          keyManager,
        },
        poll: { apiKey, baseUrl: imageBaseUrl },
        layout: { columns: 2, rows: 2, actualCount: 4 },
      });

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
      const generationError = error as Error;
      console.error("[QuadGrid] Failed:", generationError);
      toast.error(`四宫格生成失败: ${generationError.message}`);
    } finally {
      setIsQuadGridGenerating(false);
    }
  }, [
    addMediaFromUrl,
    buildEmotionDescription,
    defaultAspectRatio,
    defaultResolution,
    getImageFolderId,
    mediaProjectId,
    quadGridTarget,
    scenes,
    setIsQuadGridGenerating,
    setQuadGridOpen,
    setQuadGridResult,
    setQuadGridResultOpen,
    storyboardConfig,
  ]);

  return { getCharacterReferenceImages: collectSClassCharacterReferenceImages, handleQuadGridClick, handleQuadGridGenerate };
}
