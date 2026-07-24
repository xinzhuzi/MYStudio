import { aiManager } from "@/lib/ai/ai-manager";
import { getCinematographyProfile } from "@/lib/constants/cinematography-profiles";
import { getMediaType, getStylePrompt } from "@/lib/constants/visual-styles";
import { buildVideoPrompt } from "@/lib/generation/prompt-builder";
import type { DirectorProjectData, DirectorStore, SplitScene } from "@/stores/director-store";
import { toast } from "sonner";

export type SClassLegacyVideoGenerationOptions = {
  scenes: SplitScene[];
  storyboardConfig: DirectorProjectData["storyboardConfig"];
  projectData: Pick<DirectorProjectData, "cinematographyProfileId"> | null | undefined;
  currentStyleId: string | null;
  concurrency: number;
  setIsGenerating: (isGenerating: boolean) => void;
  setCurrentGeneratingId: (sceneId: number | null) => void;
  updateSplitSceneVideo: DirectorStore["updateSplitSceneVideo"];
};

export function normalizeSClassLegacyConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency) || concurrency <= 0) return 1;
  return Math.max(1, Math.floor(concurrency));
}

/**
 * Compatibility path retained for callers of the old S-Class batch button.
 * New flows use the typed group/single-shot controllers instead.
 */
export function createSClassLegacyVideoGenerator({
  scenes,
  storyboardConfig,
  projectData,
  currentStyleId,
  concurrency,
  setIsGenerating,
  setCurrentGeneratingId,
  updateSplitSceneVideo,
}: SClassLegacyVideoGenerationOptions) {
  return async function generateLegacyVideos() {
    console.warn("[DEPRECATED] handleGenerateVideos 已废弃，请使用 S级批量生成");
    const batchSize = normalizeSClassLegacyConcurrency(concurrency);
    if (scenes.length === 0) {
      toast.error("没有可生成的分镜");
      return;
    }

    const featureConfig = aiManager.featureConfig("video_generation");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("video_generation"));
      return;
    }
    const apiKey = featureConfig.keyManager.getCurrentKey() || "";
    if (!apiKey) {
      toast.error("请先在设置中配置图片生成服务映射");
      return;
    }
    const provider = featureConfig.platform;
    const scenesWithoutPrompts = scenes.filter((scene) => !scene.videoPrompt.trim());
    if (scenesWithoutPrompts.length > 0) {
      toast.warning(`还有 ${scenesWithoutPrompts.length} 个分镜没有提示词，将使用默认提示词`);
    }
    const scenesToGenerate = scenes.filter(
      (scene) => scene.videoStatus === "idle" || scene.videoStatus === "failed",
    );
    if (scenesToGenerate.length === 0) {
      toast.info("所有分镜已生成或正在生成中");
      return;
    }

    setIsGenerating(true);
    toast.info(`开始串行生成 ${scenesToGenerate.length} 个视频...每次处理 ${batchSize} 个`);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

    for (let index = 0; index < scenesToGenerate.length; index += batchSize) {
      const batch = scenesToGenerate.slice(index, index + batchSize);
      await Promise.all(batch.map(async (scene) => {
        setCurrentGeneratingId(scene.id);
        try {
          updateSplitSceneVideo(scene.id, {
            videoStatus: "uploading",
            videoProgress: 0,
            videoError: null,
          });

          let imageUrl = scene.imageDataUrl;
          if (scene.imageDataUrl.startsWith("data:")) {
            const response = await fetch(scene.imageDataUrl);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append("file", blob, `scene-${scene.id}.png`);
            const uploadResponse = await fetch(`${baseUrl}/api/upload`, {
              method: "POST",
              body: formData,
            });
            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              imageUrl = uploadData.url || scene.imageDataUrl;
            }
          }

          updateSplitSceneVideo(scene.id, { videoStatus: "generating", videoProgress: 20 });
          const cinProfile = projectData?.cinematographyProfileId
            ? getCinematographyProfile(projectData.cinematographyProfileId)
            : undefined;
          const fullPrompt = buildVideoPrompt(scene, cinProfile, {
            styleTokens: [getStylePrompt(currentStyleId)],
            aspectRatio: storyboardConfig.aspectRatio,
            mediaType: getMediaType(currentStyleId),
          });
          const videoDuration = Math.max(4, Math.min(12, scene.duration || 5));
          const submitResponse = await fetch(`${baseUrl}/api/ai/video`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageUrl,
              prompt: fullPrompt || scene.videoPrompt || `分镜 ${scene.id + 1} 动态效果`,
              aspectRatio: storyboardConfig.aspectRatio,
              duration: videoDuration,
              apiKey,
              provider,
            }),
          });
          if (!submitResponse.ok) {
            const errorData = await submitResponse.json().catch(() => ({}));
            throw new Error(errorData.error || `Video API failed: ${submitResponse.status}`);
          }
          const submitData = await submitResponse.json();
          if (submitData.videoUrl && submitData.status === "completed") {
            updateSplitSceneVideo(scene.id, {
              videoStatus: "completed",
              videoProgress: 100,
              videoUrl: submitData.videoUrl,
            });
            toast.success(`分镜 ${scene.id + 1} 视频生成完成`);
            return;
          }

          if (submitData.taskId) {
            const pollInterval = 3000;
            const maxAttempts = 120;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
              const progress = Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99);
              updateSplitSceneVideo(scene.id, { videoProgress: progress });
              const statusResponse = await fetch(
                `${baseUrl}/api/ai/task/${submitData.taskId}?apiKey=${encodeURIComponent(apiKey)}&provider=${provider}&type=video`,
              );
              if (!statusResponse.ok) {
                throw new Error(`Failed to check task status: ${statusResponse.status}`);
              }
              const statusData = await statusResponse.json();
              const status = statusData.status?.toLowerCase();
              if (status === "completed" || status === "success") {
                const videoUrl = statusData.videoUrl || statusData.url || statusData.resultUrl;
                if (!videoUrl) throw new Error("Task completed but no video URL");
                updateSplitSceneVideo(scene.id, {
                  videoStatus: "completed",
                  videoProgress: 100,
                  videoUrl,
                });
                toast.success(`分镜 ${scene.id + 1} 视频生成完成`);
                return;
              }
              if (status === "failed" || status === "error") {
                throw new Error(statusData.error || "Video generation failed");
              }
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }
            throw new Error("视频生成超时");
          }
          throw new Error("Invalid API response");
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          console.error(`[SplitScenes] Scene ${scene.id} video generation failed:`, error);
          updateSplitSceneVideo(scene.id, {
            videoStatus: "failed",
            videoProgress: 0,
            videoError: message,
          });
          toast.error(`分镜 ${scene.id + 1} 生成失败: ${message}`);
        }
      }));
    }

    setIsGenerating(false);
    setCurrentGeneratingId(null);
    const completedCount = scenes.filter((scene) => scene.videoStatus === "completed").length;
    if (completedCount === scenes.length) {
      toast.success("所有视频生成完成！");
    }
  };
}
