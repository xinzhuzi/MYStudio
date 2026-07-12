import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import { getDefaultTtsModel } from "@/lib/tts/model-catalog";
import { useProjectStore } from "@/stores/project-store";
import type {
  ProjectVoiceBinding,
  SceneVoiceLine,
  TtsEngine,
  TtsSpeakerId,
  VoiceProfile,
} from "@/types/tts";

type BatchMode = "all" | "missing" | "failed";

export interface TtsProjectState {
  voiceLines: Record<string, SceneVoiceLine>;
  bindings: Record<string, ProjectVoiceBinding>;
}

export interface PersistedTtsState {
  activeProjectId: string | null;
  projects: Record<string, TtsProjectState>;
  voiceProfiles: Record<string, VoiceProfile>;
}

interface EnsureSceneVoiceLineInput {
  sceneId: number;
  dialogue: string;
  characterIds: string[];
}

type VoiceProfileInput = Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">;

export interface TtsStore {
  activeProjectId: string | null;
  projects: Record<string, TtsProjectState>;
  voiceProfiles: Record<string, VoiceProfile>;
  setActiveProjectId: (projectId: string | null) => void;
  ensureProject: (projectId: string) => void;
  createVoiceProfile: (profile: VoiceProfileInput) => VoiceProfile;
  updateVoiceProfile: (profileId: string, updates: Partial<VoiceProfileInput>) => void;
  bindSpeaker: (binding: ProjectVoiceBinding) => void;
  getBinding: (speakerId: TtsSpeakerId) => ProjectVoiceBinding | undefined;
  ensureSceneVoiceLine: (input: EnsureSceneVoiceLineInput) => SceneVoiceLine | undefined;
  upsertSceneVoiceLine: (line: Partial<SceneVoiceLine> & Pick<SceneVoiceLine, "sceneId">) => void;
  getSceneVoiceLine: (sceneId: number) => SceneVoiceLine | undefined;
  selectBatchSceneIds: (sceneIds: number[], mode: BatchMode) => number[];
  markGenerating: (sceneId: number, generationId: string) => void;
  markCompleted: (sceneId: number, result: Pick<SceneVoiceLine, "audioLocalPath"> & Partial<Pick<SceneVoiceLine, "audioMaterialId" | "audioFilePath" | "ttsBackend" | "mocked" | "warning">>) => void;
  markFailed: (sceneId: number, error: string) => void;
  clearSceneAudio: (sceneId: number) => void;
}

const defaultModel = getDefaultTtsModel();

function createEmptyProject(): TtsProjectState {
  return {
    voiceLines: {},
    bindings: {},
  };
}

let profileCounter = 0;

function createId(prefix: string) {
  profileCounter += 1;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${profileCounter}`;
}

function normalizeSpeakerId(speakerId?: TtsSpeakerId): TtsSpeakerId {
  return speakerId ?? "narrator";
}

function resolveProject(get: () => TtsStore): [string, TtsProjectState] | null {
  const { activeProjectId, projects } = get();
  if (!activeProjectId) return null;
  return [activeProjectId, projects[activeProjectId] ?? createEmptyProject()];
}

function createDefaultLine(
  input: EnsureSceneVoiceLineInput,
  binding?: ProjectVoiceBinding,
): SceneVoiceLine {
  return {
    sceneId: input.sceneId,
    speakerId: "narrator",
    text: input.dialogue.trim(),
    profileId: binding?.profileId,
    engine: binding?.defaultEngine ?? defaultModel.engine,
    modelSize: binding?.defaultModelSize ?? defaultModel.modelSize,
    status: "idle",
    updatedAt: Date.now(),
  };
}

function withProject(
  set: (partial: Partial<TtsStore> | ((state: TtsStore) => Partial<TtsStore>)) => void,
  get: () => TtsStore,
  update: (project: TtsProjectState) => TtsProjectState,
) {
  const resolved = resolveProject(get);
  if (!resolved) return;
  const [projectId, project] = resolved;
  set((state) => ({
    projects: {
      ...state.projects,
      [projectId]: update(project),
    },
  }));
}

function createStoreState(set: (partial: Partial<TtsStore> | ((state: TtsStore) => Partial<TtsStore>)) => void, get: () => TtsStore): TtsStore {
  return {
    activeProjectId: null,
    projects: {},
    voiceProfiles: {},

    setActiveProjectId: (projectId) => {
      set((state) => scopeTtsStateToProject(state, projectId));
    },

    ensureProject: (projectId) => {
      set((state) => {
        if (state.projects[projectId]) return {};
        return {
          projects: { ...state.projects, [projectId]: createEmptyProject() },
        };
      });
    },

    createVoiceProfile: (profileInput) => {
      const now = Date.now();
      const profile: VoiceProfile = {
        ...profileInput,
        id: createId("voice-profile"),
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({
        voiceProfiles: {
          ...state.voiceProfiles,
          [profile.id]: profile,
        },
      }));
      return profile;
    },

    updateVoiceProfile: (profileId, updates) => {
      set((state) => {
        const profile = state.voiceProfiles[profileId];
        if (!profile) return {};
        return {
          voiceProfiles: {
            ...state.voiceProfiles,
            [profileId]: {
              ...profile,
              ...updates,
              id: profile.id,
              createdAt: profile.createdAt,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    bindSpeaker: (binding) => {
      withProject(set, get, (project) => ({
        ...project,
        bindings: {
          ...project.bindings,
          [binding.speakerId]: binding,
        },
      }));
    },

    getBinding: (speakerId) => {
      const resolved = resolveProject(get);
      if (!resolved) return undefined;
      return resolved[1].bindings[speakerId];
    },

    ensureSceneVoiceLine: (input) => {
      const resolved = resolveProject(get);
      if (!resolved) return undefined;
      const [projectId, project] = resolved;
      const sceneKey = String(input.sceneId);
      const existing = project.voiceLines[sceneKey];
      if (existing) return existing;

      const line = createDefaultLine(input, project.bindings.narrator);
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: {
            ...project,
            voiceLines: {
              ...project.voiceLines,
              [sceneKey]: line,
            },
          },
        },
      }));
      return line;
    },

    upsertSceneVoiceLine: (line) => {
      withProject(set, get, (project) => {
        const sceneKey = String(line.sceneId);
        const existing = project.voiceLines[sceneKey];
        const speakerId = normalizeSpeakerId(line.speakerId ?? existing?.speakerId);
        const binding = project.bindings[speakerId];
        const changedSpeaker = !!existing && line.speakerId !== undefined && speakerId !== existing.speakerId;
        const hasProfileId = Object.prototype.hasOwnProperty.call(line, "profileId");
        const hasModelSize = Object.prototype.hasOwnProperty.call(line, "modelSize");
        const hasError = Object.prototype.hasOwnProperty.call(line, "error");
        const nextLine: SceneVoiceLine = {
          sceneId: line.sceneId,
          speakerId,
          text: line.text ?? existing?.text ?? "",
          profileId: hasProfileId
            ? line.profileId
            : changedSpeaker
              ? binding?.profileId
              : existing?.profileId ?? binding?.profileId,
          engine: (line.engine ?? (changedSpeaker ? binding?.defaultEngine : existing?.engine) ?? binding?.defaultEngine ?? defaultModel.engine) as TtsEngine,
          modelSize: hasModelSize
            ? line.modelSize ?? (changedSpeaker && !binding ? defaultModel.modelSize : undefined)
            : changedSpeaker
              ? binding?.defaultModelSize ?? defaultModel.modelSize
              : existing?.modelSize ?? binding?.defaultModelSize ?? defaultModel.modelSize,
          status: line.status ?? existing?.status ?? "idle",
          generationId: line.generationId ?? existing?.generationId,
          audioLocalPath: line.audioLocalPath ?? existing?.audioLocalPath,
          audioMaterialId: line.audioMaterialId ?? existing?.audioMaterialId,
          audioFilePath: line.audioFilePath ?? existing?.audioFilePath,
          ttsBackend: line.ttsBackend ?? existing?.ttsBackend,
          mocked: line.mocked ?? existing?.mocked,
          warning: line.warning ?? existing?.warning,
          error: hasError ? line.error : existing?.error,
          updatedAt: Date.now(),
        };
        return {
          ...project,
          voiceLines: {
            ...project.voiceLines,
            [sceneKey]: nextLine,
          },
        };
      });
    },

    getSceneVoiceLine: (sceneId) => {
      const resolved = resolveProject(get);
      if (!resolved) return undefined;
      return resolved[1].voiceLines[String(sceneId)];
    },

    selectBatchSceneIds: (sceneIds, mode) => {
      const resolved = resolveProject(get);
      if (!resolved) return [];
      const project = resolved[1];
      return sceneIds.filter((sceneId) => {
        const line = project.voiceLines[String(sceneId)];
        if (mode === "all") return true;
        if (mode === "failed") return line?.status === "failed";
        return !line || line.status !== "completed" || !line.audioLocalPath;
      });
    },

    markGenerating: (sceneId, generationId) => {
      get().upsertSceneVoiceLine({ sceneId, generationId, status: "generating", error: undefined });
    },

    markCompleted: (sceneId, result) => {
      withProject(set, get, (project) => {
        const sceneKey = String(sceneId);
        const existing = project.voiceLines[sceneKey];
        if (!existing) return project;
        return {
          ...project,
          voiceLines: {
            ...project.voiceLines,
            [sceneKey]: {
              ...existing,
              status: "completed",
              audioLocalPath: result.audioLocalPath,
              audioMaterialId: result.audioMaterialId,
              audioFilePath: result.audioFilePath,
              ttsBackend: result.ttsBackend,
              mocked: result.mocked,
              warning: result.warning,
              error: undefined,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },

    markFailed: (sceneId, error) => {
      get().upsertSceneVoiceLine({ sceneId, status: "failed", error });
    },

    clearSceneAudio: (sceneId) => {
      withProject(set, get, (project) => {
        const sceneKey = String(sceneId);
        const existing = project.voiceLines[sceneKey];
        if (!existing) return project;
        return {
          ...project,
          voiceLines: {
            ...project.voiceLines,
            [sceneKey]: {
              ...existing,
              status: "idle",
              generationId: undefined,
              audioLocalPath: undefined,
              audioMaterialId: undefined,
              audioFilePath: undefined,
              ttsBackend: undefined,
              mocked: undefined,
              warning: undefined,
              error: undefined,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },
  };
}

export function createTtsStore() {
  return create<TtsStore>()(createStoreState);
}

export function partializeTtsStoreState(state: TtsStore): PersistedTtsState {
  const scoped = scopeTtsStateToProject(state, state.activeProjectId);
  return {
    activeProjectId: scoped.activeProjectId ?? null,
    projects: scoped.projects ?? {},
    voiceProfiles: scoped.voiceProfiles ?? {},
  };
}

export function mergeTtsStoreState(
  persistedState: unknown,
  currentState: TtsStore,
): TtsStore {
  if (!persistedState || typeof persistedState !== "object") {
    return currentState;
  }
  const persisted = persistedState as Partial<PersistedTtsState>;
  const routerProjectId = useProjectStore.getState().activeProjectId;
  const activeProjectId = routerProjectId ?? persisted.activeProjectId ?? null;
  const candidate: PersistedTtsState = {
    activeProjectId,
    projects:
      persisted.projects && typeof persisted.projects === "object"
        ? persisted.projects
        : {},
    voiceProfiles:
      persisted.voiceProfiles && typeof persisted.voiceProfiles === "object"
        ? persisted.voiceProfiles
        : {},
  };
  const scoped = scopeTtsStateToProject(candidate, activeProjectId);
  return {
    ...currentState,
    activeProjectId: scoped.activeProjectId ?? null,
    projects: scoped.projects ?? {},
    voiceProfiles: scoped.voiceProfiles ?? {},
  };
}

function scopeTtsStateToProject(
  state: Pick<TtsStore, "activeProjectId" | "projects" | "voiceProfiles">,
  projectId: string | null,
): Partial<TtsStore> & PersistedTtsState {
  if (!projectId) {
    return {
      activeProjectId: null,
      projects: {},
      voiceProfiles: {},
    };
  }

  const project = state.projects[projectId];
  if (!project) {
    return {
      activeProjectId: projectId,
      projects: { [projectId]: createEmptyProject() },
      voiceProfiles: {},
    };
  }

  const projectIds = Object.keys(state.projects);
  const voiceProfiles =
    projectIds.length === 1 && projectIds[0] === projectId
      ? state.voiceProfiles
      : filterVoiceProfilesForProject(project, state.voiceProfiles);
  return {
    activeProjectId: projectId,
    projects: { [projectId]: project },
    voiceProfiles,
  };
}

function filterVoiceProfilesForProject(
  project: TtsProjectState,
  voiceProfiles: Record<string, VoiceProfile>,
) {
  const referencedProfileIds = new Set<string>();
  for (const binding of Object.values(project.bindings)) {
    if (binding.profileId) referencedProfileIds.add(binding.profileId);
  }
  for (const line of Object.values(project.voiceLines)) {
    if (line.profileId) referencedProfileIds.add(line.profileId);
  }
  return Object.fromEntries(
    Object.entries(voiceProfiles).filter(([profileId]) =>
      referencedProfileIds.has(profileId),
    ),
  );
}

export const useTtsStore = create<TtsStore>()(
  persist(createStoreState, {
    name: "mystudio-tts-store",
    storage: createJSONStorage(() => createProjectScopedStorage("tts")),
    partialize: partializeTtsStoreState,
    merge: mergeTtsStoreState,
  }),
);
