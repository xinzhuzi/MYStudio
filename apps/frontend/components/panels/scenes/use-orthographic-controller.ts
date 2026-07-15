import { useCallback } from "react";
import type { ChangeEvent } from "react";
import type { Scene } from "@/stores/scene-store";
import { useSceneStore } from "@/stores/scene-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { readImageAsBase64, saveImageToLocal } from "@/lib/image-storage";
import { splitStoryboardImage } from "@/lib/storyboard/image-splitter";
import { getStyleById } from "@/lib/constants/visual-styles";
import { toast } from "sonner";
import {
  buildOrthographicPrompts,
  mapOrthographicSplitResults,
  type OrthographicViews,
} from "./generation-panel-utils";

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;

interface UseOrthographicControllerOptions {
  selectedScene: Scene | null;
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string | null;
  promptZh: string | null;
  image: string | null;
  views: OrthographicViews;
  resourceProjectId: string | null;
  addScene: SceneStoreState["addScene"];
  updateScene: SceneStoreState["updateScene"];
  addMediaFromUrl: (options: {
    url: string;
    name: string;
    type: "image";
    source: "ai-image";
    folderId: string;
    projectId?: string;
  }) => unknown;
  getOrCreateCategoryFolder: (category: "ai-image") => string;
  setPrompt: (prompt: string | null) => void;
  setPromptZh: (prompt: string | null) => void;
  setImage: (image: string | null) => void;
  setViews: (views: OrthographicViews) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setProgress: (progress: number) => void;
  setIsSplitting: (isSplitting: boolean) => void;
}

const EMPTY_VIEWS: OrthographicViews = { front: null, back: null, left: null, right: null };

export function useOrthographicController(options: UseOrthographicControllerOptions) {
  const handleGenerateOrthographicPrompt = useCallback(() => {
    if (!options.selectedScene) {
      toast.error("请先选择场景");
      return;
    }
    const prompts = buildOrthographicPrompts(options.selectedScene, options.styleId);
    options.setPrompt(prompts.prompt);
    options.setPromptZh(prompts.promptZh);
    toast.success("四视图提示词已生成");
  }, [options]);

  const handleGenerateOrthographicImage = useCallback(async () => {
    if (!options.prompt) {
      toast.error("请先生成提示词");
      return;
    }
    if (!aiManager.featureConfig("character_generation")) {
      toast.error(aiManager.featureNotConfiguredMessage("character_generation"));
      return;
    }

    options.setIsGenerating(true);
    options.setProgress(0);
    try {
      const stylePreset = getStyleById(options.styleId);
      const negativePrompt = stylePreset?.category === "real"
        ? "blurry, low quality, watermark, text, people, characters, anime, cartoon, distorted grid, uneven panels, asymmetric"
        : "blurry, low quality, watermark, text, people, characters, distorted grid, uneven panels, asymmetric";
      options.setProgress(20);

      const rawReferences: string[] = [];
      let overviewImage: string | null = null;
      if (options.selectedScene?.parentSceneId) {
        const scenes = useSceneStore.getState().scenes;
        const overviewScene = scenes.find((scene) => (
          scene.parentSceneId === options.selectedScene?.parentSceneId
          && scene.viewpointId === "overview"
        ));
        overviewImage = overviewScene?.referenceImage || overviewScene?.referenceImageBase64 || null;
        if (!overviewImage) {
          const overviewByName = scenes.find((scene) => (
            scene.parentSceneId === options.selectedScene?.parentSceneId
            && (scene.name?.includes("全景") || scene.viewpointName === "全景")
          ));
          overviewImage = overviewByName?.referenceImage || overviewByName?.referenceImageBase64 || null;
        }
      }
      if (overviewImage) rawReferences.push(overviewImage);
      const currentReference = options.selectedScene?.referenceImage || options.selectedScene?.referenceImageBase64;
      if (currentReference && currentReference !== overviewImage) {
        rawReferences.push(currentReference);
      }

      const referenceImages: string[] = [];
      for (const reference of rawReferences) {
        if (reference.startsWith("local-image://")) {
          const base64 = await readImageAsBase64(reference);
          if (base64) referenceImages.push(base64);
        } else {
          referenceImages.push(reference);
        }
      }
      const result = await aiManager.image({
        prompt: options.prompt,
        negativePrompt,
        aspectRatio: options.aspectRatio,
        styleId: options.styleId,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });
      options.setProgress(100);
      options.setImage(result.imageUrl);
      toast.success("四视图生成成功，可以进行切割");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Orthographic] 生成失败:", error);
      toast.error(`生成失败: ${message}`);
    } finally {
      options.setIsGenerating(false);
      options.setProgress(0);
    }
  }, [options]);

  const handleUploadOrthographic = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      options.setImage(String(loadEvent.target?.result || ""));
      toast.success("四视图已上传，可以进行切割");
    };
    reader.readAsDataURL(file);
  }, [options]);

  const handleSplitOrthographic = useCallback(async () => {
    if (!options.image) {
      toast.error("请先生成或上传四视图");
      return;
    }
    options.setIsSplitting(true);
    try {
      const settings = useAppSettingsStore.getState().imageGenerationSettings;
      const splitResults = await splitStoryboardImage(options.image, {
        aspectRatio: options.aspectRatio,
        resolution: settings.defaultResolution === "4K" ? "4K" : "2K",
        sceneCount: 4,
        options: {
          expectedRows: 2,
          expectedCols: 2,
          filterEmpty: false,
          edgeMarginPercent: 0.02,
        },
      });
      options.setViews(mapOrthographicSplitResults(splitResults));
      toast.success("已切割为 4 个视角图片");
    } catch (error) {
      console.error("[Orthographic] 切割失败:", error);
      toast.error("切割失败，请检查图片格式");
    } finally {
      options.setIsSplitting(false);
    }
  }, [options]);

  const handleSaveOrthographicViews = useCallback(async () => {
    if (!options.selectedScene) {
      toast.error("请先选择场景");
      return;
    }
    const viewLabels = [
      { key: "front", name: "正面", image: options.views.front },
      { key: "back", name: "背面", image: options.views.back },
      { key: "left", name: "左侧", image: options.views.left },
      { key: "right", name: "右侧", image: options.views.right },
    ];
    if (!viewLabels.some((view) => view.image)) {
      toast.error("没有可保存的视角图片");
      return;
    }

    const parentSceneName = options.selectedScene.name || options.selectedScene.location;
    const createdIds: string[] = [];
    for (const view of viewLabels) {
      if (!view.image) continue;
      const variantName = `${parentSceneName}-${view.name}`;
      const safeName = variantName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      const localPath = await saveImageToLocal(view.image, "scenes", `${safeName}_${Date.now()}.png`);
      createdIds.push(options.addScene({
        name: variantName,
        location: options.selectedScene.location,
        time: options.selectedScene.time || "day",
        atmosphere: options.selectedScene.atmosphere || "peaceful",
        visualPrompt: options.selectedScene.visualPrompt,
        referenceImage: localPath,
        styleId: options.selectedScene.styleId || options.styleId,
        folderId: options.selectedScene.folderId,
        projectId: options.selectedScene.projectId ?? options.resourceProjectId ?? undefined,
        tags: options.selectedScene.tags,
        parentSceneId: options.selectedScene.id,
        viewpointId: view.key,
        viewpointName: view.name,
        isViewpointVariant: true,
      }));
      options.addMediaFromUrl({
        url: localPath,
        name: `场景-${variantName}`,
        type: "image",
        source: "ai-image",
        folderId: options.getOrCreateCategoryFolder("ai-image"),
        projectId: options.selectedScene.projectId ?? options.resourceProjectId ?? undefined,
      });
    }
    options.updateScene(
      options.selectedScene.id,
      { orthographicImage: options.image } as unknown as Partial<Scene>,
    );
    toast.success(`已创建 ${createdIds.length} 个正交视角场景`);
    options.setPrompt(null);
    options.setPromptZh(null);
    options.setImage(null);
    options.setViews(EMPTY_VIEWS);
  }, [options]);

  const handleCancelOrthographic = useCallback(() => {
    options.setPrompt(null);
    options.setPromptZh(null);
    options.setImage(null);
    options.setViews(EMPTY_VIEWS);
  }, [options]);

  const handleCopyOrthographicPrompt = useCallback(async (isEnglish: boolean) => {
    const prompt = isEnglish ? options.prompt : options.promptZh;
    if (!prompt) return;
    const styleName = getStyleById(options.styleId)?.name || options.styleId;
    const fullPrompt = isEnglish
      ? `=== Orthographic View Settings ===\nStyle: ${styleName}\nAspect Ratio: ${options.aspectRatio}\nGrid Layout: 2x2\n\n=== Prompt ===\n${prompt}`
      : `=== 四视图设置 ===\n视觉风格: ${styleName}\n宽高比: ${options.aspectRatio}\n网格布局: 2x2\n\n=== 提示词 ===\n${prompt}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      toast.success(isEnglish ? "英文提示词已复制" : "中文提示词已复制");
    } catch (error) {
      console.error("[Orthographic] 复制提示词失败:", error);
      toast.error("复制提示词失败");
    }
  }, [options]);

  return {
    handleGenerateOrthographicPrompt,
    handleGenerateOrthographicImage,
    handleUploadOrthographic,
    handleSplitOrthographic,
    handleSaveOrthographicViews,
    handleCancelOrthographic,
    handleCopyOrthographicPrompt,
  };
}
