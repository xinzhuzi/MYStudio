import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { detectMultiStageHints } from "@/lib/script/character-stage-analyzer";
import { resolveSafeScriptCharacters } from "@/lib/script/character-calibrator";
import { exportProjectMetadata } from "@/lib/script/full-script-service";
import { syncToSeriesMeta } from "@/lib/script/series-meta-sync";
import { useScriptStore, type ScriptCalibrationState } from "@/stores/script-store";
import type { CalibrationStrictness, FilteredCharacterRecord, ScriptCharacter, ScriptData } from "@/types/script";

interface Options {
  projectId: string;
  importStatus: string;
  outline?: string;
  episodeCount: number;
  calibrateCharacters: () => Promise<unknown>;
  setMultiStageHints: (hints: string[]) => void;
  setSuggestMultiStage: (suggest: boolean) => void;
  setScriptData: (projectId: string, data: ScriptData | null) => void;
  setLastFilteredCharacters: (projectId: string, filtered: FilteredCharacterRecord[]) => void;
  setCalibrationState: (projectId: string, updates: Partial<ScriptCalibrationState>) => void;
  setCalibrationStrictness: (projectId: string, strictness: CalibrationStrictness) => void;
}

export function useScriptCharacterReviewActions(options: Options) {
  const {
    projectId, importStatus, outline, episodeCount, calibrateCharacters,
    setMultiStageHints, setSuggestMultiStage, setScriptData,
    setLastFilteredCharacters, setCalibrationState, setCalibrationStrictness,
  } = options;

  const confirmCalibration = useCallback((kept: ScriptCharacter[], filtered: FilteredCharacterRecord[]) => {
    const currentProject = useScriptStore.getState().projects[projectId];
    const safeCharacters = kept.length > 0 ? kept : resolveSafeScriptCharacters([], {
      existingCharacters: currentProject?.scriptData?.characters,
      seriesMetaCharacters: currentProject?.seriesMeta?.characters,
    }).characters;
    if (currentProject?.scriptData) {
      setScriptData(projectId, { ...currentProject.scriptData, characters: safeCharacters });
    }
    setLastFilteredCharacters(projectId, filtered);
    setCalibrationState(projectId, {
      calibrationDialogOpen: false,
      pendingCalibrationCharacters: null,
      pendingFilteredCharacters: [],
    });
    toast.success(`角色校准确认: ${safeCharacters.length} 个角色已保存`);
    try {
      const store = useScriptStore.getState();
      const meta = store.projects[projectId]?.seriesMeta;
      if (meta) {
        const updates = syncToSeriesMeta(meta, "character", { characters: safeCharacters });
        if (Object.keys(updates).length > 0) store.updateSeriesMeta(projectId, updates);
        store.setMetadataMarkdown(projectId, exportProjectMetadata(projectId));
      }
    } catch (error) {
      console.warn("[handleConfirmCalibration] SeriesMeta 回写失败:", error);
    }
  }, [projectId, setCalibrationState, setLastFilteredCharacters, setScriptData]);

  const cancelCalibration = useCallback(() => {
    setCalibrationState(projectId, {
      calibrationDialogOpen: false,
      pendingCalibrationCharacters: null,
      pendingFilteredCharacters: [],
    });
    toast.info("已取消角色校准");
  }, [projectId, setCalibrationState]);

  const restoreFilteredCharacter = useCallback((name: string) => {
    const project = useScriptStore.getState().projects[projectId];
    if (!project?.scriptData) return;
    setScriptData(projectId, {
      ...project.scriptData,
      characters: [...project.scriptData.characters, {
        id: `char_restored_${Date.now()}`,
        name,
        tags: ["extra", "restored"],
      }],
    });
    setLastFilteredCharacters(projectId, (project.lastFilteredCharacters || []).filter((item) => item.name !== name));
    toast.success(`已恢复角色: ${name}`);
  }, [projectId, setLastFilteredCharacters, setScriptData]);

  useEffect(() => {
    if (importStatus !== "ready" || !outline) return;
    const result = detectMultiStageHints(outline, episodeCount);
    setMultiStageHints(result.hints);
    setSuggestMultiStage(result.suggestMultiStage);
  }, [episodeCount, importStatus, outline, setMultiStageHints, setSuggestMultiStage]);

  return {
    handleAnalyzeCharacterStages: calibrateCharacters,
    handleConfirmCalibration: confirmCalibration,
    handleCancelCalibration: cancelCalibration,
    handleCalibrationStrictnessChange: (strictness: CalibrationStrictness) => setCalibrationStrictness(projectId, strictness),
    handleRestoreFilteredCharacter: restoreFilteredCharacter,
  };
}
