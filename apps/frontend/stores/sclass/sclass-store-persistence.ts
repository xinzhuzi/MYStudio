import type {
  SClassConfig,
  SClassEditorPrefs,
  SClassProjectData,
} from "./sclass-store";

export type SClassStateLike = {
  activeProjectId: string | null;
  projects: Record<string, SClassProjectData>;
  generationMode: "group" | "single";
};

export const defaultConfig: SClassConfig = {
  defaultDuration: 10,
  concurrency: 1,
};

export const defaultEditorPrefs: SClassEditorPrefs = {
  imageGenMode: "merged",
  frameMode: "first",
  refStrategy: "cluster",
  useExemplar: true,
  activeTab: "editing",
  episodeViewScope: "episode",
};

export const defaultProjectData = (): SClassProjectData => ({
  shotGroups: [],
  singleShotOverrides: {},
  globalAssetRefs: [],
  config: { ...defaultConfig },
  mode: "storyboard",
  hasAutoGrouped: false,
  lastGridImageUrl: null,
  lastGridSceneIds: null,
  editorPrefs: { ...defaultEditorPrefs },
});

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

export function normalizeProjectData(project: unknown): SClassProjectData {
  const source = asRecord(project);
  const defaults = defaultProjectData();
  return {
    ...defaults,
    ...source,
    config: {
      ...defaults.config,
      ...asRecord(source.config),
    },
    editorPrefs: {
      ...defaultEditorPrefs,
      ...asRecord(source.editorPrefs),
    },
  } as SClassProjectData;
}

function migrateConfig(config: unknown): unknown {
  if (!config) return config;
  const { aspectRatio: _aspectRatio, resolution: _resolution, ...clean } = asRecord(config);
  return clean;
}

function migrateProjectData(project: unknown): SClassProjectData {
  if (!project) return normalizeProjectData(project);
  const normalized = normalizeProjectData(project);
  return {
    ...normalized,
    config: migrateConfig(normalized.config) as SClassConfig,
    editorPrefs: {
      ...defaultEditorPrefs,
      ...(normalized.editorPrefs || {}),
    },
  };
}

export function partializeSClassStore<T extends SClassStateLike>(state: T) {
  const projectData = state.activeProjectId
    ? state.projects[state.activeProjectId] ?? null
    : null;
  return {
    activeProjectId: state.activeProjectId,
    projectData,
    generationMode: state.generationMode,
  };
}

export function mergeSClassStore<T extends SClassStateLike>(persisted: unknown, current: T): T {
  if (!persisted) return current;

  const data = persisted as {
    projects?: unknown;
    activeProjectId?: string | null;
    projectData?: unknown;
    generationMode?: "group" | "single";
  };

  if (data.projects && typeof data.projects === "object") {
    const migratedProjects: Record<string, SClassProjectData> = {};
    for (const [key, value] of Object.entries(data.projects)) {
      migratedProjects[key] = migrateProjectData(value);
    }
    return { ...current, ...(persisted as object), projects: migratedProjects } as T;
  }

  const updates = { ...current } as T & {
    activeProjectId: string | null;
    generationMode: "group" | "single";
    projects: Record<string, SClassProjectData>;
  };
  if (data.generationMode) updates.generationMode = data.generationMode;
  if (data.activeProjectId) updates.activeProjectId = data.activeProjectId;
  if (data.activeProjectId && data.projectData) {
    updates.projects = {
      ...current.projects,
      [data.activeProjectId]: migrateProjectData(data.projectData),
    };
  }
  return updates;
}
