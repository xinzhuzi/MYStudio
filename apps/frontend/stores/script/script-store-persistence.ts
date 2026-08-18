// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available in COMMERCIAL_LICENSE.md.

import type { PersistOptions, PersistStorage } from "zustand/middleware";
import { createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/storage/project-storage";
import { useProjectStore } from "@/stores/project/project-store";
import { DEFAULT_STYLE_ID } from "@/lib/constants/visual-styles";
import type {
  FilteredCharacterRecord,
  ScriptCharacter,
  ScriptData,
} from "@/types/script";
import type { ScriptCalibrationState, ScriptInputDraft, ScriptProjectData } from "./script-store-types";

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

export const defaultCalibrationState = (): ScriptCalibrationState => ({
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

/** CLI 管线曾把剧本 store 以裸 ScriptProjectData(无 zustand {state,version}
 *  包装)直写进项目文件——persist 读不懂裸形状会保持内存空态,后续任意
 *  set()(含 switchProject 的 ensureProject)触发 persist 把空默认整包写回,
 *  真实数据被覆写(道劫 08-18 事故)。读侧把裸形状按读取时的活跃项目重
 *  包装成 mergeScriptStoreState 认识的 {activeProjectId, projectData}。 */
/**
 * 概览元数据独立落盘（Trellis 08-18-seriesmeta-store-split,方案 A·持久层拆分）：
 * seriesMeta 在内存仍挂 script store（11 个剧本链服务零改动），但物理上拆为
 * `store/overview.json`——script.json 回归纯剧本，名实相符。
 * 读：overview 优先，script 旧值在场则迁移旁写 overview 并从 script 剥离；
 * 写：入参信封拆两半分流落盘。
 */
function isEnvelopeWithProjectData(value: unknown): value is { state: { activeProjectId?: unknown; projectData?: Record<string, unknown> }; version?: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const state = (value as Record<string, unknown>).state;
  if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
  return typeof (state as Record<string, unknown>).projectData === "object" && (state as Record<string, unknown>).projectData !== null;
}

function overviewEnvelope(activeProjectId: unknown, seriesMeta: unknown): string {
  return JSON.stringify({
    state: { activeProjectId: typeof activeProjectId === "string" ? activeProjectId : null, seriesMeta },
    version: 0,
  });
}

export function createScriptScopedJsonStorage(): PersistStorage<ScriptPersistedState> | undefined {
  return createJSONStorage(() => {
    const scoped = createProjectScopedStorage("script");
    const overviewScoped = createProjectScopedStorage("overview");
    return {
      getItem: async (name: string): Promise<string | null> => {
        const raw = await scoped.getItem(name);
        const overviewRaw = await overviewScoped.getItem(name);
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          // 非 JSON 内容按原样返回,交给 persist 的解析报错
          return raw;
        }

        // ① CLI 裸形状重包装（旧防御保留:无 state/projectData 包装而有 rawScript）
        if (
          !("state" in parsed) &&
          !("projectData" in parsed) &&
          "rawScript" in parsed
        ) {
          const pid = useProjectStore.getState().activeProjectId;
          if (typeof pid === "string" && pid) {
            console.warn(
              "[script-store] 检测到 CLI 直写的裸剧本文件,读时重包装为活跃项目数据以避免空态覆写",
            );
            return JSON.stringify({
              state: { activeProjectId: pid, projectData: parsed },
              version: 0,
            });
          }
          return raw;
        }

        if (!isEnvelopeWithProjectData(parsed)) {
          // 非常规形状（如无 projectData 的空壳）不参与拆分合并
          return raw;
        }
        const state = parsed.state;
        const projectData = state.projectData!;

        // ② overview.json 的 seriesMeta 优先注入
        let overviewSeriesMeta: unknown;
        let overviewParsed: unknown = null;
        if (overviewRaw) {
          try {
            overviewParsed = JSON.parse(overviewRaw);
          } catch {
            overviewParsed = null;
          }
          if (
            overviewParsed !== null &&
            typeof overviewParsed === "object" &&
            !Array.isArray(overviewParsed) &&
            typeof (overviewParsed as Record<string, unknown>).state === "object"
          ) {
            overviewSeriesMeta = ((overviewParsed as { state: Record<string, unknown> }).state).seriesMeta;
          }
        }
        if (overviewSeriesMeta !== undefined) {
          projectData.seriesMeta = overviewSeriesMeta;
          return JSON.stringify(parsed);
        }

        // ③ 旧布局迁移:script.json 里还躺着 seriesMeta → 旁写 overview.json 并从 script 剥离
        const legacy = projectData.seriesMeta;
        if (legacy !== undefined && legacy !== null) {
          delete projectData.seriesMeta;
          try {
            await overviewScoped.setItem(name, overviewEnvelope(state.activeProjectId, legacy));
            await scoped.setItem(name, JSON.stringify(parsed));
            console.warn("[script-store] seriesMeta 已迁移至独立 store/overview.json");
          } catch (error) {
            // 迁移失败不阻断读取:返回含 seriesMeta 的原状(下次再试)
            console.warn("[script-store] seriesMeta 迁移 overview.json 失败,暂留 script.json:", error);
          }
          // 盘上已剥离;返回给内存的形状必须保留 seriesMeta(消费方零改动的前提)
          projectData.seriesMeta = legacy;
        }
        return JSON.stringify(parsed);
      },
      setItem: async (name: string, value: string): Promise<void> => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          await scoped.setItem(name, value);
          return;
        }
        if (!isEnvelopeWithProjectData(parsed)) {
          await scoped.setItem(name, value);
          return;
        }
        const state = parsed.state;
        const projectData = state.projectData!;
        const seriesMeta = projectData.seriesMeta;
        delete projectData.seriesMeta;
        if (seriesMeta !== undefined && seriesMeta !== null) {
          await overviewScoped.setItem(name, overviewEnvelope(state.activeProjectId, seriesMeta));
        }
        await scoped.setItem(name, JSON.stringify(parsed));
      },
      removeItem: async (name: string): Promise<void> => {
        await scoped.removeItem(name);
        await overviewScoped.removeItem(name);
      },
    };
  });
}
