import { aiManager } from "@/lib/ai/ai-manager";
import { getMediaType, getStylePrompt } from "@/lib/constants/visual-styles";
import { getCinematographyProfile } from "@/lib/constants/cinematography-profiles";
import { buildVideoPrompt } from "@/lib/generation/prompt-builder";
import { saveVideoToLocal } from "@/lib/image-storage";
import { persistSceneImage } from "@/lib/utils/image-persist";
import { convertToHttpUrl, extractLastFrameFromVideo, isContentModerationError } from "@/lib/ai/video-generator";
import type { DirectorProjectData, DirectorStore, SplitScene } from "@/stores/director-store";
import { toast } from "sonner";

type SClassSingleVideoGenerationOptions = {
  scenes: readonly SplitScene[];
  storyboardConfig: Pick<DirectorProjectData["storyboardConfig"], "aspectRatio" | "videoResolution">;
  projectData: Pick<DirectorProjectData, "cinematographyProfileId"> | null | undefined;
  currentStyleId: string;
  setIsGenerating: (isGenerating: boolean) => void;
  setCurrentGeneratingId: (sceneId: number | null) => void;
  updateSplitSceneVideo: DirectorStore["updateSplitSceneVideo"];
  updateSplitSceneEndFrame: DirectorStore["updateSplitSceneEndFrame"];
  autoSaveVideoToLibrary: (sceneId: number, videoUrl: string, thumbnailUrl?: string, duration?: number) => string;
  getCharacterReferenceImages: (characterIds: string[], variationMap?: Record<string, string>) => string[];
};

export function createSClassSingleVideoGenerator(options: SClassSingleVideoGenerationOptions) {
  return async (sceneId: number) => {
    const scene = options.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;

    const featureConfig = aiManager.featureConfig("video_generation");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("video_generation"));
      return;
    }
    const platform = featureConfig.platform;
    const model = featureConfig.models?.[0];
    if (!model) {
      toast.error("请先在设置中配置视频生成模型");
      return;
    }
    const videoBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    if (!videoBaseUrl) {
      toast.error("请先在设置中配置视频生成服务映射");
      return;
    }
    const keyManager = featureConfig.keyManager;
    const apiKey = keyManager.getCurrentKey() || "";
    if (!apiKey) {
      toast.error(`请先配置 ${platform} API Key`);
      return;
    }

    options.setIsGenerating(true);
    options.setCurrentGeneratingId(sceneId);

    try {
      options.updateSplitSceneVideo(sceneId, {
        videoStatus: "uploading",
        videoProgress: 0,
        videoError: null,
        videoUrl: null,
      });

      let firstFrameUrl = scene.imageDataUrl;
      const hasValidHttpUrl = Boolean(scene.imageHttpUrl?.startsWith("http"));
      if (firstFrameUrl && !firstFrameUrl.startsWith("http://") && !firstFrameUrl.startsWith("https://")) {
        if (hasValidHttpUrl && scene.imageSource === "ai-generated") {
          firstFrameUrl = scene.imageHttpUrl || "";
        }
      }
      if (!firstFrameUrl) {
        toast.error(`分镜 ${sceneId + 1} 没有首帧图片，请先生成图片`);
        options.setIsGenerating(false);
        options.setCurrentGeneratingId(null);
        return;
      }

      const lastFrameUrl = scene.needsEndFrame
        ? scene.endFrameHttpUrl || scene.endFrameImageUrl
        : null;
      const characterRefs = scene.characterIds?.length
        ? options.getCharacterReferenceImages(scene.characterIds, scene.characterVariationMap)
        : [];
      options.updateSplitSceneVideo(sceneId, { videoStatus: "generating", videoProgress: 20 });

      const cinematographyProfile = options.projectData?.cinematographyProfileId
        ? getCinematographyProfile(options.projectData.cinematographyProfileId)
        : undefined;
      const fullPrompt = buildVideoPrompt(scene, cinematographyProfile, {
        styleTokens: [getStylePrompt(options.currentStyleId)],
        aspectRatio: options.storyboardConfig.aspectRatio,
        mediaType: getMediaType(options.currentStyleId),
      });
      const videoDuration = Math.max(4, Math.min(12, scene.duration || 5));

      const normalizeUrl = (url: unknown): string => {
        if (Array.isArray(url)) return typeof url[0] === "string" ? url[0] : "";
        return typeof url === "string" ? url : "";
      };
      const imageWithRoles: Array<{ url: string; role: "first_frame" | "last_frame" }> = [];
      const firstFrameConverted = await convertToHttpUrl(normalizeUrl(firstFrameUrl));
      if (!firstFrameConverted) throw new Error("无法获取首帧图片的 HTTP URL，请重新生成图片");
      imageWithRoles.push({ url: firstFrameConverted, role: "first_frame" });
      if (lastFrameUrl) {
        const lastFrameConverted = await convertToHttpUrl(normalizeUrl(lastFrameUrl));
        if (lastFrameConverted) imageWithRoles.push({ url: lastFrameConverted, role: "last_frame" });
      }
      if (characterRefs.length > 0) {
        console.log("[SClassScenes] Skipping character refs for first/last-frame video mode");
      }

      const videoUrl = await aiManager.video(
        apiKey,
        fullPrompt,
        videoDuration,
        options.storyboardConfig.aspectRatio,
        imageWithRoles,
        (progress) => options.updateSplitSceneVideo(sceneId, { videoProgress: progress }),
        keyManager,
        platform,
        options.storyboardConfig.videoResolution as "480p" | "720p" | "1080p" | undefined,
      );

      let finalVideoUrl = videoUrl;
      try {
        finalVideoUrl = await saveVideoToLocal(videoUrl, `scene_${sceneId + 1}_${Date.now()}.mp4`);
      } catch (error) {
        console.warn("[SClassScenes] Failed to save video locally, using URL:", error);
      }

      const mediaId = options.autoSaveVideoToLibrary(sceneId, finalVideoUrl, scene.imageDataUrl, videoDuration);
      options.updateSplitSceneVideo(sceneId, {
        videoStatus: "completed",
        videoProgress: 100,
        videoUrl: finalVideoUrl,
        videoMediaId: mediaId,
      });
      toast.success(`分镜 ${sceneId + 1} 视频生成完成，已保存到素材库`);

      const currentScene = options.scenes.find((candidate) => candidate.id === sceneId);
      if (currentScene?.needsEndFrame && !currentScene.endFrameImageUrl) {
        void (async () => {
          try {
            const lastFrameBase64 = await extractLastFrameFromVideo(finalVideoUrl, 0.1);
            if (!lastFrameBase64) return;
            const persisted = await persistSceneImage(lastFrameBase64, sceneId, "end");
            options.updateSplitSceneEndFrame(sceneId, persisted.localPath, "video-extracted", persisted.httpUrl || undefined);
          } catch (error) {
            console.warn("[SClassScenes] Error during frame extraction:", error);
          }
        })();
      }
    } catch (error) {
      const err = error as Error;
      if (isContentModerationError(err)) {
        options.updateSplitSceneVideo(sceneId, {
          videoStatus: "failed",
          videoProgress: 0,
          videoError: `MODERATION_SKIPPED:${err.message}`,
        });
        toast.warning(`分镜 ${sceneId + 1} 因内容审核跳过`);
      } else {
        options.updateSplitSceneVideo(sceneId, {
          videoStatus: "failed",
          videoProgress: 0,
          videoError: err.message,
        });
        toast.error(`分镜 ${sceneId + 1} 生成失败: ${err.message}`);
      }
    }

    options.setIsGenerating(false);
    options.setCurrentGeneratingId(null);
  };
}
