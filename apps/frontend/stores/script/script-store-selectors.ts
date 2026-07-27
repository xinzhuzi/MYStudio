import type { ScriptProjectData } from "./script-store-types";

export interface ActiveScriptProjectState {
  activeProjectId: string | null;
  projects: Record<string, ScriptProjectData>;
}

export function selectActiveScriptProject(
  state: ActiveScriptProjectState,
): ScriptProjectData | null {
  const id = state.activeProjectId;
  return id ? state.projects[id] ?? null : null;
}
