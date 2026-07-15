import { useCallback } from "react";
import type { PromptLanguage, ScriptData } from "@/types/script";
import type { ScriptCalibrationStatus } from "@/stores/script-store";
import { useScriptStore } from "@/stores/script-store";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  calibrateEpisodeTitles,
  generateEpisodeSynopses,
  getMissingSynopsisEpisodes,
  getMissingTitleEpisodes,
  importFullScript,
} from "@/lib/script/full-script-service";
import {
  calibrateCharacters,
  convertToScriptCharacters,
  resolveSafeScriptCharacters,
  sortByImportance,
} from "@/lib/script/character-calibrator";
import { toast } from "sonner";

type SynopsisStatus = "idle" | "generating" | "completed" | "error";
type CharacterCalibrationResult = { filteredCount: number; mergedCount: number; finalCount: number };

interface UseScriptFullImportOptions {
  projectId: string;
  styleId: string;
  promptLanguage: PromptLanguage;
  handleGenerateEpisodeShots: (episodeIndex: number) => Promise<{
    viewpointAnalyzed: boolean;
    viewpointSkippedReason?: string;
  }>;
  setImportStatus: (status: "importing" | "ready" | "error") => void;
  setImportError: (error: string | undefined) => void;
  setMissingTitleCount: (count: number) => void;
  setCalibrationStatus: (status: ScriptCalibrationStatus) => void;
  setProjectSynopsisStatus: (status: SynopsisStatus) => void;
  setMissingSynopsisCount: (count: number) => void;
  setCharacterCalibrationStatus: (status: ScriptCalibrationStatus) => void;
  setCharacterCalibrationResult: (result: CharacterCalibrationResult) => void;
  setScriptData: (projectId: string, data: ScriptData) => void;
}

export function useScriptFullImport({
  projectId,
  styleId,
  promptLanguage,
  handleGenerateEpisodeShots,
  setImportStatus,
  setImportError,
  setMissingTitleCount,
  setCalibrationStatus,
  setProjectSynopsisStatus,
  setMissingSynopsisCount,
  setCharacterCalibrationStatus,
  setCharacterCalibrationResult,
  setScriptData,
}: UseScriptFullImportOptions) {
  return useCallback(async (text: string) => {
    if (!text.trim()) {
      toast.error("请输入剧本内容");
      return;
    }

    const featureConfig = aiManager.featureConfig("script_analysis");
    const hasAI = !!featureConfig;
    setImportStatus("importing");
    setImportError(undefined);

    try {
      const result = await importFullScript(text, projectId, { styleId, promptLanguage });
      if (!result.success) throw new Error(result.error || "导入失败");

      setImportStatus("ready");
      const rawCharacterCount = result.scriptData?.characters.length || 0;
      toast.success(`导入成功: ${result.episodes.length} 集, ${rawCharacterCount} 角色(待校准), ${result.scriptData?.scenes.length || 0} 场景`);

      const missingTitles = getMissingTitleEpisodes(projectId);
      if (missingTitles.length > 0 && featureConfig) {
        setMissingTitleCount(missingTitles.length);
        toast.info(`正在为 ${missingTitles.length} 集自动生成标题...`);
        setCalibrationStatus("calibrating");
        try {
          const calibration = await calibrateEpisodeTitles(projectId, {
            apiKey: featureConfig.allApiKeys.join(","),
            provider: featureConfig.platform,
            baseUrl: featureConfig.baseUrl,
            model: featureConfig.models?.[0],
          }, (_current, _total, message) => console.log(`[ScriptView] 标题校准: ${message}`));
          if (!calibration.success) throw new Error(calibration.error || "校准失败");
          setCalibrationStatus("completed");
          setMissingTitleCount(0);
          toast.success(`已为 ${calibration.calibratedCount} 集生成标题`);
        } catch (error) {
          console.error("[ScriptView] Auto calibration failed:", error);
          setCalibrationStatus("error");
        }
      }

      if (hasAI && featureConfig && result.episodes.length > 0) {
        toast.info(`正在为 ${result.episodes.length} 集生成大纲...`);
        setProjectSynopsisStatus("generating");
        try {
          const synopsis = await generateEpisodeSynopses(projectId, {
            apiKey: featureConfig.allApiKeys.join(","),
            provider: featureConfig.platform,
            baseUrl: featureConfig.baseUrl,
            model: featureConfig.models?.[0],
          }, (_current, _total, message) => console.log(`[ScriptView] 大纲生成: ${message}`));
          if (!synopsis.success) throw new Error(synopsis.error || "大纲生成失败");
          setProjectSynopsisStatus("completed");
          setMissingSynopsisCount(getMissingSynopsisEpisodes(projectId).length);
          toast.success(`已为 ${synopsis.generatedCount} 集生成大纲`);
        } catch (error) {
          console.error("[ScriptView] Auto synopsis generation failed:", error);
          setProjectSynopsisStatus("error");
        }
      }

      let viewpointResult: Awaited<ReturnType<typeof handleGenerateEpisodeShots>> | null = null;
      if (result.episodes.length > 0) {
        toast.info("正在自动生成第1集分镜...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        viewpointResult = await handleGenerateEpisodeShots(1);
      }

      if (hasAI && rawCharacterCount > 0 && result.scriptData && result.projectBackground) {
        if (!viewpointResult?.viewpointAnalyzed) {
          toast.error(`AI 视角分析未执行，已阻止角色校准：${viewpointResult?.viewpointSkippedReason || "未知原因"}`);
          return;
        }
        toast.info(`正在 AI 校准 ${rawCharacterCount} 个角色...`);
        setCharacterCalibrationStatus("calibrating");
        try {
          const calibration = await calibrateCharacters(
            result.scriptData.characters,
            result.projectBackground,
            result.episodes,
            { promptLanguage },
          );
          const sortedCharacters = sortByImportance(calibration.characters);
          const currentProject = useScriptStore.getState().projects[projectId];
          const currentScriptData = currentProject?.scriptData;
          const existingCharacters = currentScriptData?.characters || result.scriptData.characters;
          const resolvedCharacters = resolveSafeScriptCharacters(
            convertToScriptCharacters(sortedCharacters, existingCharacters, promptLanguage),
            {
              existingCharacters,
              seriesMetaCharacters: currentProject?.seriesMeta?.characters,
              rawCharacters: result.scriptData.characters,
            },
          );
          if (currentScriptData) {
            setScriptData(projectId, { ...currentScriptData, characters: resolvedCharacters.characters });
          }
          if (resolvedCharacters.source !== "calibrated") {
            console.warn(`[ScriptView] AI character calibration returned empty result, recovered characters from ${resolvedCharacters.source}.`);
            toast.warning("AI 角色校准返回空结果，已保留现有角色，避免剧本主数据被清空");
          }
          setCharacterCalibrationStatus("completed");
          setCharacterCalibrationResult({
            filteredCount: calibration.filteredWords.length,
            mergedCount: calibration.mergeRecords.length,
            finalCount: resolvedCharacters.characters.length,
          });
          toast.success(`角色校准完成: ${resolvedCharacters.characters.length} 个有效角色, 过滤 ${calibration.filteredWords.length} 个非角色词, 合并 ${calibration.mergeRecords.length} 组重复`);
          console.log("[ScriptView] 角色校准结果:", calibration.analysisNotes);
          if (calibration.filteredWords.length > 0) console.log("[ScriptView] 过滤的非角色词:", calibration.filteredWords);
          if (calibration.mergeRecords.length > 0) console.log("[ScriptView] 合并记录:", calibration.mergeRecords);
        } catch (error) {
          console.error("[ScriptView] 角色校准失败:", error);
          setCharacterCalibrationStatus("error");
          toast.error("角色校准失败，使用原始角色列表");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] Import failed:", error);
      setImportStatus("error");
      setImportError(message);
      toast.error(`导入失败: ${message}`);
    }
  }, [
    handleGenerateEpisodeShots,
    projectId,
    promptLanguage,
    setCalibrationStatus,
    setCharacterCalibrationResult,
    setCharacterCalibrationStatus,
    setImportError,
    setImportStatus,
    setMissingSynopsisCount,
    setMissingTitleCount,
    setProjectSynopsisStatus,
    setScriptData,
    styleId,
  ]);
}
