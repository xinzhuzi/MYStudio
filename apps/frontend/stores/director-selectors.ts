import type { SceneProgress } from "@opencut/ai-core";
import type { DirectorProjectData, DirectorStore } from "./director-store";

function getSceneProgress(state: DirectorStore): Map<number, SceneProgress> {
  return state.sceneProgress instanceof Map ? state.sceneProgress : new Map();
}

export function selectActiveDirectorProject(state: DirectorStore): DirectorProjectData | null {
  if (!state.activeProjectId) return null;
  return state.projects[state.activeProjectId] || null;
}

export function selectDirectorSceneProgress(sceneId: number) {
  return (state: DirectorStore): SceneProgress | undefined => getSceneProgress(state).get(sceneId);
}

export function selectDirectorOverallProgress(state: DirectorStore): number {
  const project = state.activeProjectId ? state.projects[state.activeProjectId] : null;
  const screenplay = project?.screenplay || null;
  if (!screenplay || screenplay.scenes.length === 0) return 0;
  const sceneProgress = getSceneProgress(state);
  let total = 0;
  for (const scene of screenplay.scenes) {
    total += sceneProgress.get(scene.sceneId)?.progress ?? 0;
  }
  return Math.round(total / screenplay.scenes.length);
}

export function selectDirectorIsGenerating(state: DirectorStore): boolean {
  for (const progress of getSceneProgress(state).values()) {
    if (progress.status === "generating") return true;
  }
  return false;
}

export function selectCompletedDirectorScenesCount(state: DirectorStore): number {
  let count = 0;
  for (const progress of getSceneProgress(state).values()) {
    if (progress.status === "completed") count++;
  }
  return count;
}

export function selectFailedDirectorScenesCount(state: DirectorStore): number {
  let count = 0;
  for (const progress of getSceneProgress(state).values()) {
    if (progress.status === "failed") count++;
  }
  return count;
}
