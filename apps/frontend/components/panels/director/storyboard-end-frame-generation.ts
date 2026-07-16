import { aiManager } from "@/lib/ai/ai-manager";
import { pollImageTaskUrl } from "@/lib/storyboard/image-task-transport";
import { persistSceneImage } from "@/lib/utils/image-persist";
import type { SplitScene } from "@/stores/director-store";
import { toast } from "sonner";

type EndFrameStatusUpdate = Partial<Pick<
  SplitScene,
  "endFrameStatus" | "endFrameProgress" | "endFrameError"
>>;

export interface StoryboardEndFrameRequest {
  prompt: string;
  referenceImages: string[];
}

export interface StoryboardEndFrameGenerationOptions {
  getScene: (sceneId: number) => SplitScene | undefined;
  aspectRatio: "16:9" | "9:16";
  resolution: "1K" | "2K" | "4K";
  prepareRequest: (input: {
    scene: SplitScene;
    model: string;
    promptToUse: string;
  }) => Promise<StoryboardEndFrameRequest> | StoryboardEndFrameRequest;
  updateStatus: (sceneId: number, update: EndFrameStatusUpdate) => void;
  updateEndFrame: (
    sceneId: number,
    localPath: string,
    source: "ai-generated",
    httpUrl?: string,
  ) => void;
  setGenerating: (isGenerating: boolean) => void;
  folderId: () => string;
  projectId?: string;
  addMedia: (input: {
    url: string;
    name: string;
    type: "image";
    source: "ai-image";
    folderId: string;
    projectId?: string;
  }) => unknown;
  createAbortController?: () => AbortController;
}

export function createStoryboardEndFrameGenerator(
  options: StoryboardEndFrameGenerationOptions,
) {
  return async (sceneId: number) => {
    const scene = options.getScene(sceneId);
    if (!scene) return;

    const promptToUse = scene.endFramePromptZh?.trim() || scene.endFramePrompt?.trim() || "";
    if (!promptToUse) {
      toast.warning("请先填写尾帧提示词后再生成");
      return;
    }

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

    const controller = options.createAbortController?.();
    options.setGenerating(true);

    try {
      options.updateStatus(sceneId, {
        endFrameStatus: "generating",
        endFrameProgress: 0,
        endFrameError: null,
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
          onProgress: (progress) => options.updateStatus(sceneId, { endFrameProgress: progress }),
          notFoundMessage: "任务不存在",
          requestErrorMessage: (status) => `Failed to check task status: ${status}`,
          failureFallbackMessage: "尾帧生成失败",
          noCache: true,
        });
        if (!imageUrl) throw new Error("尾帧生成超时");
      }
      if (!imageUrl) throw new Error("Invalid API response");

      const persisted = await persistSceneImage(imageUrl, sceneId, "end");
      options.updateEndFrame(
        sceneId,
        persisted.localPath,
        "ai-generated",
        persisted.httpUrl || imageUrl,
      );
      options.addMedia({
        url: persisted.localPath,
        name: `分镜 ${sceneId + 1} - 尾帧`,
        type: "image",
        source: "ai-image",
        folderId: options.folderId(),
        projectId: options.projectId,
      });
      toast.success(`分镜 ${sceneId + 1} 尾帧生成完成，已保存到素材库`);
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" || err.message === "用户已取消") {
        console.log(`[Storyboard] Scene ${sceneId} end frame generation cancelled by user`);
        return;
      }

      console.error(`[Storyboard] Scene ${sceneId} end frame generation failed:`, err);
      options.updateStatus(sceneId, {
        endFrameStatus: "failed",
        endFrameProgress: 0,
        endFrameError: err.message,
      });
      toast.error(`分镜 ${sceneId + 1} 尾帧生成失败: ${err.message}`);
    } finally {
      options.setGenerating(false);
    }
  };
}
