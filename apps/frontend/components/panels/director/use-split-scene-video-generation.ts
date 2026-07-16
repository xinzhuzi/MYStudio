import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { extractLastFrameFromVideo, isContentModerationError } from "@/lib/ai/video-generator";
import { saveVideoToLocal } from "@/lib/image-storage";
import { getCinematographyProfile } from "@/lib/constants/cinematography-profiles";
import { getMediaType, getStylePrompt } from "@/lib/constants/visual-styles";
import { buildVideoPrompt } from "@/lib/generation/prompt-builder";
import { persistSceneImage } from "@/lib/utils/image-persist";
import { useAPIConfigStore } from "@/stores/api-config-store";
import type { DirectorProjectData, DirectorStore, SplitScene } from "@/stores/director-store";
import {
  convertStoryboardFrameToHttpUrl,
  isDiscouragedExternalImageUrl,
  isHttpImageUrl,
  isLocalImageSource,
  normalizeStoryboardVideoFrameUrl,
  shouldRefreshImageViaCurrentHost,
} from "./storyboard-video-frame-transfer";

type StoryboardVideoConfig = Pick<
  DirectorProjectData["storyboardConfig"],
  "aspectRatio" | "videoResolution"
>;

export interface UseSplitSceneVideoGenerationOptions {
  scenes: readonly SplitScene[];
  storyboardConfig: StoryboardVideoConfig;
  projectData: Pick<DirectorProjectData, "cinematographyProfileId"> | null | undefined;
  currentStyleId: string | null;
  concurrency: number;
  setIsGenerating: (isGenerating: boolean) => void;
  setCurrentGeneratingId: (sceneId: number | null) => void;
  updateSplitSceneVideo: DirectorStore["updateSplitSceneVideo"];
  updateSplitSceneEndFrame: DirectorStore["updateSplitSceneEndFrame"];
  autoSaveVideoToLibrary: (sceneId: number, videoUrl: string, thumbnailUrl?: string, duration?: number) => string;
  getCharacterReferenceImages: (characterIds: string[], variationMap?: Record<string, string>) => string[];
}

export function useSplitSceneVideoGeneration({
  scenes,
  storyboardConfig,
  projectData,
  currentStyleId,
  concurrency,
  setIsGenerating,
  setCurrentGeneratingId,
  updateSplitSceneVideo,
  updateSplitSceneEndFrame,
  autoSaveVideoToLibrary,
  getCharacterReferenceImages,
}: UseSplitSceneVideoGenerationOptions) {
  const videoAbortRef = useRef<AbortController | null>(null);

  const stopVideoGeneration = useCallback((sceneId: number) => {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    updateSplitSceneVideo(sceneId, {
      videoStatus: "idle",
      videoProgress: 0,
      videoError: "用户已取消",
    });
    setIsGenerating(false);
    setCurrentGeneratingId(null);
    toast.info(`分镜 ${sceneId + 1} 视频生成已停止`);
  }, [setCurrentGeneratingId, setIsGenerating, updateSplitSceneVideo]);

  const generateSingleVideo = useCallback(async (sceneId: number) => {
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;

    const apiStore = useAPIConfigStore.getState();
    if (process.env.NODE_ENV === "development") {
      console.log("[SplitScenes] API Store state:", {
        providers: apiStore.providers.length,
        apiKeys: Object.keys(apiStore.apiKeys),
        memefastKey: apiStore.apiKeys.memefast ? "set" : "not set",
        getApiKey_memefast: apiStore.getApiKey("memefast") ? "set" : "not set",
      });
    }

    const featureConfig = aiManager.featureConfig("video_generation");
    if (process.env.NODE_ENV === "development") {
      console.log("[SplitScenes] Feature config for video_generation:", featureConfig ? {
        platform: featureConfig.platform,
        model: featureConfig.models?.[0],
        apiKey: featureConfig.apiKey ? `${featureConfig.apiKey.substring(0, 8)}...` : "empty",
        providerId: featureConfig.provider?.id,
      } : "null");
    }

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

    if (process.env.NODE_ENV === "development") {
      console.log("[SplitScenes] Using video config:", { platform, model, videoBaseUrl });
    }

    const keyManager = featureConfig.keyManager;
    const apiKey = keyManager.getCurrentKey() || "";
    if (!apiKey) {
      toast.error(`请先配置 ${platform} API Key`);
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`[SplitScenes] Using API key ${keyManager.getTotalKeyCount()} keys, current index available: ${keyManager.getAvailableKeyCount()}`);
    }

    setIsGenerating(true);
    setCurrentGeneratingId(sceneId);

    const videoController = new AbortController();
    videoAbortRef.current = videoController;

    try {
      updateSplitSceneVideo(sceneId, {
        videoStatus: "uploading",
        videoProgress: 0,
        videoError: null,
        videoUrl: null,
      });

      let firstFrameUrl = scene.imageDataUrl || (isHttpImageUrl(scene.imageHttpUrl) ? scene.imageHttpUrl : "");
      const hasValidHttpUrl = isHttpImageUrl(scene.imageHttpUrl);
      const shouldRefreshFirstFrame = shouldRefreshImageViaCurrentHost(scene.imageDataUrl);

      if (isLocalImageSource(scene.imageDataUrl)) {
        if (shouldRefreshFirstFrame) {
          if (hasValidHttpUrl) {
            console.log(
              `[SplitScenes] Using local first frame and refreshing via configured image host${isDiscouragedExternalImageUrl(scene.imageHttpUrl) ? " (skipping discouraged external URL)" : ""}:`,
              scene.imageHttpUrl!.substring(0, 60),
            );
          } else {
            console.log("[SplitScenes] Using local first frame and uploading to configured image host");
          }
          firstFrameUrl = scene.imageDataUrl;
        } else if (hasValidHttpUrl && scene.imageSource === "ai-generated") {
          console.log("[SplitScenes] Using imageHttpUrl for AI-generated image:", scene.imageHttpUrl!.substring(0, 60));
          firstFrameUrl = scene.imageHttpUrl!;
        } else {
          console.log(
            "[SplitScenes] Using imageDataUrl (will upload to image host):",
            hasValidHttpUrl ? `has old httpUrl but imageSource=${scene.imageSource}` : "no valid httpUrl",
          );
        }
      }

      if (!firstFrameUrl) {
        toast.error(`分镜 ${sceneId + 1} 没有首帧图片，请先生成图片`);
        setIsGenerating(false);
        setCurrentGeneratingId(null);
        return;
      }
      console.log("[SplitScenes] First frame source:", firstFrameUrl.startsWith("http") ? "HTTP URL" : "local/base64");

      let lastFrameUrl: string | null | undefined = null;
      if (scene.needsEndFrame && (scene.endFrameImageUrl || scene.endFrameHttpUrl)) {
        const shouldRefreshEndFrame = shouldRefreshImageViaCurrentHost(scene.endFrameImageUrl);
        if (shouldRefreshEndFrame && scene.endFrameImageUrl) {
          lastFrameUrl = scene.endFrameImageUrl;
          console.log(
            `[SplitScenes] Using local end frame and refreshing via configured image host${isDiscouragedExternalImageUrl(scene.endFrameHttpUrl) ? " (skipping discouraged external URL)" : ""}`,
          );
        } else {
          lastFrameUrl = scene.endFrameImageUrl || scene.endFrameHttpUrl;
          console.log("[SplitScenes] Using end frame for video generation");
        }
      } else {
        console.log("[SplitScenes] Skipping end frame: needsEndFrame=", scene.needsEndFrame, "hasEndFrame=", Boolean(scene.endFrameImageUrl));
      }

      const characterRefs = scene.characterIds?.length
        ? getCharacterReferenceImages(scene.characterIds, scene.characterVariationMap)
        : [];

      updateSplitSceneVideo(sceneId, {
        videoStatus: "generating",
        videoProgress: 20,
      });

      const cinProfile = projectData?.cinematographyProfileId
        ? getCinematographyProfile(projectData.cinematographyProfileId)
        : undefined;
      const fullPrompt = buildVideoPrompt(scene, cinProfile, {
        styleTokens: [getStylePrompt(currentStyleId)],
        aspectRatio: storyboardConfig.aspectRatio,
        mediaType: getMediaType(currentStyleId),
      });
      const rawDuration = scene.duration || 5;
      const videoDuration = Math.max(4, Math.min(12, rawDuration));

      console.log("[SplitScenes] Video generation params:", {
        sceneId,
        hasFirstFrame: Boolean(firstFrameUrl),
        hasLastFrame: Boolean(lastFrameUrl),
        characterRefCount: characterRefs.length,
        shotSize: scene.shotSize,
        duration: videoDuration,
        ambientSound: scene.ambientSound,
        soundEffects: scene.soundEffects,
        emotionTags: scene.emotionTags,
        fullPrompt,
      });

      const imageWithRoles: Array<{ url: string; role: "first_frame" | "last_frame" }> = [];
      const normalizedFirstFrame = normalizeStoryboardVideoFrameUrl(firstFrameUrl);
      console.log("[SplitScenes] First frame URL (normalized):", normalizedFirstFrame.substring(0, 80));
      const firstFrameConverted = await convertStoryboardFrameToHttpUrl(normalizedFirstFrame, {
        localFallback: scene.imageDataUrl,
        frameLabel: "First frame",
        uploadName: `scene_${sceneId}_frame_${Date.now()}`,
      });
      if (!firstFrameConverted) {
        throw new Error("无法获取首帧图片的 HTTP URL，请重新生成图片");
      }
      imageWithRoles.push({ url: firstFrameConverted, role: "first_frame" });
      console.log("[SplitScenes] First frame HTTP URL:", firstFrameConverted.substring(0, 60));

      if (lastFrameUrl) {
        const lastFrameConverted = await convertStoryboardFrameToHttpUrl(lastFrameUrl, {
          localFallback: scene.endFrameImageUrl,
          frameLabel: "Last frame",
          uploadName: `scene_${sceneId}_frame_${Date.now()}`,
        });
        if (lastFrameConverted) {
          imageWithRoles.push({ url: lastFrameConverted, role: "last_frame" });
          console.log("[SplitScenes] Last frame HTTP URL:", lastFrameConverted.substring(0, 60));
        }
      }

      if (characterRefs.length > 0) {
        console.log("[SplitScenes] Skipping", characterRefs.length, "character refs - cannot mix with first_frame");
      }

      console.log("[SplitScenes] image_with_roles:", imageWithRoles.length, "images", imageWithRoles.map((image) => image.role));
      const videoUrl = await aiManager.video(
        apiKey,
        fullPrompt,
        videoDuration,
        storyboardConfig.aspectRatio,
        imageWithRoles,
        (progress) => updateSplitSceneVideo(sceneId, { videoProgress: progress }),
        keyManager,
        platform,
        storyboardConfig.videoResolution as "480p" | "720p" | "1080p" | undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        videoController.signal,
      );

      let finalVideoUrl = videoUrl;
      try {
        const filename = `scene_${sceneId + 1}_${Date.now()}.mp4`;
        finalVideoUrl = await saveVideoToLocal(videoUrl, filename);
        console.log("[SplitScenes] Video saved locally:", finalVideoUrl);
      } catch (error) {
        console.warn("[SplitScenes] Failed to save video locally, using URL:", error);
      }

      const mediaId = autoSaveVideoToLibrary(sceneId, finalVideoUrl, scene.imageDataUrl, videoDuration);
      updateSplitSceneVideo(sceneId, {
        videoStatus: "completed",
        videoProgress: 100,
        videoUrl: finalVideoUrl,
        videoMediaId: mediaId,
      });
      toast.success(`分镜 ${sceneId + 1} 视频生成完成，已保存到素材库`);

      const currentScene = scenes.find((candidate) => candidate.id === sceneId);
      const shouldExtractEndFrame = currentScene?.needsEndFrame && !currentScene.endFrameImageUrl;
      if (shouldExtractEndFrame) {
        void (async () => {
          try {
            const lastFrameBase64 = await extractLastFrameFromVideo(finalVideoUrl, 0.1);
            if (!lastFrameBase64) {
              console.warn("[SplitScenes] Failed to extract last frame from video");
              return;
            }
            const persistResult = await persistSceneImage(lastFrameBase64, sceneId, "end");
            updateSplitSceneEndFrame(sceneId, persistResult.localPath, "video-extracted", persistResult.httpUrl || undefined);
            console.log("[SplitScenes] Saved video last frame locally:", persistResult.localPath);
          } catch (error) {
            console.warn("[SplitScenes] Error during frame extraction:", error);
          }
        })();
      } else {
        console.log("[SplitScenes] Skipping end frame extraction: needsEndFrame=", currentScene?.needsEndFrame, "hasEndFrame=", Boolean(currentScene?.endFrameImageUrl));
      }

      setIsGenerating(false);
      setCurrentGeneratingId(null);
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" || err.message === "用户已取消") {
        console.log(`[SplitScenes] Scene ${sceneId} video generation cancelled by user`);
        setIsGenerating(false);
        setCurrentGeneratingId(null);
        return;
      }

      console.error(`[SplitScenes] Scene ${sceneId} video generation failed:`, err);
      if (isContentModerationError(err)) {
        updateSplitSceneVideo(sceneId, {
          videoStatus: "failed",
          videoProgress: 0,
          videoError: `MODERATION_SKIPPED:${err.message}`,
        });
        toast.warning(`分镜 ${sceneId + 1} 因内容审核跳过`);
        console.log(`[SplitScenes] Scene ${sceneId} skipped due to content moderation`);
      } else {
        updateSplitSceneVideo(sceneId, {
          videoStatus: "failed",
          videoProgress: 0,
          videoError: err.message,
        });
        toast.error(`分镜 ${sceneId + 1} 生成失败: ${err.message}`);
      }
    }

    setIsGenerating(false);
    setCurrentGeneratingId(null);
  }, [
    autoSaveVideoToLibrary,
    currentStyleId,
    getCharacterReferenceImages,
    projectData?.cinematographyProfileId,
    scenes,
    setCurrentGeneratingId,
    setIsGenerating,
    storyboardConfig.aspectRatio,
    storyboardConfig.videoResolution,
    updateSplitSceneEndFrame,
    updateSplitSceneVideo,
  ]);

  const generateVideos = useCallback(async () => {
    if (scenes.length === 0) {
      toast.error("没有可生成的分镜");
      return;
    }

    const featureConfig = aiManager.featureConfig("video_generation");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("video_generation"));
      return;
    }

    const scenesWithoutPrompts = scenes.filter(
      (scene) => !(scene.videoPromptZh?.trim() || scene.videoPrompt?.trim()),
    );
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
    toast.info(`开始串行生成 ${scenesToGenerate.length} 个视频...每次处理 ${concurrency} 个`);

    let successCount = 0;
    const totalCount = scenesToGenerate.length;
    for (let index = 0; index < scenesToGenerate.length; index += concurrency) {
      const batch = scenesToGenerate.slice(index, index + concurrency);
      await Promise.all(batch.map(async (scene) => {
        try {
          await generateSingleVideo(scene.id);
          successCount += 1;
        } catch (error) {
          console.error(`[SplitScenes] Batch: Scene ${scene.id} video generation failed:`, error);
        }
      }));
    }

    setIsGenerating(false);
    setCurrentGeneratingId(null);
    if (successCount === totalCount) {
      toast.success("所有视频生成完成！");
    } else if (successCount > 0) {
      toast.info(`${successCount}/${totalCount} 个视频生成完成，${totalCount - successCount} 个失败`);
    }
  }, [concurrency, generateSingleVideo, scenes, setCurrentGeneratingId, setIsGenerating]);

  return { stopVideoGeneration, generateSingleVideo, generateVideos };
}
