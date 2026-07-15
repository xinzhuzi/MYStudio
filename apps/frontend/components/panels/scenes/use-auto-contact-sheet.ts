import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import { saveImageToLocal } from "@/lib/image-storage";
import type { SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import { splitStoryboardImage } from "@/lib/storyboard/image-splitter";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import type { ContactSheetPromptSet, PendingViewpointData } from "@/stores/media-panel-store";
import { useSceneStore, type Scene } from "@/stores/scene-store";
import type { ScriptScene, Shot } from "@/types/script";
import { toast } from "sonner";
import {
  buildAutoContactSheetPrompt,
  getLayoutDimensions,
  mapAutoContactSheetResults,
  type ContactSheetLayout,
} from "./generation-panel-utils";

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;
type ViewpointImages = Record<string, { imageUrl: string; gridIndex: number }>;

interface UseAutoContactSheetOptions {
  selectedScene: Scene | null;
  contactSheetPrompt: string | null;
  styleId: string;
  contactSheetAspectRatio: "16:9" | "9:16";
  contactSheetLayout: ContactSheetLayout;
  pendingViewpoints: PendingViewpointData[];
  extractedViewpoints: SceneViewpoint[];
  pendingContactSheetPrompts: ContactSheetPromptSet[];
  currentPageIndex: number;
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt: string;
  tags: string[];
  notes: string;
  currentFolderId: string | null;
  resourceProjectId: string | null;
  allShots: Shot[];
  scriptScenes: ScriptScene[];
  addScene: SceneStoreState["addScene"];
  updateScene: SceneStoreState["updateScene"];
  selectScene: SceneStoreState["selectScene"];
  setContactSheetTask: SceneStoreState["setContactSheetTask"];
  onSceneCreated?: (id: string) => void;
  addMediaFromUrl: (options: {
    url: string;
    name: string;
    type: "image";
    source: "ai-image";
    folderId: string;
    projectId?: string;
  }) => unknown;
  getOrCreateCategoryFolder: (category: "ai-image") => string;
  setContactSheetPrompt: (prompt: string | null) => void;
  setContactSheetPromptZh: (prompt: string | null) => void;
  setContactSheetImage: (image: string | null) => void;
  setSplitViewpointImages: (images: ViewpointImages) => void;
  setIsGeneratingContactSheet: (isGenerating: boolean) => void;
}

export function useAutoContactSheet(options: UseAutoContactSheetOptions) {
  const {
    selectedScene,
    contactSheetPrompt,
    styleId,
    contactSheetAspectRatio,
    contactSheetLayout,
    pendingViewpoints,
    extractedViewpoints,
    pendingContactSheetPrompts,
    currentPageIndex,
    name,
    location,
    time,
    atmosphere,
    visualPrompt,
    tags,
    notes,
    currentFolderId,
    resourceProjectId,
    allShots,
    scriptScenes,
    addScene,
    updateScene,
    selectScene,
    setContactSheetTask,
    onSceneCreated,
    addMediaFromUrl,
    getOrCreateCategoryFolder,
    setContactSheetPrompt,
    setContactSheetPromptZh,
    setContactSheetImage,
    setSplitViewpointImages,
    setIsGeneratingContactSheet,
  } = options;

  return useCallback(async () => {
    if (!contactSheetPrompt) {
      toast.error("请先生成提示词");
      return;
    }
    if (!aiManager.featureConfig("character_generation")) {
      toast.error(aiManager.featureNotConfiguredMessage("character_generation"));
      return;
    }

    const snapshotPrompt = contactSheetPrompt;
    const snapshotStyleId = styleId;
    const snapshotAspectRatio = contactSheetAspectRatio;
    const snapshotLayout = contactSheetLayout;
    const snapshotViewpoints = [...(pendingViewpoints.length > 0
      ? pendingViewpoints.filter((viewpoint) => viewpoint.pageIndex === currentPageIndex)
      : extractedViewpoints)];
    const snapshotCurrentPageIndex = currentPageIndex;
    const snapshotPendingPrompts = [...pendingContactSheetPrompts];
    const snapshotName = name.trim() || selectedScene?.name || "未命名场景";
    const snapshotLocation = location.trim() || selectedScene?.location || snapshotName;
    const snapshotTime = time || selectedScene?.time || "day";
    const snapshotAtmosphere = atmosphere || selectedScene?.atmosphere || "peaceful";
    const snapshotVisualPrompt = visualPrompt || selectedScene?.visualPrompt;
    const snapshotTags = [...tags];
    const snapshotNotes = notes;
    const snapshotProjectId = resourceProjectId;

    console.log("[AutoContactSheet] 快照状态:", {
      promptLength: contactSheetPrompt.length,
      aspectRatio: snapshotAspectRatio,
      layout: snapshotLayout,
      viewpointsCount: snapshotViewpoints.length,
      pendingViewpointsTotal: pendingViewpoints.length,
      extractedViewpointsCount: extractedViewpoints.length,
      currentPageIndex,
    });

    let parentSceneId: string;
    if (selectedScene) {
      parentSceneId = selectedScene.id;
    } else {
      parentSceneId = addScene({
        name: snapshotName,
        location: snapshotLocation,
        time: snapshotTime,
        atmosphere: snapshotAtmosphere,
        styleId: snapshotStyleId || undefined,
        folderId: currentFolderId,
        projectId: snapshotProjectId ?? undefined,
        visualPrompt: snapshotVisualPrompt,
        tags: snapshotTags.length > 0 ? snapshotTags : undefined,
        notes: snapshotNotes.trim() || undefined,
      });
      selectScene(parentSceneId);
      onSceneCreated?.(parentSceneId);
    }

    setContactSheetTask(parentSceneId, { status: "generating", progress: 10, message: "正在生成联合图..." });
    toast.info(`场景「${snapshotName}」联合图开始生成...`);
    setContactSheetPrompt(null);
    setContactSheetPromptZh(null);
    setContactSheetImage(null);
    setSplitViewpointImages({});
    setIsGeneratingContactSheet(false);

    void (async () => {
      try {
        const featureConfig = aiManager.featureConfig("character_generation");
        if (!featureConfig) throw new Error(aiManager.featureNotConfiguredMessage("character_generation"));
        const apiKey = featureConfig.apiKey;
        const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "") || "";
        const model = featureConfig.models?.[0] || "";
        if (!apiKey || !baseUrl || !model) throw new Error("图片生成 API 未配置");

        const finalPrompt = buildAutoContactSheetPrompt({
          prompt: snapshotPrompt,
          styleId: snapshotStyleId,
          aspectRatio: snapshotAspectRatio,
          layout: snapshotLayout,
          pageLayout: snapshotPendingPrompts[snapshotCurrentPageIndex]?.gridLayout,
        });
        setContactSheetTask(parentSceneId, { status: "generating", progress: 30, message: "正在调用 AI 生成..." });
        const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
        const result = await aiManager.imageGrid({
          model,
          prompt: finalPrompt,
          apiKey,
          baseUrl,
          aspectRatio: snapshotAspectRatio,
          resolution: imageSettings.defaultResolution,
          keyManager: featureConfig.keyManager,
        });
        const generatedImageUrl = result.imageUrl;
        if (!generatedImageUrl) throw new Error("图片生成失败：未返回图片 URL");

        setContactSheetTask(parentSceneId, { status: "splitting", progress: 60, message: "正在切割视角..." });
        const currentPagePrompt = snapshotPendingPrompts[snapshotCurrentPageIndex];
        const dimensions = currentPagePrompt?.gridLayout || getLayoutDimensions(snapshotLayout, snapshotAspectRatio);
        const expectedCount = dimensions.rows * dimensions.cols;
        let imageForSplit = generatedImageUrl;
        if (/^https?:\/\//.test(generatedImageUrl)) {
          try {
            const response = await fetch(generatedImageUrl);
            const blob = await response.blob();
            imageForSplit = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (error) {
            console.warn("[AutoContactSheet] HTTP→base64 转换失败，使用原URL:", error);
          }
        }

        const splitResults = await splitStoryboardImage(imageForSplit, {
          aspectRatio: snapshotAspectRatio,
          resolution: imageSettings.defaultResolution === "4K" ? "4K" : "2K",
          sceneCount: expectedCount,
          options: {
            expectedRows: dimensions.rows,
            expectedCols: dimensions.cols,
            filterEmpty: false,
            edgeMarginPercent: 0.02,
          },
        });
        const { viewpoints: effectiveViewpoints, images } = mapAutoContactSheetResults(
          splitResults,
          snapshotViewpoints,
          dimensions.cols,
        );

        setContactSheetTask(parentSceneId, { status: "saving", progress: 80, message: "正在保存视角..." });
        const parentScene = useSceneStore.getState().scenes.find((scene) => scene.id === parentSceneId);
        if (!parentScene) throw new Error("父场景已被删除");
        const parentSceneName = parentScene.name || parentScene.location;
        const viewpointsToSave = effectiveViewpoints.map((viewpoint) => ({
          ...viewpoint,
          shotIds: [...(viewpoint.shotIds || [])],
        }));
        const matchedScene = scriptScenes.find((scene) => (
          scene.name === parentSceneName
          || scene.location === parentSceneName
          || (!!scene.name && parentSceneName.includes(scene.name))
          || (!!scene.location && parentSceneName.includes(scene.location))
        ));
        const sceneShots = matchedScene ? allShots.filter((shot) => shot.sceneRefId === matchedScene.id) : [];
        if (sceneShots.length > 0) {
          const assignedShotIds = new Set(viewpointsToSave.flatMap((viewpoint) => viewpoint.shotIds || []));
          for (const shot of sceneShots.filter((item) => !assignedShotIds.has(item.id))) {
            const shotIndex = sceneShots.findIndex((item) => item.id === shot.id);
            viewpointsToSave[shotIndex % viewpointsToSave.length].shotIds.push(shot.id);
          }
        }

        const createdVariantIds: string[] = [];
        for (const viewpoint of viewpointsToSave) {
          const image = images[viewpoint.id];
          if (!image) continue;
          const variantName = `${parentSceneName}-${viewpoint.name}`;
          const safeName = variantName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
          const localPath = await saveImageToLocal(image.imageUrl, "scenes", `${safeName}_${Date.now()}.png`);
          const variantId = addScene({
            name: variantName,
            location: parentScene.location,
            time: parentScene.time || "day",
            atmosphere: parentScene.atmosphere || "peaceful",
            visualPrompt: parentScene.visualPrompt,
            referenceImage: localPath,
            styleId: parentScene.styleId || snapshotStyleId,
            folderId: parentScene.folderId,
            projectId: parentScene.projectId ?? snapshotProjectId ?? undefined,
            tags: parentScene.tags,
            parentSceneId: parentScene.id,
            viewpointId: viewpoint.id,
            viewpointName: viewpoint.name,
            shotIds: viewpoint.shotIds,
            isViewpointVariant: true,
          });
          createdVariantIds.push(variantId);
          addMediaFromUrl({
            url: localPath,
            name: `场景-${variantName}`,
            type: "image",
            source: "ai-image",
            folderId: getOrCreateCategoryFolder("ai-image"),
            projectId: parentScene.projectId ?? snapshotProjectId ?? undefined,
          });
        }

        let localContactSheet = imageForSplit || generatedImageUrl;
        if (localContactSheet && (localContactSheet.startsWith("data:") || localContactSheet.startsWith("http"))) {
          const savedPath = await saveImageToLocal(
            localContactSheet,
            "scenes",
            `contact-sheet-${parentScene.id}_${Date.now()}.png`,
          );
          if (savedPath.startsWith("local-image://")) {
            localContactSheet = savedPath;
            addMediaFromUrl({
              url: savedPath,
              name: `联合图-${parentSceneName}`,
              type: "image",
              source: "ai-image",
              folderId: getOrCreateCategoryFolder("ai-image"),
              projectId: parentScene.projectId ?? snapshotProjectId ?? undefined,
            });
          }
        }
        updateScene(parentScene.id, {
          contactSheetImage: localContactSheet,
          viewpoints: viewpointsToSave.map((viewpoint) => ({
            id: viewpoint.id,
            name: viewpoint.name,
            nameEn: viewpoint.nameEn,
            shotIds: viewpoint.shotIds,
            keyProps: viewpoint.keyProps,
            gridIndex: viewpoint.gridIndex,
          })),
        });

        setContactSheetTask(parentSceneId, {
          status: "done",
          progress: 100,
          message: `完成，已创建 ${createdVariantIds.length} 个子场景`,
        });
        if (createdVariantIds.length > 0) {
          toast.success(`场景「${parentSceneName}」联合图已切割保存，共 ${createdVariantIds.length} 个视角子场景（点击展开查看）`);
        } else {
          toast.warning(`场景「${parentSceneName}」联合图已保存，但未能创建子场景（切割结果: ${splitResults.length} 个）`);
        }
        setTimeout(() => setContactSheetTask(parentSceneId, null), 3000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[AutoContactSheet] 自动流水线失败:", error);
        setContactSheetTask(parentSceneId, { status: "error", progress: 0, message });
        toast.error(`场景联合图自动生成失败: ${message}`);
        setTimeout(() => setContactSheetTask(parentSceneId, null), 10000);
      }
    })();
  }, [
    addMediaFromUrl, addScene, allShots, atmosphere, contactSheetAspectRatio,
    contactSheetLayout, contactSheetPrompt, currentFolderId, currentPageIndex,
    extractedViewpoints, getOrCreateCategoryFolder, location, name, notes,
    onSceneCreated, pendingContactSheetPrompts, pendingViewpoints, resourceProjectId,
    scriptScenes, selectScene, selectedScene, setContactSheetImage,
    setContactSheetPrompt, setContactSheetPromptZh, setContactSheetTask,
    setIsGeneratingContactSheet, setSplitViewpointImages, styleId, tags, time,
    updateScene, visualPrompt,
  ]);
}
