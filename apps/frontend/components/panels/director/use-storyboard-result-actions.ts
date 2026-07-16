import { useCallback } from "react";
import { toast } from "sonner";
import { persistSceneImage } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";
import type { useMediaStore } from "@/stores/media-store";
import type { StoryboardGenerationUiController } from "./use-storyboard-generation-ui";

type DirectorState = ReturnType<typeof import("@/stores/director-store").useDirectorStore.getState>;
type MediaState = ReturnType<typeof useMediaStore.getState>;

type UseStoryboardResultActionsOptions = {
  scenes: SplitScene[];
  controller: StoryboardGenerationUiController;
  mediaProjectId?: string;
  getImageFolderId: () => string;
  addMediaFromUrl: MediaState["addMediaFromUrl"];
  updateSplitSceneImage: DirectorState["updateSplitSceneImage"];
  updateSplitSceneEndFrame: DirectorState["updateSplitSceneEndFrame"];
};

export function useStoryboardResultActions({
  scenes,
  controller,
  mediaProjectId,
  getImageFolderId,
  addMediaFromUrl,
  updateSplitSceneImage,
  updateSplitSceneEndFrame,
}: UseStoryboardResultActionsOptions) {
  const {
    quadGridResult,
    quadGridTarget,
    setQuadGridResultOpen,
    setQuadGridResult,
    setQuadGridTarget,
    angleSwitchResult,
    angleSwitchTarget,
    selectedHistoryIndex,
    setAngleSwitchResultOpen,
    setAngleSwitchResult,
    setAngleSwitchTarget,
    setSelectedHistoryIndex,
  } = controller;

  const handleApplyQuadGrid = useCallback(async (imageIndex: number) => {
    if (!quadGridResult || !quadGridTarget) return;
    const imageToApply = quadGridResult.images[imageIndex];
    if (!imageToApply) return;
    const frameType = quadGridTarget.type === "start" ? "first" as const : "end" as const;
    const { localPath, httpUrl } = await persistSceneImage(imageToApply, quadGridTarget.sceneId, frameType);
    if (quadGridTarget.type === "start") {
      updateSplitSceneImage(quadGridTarget.sceneId, localPath, undefined, undefined, httpUrl || undefined);
    } else {
      updateSplitSceneEndFrame(quadGridTarget.sceneId, localPath, undefined, httpUrl || undefined);
    }
    setQuadGridResultOpen(false);
    setQuadGridResult(null);
    setQuadGridTarget(null);
    toast.success(`已应用到${quadGridTarget.type === "start" ? "首帧" : "尾帧"}`);
  }, [quadGridResult, quadGridTarget, setQuadGridResult, setQuadGridResultOpen, setQuadGridTarget, updateSplitSceneEndFrame, updateSplitSceneImage]);

  const handleCopyQuadGridToScene = useCallback(async (
    imageIndex: number,
    targetSceneId: number,
    targetFrameType: "start" | "end",
  ) => {
    if (!quadGridResult) return;
    const imageToApply = quadGridResult.images[imageIndex];
    if (!imageToApply) return;
    const frameType = targetFrameType === "start" ? "first" as const : "end" as const;
    const { localPath, httpUrl } = await persistSceneImage(imageToApply, targetSceneId, frameType);
    if (targetFrameType === "start") {
      updateSplitSceneImage(targetSceneId, localPath, undefined, undefined, httpUrl || undefined);
    } else {
      updateSplitSceneEndFrame(targetSceneId, localPath, undefined, httpUrl || undefined);
    }
    toast.success(`已复制到分镜 ${targetSceneId + 1} 的${targetFrameType === "start" ? "首帧" : "尾帧"}`);
  }, [quadGridResult, updateSplitSceneEndFrame, updateSplitSceneImage]);

  const handleSaveQuadGridToLibrary = useCallback((imageIndex: number) => {
    if (!quadGridResult || !quadGridTarget) return;
    const imageToSave = quadGridResult.images[imageIndex];
    if (!imageToSave) return;
    addMediaFromUrl({
      url: imageToSave,
      name: `四宫格-${quadGridResult.variationType}-${imageIndex + 1}`,
      type: "image",
      source: "ai-image",
      folderId: getImageFolderId(),
      projectId: mediaProjectId,
    });
    toast.success("已保存到素材库");
  }, [addMediaFromUrl, getImageFolderId, mediaProjectId, quadGridResult, quadGridTarget]);

  const handleSaveAllQuadGridToLibrary = useCallback(() => {
    if (!quadGridResult) return;
    const folderId = getImageFolderId();
    quadGridResult.images.forEach((image, index) => {
      addMediaFromUrl({
        url: image,
        name: `四宫格-${quadGridResult.variationType}-${index + 1}`,
        type: "image",
        source: "ai-image",
        folderId,
        projectId: mediaProjectId,
      });
    });
    toast.success(`已保存 ${quadGridResult.images.length} 张图片到素材库`);
  }, [addMediaFromUrl, getImageFolderId, mediaProjectId, quadGridResult]);

  const handleApplyAngleSwitch = useCallback(async () => {
    if (!angleSwitchResult || !angleSwitchTarget) return;
    const scene = scenes.find((item) => item.id === angleSwitchTarget.sceneId);
    const history = angleSwitchTarget.type === "start"
      ? (scene?.startFrameAngleSwitchHistory || [])
      : (scene?.endFrameAngleSwitchHistory || []);
    const imageToApply = selectedHistoryIndex >= 0 && history[selectedHistoryIndex]
      ? history[selectedHistoryIndex].imageUrl
      : angleSwitchResult.newImage;
    const frameType = angleSwitchTarget.type === "start" ? "first" as const : "end" as const;
    const { localPath, httpUrl } = await persistSceneImage(imageToApply, angleSwitchTarget.sceneId, frameType);
    if (angleSwitchTarget.type === "start") {
      updateSplitSceneImage(angleSwitchTarget.sceneId, localPath, undefined, undefined, httpUrl || undefined);
    } else {
      updateSplitSceneEndFrame(angleSwitchTarget.sceneId, localPath, undefined, httpUrl || undefined);
    }
    setAngleSwitchResultOpen(false);
    setAngleSwitchResult(null);
    setAngleSwitchTarget(null);
    setSelectedHistoryIndex(-1);
    toast.success("视角已应用");
  }, [angleSwitchResult, angleSwitchTarget, scenes, selectedHistoryIndex, setAngleSwitchResult, setAngleSwitchResultOpen, setAngleSwitchTarget, setSelectedHistoryIndex, updateSplitSceneEndFrame, updateSplitSceneImage]);

  return {
    handleApplyQuadGrid,
    handleCopyQuadGridToScene,
    handleSaveQuadGridToLibrary,
    handleSaveAllQuadGridToLibrary,
    handleApplyAngleSwitch,
  };
}
