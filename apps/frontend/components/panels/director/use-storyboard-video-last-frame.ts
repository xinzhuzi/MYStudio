import { useCallback } from "react";
import { toast } from "sonner";
import { extractLastFrameFromVideo } from "@/lib/ai/video-generator";
import { persistSceneImage } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";

type StoryboardVideoScene = Pick<SplitScene, "id" | "videoUrl" | "width" | "height">;

type UseStoryboardVideoLastFrameOptions = {
  scenes: readonly StoryboardVideoScene[];
  setIsExtractingFrame: (isExtracting: boolean) => void;
  updateSplitSceneImage: (
    sceneId: number,
    imageDataUrl: string,
    width?: number,
    height?: number,
    httpUrl?: string,
  ) => void;
};

export function useStoryboardVideoLastFrame({
  scenes,
  setIsExtractingFrame,
  updateSplitSceneImage,
}: UseStoryboardVideoLastFrameOptions) {
  const extractVideoLastFrame = useCallback(async (sceneId: number) => {
    const sceneIndex = scenes.findIndex((scene) => scene.id === sceneId);
    const scene = scenes[sceneIndex];
    if (!scene?.videoUrl) {
      toast.error("请先生成视频");
      return;
    }

    const nextScene = scenes[sceneIndex + 1];
    if (!nextScene) {
      toast.error("这是最后一个分镜，无法插入到下一个分镜");
      return;
    }

    setIsExtractingFrame(true);
    try {
      const lastFrameBase64 = await extractLastFrameFromVideo(scene.videoUrl, 0.1);
      if (!lastFrameBase64) {
        toast.error("提取帧失败");
        return;
      }

      const persisted = await persistSceneImage(lastFrameBase64, nextScene.id, "first");
      updateSplitSceneImage(
        nextScene.id,
        persisted.localPath,
        nextScene.width,
        nextScene.height,
        persisted.httpUrl || undefined,
      );
      toast.success(`分镜 ${sceneId + 1} 尾帧已插入到分镜 ${nextScene.id + 1} 首帧`);
    } catch (error) {
      console.error("[SplitScenes] Extract last frame error:", error);
      toast.error("提取帧失败");
    } finally {
      setIsExtractingFrame(false);
    }
  }, [scenes, setIsExtractingFrame, updateSplitSceneImage]);

  return { extractVideoLastFrame };
}
