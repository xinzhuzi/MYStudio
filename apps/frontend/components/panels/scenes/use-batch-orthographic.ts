import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import { getStyleById } from "@/lib/constants/visual-styles";
import { readImageAsBase64, saveImageToLocal } from "@/lib/image-storage";
import { splitStoryboardImage } from "@/lib/storyboard/image-splitter";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useSceneStore } from "@/stores/scene-store";
import { toast } from "sonner";
import { extractSpatialAssets } from "./generation-panel-utils";

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;

interface UseBatchOrthographicOptions {
  savedChildSceneIds: string[];
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  resourceProjectId: string | null;
  addScene: SceneStoreState["addScene"];
  addMediaFromUrl: (options: {
    url: string;
    name: string;
    type: "image";
    source: "ai-image";
    folderId: string;
    projectId?: string;
  }) => unknown;
  getOrCreateCategoryFolder: (category: "ai-image") => string;
  setSavedChildSceneIds: (ids: string[]) => void;
}

const VIEW_LABELS = [
  { key: "front", name: "正面", row: 0, col: 0 },
  { key: "back", name: "背面", row: 0, col: 1 },
  { key: "left", name: "左侧", row: 1, col: 0 },
  { key: "right", name: "右侧", row: 1, col: 1 },
] as const;

export function useBatchOrthographic(options: UseBatchOrthographicOptions) {
  const {
    savedChildSceneIds,
    styleId,
    aspectRatio,
    resourceProjectId,
    addScene,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setSavedChildSceneIds,
  } = options;

  const handleClearBatchOrthographic = useCallback(() => {
    setSavedChildSceneIds([]);
  }, [setSavedChildSceneIds]);

  const handleBatchGenerateOrthographic = useCallback(async () => {
    if (savedChildSceneIds.length === 0) {
      toast.error("没有可处理的子场景");
      return;
    }
    if (!aiManager.featureConfig("character_generation")) {
      toast.error(aiManager.featureNotConfiguredMessage("character_generation"));
      return;
    }

    const scenes = useSceneStore.getState().scenes;
    const childScenes = savedChildSceneIds.flatMap((id) => {
      const scene = scenes.find((item) => item.id === id);
      return scene ? [scene] : [];
    });
    if (childScenes.length === 0) {
      toast.error("找不到子场景");
      return;
    }

    toast.info(`开始为 ${childScenes.length} 个子场景生成四视图...`);
    let successCount = 0;
    let failCount = 0;

    for (const childScene of childScenes) {
      try {
        const { anchor, walls } = extractSpatialAssets(childScene);
        const sceneName = childScene.name || childScene.location || "the scene";
        const stylePreset = getStyleById(childScene.styleId || styleId);
        const styleTokens = stylePreset?.prompt || "anime style";
        const prompt = `A professional orthographic concept sheet arranged in a precise 2x2 grid, depicting ${sceneName} from four cardinal angles with perfect spatial continuity. ${styleTokens}, detailed environment concept art.

**Top-Left (Front View):** A direct front-facing shot of ${anchor}. Background: ${walls.south}.
**Top-Right (Back View):** A direct back-facing shot of ${anchor}. Background: ${walls.north}.
**Bottom-Left (Left Profile):** Side profile shot from the left. Background: ${walls.east}.
**Bottom-Right (Right Profile):** Side profile shot from the right. Background: ${walls.west}.

No characters, empty environment.`;
        const negativePrompt = stylePreset?.category === "real"
          ? "blurry, low quality, watermark, text, people, characters, anime, cartoon, distorted grid"
          : "blurry, low quality, watermark, text, people, characters, distorted grid";

        let overviewImage: string | undefined;
        if (childScene.parentSceneId) {
          const overviewScene = scenes.find((scene) => (
            scene.parentSceneId === childScene.parentSceneId && scene.viewpointId === "overview"
          ));
          overviewImage = overviewScene?.referenceImage || overviewScene?.referenceImageBase64;
          if (!overviewImage) {
            const overviewByName = scenes.find((scene) => (
              scene.parentSceneId === childScene.parentSceneId
              && (scene.name?.includes("全景") || scene.viewpointName === "全景")
            ));
            overviewImage = overviewByName?.referenceImage || overviewByName?.referenceImageBase64;
          }
        }

        const rawReferences = [
          overviewImage,
          childScene.referenceImage || childScene.referenceImageBase64,
        ]
          .filter((reference, index, values): reference is string => !!reference && values.indexOf(reference) === index);
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
          prompt,
          negativePrompt,
          aspectRatio,
          styleId: childScene.styleId || styleId,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        });
        const settings = useAppSettingsStore.getState().imageGenerationSettings;
        const splitResults = await splitStoryboardImage(result.imageUrl, {
          aspectRatio,
          resolution: settings.defaultResolution === "4K" ? "4K" : "2K",
          sceneCount: 4,
          options: { expectedRows: 2, expectedCols: 2, filterEmpty: false, edgeMarginPercent: 0.02 },
        });

        for (const view of VIEW_LABELS) {
          const split = splitResults.find((item) => item.row === view.row && item.col === view.col);
          if (!split) continue;
          const safeName = `${childScene.name}-${view.name}`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
          const localPath = await saveImageToLocal(split.dataUrl, "scenes", `${safeName}_${Date.now()}.png`);
          addScene({
            name: `${childScene.name}-${view.name}`,
            location: childScene.location,
            time: childScene.time || "day",
            atmosphere: childScene.atmosphere || "peaceful",
            referenceImage: localPath,
            styleId: childScene.styleId || styleId,
            folderId: childScene.folderId,
            projectId: childScene.projectId ?? resourceProjectId ?? undefined,
            parentSceneId: childScene.id,
            viewpointId: view.key,
            viewpointName: view.name,
            isViewpointVariant: true,
          });
          addMediaFromUrl({
            url: localPath,
            name: `场景-${childScene.name}-${view.name}`,
            type: "image",
            source: "ai-image",
            folderId: getOrCreateCategoryFolder("ai-image"),
            projectId: childScene.projectId ?? resourceProjectId ?? undefined,
          });
        }
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`[批量四视图] ${childScene.name} 失败:`, error);
      }
    }

    setSavedChildSceneIds([]);
    toast.success(`批量四视图完成！成功 ${successCount} 个，失败 ${failCount} 个`);
  }, [
    addMediaFromUrl, addScene, aspectRatio, getOrCreateCategoryFolder,
    resourceProjectId, savedChildSceneIds, setSavedChildSceneIds, styleId,
  ]);

  return { handleClearBatchOrthographic, handleBatchGenerateOrthographic };
}
