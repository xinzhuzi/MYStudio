// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import type { ScriptData, Shot, Episode, ScriptScene, ScriptCharacter, EpisodeRawScript, ProjectBackground, PromptLanguage, CalibrationStrictness, FilteredCharacterRecord, SeriesMeta } from "@/types/script";
import {
  cloneScriptCharacters,
  createDefaultScriptProjectData,
  createScriptPersistOptions,
  defaultScriptInputDraft,
} from "./script-store-persistence";

export type ParseStatus = "idle" | "parsing" | "ready" | "error";
export type ShotListStatus = "idle" | "generating" | "ready" | "error";

export interface BatchProgress {
  current: number;
  total: number;
  message: string;
}

export interface ScriptInputDraft {
  mode: "import" | "create";
  idea: string;
  updatedAt: number;
}

export type ScriptCalibrationStatus = "idle" | "calibrating" | "completed" | "error";
export type ScriptViewpointStatus = "idle" | "analyzing" | "completed" | "error";
export type ScriptStructureStatus = "idle" | "processing" | "completed" | "error";

export type ScriptImportStatus = "idle" | "importing" | "ready" | "error";
export type ScriptSynopsisStatus = "idle" | "generating" | "completed" | "error";

export interface ScriptCalibrationState {
  titleCalibrationStatus: ScriptCalibrationStatus;
  characterCalibrationStatus: ScriptCalibrationStatus;
  sceneCalibrationStatus: ScriptCalibrationStatus;
  viewpointAnalysisStatus: ScriptViewpointStatus;
  structureCompletionStatus: ScriptStructureStatus;
  singleShotCalibrationStatus: Record<string, ScriptCalibrationStatus>;
  calibrationDialogOpen: boolean;
  pendingCalibrationCharacters: ScriptCharacter[] | null;
  pendingFilteredCharacters: FilteredCharacterRecord[];
  // 面板切换后需恢复的导入/大纲生成状态
  importStatus: ScriptImportStatus;
  synopsisStatus: ScriptSynopsisStatus;
}

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
export interface ScriptProjectData {
  rawScript: string;
  language: string;
  targetDuration: string;
  styleId: string;
  inputDraft: ScriptInputDraft;
  sceneCount?: string; // 场景数量（可选）
  shotCount?: string;  // 分镜数量（可选）
  scriptData: ScriptData | null;
  parseStatus: ParseStatus;
  parseError?: string;
  shots: Shot[];
  shotStatus: ShotListStatus;
  shotError?: string;
  batchProgress: BatchProgress | null;
  characterIdMap: Record<string, string>; // scriptCharId -> characterId
  sceneIdMap: Record<string, string>; // scriptSceneId -> sceneId
  updatedAt: number;
  // 完整剧本数据
  projectBackground: ProjectBackground | null;  // 项目背景（大纲、人物小传等）
  episodeRawScripts: EpisodeRawScript[];        // 各集原始剧本文本
  metadataMarkdown: string;                     // 自动生成的项目元数据 Markdown（供 AI 生成使用）
  metadataGeneratedAt?: number;                 // 元数据生成时间
  promptLanguage: PromptLanguage;               // 提示词语言（默认中文）
  calibrationStrictness: CalibrationStrictness;  // AI 角色校准严格度
  lastFilteredCharacters: FilteredCharacterRecord[];  // 上次校准被过滤的角色（用于恢复）
  calibrationState: ScriptCalibrationState;           // 校准任务状态（持久化，支持切换面板后恢复）
  seriesMeta: SeriesMeta | null;                      // 剧集元数据（跨集共享）
}

export interface ScriptStoreState {
  activeProjectId: string | null;
  projects: Record<string, ScriptProjectData>;
}

export interface ScriptStoreActions {
  setActiveProjectId: (id: string | null) => void;
  ensureProject: (projectId: string) => void;
  setRawScript: (projectId: string, rawScript: string) => void;
  setLanguage: (projectId: string, language: string) => void;
  setTargetDuration: (projectId: string, duration: string) => void;
  setStyleId: (projectId: string, styleId: string) => void;
  setInputDraft: (projectId: string, draft: Partial<ScriptInputDraft>) => void;
  setSceneCount: (projectId: string, sceneCount?: string) => void;
  setShotCount: (projectId: string, shotCount?: string) => void;
  setScriptData: (projectId: string, data: ScriptData | null) => void;
  setParseStatus: (projectId: string, status: ParseStatus, error?: string) => void;
  setShots: (projectId: string, shots: Shot[]) => void;
  updateShot: (projectId: string, shotId: string, updates: Partial<Shot>) => void;
  setShotStatus: (projectId: string, status: ShotListStatus, error?: string) => void;
  setBatchProgress: (projectId: string, progress: BatchProgress | null) => void;
  setMappings: (projectId: string, mappings: { characterIdMap?: Record<string, string>; sceneIdMap?: Record<string, string> }) => void;
  resetProjectData: (projectId: string) => void;
  // Episode CRUD
  addEpisode: (projectId: string, episode: Episode) => void;
  updateEpisode: (projectId: string, episodeId: string, updates: Partial<Episode>) => void;
  deleteEpisode: (projectId: string, episodeId: string) => void;
  // Episode Bundle 原子操作（同步 scriptData.episodes 与 episodeRawScripts）
  addEpisodeBundle: (projectId: string, title: string, synopsis?: string) => void;
  deleteEpisodeBundle: (projectId: string, episodeIndex: number) => void;
  reindexEpisodes: (projectId: string) => void;
  updateEpisodeBundle: (projectId: string, episodeIndex: number, updates: { title?: string; synopsis?: string }) => void;
  // Scene CRUD
  addScene: (projectId: string, scene: ScriptScene, episodeId?: string) => void;
  updateScene: (projectId: string, sceneId: string, updates: Partial<ScriptScene>) => void;
  deleteScene: (projectId: string, sceneId: string) => void;
  // Character CRUD
  addCharacter: (projectId: string, character: ScriptCharacter) => void;
  updateCharacter: (projectId: string, characterId: string, updates: Partial<ScriptCharacter>) => void;
  deleteCharacter: (projectId: string, characterId: string) => void;
  // Shot CRUD
  addShot: (projectId: string, shot: Shot) => void;
  deleteShot: (projectId: string, shotId: string) => void;
// 完整剧本管理
  setProjectBackground: (projectId: string, background: ProjectBackground) => void;
  setEpisodeRawScripts: (projectId: string, scripts: EpisodeRawScript[]) => void;
  updateEpisodeRawScript: (projectId: string, episodeIndex: number, updates: Partial<EpisodeRawScript>) => void;
  setMetadataMarkdown: (projectId: string, markdown: string) => void;
  setPromptLanguage: (projectId: string, lang: PromptLanguage) => void;
  setCalibrationState: (projectId: string, updates: Partial<ScriptCalibrationState>) => void;
  setSingleShotCalibrationStatus: (projectId: string, shotId: string, status: ScriptCalibrationStatus) => void;
  setCalibrationStrictness: (projectId: string, strictness: CalibrationStrictness) => void;
  setLastFilteredCharacters: (projectId: string, filtered: FilteredCharacterRecord[]) => void;
  setSeriesMeta: (projectId: string, meta: SeriesMeta) => void;
  updateSeriesMeta: (projectId: string, updates: Partial<SeriesMeta>) => void;
}

export type ScriptStore = ScriptStoreState & ScriptStoreActions;

const defaultProjectData = createDefaultScriptProjectData;

export const useScriptStore = create<ScriptStore>()(
  persist(
    (set, get) => ({
      activeProjectId: null,
      projects: {},

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      ensureProject: (projectId) => {
        const { projects } = get();
        if (projects[projectId]) return;
        set({
          projects: { ...projects, [projectId]: defaultProjectData() },
        });
      },

      setRawScript: (projectId, rawScript) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              rawScript,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setLanguage: (projectId, language) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              language,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setTargetDuration: (projectId, duration) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              targetDuration: duration,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setStyleId: (projectId, styleId) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              styleId,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setInputDraft: (projectId, draft) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              inputDraft: {
                ...(state.projects[projectId]?.inputDraft || defaultScriptInputDraft),
                ...draft,
                updatedAt: Date.now(),
              },
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setSceneCount: (projectId, sceneCount) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              sceneCount,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setShotCount: (projectId, shotCount) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              shotCount,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setScriptData: (projectId, data) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              scriptData: data,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setParseStatus: (projectId, status, error) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              parseStatus: status,
              parseError: error,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setShots: (projectId, shots) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              shots,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      updateShot: (projectId, shotId, updates) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              shots: state.projects[projectId].shots.map((s) =>
                s.id === shotId ? { ...s, ...updates } : s
              ),
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setShotStatus: (projectId, status, error) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              shotStatus: status,
              shotError: error,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setBatchProgress: (projectId, progress) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              batchProgress: progress,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setMappings: (projectId, mappings) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              characterIdMap: mappings.characterIdMap || state.projects[projectId].characterIdMap,
              sceneIdMap: mappings.sceneIdMap || state.projects[projectId].sceneIdMap,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      resetProjectData: (projectId) => {
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: defaultProjectData(),
          },
        }));
      },

      // Episode CRUD
      addEpisode: (projectId, episode) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: [...(project.scriptData.episodes || []), episode],
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateEpisode: (projectId, episodeId, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: (project.scriptData.episodes || []).map((e) =>
                    e.id === episodeId ? { ...e, ...updates } : e
                  ),
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      deleteEpisode: (projectId, episodeId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          // Also remove scenes belonging to this episode
          const episode = project.scriptData.episodes?.find((e) => e.id === episodeId);
          const sceneIdsToRemove = new Set(episode?.sceneIds || []);
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: (project.scriptData.episodes || []).filter((e) => e.id !== episodeId),
                  scenes: project.scriptData.scenes.filter((s) => !sceneIdsToRemove.has(s.id)),
                },
                shots: project.shots.filter((s) => !sceneIdsToRemove.has(s.sceneRefId)),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      // ==================== Episode Bundle 原子操作 ====================

      addEpisodeBundle: (projectId, title, synopsis) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          const existingEpisodes = project.scriptData.episodes || [];
          const existingRawScripts = project.episodeRawScripts || [];
          const newIndex = existingEpisodes.length > 0
            ? Math.max(...existingEpisodes.map(e => e.index)) + 1
            : 1;
          const newEpisodeId = `ep_${Date.now()}_${newIndex}`;
          const newEpisode: Episode = {
            id: newEpisodeId,
            index: newIndex,
            title: title || `第${newIndex}集`,
            description: synopsis || '',
            sceneIds: [],
          };
          const newRawScript: EpisodeRawScript = {
            episodeIndex: newIndex,
            title: title || `第${newIndex}集`,
            synopsis: synopsis || '',
            keyEvents: [],
            rawContent: '',
            scenes: [],
            shotGenerationStatus: 'idle',
          };
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: [...existingEpisodes, newEpisode],
                },
                episodeRawScripts: [...existingRawScripts, newRawScript],
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      deleteEpisodeBundle: (projectId, episodeIndex) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          const episode = project.scriptData.episodes?.find(e => e.index === episodeIndex);
          const sceneIdsToRemove = new Set(episode?.sceneIds || []);
          const newEpisodes = (project.scriptData.episodes || []).filter(e => e.index !== episodeIndex);
          const newRawScripts = (project.episodeRawScripts || []).filter(e => e.episodeIndex !== episodeIndex);
          // Reindex
          const reindexed = newEpisodes.map((e, i) => ({ ...e, index: i + 1 }));
          const reindexedRaw = newRawScripts.map((e, i) => ({
            ...e,
            episodeIndex: i + 1,
            title: e.title.replace(/^第\d+集/, `第${i + 1}集`),
          }));
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: reindexed,
                  scenes: project.scriptData.scenes.filter(s => !sceneIdsToRemove.has(s.id)),
                },
                shots: project.shots.filter(s => !sceneIdsToRemove.has(s.sceneRefId)),
                episodeRawScripts: reindexedRaw,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      reindexEpisodes: (projectId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          const episodes = [...(project.scriptData.episodes || [])].sort((a, b) => a.index - b.index);
          const rawScripts = [...(project.episodeRawScripts || [])].sort((a, b) => a.episodeIndex - b.episodeIndex);
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: episodes.map((e, i) => ({ ...e, index: i + 1 })),
                },
                episodeRawScripts: rawScripts.map((e, i) => ({ ...e, episodeIndex: i + 1 })),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateEpisodeBundle: (projectId, episodeIndex, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  episodes: (project.scriptData.episodes || []).map(e =>
                    e.index === episodeIndex
                      ? { ...e, ...(updates.title !== undefined ? { title: updates.title } : {}), ...(updates.synopsis !== undefined ? { description: updates.synopsis } : {}) }
                      : e
                  ),
                },
                episodeRawScripts: (project.episodeRawScripts || []).map(e =>
                  e.episodeIndex === episodeIndex
                    ? { ...e, ...(updates.title !== undefined ? { title: updates.title } : {}), ...(updates.synopsis !== undefined ? { synopsis: updates.synopsis } : {}) }
                    : e
                ),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      // Scene CRUD
      addScene: (projectId, scene, episodeId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          const newScenes = [...project.scriptData.scenes, scene];
          let newEpisodes = project.scriptData.episodes || [];
          if (episodeId) {
            newEpisodes = newEpisodes.map((e) =>
              e.id === episodeId ? { ...e, sceneIds: [...e.sceneIds, scene.id] } : e
            );
          } else if (newEpisodes.length > 0) {
            // Add to first episode if no specific episode specified
            newEpisodes = newEpisodes.map((e, i) =>
              i === 0 ? { ...e, sceneIds: [...e.sceneIds, scene.id] } : e
            );
          }
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  scenes: newScenes,
                  episodes: newEpisodes,
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateScene: (projectId, sceneId, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  scenes: project.scriptData.scenes.map((s) =>
                    s.id === sceneId ? { ...s, ...updates } : s
                  ),
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      deleteScene: (projectId, sceneId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  scenes: project.scriptData.scenes.filter((s) => s.id !== sceneId),
                  episodes: (project.scriptData.episodes || []).map((e) => ({
                    ...e,
                    sceneIds: e.sceneIds.filter((id) => id !== sceneId),
                  })),
                },
                shots: project.shots.filter((s) => s.sceneRefId !== sceneId),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      // Character CRUD
      addCharacter: (projectId, character) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  characters: [...project.scriptData.characters, character],
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateCharacter: (projectId, characterId, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  characters: project.scriptData.characters.map((c) =>
                    c.id === characterId ? { ...c, ...updates } : c
                  ),
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      deleteCharacter: (projectId, characterId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project.scriptData) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData: {
                  ...project.scriptData,
                  characters: project.scriptData.characters.filter((c) => c.id !== characterId),
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      // Shot CRUD
      addShot: (projectId, shot) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                shots: [...project.shots, shot],
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      deleteShot: (projectId, shotId) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                shots: project.shots.filter((s) => s.id !== shotId),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      // 完整剧本管理方法
      setProjectBackground: (projectId, background) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              projectBackground: background,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setEpisodeRawScripts: (projectId, scripts) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              episodeRawScripts: scripts,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      updateEpisodeRawScript: (projectId, episodeIndex, updates) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              episodeRawScripts: state.projects[projectId].episodeRawScripts.map((ep) =>
                ep.episodeIndex === episodeIndex ? { ...ep, ...updates } : ep
              ),
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setMetadataMarkdown: (projectId, markdown) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              metadataMarkdown: markdown,
              metadataGeneratedAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setPromptLanguage: (projectId, lang) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              promptLanguage: lang,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setCalibrationState: (projectId, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          const currentCalibration = project?.calibrationState || defaultCalibrationState();
          const hasPendingCharacters = Object.prototype.hasOwnProperty.call(updates, 'pendingCalibrationCharacters');
          const hasPendingFiltered = Object.prototype.hasOwnProperty.call(updates, 'pendingFilteredCharacters');
          const hasSingleShotStatus = Object.prototype.hasOwnProperty.call(updates, 'singleShotCalibrationStatus');

          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                calibrationState: {
                  ...currentCalibration,
                  ...updates,
                  pendingCalibrationCharacters: hasPendingCharacters
                    ? (updates.pendingCalibrationCharacters ?? null)
                    : currentCalibration.pendingCalibrationCharacters,
                  pendingFilteredCharacters: hasPendingFiltered
                    ? (updates.pendingFilteredCharacters ?? [])
                    : currentCalibration.pendingFilteredCharacters,
                  singleShotCalibrationStatus: hasSingleShotStatus
                    ? (updates.singleShotCalibrationStatus ?? currentCalibration.singleShotCalibrationStatus)
                    : currentCalibration.singleShotCalibrationStatus,
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setSingleShotCalibrationStatus: (projectId, shotId, status) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          const currentCalibration = project?.calibrationState || defaultCalibrationState();
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                calibrationState: {
                  ...currentCalibration,
                  singleShotCalibrationStatus: {
                    ...(currentCalibration.singleShotCalibrationStatus || {}),
                    [shotId]: status,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setCalibrationStrictness: (projectId, strictness) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              calibrationStrictness: strictness,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setLastFilteredCharacters: (projectId, filtered) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              lastFilteredCharacters: filtered,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      setSeriesMeta: (projectId, meta) => {
        get().ensureProject(projectId);
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              scriptData:
                state.projects[projectId]?.scriptData &&
                (!state.projects[projectId].scriptData.characters || state.projects[projectId].scriptData.characters.length === 0) &&
                meta.characters?.length
                  ? {
                      ...state.projects[projectId].scriptData,
                      characters: cloneScriptCharacters(meta.characters),
                    }
                  : state.projects[projectId]?.scriptData ?? null,
              seriesMeta: meta,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      updateSeriesMeta: (projectId, updates) => {
        get().ensureProject(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project?.seriesMeta) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                scriptData:
                  project.scriptData &&
                  (!project.scriptData.characters || project.scriptData.characters.length === 0) &&
                  updates.characters?.length
                    ? {
                        ...project.scriptData,
                        characters: cloneScriptCharacters(updates.characters),
                      }
                    : project.scriptData,
                seriesMeta: { ...project.seriesMeta, ...updates },
                updatedAt: Date.now(),
              },
            },
          };
        });
      },
    }),
    createScriptPersistOptions<ScriptStore>(
      createJSONStorage(() => createProjectScopedStorage("script")),
    ),
  )
);

export const useActiveScriptProject = (): ScriptProjectData | null => {
  return useScriptStore((state) => {
    const id = state.activeProjectId;
    if (!id) return null;
    return state.projects[id] || null;
  });
};
