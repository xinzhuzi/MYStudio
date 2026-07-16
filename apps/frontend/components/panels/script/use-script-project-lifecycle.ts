import { useCallback, useEffect, useRef } from "react";
import { useScriptStore, type ScriptCalibrationState, type ScriptCalibrationStatus, type ScriptViewpointStatus } from "@/stores/script-store";

interface Options {
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;
  ensureProject: (projectId: string) => void;
  setCalibrationState: (projectId: string, updates: Partial<ScriptCalibrationState>) => void;
}

export function useScriptProjectLifecycle({
  activeProjectId,
  setActiveProjectId,
  ensureProject,
  setCalibrationState,
}: Options) {
  const stableProjectId = useRef("default-project");

  useEffect(() => {
    if (!activeProjectId) return;
    setActiveProjectId(activeProjectId);
    ensureProject(activeProjectId);
    stableProjectId.current = activeProjectId;
  }, [activeProjectId, ensureProject, setActiveProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    const state = useScriptStore.getState().projects[activeProjectId]?.calibrationState;
    if (!state) return;
    const updates: Partial<ScriptCalibrationState> = {};
    if (state.importStatus === "importing") updates.importStatus = "idle";
    if (state.synopsisStatus === "generating") updates.synopsisStatus = "idle";
    if (Object.keys(updates).length > 0) setCalibrationState(activeProjectId, updates);
  }, [activeProjectId, setCalibrationState]);

  const projectId = activeProjectId || stableProjectId.current;
  return {
    projectId,
    setProjectSynopsisStatus: useCallback((status: ScriptCalibrationState["synopsisStatus"]) => {
      setCalibrationState(projectId, { synopsisStatus: status });
    }, [projectId, setCalibrationState]),
    setImportStatus: useCallback((status: ScriptCalibrationState["importStatus"]) => {
      setCalibrationState(projectId, { importStatus: status });
    }, [projectId, setCalibrationState]),
    setCalibrationStatus: useCallback((status: ScriptCalibrationStatus) => {
      setCalibrationState(projectId, { titleCalibrationStatus: status });
    }, [projectId, setCalibrationState]),
    setCharacterCalibrationStatus: useCallback((status: ScriptCalibrationStatus) => {
      setCalibrationState(projectId, { characterCalibrationStatus: status });
    }, [projectId, setCalibrationState]),
    setSceneCalibrationStatus: useCallback((status: ScriptCalibrationStatus) => {
      setCalibrationState(projectId, { sceneCalibrationStatus: status });
    }, [projectId, setCalibrationState]),
    setViewpointAnalysisStatus: useCallback((status: ScriptViewpointStatus) => {
      setCalibrationState(projectId, { viewpointAnalysisStatus: status });
    }, [projectId, setCalibrationState]),
  };
}
