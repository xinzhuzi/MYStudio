import { useCallback } from "react";
import type {
  EpisodeRawScript,
  ProjectBackground,
  PromptLanguage,
  ScriptData,
} from "@/types/script";
import type { ScriptCalibrationStatus } from "@/stores/script-store";
import { useScriptStore } from "@/stores/script-store";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  calibrateEpisodeScenes,
  calibrateScenes,
  convertToScriptScenes,
} from "@/lib/script/scene-calibrator";
import { syncToSeriesMeta } from "@/lib/script/series-meta-sync";
import { exportProjectMetadata } from "@/lib/script/full-script-service";
import { toast } from "sonner";

interface UseScriptSceneCalibrationOptions {
  projectId: string;
  background?: ProjectBackground | null;
  episodeRawScripts: EpisodeRawScript[];
  scriptData: ScriptData | null;
  promptLanguage: PromptLanguage;
  setScriptData: (projectId: string, data: ScriptData) => void;
  setSceneCalibrationStatus: (status: ScriptCalibrationStatus) => void;
  addSecondPass: (type: string) => void;
  removeSecondPass: (type: string) => void;
}

export function useScriptSceneCalibration({
  projectId,
  background,
  episodeRawScripts,
  scriptData,
  promptLanguage,
  setScriptData,
  setSceneCalibrationStatus,
  addSecondPass,
  removeSecondPass,
}: UseScriptSceneCalibrationOptions) {
  const handleCalibrateScenes = useCallback(async () => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    if (!background) {
      toast.error("请先导入剧本");
      return;
    }
    if (episodeRawScripts.length === 0) {
      toast.error("缺少分集剧本数据");
      return;
    }

    const currentScenes = scriptData?.scenes || [];
    addSecondPass("scenes");
    setSceneCalibrationStatus("calibrating");
    toast.info(`正在 AI 校准 ${currentScenes.length} 个场景...`);

    try {
      const result = await calibrateScenes(currentScenes, background, episodeRawScripts, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform as string,
        baseUrl: featureConfig.baseUrl,
        promptLanguage,
      });
      const newScenes = currentScenes.map((original, index) => {
        const calibrated = result.scenes.find((scene) => scene.id === original.id);
        if (!calibrated) {
          console.log(`[handleCalibrateScenes] 场景 #${index + 1} "${original.name}" 未找到校准结果，保持原样`);
          return original;
        }
        const nextVisualPromptZh = calibrated.visualPromptZh || original.visualPrompt;
        const nextVisualPromptEn = calibrated.visualPromptEn || original.visualPromptEn;
        return {
          ...original,
          architectureStyle: calibrated.architectureStyle || original.architectureStyle,
          lightingDesign: calibrated.lightingDesign || original.lightingDesign,
          colorPalette: calibrated.colorPalette || original.colorPalette,
          keyProps: calibrated.keyProps || original.keyProps,
          spatialLayout: calibrated.spatialLayout || original.spatialLayout,
          eraDetails: calibrated.eraDetails || original.eraDetails,
          atmosphere: calibrated.atmosphere || original.atmosphere,
          importance: calibrated.importance || original.importance || "secondary",
          visualPrompt: promptLanguage === "en" ? undefined : nextVisualPromptZh,
          visualPromptEn: promptLanguage === "zh" ? undefined : nextVisualPromptEn,
        };
      });

      console.log("[handleCalibrateScenes] 轻量级校准完成：场景数保持", newScenes.length, "，顺序不变");
      if (scriptData) setScriptData(projectId, { ...scriptData, scenes: newScenes });

      setSceneCalibrationStatus("completed");
      removeSecondPass("scenes");
      toast.success(`场景校准完成！${result.analysisNotes}`);

      try {
        const store = useScriptStore.getState();
        const meta = store.projects[projectId]?.seriesMeta;
        if (meta) {
          const updates = syncToSeriesMeta(meta, "scene", { scenes: newScenes });
          if (Object.keys(updates).length > 0) store.updateSeriesMeta(projectId, updates);
          store.setMetadataMarkdown(projectId, exportProjectMetadata(projectId));
        }
      } catch (error) {
        console.warn("[handleCalibrateScenes] SeriesMeta 回写失败:", error);
      }

      if (result.mergeRecords.length > 0) {
        console.log("[handleCalibrateScenes] 合并建议:", result.mergeRecords);
        toast.info(`发现 ${result.mergeRecords.length} 个合并建议，请在控制台查看`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[handleCalibrateScenes] 校准失败:", error);
      setSceneCalibrationStatus("error");
      removeSecondPass("scenes");
      toast.error(`场景校准失败: ${message}`);
    }
  }, [addSecondPass, background, episodeRawScripts, projectId, promptLanguage, removeSecondPass, scriptData, setSceneCalibrationStatus, setScriptData]);

  const handleCalibrateEpisodeScenes = useCallback(async (episodeIndex: number) => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    if (!background) {
      toast.error("请先导入剧本");
      return;
    }

    const currentScenes = scriptData?.scenes || [];
    addSecondPass("scenes");
    setSceneCalibrationStatus("calibrating");
    toast.info(`正在 AI 校准第 ${episodeIndex} 集的场景...`);

    try {
      const result = await calibrateEpisodeScenes(episodeIndex, currentScenes, background, episodeRawScripts, {
        apiKey: featureConfig.allApiKeys.join(","),
        provider: featureConfig.platform as string,
        baseUrl: featureConfig.baseUrl,
        promptLanguage,
      });
      const calibratedScenes = convertToScriptScenes(result.scenes, currentScenes, promptLanguage);
      const calibratedIds = new Set(calibratedScenes.map((scene) => scene.id));
      const mergedScenes = [
        ...currentScenes.filter((scene) => !calibratedIds.has(scene.id)),
        ...calibratedScenes,
      ];
      if (scriptData) setScriptData(projectId, { ...scriptData, scenes: mergedScenes });

      setSceneCalibrationStatus("completed");
      removeSecondPass("scenes");
      toast.success(`第 ${episodeIndex} 集场景校准完成！`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[handleCalibrateEpisodeScenes] 校准失败:", error);
      setSceneCalibrationStatus("error");
      removeSecondPass("scenes");
      toast.error(`场景校准失败: ${message}`);
    }
  }, [addSecondPass, background, episodeRawScripts, projectId, promptLanguage, removeSecondPass, scriptData, setSceneCalibrationStatus, setScriptData]);

  return { handleCalibrateScenes, handleCalibrateEpisodeScenes };
}
