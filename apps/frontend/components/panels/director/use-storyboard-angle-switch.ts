import { useCallback } from "react";
import type { AngleSwitchDialogProps, AngleSwitchHistoryItem } from "@/components/angle-switch";
import type { IProvider } from "@/stores/api-config-store";
import type { SplitScene } from "@/stores/director-store";
import { parseApiKeys } from "@/lib/api-key-manager";
import { generateAngleSwitch } from "@/lib/ai/runninghub-client";
import { getAngleLabel } from "@/lib/ai/runninghub-angles";
import { toast } from "sonner";
import type { StoryboardGenerationUiController, StoryboardFrameTarget } from "./use-storyboard-generation-ui";

type AngleSwitchScene = Pick<
  SplitScene,
  | "id"
  | "imageDataUrl"
  | "imageHttpUrl"
  | "endFrameImageUrl"
  | "endFrameHttpUrl"
  | "startFrameAngleSwitchHistory"
  | "endFrameAngleSwitchHistory"
>;

type UseStoryboardAngleSwitchOptions = {
  scenes: AngleSwitchScene[];
  controller: StoryboardGenerationUiController;
  getProviderByPlatform: (platform: string) => IProvider | undefined;
  addHistory: (sceneId: number, type: StoryboardFrameTarget["type"], item: AngleSwitchHistoryItem) => void;
  getLatestScenes: () => AngleSwitchScene[];
};

function getTargetImage(scene: AngleSwitchScene, type: StoryboardFrameTarget["type"]) {
  return type === "start"
    ? (scene.imageDataUrl || scene.imageHttpUrl)
    : (scene.endFrameImageUrl || scene.endFrameHttpUrl);
}

export function useStoryboardAngleSwitch({
  scenes,
  controller,
  getProviderByPlatform,
  addHistory,
  getLatestScenes,
}: UseStoryboardAngleSwitchOptions) {
  const {
    angleSwitchTarget,
    setAngleSwitchTarget,
    setAngleSwitchOpen,
    setAngleSwitchResultOpen,
    setAngleSwitchResult,
    setSelectedHistoryIndex,
    setIsAngleSwitching,
  } = controller;

  const openAngleSwitch = useCallback((sceneId: number, type: StoryboardFrameTarget["type"]) => {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    if (!getTargetImage(scene, type)) {
      toast.error(`请先生成${type === "start" ? "首帧" : "尾帧"}`);
      return;
    }

    setSelectedHistoryIndex(-1);
    setAngleSwitchTarget({ sceneId, type });
    setAngleSwitchOpen(true);
  }, [scenes, setAngleSwitchOpen, setAngleSwitchTarget, setSelectedHistoryIndex]);

  const generate = useCallback<AngleSwitchDialogProps["onGenerate"]>(async (params) => {
    if (!angleSwitchTarget) return;
    const { direction, elevation, shotSize } = params;
    const runninghubProvider = getProviderByPlatform("runninghub");
    const runninghubKey = parseApiKeys(runninghubProvider?.apiKey || "")[0];
    const runninghubBaseUrl = runninghubProvider?.baseUrl?.trim();
    const runninghubAppId = runninghubProvider?.model?.[0];
    if (!runninghubKey || !runninghubBaseUrl || !runninghubAppId) {
      toast.error("请先在设置中配置 RunningHub（API Key / Base URL / 模型AppId）");
      setAngleSwitchOpen(false);
      return;
    }

    const scene = scenes.find((item) => item.id === angleSwitchTarget.sceneId);
    if (!scene) return;
    const originalImage = getTargetImage(scene, angleSwitchTarget.type);
    if (!originalImage) {
      toast.error("找不到原图");
      return;
    }

    setIsAngleSwitching(true);
    try {
      const newImageUrl = await generateAngleSwitch({
        referenceImage: originalImage,
        direction,
        elevation,
        shotSize,
        apiKey: runninghubKey,
        baseUrl: runninghubBaseUrl,
        appId: runninghubAppId,
        onProgress: (progress, status) => {
          console.log(`[AngleSwitch] Progress: ${progress}%, Status: ${status}`);
        },
      });
      const angleLabel = getAngleLabel(direction, elevation, shotSize);
      addHistory(angleSwitchTarget.sceneId, angleSwitchTarget.type, {
        imageUrl: newImageUrl,
        angleLabel,
        timestamp: Date.now(),
      });

      const updatedScene = getLatestScenes().find((item) => item.id === angleSwitchTarget.sceneId);
      const history = angleSwitchTarget.type === "start"
        ? (updatedScene?.startFrameAngleSwitchHistory || [])
        : (updatedScene?.endFrameAngleSwitchHistory || []);
      setSelectedHistoryIndex(history.length - 1);
      setAngleSwitchResult({ originalImage, newImage: newImageUrl, angleLabel });
      setAngleSwitchOpen(false);
      setAngleSwitchResultOpen(true);
      toast.success("视角切换生成完成");
    } catch (error) {
      toast.error(`视角切换失败: ${(error as Error).message}`);
    } finally {
      setIsAngleSwitching(false);
    }
  }, [
    addHistory,
    angleSwitchTarget,
    getLatestScenes,
    getProviderByPlatform,
    scenes,
    setAngleSwitchOpen,
    setAngleSwitchResult,
    setAngleSwitchResultOpen,
    setIsAngleSwitching,
    setSelectedHistoryIndex,
  ]);

  return { openAngleSwitch, generate };
}
