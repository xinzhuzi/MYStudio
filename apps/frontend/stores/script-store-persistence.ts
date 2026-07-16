// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available in COMMERCIAL_LICENSE.md.

import type { PersistOptions, PersistStorage } from "zustand/middleware";
import { DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";
import type {
  FilteredCharacterRecord,
  ScriptCharacter,
  ScriptData,
} from "@/types/script";
import type {
  ScriptCalibrationState,
  ScriptInputDraft,
  ScriptProjectData,
} from "./script-store";

export interface ScriptStorePersistenceState {
  activeProjectId: string | null;
  projects: Record<string, ScriptProjectData>;
  setScriptData: (projectId: string, data: ScriptData | null) => void;
}

export interface ScriptPersistedState {
  activeProjectId: string | null;
  projectData?: ScriptProjectData;
  projects?: Record<string, ScriptProjectData>;
}

export const defaultScriptInputDraft: ScriptInputDraft = {
  mode: "import",
  idea: "",
  updatedAt: 0,
};

const defaultCalibrationState = (): ScriptCalibrationState => ({
  titleCalibrationStatus: "idle",
  characterCalibrationStatus: "idle",
  sceneCalibrationStatus: "idle",
  viewpointAnalysisStatus: "idle",
  structureCompletionStatus: "idle",
  singleShotCalibrationStatus: {},
  calibrationDialogOpen: false,
  pendingCalibrationCharacters: null,
  pendingFilteredCharacters: [],
  importStatus: "idle",
  synopsisStatus: "idle",
});

export const createDefaultScriptProjectData = (): ScriptProjectData => ({
  rawScript: "",
  language: "中文",
  targetDuration: "60s",
  styleId: DEFAULT_STYLE_ID,
  inputDraft: { ...defaultScriptInputDraft },
  sceneCount: undefined,
  shotCount: undefined,
  scriptData: null,
  parseStatus: "idle",
  parseError: undefined,
  shots: [],
  shotStatus: "idle",
  shotError: undefined,
  batchProgress: null,
  characterIdMap: {},
  sceneIdMap: {},
  updatedAt: Date.now(),
  projectBackground: null,
  episodeRawScripts: [],
  metadataMarkdown: "",
  metadataGeneratedAt: undefined,
  promptLanguage: "zh",
  calibrationStrictness: "normal",
  lastFilteredCharacters: [],
  calibrationState: defaultCalibrationState(),
  seriesMeta: null,
});

const pendingCharacterRecoveryProjectIds = new Set<string>();

export const cloneScriptCharacters = (characters: ScriptCharacter[] | undefined): ScriptCharacter[] => {
  if (!Array.isArray(characters) || characters.length === 0) {
    return [];
  }

  return characters
    .filter((character): character is ScriptCharacter => Boolean(character?.name))
    .map((character, index) => ({
      ...character,
      id: character.id || `char_recovered_${index + 1}`,
      name: character.name.trim(),
      tags: Array.isArray(character.tags)
        ? [...new Set(character.tags.filter(Boolean))]
        : character.tags,
    }));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizeScriptProjectData = (
  projectId: string,
  projectData: unknown,
): ScriptProjectData => {
  const defaults = createDefaultScriptProjectData();
  const defaultCalibration = defaultCalibrationState();
  const rawProject = isRecord(projectData)
    ? (projectData as Partial<ScriptProjectData>)
    : {};
  const rawInputDraft = isRecord(rawProject.inputDraft)
    ? rawProject.inputDraft
    : {};
  const rawCalibration: Record<string, unknown> = isRecord(rawProject.calibrationState)
    ? (rawProject.calibrationState as Record<string, unknown>)
    : {};
  const rawSingleShotStatuses: Partial<ScriptCalibrationState["singleShotCalibrationStatus"]> = isRecord(
    rawCalibration.singleShotCalibrationStatus,
  )
    ? (rawCalibration.singleShotCalibrationStatus as Partial<ScriptCalibrationState["singleShotCalibrationStatus"]>)
    : {};

  const normalizedProject: ScriptProjectData = {
    ...defaults,
    ...rawProject,
    inputDraft: {
      ...defaultScriptInputDraft,
      ...rawInputDraft,
    },
    calibrationState: {
      ...defaultCalibration,
      ...rawCalibration,
      singleShotCalibrationStatus: {
        ...defaultCalibration.singleShotCalibrationStatus,
        ...(rawSingleShotStatuses as ScriptCalibrationState["singleShotCalibrationStatus"]),
      },
      pendingCalibrationCharacters: Array.isArray(rawCalibration.pendingCalibrationCharacters)
        ? rawCalibration.pendingCalibrationCharacters
        : null,
      pendingFilteredCharacters: Array.isArray(rawCalibration.pendingFilteredCharacters)
        ? (rawCalibration.pendingFilteredCharacters as FilteredCharacterRecord[])
        : [],
    },
  };

  const recoveredCharacters = cloneScriptCharacters(normalizedProject.seriesMeta?.characters);
  if (
    normalizedProject.scriptData &&
    (!Array.isArray(normalizedProject.scriptData.characters) || normalizedProject.scriptData.characters.length === 0) &&
    recoveredCharacters.length > 0
  ) {
    normalizedProject.scriptData = {
      ...normalizedProject.scriptData,
      characters: recoveredCharacters,
    };
    pendingCharacterRecoveryProjectIds.add(projectId);
  }

  return normalizedProject;
};

export const flushRecoveredCharactersToDisk = (
  state: ScriptStorePersistenceState | undefined,
): void => {
  if (!state || pendingCharacterRecoveryProjectIds.size === 0) {
    return;
  }

  for (const projectId of Array.from(pendingCharacterRecoveryProjectIds)) {
    const project = state.projects[projectId];
    const characters = cloneScriptCharacters(project?.scriptData?.characters);
    if (!project?.scriptData || characters.length === 0) {
      pendingCharacterRecoveryProjectIds.delete(projectId);
      continue;
    }

    state.setScriptData(projectId, {
      ...project.scriptData,
      characters,
    });
    pendingCharacterRecoveryProjectIds.delete(projectId);
  }
};

export const partializeScriptStoreState = <S extends ScriptStorePersistenceState>(
  state: S,
): ScriptPersistedState => {
  const pid = state.activeProjectId;
  if (!pid || !state.projects[pid]) return { activeProjectId: pid };
  return {
    activeProjectId: pid,
    projectData: state.projects[pid],
  };
};

export const mergeScriptStoreState = <S extends ScriptStorePersistenceState>(
  persisted: unknown,
  current: S,
): S => {
  if (!isRecord(persisted)) return current;

  const legacyProjects = persisted.projects;
  if (isRecord(legacyProjects)) {
    const normalizedProjects: Record<string, ScriptProjectData> = {};
    for (const [projectId, projectData] of Object.entries(legacyProjects)) {
      normalizedProjects[projectId] = normalizeScriptProjectData(projectId, projectData);
    }
    return {
      ...current,
      ...persisted,
      projects: normalizedProjects,
    } as S;
  }

  const pid = typeof persisted.activeProjectId === "string" ? persisted.activeProjectId : null;
  const projectData = persisted.projectData;
  if (!pid || !projectData) return current;

  return {
    ...current,
    activeProjectId: pid,
    projects: {
      ...current.projects,
      [pid]: normalizeScriptProjectData(pid, projectData),
    },
  };
};

export const createScriptPersistOptions = <S extends ScriptStorePersistenceState>(
  storage?: PersistStorage<ScriptPersistedState>,
): PersistOptions<S, ScriptPersistedState> => ({
  name: "mystudio-script-store",
  storage,
  partialize: partializeScriptStoreState,
  merge: mergeScriptStoreState,
  onRehydrateStorage: () => (state, error) => {
    if (error || pendingCharacterRecoveryProjectIds.size === 0) {
      return;
    }

    queueMicrotask(() => {
      flushRecoveredCharactersToDisk(state);
    });
  },
});
