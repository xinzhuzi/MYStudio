import { aiManager } from "@/lib/ai/ai-manager";
import { buildImageWithRoles, saveVideoLocally } from "@/lib/ai/video-generator";
import type { SplitScene } from "@/stores/director-store";
import { useDirectorStore } from "@/stores/director-store";
import type { SClassAspectRatio, SClassResolution, VideoGenStatus } from "@/stores/sclass-store";
import { toast } from "sonner";
import { runSClassVideoWithKeyRotation } from "./sclass-video-retry";

type SingleShotVideoUpdate = {
  videoStatus?: VideoGenStatus;
  videoProgress?: number;
  videoUrl?: string | null;
  videoError?: string | null;
};

type RunSClassSingleShotGenerationOptions = {
  scene: SplitScene;
  activeProjectId: string | null;
  updateSingleShotVideo: (sceneId: number, update: SingleShotVideoUpdate) => void;
};

export async function runSClassSingleShotGeneration({
  scene,
  activeProjectId,
  updateSingleShotVideo,
}: RunSClassSingleShotGenerationOptions): Promise<boolean> {
  const featureConfig = aiManager.featureConfig("video_generation");
  if (!featureConfig) {
    toast.error(aiManager.featureNotConfiguredMessage("video_generation"));
    return false;
  }

  const keyManager = featureConfig.keyManager;
  if (!keyManager.getCurrentKey()) {
    toast.error("请先在设置中配置视频生成 API Key");
    return false;
  }
  if (!activeProjectId) return false;

  const directorState = useDirectorStore.getState();
  const directorProject = directorState.projects[directorState.activeProjectId || ""];
  const storyboardConfig = directorProject?.storyboardConfig;
  const aspectRatio = (storyboardConfig?.aspectRatio || "16:9") as SClassAspectRatio;
  const videoResolution = (storyboardConfig?.videoResolution || "720p") as SClassResolution;

  updateSingleShotVideo(scene.id, {
    videoStatus: "generating",
    videoProgress: 0,
    videoError: null,
  });

  try {
    const firstFrameUrl = scene.imageDataUrl || scene.imageHttpUrl || undefined;
    const imageWithRoles = await buildImageWithRoles(firstFrameUrl, undefined);
    const prompt = scene.videoPrompt
      || scene.videoPromptZh
      || `分镜 ${scene.id + 1} 视频`;
    const duration = Math.max(4, Math.min(15, scene.duration || 5));
    const videoUrl = await runSClassVideoWithKeyRotation({
      keyManager,
      label: "Single shot",
      context: { sceneId: scene.id },
      invoke: (currentApiKey) => aiManager.video(
        currentApiKey,
        prompt,
        duration,
        aspectRatio,
        imageWithRoles,
        (progress) => updateSingleShotVideo(scene.id, { videoProgress: progress }),
        keyManager,
        featureConfig.platform,
        videoResolution,
      ),
    });
    const localUrl = await saveVideoLocally(videoUrl, scene.id);

    updateSingleShotVideo(scene.id, {
      videoStatus: "completed",
      videoProgress: 100,
      videoUrl: localUrl,
      videoError: null,
    });
    toast.success(`分镜 ${scene.id + 1} 生成完成`);
    return true;
  } catch (error) {
    const generationError = error as Error;
    updateSingleShotVideo(scene.id, {
      videoStatus: "failed",
      videoProgress: 0,
      videoError: generationError.message,
    });
    toast.error(`分镜 ${scene.id + 1} 生成失败: ${generationError.message}`);
    return false;
  }
}
