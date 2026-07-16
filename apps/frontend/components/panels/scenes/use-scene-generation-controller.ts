import { useState, type ChangeEvent } from "react";
import type { Shot } from "@/types/script";
import type { Scene, useSceneStore } from "@/stores/scene-store";
import type { useMediaStore } from "@/stores/media-store";
import { aiManager } from "@/lib/ai/ai-manager";
import { saveImageToLocal } from "@/lib/image-storage";
import { getStyleById } from "@/lib/constants/visual-styles";
import { toast } from "sonner";
import { buildScenePrompt } from "./generation-panel-utils";

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;
type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

interface UseSceneGenerationControllerOptions {
  selectedScene: Scene | null;
  allShots: Shot[];
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt: string;
  tags: string[];
  notes: string;
  styleId: string;
  resourceProjectId: string | null;
  updateScene: SceneStoreState["updateScene"];
  setGenerationStatus: SceneStoreState["setGenerationStatus"];
  setGeneratingScene: SceneStoreState["setGeneratingScene"];
  addMediaFromUrl: MediaStoreState["addMediaFromUrl"];
  getOrCreateCategoryFolder: MediaStoreState["getOrCreateCategoryFolder"];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function useSceneGenerationController({
  selectedScene,
  allShots,
  name,
  location,
  time,
  atmosphere,
  visualPrompt,
  tags,
  notes,
  styleId,
  resourceProjectId,
  updateScene,
  setGenerationStatus,
  setGeneratingScene,
  addMediaFromUrl,
  getOrCreateCategoryFolder,
}: UseSceneGenerationControllerOptions) {
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);

  const handleRefImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (referenceImages.length + newImages.length >= 3) break;
      try {
        newImages.push(await fileToBase64(file));
      } catch (error) {
        console.error("Failed to convert image:", error);
      }
    }

    if (newImages.length > 0) {
      setReferenceImages([...referenceImages, ...newImages].slice(0, 3));
    }
    event.target.value = "";
  };

  const removeRefImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, imageIndex) => imageIndex !== index));
  };

  const handleGenerate = async () => {
    const targetId = selectedScene?.id;
    if (!targetId) {
      toast.error("请先选择或创建场景");
      return;
    }
    if (!location.trim()) {
      toast.error("请输入地点描述");
      return;
    }

    if (!aiManager.featureConfig("character_generation")) {
      toast.error(aiManager.featureNotConfiguredMessage("character_generation"));
      return;
    }

    if (
      location.trim() !== selectedScene.location
      || time !== selectedScene.time
      || atmosphere !== selectedScene.atmosphere
      || visualPrompt.trim() !== (selectedScene.visualPrompt || "")
      || notes.trim() !== (selectedScene.notes || "")
    ) {
      updateScene(targetId, {
        location: location.trim(),
        time,
        atmosphere,
        visualPrompt: visualPrompt.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: notes.trim() || undefined,
      });
    }

    setGenerationStatus("generating");
    setGeneratingScene(targetId);

    try {
      const actionDescriptions = allShots
        .filter((shot) => shot.sceneRefId === targetId || shot.sceneId === targetId)
        .map((shot) => shot.actionSummary)
        .filter(Boolean)
        .slice(0, 10);
      const prompt = buildScenePrompt(
        { ...selectedScene, location, time, atmosphere, styleId },
        actionDescriptions,
      );
      const stylePreset = styleId ? getStyleById(styleId) : null;
      const negativePrompt = stylePreset?.category === "real"
        ? "blurry, low quality, watermark, text, people, characters, anime, cartoon"
        : "blurry, low quality, watermark, text, people, characters";
      const result = await aiManager.image({
        prompt,
        negativePrompt,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        styleId,
      });

      setPreviewUrl(result.imageUrl);
      setPreviewSceneId(targetId);
      setGenerationStatus("completed");
      toast.success("场景概念图生成完成，请预览确认");
    } catch (error) {
      const generationError = error as Error;
      setGenerationStatus("error", generationError.message);
      toast.error(`生成失败: ${generationError.message}`);
    } finally {
      setGeneratingScene(null);
    }
  };

  const handleSavePreview = async () => {
    if (!previewUrl || !previewSceneId) return;
    toast.loading("正在保存图片到本地...", { id: "saving-scene-preview" });

    try {
      const sceneName = (name || selectedScene?.name || "scene").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      const localPath = await saveImageToLocal(
        previewUrl,
        "scenes",
        `${sceneName}_${Date.now()}.png`,
      );
      updateScene(previewSceneId, {
        referenceImage: localPath,
        visualPrompt: buildScenePrompt({
          ...selectedScene!,
          location,
          time,
          atmosphere,
          styleId,
        }),
      });
      const aiFolderId = getOrCreateCategoryFolder("ai-image");
      addMediaFromUrl({
        url: localPath,
        name: `场景-${name || selectedScene?.name || "未命名"}`,
        type: "image",
        source: "ai-image",
        folderId: aiFolderId,
        projectId: resourceProjectId || undefined,
      });
      setPreviewUrl(null);
      setPreviewSceneId(null);
      toast.success("场景概念图已保存到本地！", { id: "saving-scene-preview" });
    } catch (error) {
      console.error("Failed to save scene preview:", error);
      toast.error("保存失败", { id: "saving-scene-preview" });
    }
  };

  const handleDiscardPreview = () => {
    setPreviewUrl(null);
    setPreviewSceneId(null);
    setGenerationStatus("idle");
  };

  return {
    referenceImages,
    previewUrl,
    handleRefImageChange,
    removeRefImage,
    handleGenerate,
    handleSavePreview,
    handleDiscardPreview,
  };
}
