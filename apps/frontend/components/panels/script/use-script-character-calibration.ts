import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  CalibrationStrictness,
  EpisodeRawScript,
  ProjectBackground,
  PromptLanguage,
  ScriptData,
} from "@/types/script";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  calibrateCharacters,
  convertToScriptCharacters,
  extractAllCharactersFromEpisodes,
  resolveSafeScriptCharacters,
  sortByImportance,
} from "@/lib/script/character-calibrator";
import {
  analyzeCharacterStages,
  detectMultiStageHints,
} from "@/lib/script/character-stage-analyzer";
import { expandCharacterStages } from "@/lib/script/character-stage-expansion";
import { useScriptStore, type ScriptCalibrationStatus } from "@/stores/script-store";
import { toast } from "sonner";

type ScriptStoreState = ReturnType<typeof useScriptStore.getState>;
type StageAnalysisStatus = "idle" | "analyzing" | "completed" | "error";
type CharacterCalibrationResult = {
  filteredCount: number;
  mergedCount: number;
  finalCount: number;
};

interface UseScriptCharacterCalibrationOptions {
  projectId: string;
  scriptData: ScriptData | null;
  background?: ProjectBackground | null;
  calibrationStrictness?: CalibrationStrictness;
  episodeRawScripts: EpisodeRawScript[];
  promptLanguage: PromptLanguage;
  setCalibrationState: ScriptStoreState["setCalibrationState"];
  setCharacterCalibrationStatus: (status: ScriptCalibrationStatus) => void;
  setStageAnalysisStatus: Dispatch<SetStateAction<StageAnalysisStatus>>;
  setMultiStageHints: Dispatch<SetStateAction<string[]>>;
  setSuggestMultiStage: Dispatch<SetStateAction<boolean>>;
  setCharacterCalibrationResult: Dispatch<SetStateAction<CharacterCalibrationResult | null>>;
  addSecondPass: (type: string) => void;
  removeSecondPass: (type: string) => void;
}

export function useScriptCharacterCalibration({
  projectId,
  scriptData,
  background,
  calibrationStrictness,
  episodeRawScripts,
  promptLanguage,
  setCalibrationState,
  setCharacterCalibrationStatus,
  setStageAnalysisStatus,
  setMultiStageHints,
  setSuggestMultiStage,
  setCharacterCalibrationResult,
  addSecondPass,
  removeSecondPass,
}: UseScriptCharacterCalibrationOptions) {
  const handleCalibrateCharacters = useCallback(async () => {
    const featureConfig = aiManager.featureConfig("script_analysis");
    if (!featureConfig) {
      toast.error(aiManager.featureNotConfiguredMessage("script_analysis"));
      return;
    }
    if (!background) {
      toast.error("缺少剧本背景信息");
      return;
    }
    if (episodeRawScripts.length === 0) {
      toast.error("缺少分集剧本数据，请重新导入剧本或使用新版导入功能");
      console.error("[handleCalibrateCharacters] episodeRawScripts 为空或不存在");
      return;
    }

    const rawCharacters = extractAllCharactersFromEpisodes(episodeRawScripts);
    if (rawCharacters.length === 0) {
      toast.error("未能从剧本中提取到角色");
      return;
    }

    console.log("[handleCalibrateCharacters] 开始校准:", {
      rawCharacterCount: rawCharacters.length,
      episodeCount: episodeRawScripts.length,
      hasBackground: true,
    });
    addSecondPass("characters");
    setCalibrationState(projectId, {
      characterCalibrationStatus: "calibrating",
      calibrationDialogOpen: false,
      pendingCalibrationCharacters: null,
      pendingFilteredCharacters: [],
    });
    toast.info(`正在 AI 校准 ${rawCharacters.length} 个原始角色...`);

    try {
      const existingCalibrated = scriptData?.characters?.map((character) => ({
        id: character.id,
        name: character.name,
        importance: (character.tags?.includes("protagonist") ? "protagonist"
          : character.tags?.includes("supporting") ? "supporting"
            : character.tags?.includes("minor") ? "minor" : "extra") as "protagonist" | "supporting" | "minor" | "extra",
        appearanceCount: 1,
        role: character.role,
        age: character.age,
        gender: character.gender,
        relationships: character.relationships,
        nameVariants: [character.name],
        visualPromptEn: character.visualPromptEn,
        visualPromptZh: character.visualPromptZh,
        identityAnchors: character.identityAnchors,
        negativePrompt: character.negativePrompt,
      })) || [];
      const calibration = await calibrateCharacters(
        rawCharacters,
        background,
        episodeRawScripts,
        {
          previousCharacters: existingCalibrated,
          promptLanguage,
          strictness: calibrationStrictness || "normal",
        },
      );
      let characters = convertToScriptCharacters(
        sortByImportance(calibration.characters),
        rawCharacters,
        promptLanguage,
      );
      if (characters.length === 0) {
        const currentProject = useScriptStore.getState().projects[projectId];
        const resolved = resolveSafeScriptCharacters([], {
          existingCharacters: currentProject?.scriptData?.characters,
          seriesMetaCharacters: currentProject?.seriesMeta?.characters,
          rawCharacters,
        });
        characters = resolved.characters;
        console.warn(`[handleCalibrateCharacters] AI character calibration returned empty result, recovered characters from ${resolved.source}.`);
        toast.warning("AI 角色校准返回空结果，已回退到现有角色列表，请确认后保存");
      }

      const multiStageHint = detectMultiStageHints(background.outline || "", episodeRawScripts.length);
      if (multiStageHint.suggestMultiStage) {
        toast.info("检测到多阶段角色线索，正在分析主角阶段变化...");
        setStageAnalysisStatus("analyzing");
        try {
          const analyses = await analyzeCharacterStages(
            background,
            characters,
            episodeRawScripts.length,
            promptLanguage,
          );
          if (analyses.some((analysis) => analysis.needsMultiStage)) {
            const expansion = expandCharacterStages(characters, analyses, promptLanguage);
            characters = expansion.characters;
            setMultiStageHints(multiStageHint.hints);
            setSuggestMultiStage(false);
            toast.success(`多阶段角色创建完成！为 ${expansion.multiStageCharacterCount} 个角色创建了 ${expansion.stageCount} 个阶段角色`);
          }
          setStageAnalysisStatus("completed");
        } catch (error) {
          console.error("[ScriptView] 多阶段分析失败:", error);
          setStageAnalysisStatus("error");
        }
      }

      setCalibrationState(projectId, {
        pendingCalibrationCharacters: characters,
        pendingFilteredCharacters: calibration.filteredCharacters || [],
        calibrationDialogOpen: true,
      });
      setCharacterCalibrationStatus("completed");
      removeSecondPass("characters");
      setCharacterCalibrationResult({
        filteredCount: calibration.filteredCharacters.length,
        mergedCount: calibration.mergeRecords.length,
        finalCount: characters.length,
      });
      toast.info(`角色校准完成，共 ${characters.length} 个角色，请确认结果`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ScriptView] 角色校准失败:", error);
      setCharacterCalibrationStatus("error");
      removeSecondPass("characters");
      toast.error(`角色校准失败: ${message}`);
    }
  }, [
    addSecondPass,
    background,
    calibrationStrictness,
    episodeRawScripts,
    projectId,
    promptLanguage,
    removeSecondPass,
    scriptData,
    setCalibrationState,
    setCharacterCalibrationResult,
    setCharacterCalibrationStatus,
    setMultiStageHints,
    setStageAnalysisStatus,
    setSuggestMultiStage,
  ]);

  return { handleCalibrateCharacters };
}
