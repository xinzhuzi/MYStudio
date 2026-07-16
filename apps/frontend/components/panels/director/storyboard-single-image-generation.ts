import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";
import { persistSceneImage } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";
import { toast } from "sonner";

type ImageStatusUpdate = Partial<Pick<SplitScene, "imageStatus" | "imageProgress" | "imageError">>;

export interface StoryboardSingleImageRequest {
  prompt: string;
  referenceImages: string[];
}

export interface StoryboardSingleImageGenerationOptions {
  getScene: (sceneId: number) => SplitScene | undefined;
  aspectRatio: "16:9" | "9:16";
  resolution: "1K" | "2K" | "4K";
  prepareRequest: (input: {
    scene: SplitScene;
    model: string;
    promptToUse: string;
  }) => Promise<StoryboardSingleImageRequest> | StoryboardSingleImageRequest;
  updateStatus: (sceneId: number, update: ImageStatusUpdate) => void;
  updateImage: (
    sceneId: number,
    localPath: string,
    width: number,
    height: number,
    httpUrl?: string,
  ) => void;
  autoSaveImage: (sceneId: number, localPath: string) => unknown;
  setGenerating: (isGenerating: boolean) => void;
  createAbortController?: () => AbortController;
  usePersistedHttpUrlOnly?: boolean;
}

export function createStoryboardSingleImageGenerator(
  options: StoryboardSingleImageGenerationOptions,
) {
  return async (sceneId: number) => {
    const scene = options.getScene(sceneId);
    if (!scene) return;

    const featureConfig = aiManager.featureConfig("character_generation");
    if (!featureConfig) {
      toast.error("请先在设置中配置图片生成服务映射");
      return;
    }
    const keyManager = featureConfig.keyManager;
    const apiKey = keyManager.getCurrentKey() || "";
    if (!apiKey) {
      toast.error("请先在设置中配置图片生成服务映射");
      return;
    }
    const model = featureConfig.models?.[0];
    if (!model) {
      toast.error("请先在设置中配置图片生成模型");
      return;
    }
    const imageBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");
    if (!imageBaseUrl) {
      toast.error("请先在设置中配置图片生成服务映射");
      return;
    }

    const promptToUse = scene.imagePromptZh?.trim()
      || scene.imagePrompt?.trim()
      || scene.videoPromptZh?.trim()
      || scene.videoPrompt?.trim()
      || "";
    if (!promptToUse) {
      toast.warning("请先填写首帧提示词后再生成图片");
      return;
    }

    const controller = options.createAbortController?.();
    options.setGenerating(true);
    try {
      options.updateStatus(sceneId, {
        imageStatus: "generating",
        imageProgress: 0,
        imageError: null,
      });
      const request = await options.prepareRequest({ scene, model, promptToUse });
      const apiResult = await aiManager.imageGrid({
        model,
        prompt: request.prompt,
        apiKey,
        baseUrl: imageBaseUrl,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        referenceImages: request.referenceImages.length ? request.referenceImages : undefined,
        keyManager,
        signal: controller?.signal,
      });

      let imageUrl = apiResult.imageUrl;
      if (!imageUrl && apiResult.taskId) {
        imageUrl = await pollImageTaskUrl({
          taskId: apiResult.taskId,
          apiKey,
          baseUrl: imageBaseUrl,
          maxAttempts: 60,
          pollIntervalMs: 2000,
          signal: controller?.signal,
          onProgress: (progress) => options.updateStatus(sceneId, { imageProgress: progress }),
          notFoundMessage: "任务不存在",
          requestErrorMessage: (status) => `Failed to check task status: ${status}`,
          noCache: true,
        });
        if (!imageUrl) throw new Error("图片生成超时");
      }
      if (!imageUrl) throw new Error("Invalid API response: no image URL or task ID");

      const persisted = await persistSceneImage(imageUrl, sceneId, "first");
      const httpUrl = options.usePersistedHttpUrlOnly
        ? persisted.httpUrl || undefined
        : persisted.httpUrl || imageUrl;
      options.updateImage(sceneId, persisted.localPath, scene.width, scene.height, httpUrl);
      options.autoSaveImage(sceneId, persisted.localPath);
      toast.success(`分镜 ${sceneId + 1} 图片生成完成，已保存到素材库`);
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" || err.message === "用户已取消") {
        console.log(`[Storyboard] Scene ${sceneId} image generation cancelled by user`);
        return;
      }
      console.error(`[Storyboard] Scene ${sceneId} image generation failed:`, err);
      options.updateStatus(sceneId, {
        imageStatus: "failed",
        imageProgress: 0,
        imageError: err.message,
      });
      toast.error(`分镜 ${sceneId + 1} 图片生成失败: ${err.message}`);
    } finally {
      options.setGenerating(false);
    }
  };
}
