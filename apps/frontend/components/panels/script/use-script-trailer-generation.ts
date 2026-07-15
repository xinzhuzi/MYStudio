import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import { selectTrailerShots } from "@/lib/script/trailer-service";
import type { ProjectBackground, Shot } from "@/types/script";
import type { DirectorScriptSceneInput } from "@/stores/director-script-scene-builder";
import type { DirectorStore, SplitScene, TrailerDuration } from "@/stores/director-store";
import { toast } from "sonner";

type TrailerShot = Shot & {
  narrativeFunction?: string;
  shotPurpose?: string;
  visualFocus?: string;
  cameraPosition?: string;
  characterBlocking?: string;
  rhythm?: string;
};

interface UseScriptTrailerGenerationOptions {
  shots: Shot[];
  background: ProjectBackground | null;
  splitScenes: SplitScene[];
  setTrailerConfig: DirectorStore["setTrailerConfig"];
  addScenesFromScript: DirectorStore["addScenesFromScript"];
}

function toTrailerScene(shot: Shot, index: number): DirectorScriptSceneInput {
  const trailerShot = shot as TrailerShot;
  return {
    promptZh: shot.visualDescription || shot.actionSummary || "预告片分镜",
    promptEn: shot.imagePrompt || shot.visualPrompt || "",
    imagePrompt: shot.imagePrompt || shot.visualPrompt || "",
    imagePromptZh: shot.imagePromptZh || shot.visualDescription || "",
    videoPrompt: shot.videoPrompt || "",
    videoPromptZh: shot.videoPromptZh || shot.actionSummary || "",
    endFramePrompt: shot.endFramePrompt || "",
    endFramePromptZh: shot.endFramePromptZh || "",
    needsEndFrame: shot.needsEndFrame || false,
    shotSize: (shot.shotSize as DirectorScriptSceneInput["shotSize"]) || null,
    duration: shot.duration || 5,
    ambientSound: shot.ambientSound || "",
    soundEffectText: shot.soundEffect || "",
    dialogue: shot.dialogue || "",
    actionSummary: shot.actionSummary || "",
    cameraMovement: shot.cameraMovement || "",
    sceneName: `预告片 #${index + 1}`,
    sceneLocation: "",
    narrativeFunction: trailerShot.narrativeFunction || "",
    shotPurpose: trailerShot.shotPurpose || "",
    visualFocus: trailerShot.visualFocus || "",
    cameraPosition: trailerShot.cameraPosition || "",
    characterBlocking: trailerShot.characterBlocking || "",
    rhythm: trailerShot.rhythm || "",
    visualDescription: shot.visualDescription || "",
    lightingStyle: shot.lightingStyle,
    lightingDirection: shot.lightingDirection,
    colorTemperature: shot.colorTemperature,
    lightingNotes: shot.lightingNotes,
    depthOfField: shot.depthOfField,
    focusTarget: shot.focusTarget,
    focusTransition: shot.focusTransition,
    cameraRig: shot.cameraRig,
    movementSpeed: shot.movementSpeed,
    atmosphericEffects: shot.atmosphericEffects,
    effectIntensity: shot.effectIntensity,
    playbackSpeed: shot.playbackSpeed,
    cameraAngle: shot.cameraAngle,
    focalLength: shot.focalLength,
    photographyTechnique: shot.photographyTechnique,
  };
}

export function useScriptTrailerGeneration(options: UseScriptTrailerGenerationOptions) {
  const { shots, background, splitScenes, setTrailerConfig, addScenesFromScript } = options;
  return useCallback(async (duration: TrailerDuration) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    if (shots.length === 0) {
      toast.error("请先生成分镜");
      return;
    }

    setTrailerConfig({ duration, shotIds: [], status: "generating", generatedAt: undefined, error: undefined });
    toast.info(`正在 AI 挑选 ${duration} 秒预告片分镜...`);
    try {
      const result = await selectTrailerShots(shots, background, duration, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform as string,
        baseUrl: featureConfig.baseUrl,
      });
      if (!result.success) {
        setTrailerConfig({
          duration,
          shotIds: [],
          status: "error",
          generatedAt: undefined,
          error: result.error || "挑选失败",
        });
        toast.error(result.error || "预告片生成失败");
        return;
      }

      const startId = splitScenes.length > 0 ? Math.max(...splitScenes.map((scene) => scene.id)) + 1 : 1;
      console.log("[handleGenerateTrailer] startId calculation:", {
        latestSplitScenesLength: splitScenes.length,
        latestIds: splitScenes.map((scene) => scene.id),
        calculatedStartId: startId,
      });
      addScenesFromScript(result.selectedShots.map(toTrailerScene));
      const shotIds = result.selectedShots.map((shot) => shot.id);
      console.log("[handleGenerateTrailer] originalShotIds:", shotIds);
      setTrailerConfig({
        duration,
        shotIds,
        status: "completed",
        generatedAt: Date.now(),
        error: result.error,
      });
      toast.success(`已挑选 ${result.selectedShots.length} 个分镜用于预告片，可在 AI 导演面板编辑`);
      if (result.error) toast.warning(result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[handleGenerateTrailer] 失败:", error);
      setTrailerConfig({ duration, shotIds: [], status: "error", generatedAt: undefined, error: message });
      toast.error(`预告片生成失败: ${message}`);
    }
  }, [addScenesFromScript, background, setTrailerConfig, shots, splitScenes]);
}
