import { useCallback } from "react";
import { toast } from "sonner";
import { aiManager } from "@/lib/ai/ai-manager";
import { DEFAULT_CINEMATOGRAPHY_PROFILE_ID } from "@/lib/constants/cinematography-profiles";
import { calibrateEpisodeShots, calibrateSingleShot, exportProjectMetadata } from "@/lib/script/full-script-service";
import { syncToSeriesMeta } from "@/lib/script/series-meta-sync";
import { useScriptStore, type ScriptCalibrationStatus, type ScriptViewpointStatus } from "@/stores/script-store";
import type { PromptLanguage, ScriptData, Shot } from "@/types/script";

interface UseScriptShotCalibrationOptions {
  projectId: string;
  scriptData: ScriptData | null;
  shots: Shot[];
  styleId: string;
  promptLanguage: PromptLanguage;
  cinematographyProfileId?: string;
  setViewpointAnalysisStatus: (status: ScriptViewpointStatus) => void;
  setSingleShotCalibrationStatus: (
    projectId: string,
    shotId: string,
    status: ScriptCalibrationStatus,
  ) => void;
  addSecondPass: (type: string) => void;
  removeSecondPass: (type: string) => void;
}

export function useScriptShotCalibration({
  projectId,
  scriptData,
  shots,
  styleId,
  promptLanguage,
  cinematographyProfileId,
  setViewpointAnalysisStatus,
  setSingleShotCalibrationStatus,
  addSecondPass,
  removeSecondPass,
}: UseScriptShotCalibrationOptions) {
  const createOptions = useCallback(() => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return null;
    }
    return {
      apiKey: featureConfig.allApiKeys.join(","),
      provider: featureConfig.platform,
      baseUrl: featureConfig.baseUrl,
      model: featureConfig.models?.[0],
      styleId,
      cinematographyProfileId: cinematographyProfileId || DEFAULT_CINEMATOGRAPHY_PROFILE_ID,
      promptLanguage,
    };
  }, [cinematographyProfileId, promptLanguage, styleId]);

  const handleCalibrateShots = useCallback(async (episodeIndex: number) => {
    const options = createOptions();
    if (!options) return;
    addSecondPass("shots");
    setViewpointAnalysisStatus("analyzing");
    toast.info(`正在校准第 ${episodeIndex} 集的分镜...`);

    try {
      const result = await calibrateEpisodeShots(
        episodeIndex,
        projectId,
        options,
        (_current, _total, message) => console.log(`[ScriptView] Shot Calibration: ${message}`),
      );
      if (!result.success) throw new Error(result.error || "分镜校准失败");

      setViewpointAnalysisStatus("completed");
      removeSecondPass("shots");
      toast.success(`分镜校准完成！已优化 ${result.calibratedCount}/${result.totalShots} 个分镜`);

      try {
        const store = useScriptStore.getState();
        const meta = store.projects[projectId]?.seriesMeta;
        if (meta) {
          const updates = syncToSeriesMeta(meta, "shot", {});
          if (Object.keys(updates).length > 0) store.updateSeriesMeta(projectId, updates);
          store.setMetadataMarkdown(projectId, exportProjectMetadata(projectId));
        }
      } catch (error) {
        console.warn("[handleCalibrateShots] SeriesMeta 回写失败:", error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Shot calibration failed:", error);
      setViewpointAnalysisStatus("error");
      removeSecondPass("shots");
      toast.error(`分镜校准失败: ${message}`);
    }
  }, [addSecondPass, createOptions, projectId, removeSecondPass, setViewpointAnalysisStatus]);

  const handleCalibrateScenesShots = useCallback(async (sceneId: string) => {
    const options = createOptions();
    if (!options) return;
    const episode = scriptData?.episodes.find((item) => item.sceneIds.includes(sceneId));
    if (!episode) {
      toast.error("找不到场景所属的集");
      return;
    }
    const scene = scriptData?.scenes.find((item) => item.id === sceneId);
    const sceneName = scene?.name || scene?.location || "场景";
    addSecondPass("shots");
    setViewpointAnalysisStatus("analyzing");
    toast.info(`正在校准「${sceneName}」的分镜...`);

    try {
      const result = await calibrateEpisodeShots(
        episode.index,
        projectId,
        options,
        (_current, _total, message) => console.log(`[ScriptView] Scene Shot Calibration: ${message}`),
        sceneId,
      );
      if (!result.success) throw new Error(result.error || "分镜校准失败");
      setViewpointAnalysisStatus("completed");
      removeSecondPass("shots");
      toast.success(`「${sceneName}」分镜校准完成！已优化 ${result.calibratedCount}/${result.totalShots} 个分镜`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Scene shot calibration failed:", error);
      setViewpointAnalysisStatus("error");
      removeSecondPass("shots");
      toast.error(`分镜校准失败: ${message}`);
    }
  }, [addSecondPass, createOptions, projectId, removeSecondPass, scriptData, setViewpointAnalysisStatus]);

  const handleCalibrateSingleShot = useCallback(async (shotId: string) => {
    const options = createOptions();
    if (!options) return;
    setSingleShotCalibrationStatus(projectId, shotId, "calibrating");
    const shot = shots.find((item) => item.id === shotId);
    if (!shot) {
      toast.error("找不到分镜");
      setSingleShotCalibrationStatus(projectId, shotId, "error");
      return;
    }
    toast.info(`正在校准分镜: ${shot.actionSummary?.slice(0, 20)}...`);

    try {
      const result = await calibrateSingleShot(
        shotId,
        projectId,
        options,
        (message) => console.log(`[ScriptView] Single Shot Calibration: ${message}`),
      );
      if (!result.success) throw new Error(result.error || "分镜校准失败");
      setSingleShotCalibrationStatus(projectId, shotId, "completed");
      toast.success("分镜校准完成！");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Single shot calibration failed:", error);
      setSingleShotCalibrationStatus(projectId, shotId, "error");
      toast.error(`分镜校准失败: ${message}`);
    }
  }, [createOptions, projectId, setSingleShotCalibrationStatus, shots]);

  return { handleCalibrateShots, handleCalibrateScenesShots, handleCalibrateSingleShot };
}
