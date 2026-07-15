import { useCallback } from "react";
import type { Scene } from "@/stores/scene-store";
import { useSceneStore } from "@/stores/scene-store";
import type { PendingViewpointData, ContactSheetPromptSet } from "@/stores/media-panel-store";
import type { SceneViewpoint } from "@/lib/script/scene-viewpoint-generator";
import type { ScriptScene, Shot } from "@/types/script";
import { saveImageToLocal } from "@/lib/image-storage";
import { toast } from "sonner";

type SceneStoreState = ReturnType<typeof useSceneStore.getState>;
type ViewpointImages = Record<string, { imageUrl: string; gridIndex: number }>;

interface UseContactSheetSaveOptions {
  selectedScene: Scene | null;
  splitViewpointImages: ViewpointImages;
  contactSheetImage: string | null;
  extractedViewpoints: SceneViewpoint[];
  pendingViewpoints: PendingViewpointData[];
  pendingContactSheetPrompts: ContactSheetPromptSet[];
  currentPageIndex: number;
  allShots: Shot[];
  scriptScenes: ScriptScene[];
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  styleId: string;
  currentFolderId: string | null;
  resourceProjectId: string | null;
  addScene: SceneStoreState["addScene"];
  updateScene: SceneStoreState["updateScene"];
  selectScene: SceneStoreState["selectScene"];
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
  setContactSheetPrompt: (prompt: string | null) => void;
  setContactSheetPromptZh: (prompt: string | null) => void;
  setContactSheetImage: (image: string | null) => void;
  setSplitViewpointImages: (images: ViewpointImages) => void;
  setExtractedViewpoints: (viewpoints: SceneViewpoint[]) => void;
  setPendingViewpoints: (viewpoints: PendingViewpointData[]) => void;
  setPendingContactSheetPrompts: (prompts: ContactSheetPromptSet[]) => void;
}

export function useContactSheetSave(options: UseContactSheetSaveOptions) {
  return useCallback(async () => {
    if (Object.keys(options.splitViewpointImages).length === 0) {
      toast.error("没有可保存的视角图片");
      return;
    }

    let parentScene = options.selectedScene;
    if (!parentScene) {
      const sceneName = options.name.trim() || "未命名场景";
      const sceneLocation = options.location.trim() || sceneName;
      const newParentId = options.addScene({
        name: sceneName,
        location: sceneLocation,
        time: options.time || "day",
        atmosphere: options.atmosphere || "peaceful",
        styleId: options.styleId || undefined,
        folderId: options.currentFolderId,
        projectId: options.resourceProjectId ?? undefined,
      });
      parentScene = useSceneStore.getState().scenes.find((scene) => scene.id === newParentId) || null;
      if (!parentScene) {
        toast.error("创建父场景失败");
        return;
      }
      options.selectScene(newParentId);
      toast.success(`已自动创建场景「${sceneName}」`);
    }

    const currentPageViewpoints = options.pendingViewpoints.filter((viewpoint) => viewpoint.pageIndex === options.currentPageIndex);
    let viewpointsToUse = currentPageViewpoints.length > 0 ? currentPageViewpoints : options.extractedViewpoints;
    if (viewpointsToUse.length === 0) {
      toast.error("没有视角数据");
      return;
    }

    const sceneName = parentScene.name || parentScene.location || "";
    const matchedScene = options.scriptScenes.find((scene) => (
      scene.name === sceneName
      || scene.location === sceneName
      || (!!scene.name && sceneName.includes(scene.name))
      || (!!scene.location && sceneName.includes(scene.location))
    ));
    const sceneShots = matchedScene
      ? options.allShots.filter((shot) => shot.sceneRefId === matchedScene.id)
      : [];
    if (sceneShots.length > 0) {
      const assignedShotIds = new Set(viewpointsToUse.flatMap((viewpoint) => viewpoint.shotIds || []));
      const unassignedShots = sceneShots.filter((shot) => !assignedShotIds.has(shot.id));
      if (unassignedShots.length > 0) {
        viewpointsToUse = viewpointsToUse.map((viewpoint) => ({
          ...viewpoint,
          shotIds: [...(viewpoint.shotIds || [])],
        })) as typeof viewpointsToUse;
        for (const shot of unassignedShots) {
          const shotIndex = sceneShots.findIndex((item) => item.id === shot.id);
          viewpointsToUse[shotIndex % viewpointsToUse.length].shotIds.push(shot.id);
        }
      }
    }

    const parentSceneName = parentScene.name || parentScene.location;
    const createdVariantIds: string[] = [];
    for (const viewpoint of viewpointsToUse) {
      const image = options.splitViewpointImages[viewpoint.id];
      if (!image) continue;
      const variantName = `${parentSceneName}-${viewpoint.name}`;
      const safeName = variantName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      const localPath = await saveImageToLocal(image.imageUrl, "scenes", `${safeName}_${Date.now()}.png`);
      if (!localPath.startsWith("local-image://")) {
        console.warn(`[ContactSheet] 视角图片本地保存失败: ${viewpoint.name}, 将使用原始 URL`);
      }
      const variantId = options.addScene({
        name: variantName,
        location: parentScene.location,
        time: parentScene.time || "day",
        atmosphere: parentScene.atmosphere || "peaceful",
        visualPrompt: parentScene.visualPrompt,
        referenceImage: localPath,
        styleId: parentScene.styleId || options.styleId,
        folderId: parentScene.folderId,
        projectId: parentScene.projectId ?? options.resourceProjectId ?? undefined,
        tags: parentScene.tags,
        parentSceneId: parentScene.id,
        viewpointId: viewpoint.id,
        viewpointName: viewpoint.name,
        shotIds: viewpoint.shotIds,
        isViewpointVariant: true,
      });
      createdVariantIds.push(variantId);
      options.addMediaFromUrl({
        url: localPath,
        name: `场景-${variantName}`,
        type: "image",
        source: "ai-image",
        folderId: options.getOrCreateCategoryFolder("ai-image"),
        projectId: parentScene.projectId ?? options.resourceProjectId ?? undefined,
      });
    }

    const viewpoints = viewpointsToUse.map((viewpoint) => ({
      id: viewpoint.id,
      name: viewpoint.name,
      nameEn: viewpoint.nameEn,
      shotIds: viewpoint.shotIds,
      keyProps: viewpoint.keyProps,
      gridIndex: viewpoint.gridIndex,
    }));
    let localContactSheet = options.contactSheetImage;
    if (options.contactSheetImage?.startsWith("data:")) {
      const contactSheetPath = await saveImageToLocal(
        options.contactSheetImage,
        "scenes",
        `contact-sheet-${parentScene.id}_${Date.now()}.png`,
      );
      if (contactSheetPath.startsWith("local-image://")) {
        localContactSheet = contactSheetPath;
        options.addMediaFromUrl({
          url: contactSheetPath,
          name: `联合图-${parentSceneName}`,
          type: "image",
          source: "ai-image",
          folderId: options.getOrCreateCategoryFolder("ai-image"),
          projectId: parentScene.projectId ?? options.resourceProjectId ?? undefined,
        });
      }
    }
    options.updateScene(parentScene.id, { contactSheetImage: localContactSheet ?? undefined, viewpoints });
    options.setSavedChildSceneIds(createdVariantIds);
    toast.success(`已创建 ${createdVariantIds.length} 个视角变体场景`);

    options.setContactSheetPrompt(null);
    options.setContactSheetPromptZh(null);
    options.setContactSheetImage(null);
    options.setSplitViewpointImages({});
    options.setExtractedViewpoints([]);
    options.setPendingViewpoints([]);
    options.setPendingContactSheetPrompts([]);
  }, [options]);
}
