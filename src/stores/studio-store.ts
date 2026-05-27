import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import { buildSkillContextPackage } from "@/lib/studio/context";
import {
  DEFAULT_DIRECTOR_MANUAL_ID,
  DEFAULT_VISUAL_MANUAL_ID,
} from "@/lib/studio/manuals";
import { buildMediaRefFromMaterial, createMaterialRecord } from "@/lib/studio/material";
import {
  appendNovelChapters,
  buildNovelChapterMirror,
  parseNovelChapters,
  replaceNovelChapters,
} from "@/lib/studio/novel";
import { groupStoryboardsIntoTracks } from "@/lib/studio/production";
import { useProjectStore } from "@/stores/project-store";
import type {
  AgentWorkData,
  AgentWorkKey,
  NovelChapter,
  ProductionTrack,
  SkillContextPackage,
  StudioWorkflowConfig,
  StoryboardItem,
  StoryboardMediaRef,
  StudioMaterial,
  VideoCandidate,
} from "@/types/studio";

interface StudioWorkflowState {
  materials: StudioMaterial[];
  novelChapters: NovelChapter[];
  agentWorkData: AgentWorkData[];
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  workflowConfig: StudioWorkflowConfig;
  lastContextPackage: SkillContextPackage | null;
}

interface StudioWorkflowActions {
  addMaterial: (input: { name: string; localPath: string; size: number; importedAt?: number }) => string;
  deleteMaterial: (id: string) => void;
  bindMaterialToStoryboard: (storyboardId: string, materialId: string) => void;
  importNovelText: (sourceText: string) => void;
  appendNovelText: (sourceText: string, sourceName?: string) => void;
  replaceNovelText: (sourceText: string, sourceName?: string) => void;
  updateNovelChapter: (id: string, updates: Partial<NovelChapter>) => void;
  deleteNovelChapter: (id: string) => void;
  deleteNovelChapters: (ids: string[]) => void;
  setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>) => void;
  saveAgentWorkData: (key: AgentWorkKey, data: string, episodeId?: string) => string;
  buildContext: (projectName: string, taskKey: AgentWorkKey) => SkillContextPackage;
  addStoryboard: (item?: Partial<StoryboardItem>) => string;
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef) => void;
  createStoryboardsFromChapters: () => void;
  rebuildTracks: () => void;
  updateTrack: (id: string, updates: Partial<ProductionTrack>) => void;
  addVideoCandidate: (candidate: Omit<VideoCandidate, "id" | "createdAt"> & { id?: string; createdAt?: number }) => string;
  updateVideoCandidate: (id: string, updates: Partial<VideoCandidate>) => void;
  selectVideoCandidate: (trackId: string, videoId: string) => void;
  deleteVideoCandidate: (id: string) => void;
  resetStudioWorkflow: () => void;
}

type StudioWorkflowStore = StudioWorkflowState & StudioWorkflowActions;

const initialState: StudioWorkflowState = {
  materials: [],
  novelChapters: [],
  agentWorkData: [],
  storyboards: [],
  productionTracks: [],
  videoCandidates: [],
  workflowConfig: {
    visualManualId: DEFAULT_VISUAL_MANUAL_ID,
    directorManualId: DEFAULT_DIRECTOR_MANUAL_ID,
    autoAnalyzeEventsOnImport: false,
  },
  lastContextPackage: null,
};

const LEGACY_VISUAL_MANUAL_ID = "2D_chinese_guofeng";
const LEGACY_DIRECTOR_MANUAL_ID = "Xianxia_fantasy";

export const useStudioStore = create<StudioWorkflowStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addMaterial: (input) => {
        const material = createMaterialRecord(input);
        set((state) => ({
          materials: [
            material,
            ...state.materials.filter((item) => item.id !== material.id && item.localPath !== material.localPath),
          ],
        }));
        return material.id;
      },

      deleteMaterial: (id) => {
        set((state) => ({
          materials: state.materials.filter((item) => item.id !== id),
          storyboards: state.storyboards.map((item) => {
            const material = state.materials.find((candidate) => candidate.id === id);
            if (!material || item.mediaRef?.path !== material.localPath) return item;
            return { ...item, mediaRef: undefined };
          }),
        }));
        get().rebuildTracks();
      },

      bindMaterialToStoryboard: (storyboardId, materialId) => {
        const material = get().materials.find((item) => item.id === materialId);
        if (!material) return;
        get().updateStoryboard(storyboardId, { mediaRef: buildMediaRefFromMaterial(material) });
      },

      importNovelText: (sourceText) => {
        const novelChapters = parseNovelChapters(sourceText);
        set({ novelChapters });
        syncNovelChapterMirrors(novelChapters);
      },

      appendNovelText: (sourceText, sourceName) => {
        const novelChapters = appendNovelChapters(get().novelChapters, sourceText, { sourceName });
        const importedChapters = novelChapters.slice(get().novelChapters.length);
        set({ novelChapters });
        syncNovelChapterMirrors(importedChapters);
      },

      replaceNovelText: (sourceText, sourceName) => {
        const previousChapters = get().novelChapters;
        const novelChapters = replaceNovelChapters(sourceText, { sourceName });
        set({ novelChapters });
        syncNovelChapterMirrors(novelChapters);
        removeNovelChapterMirrors(previousChapters.filter((chapter) => !novelChapters.some((next) => next.id === chapter.id)));
      },

      updateNovelChapter: (id, updates) => {
        set((state) => ({
          novelChapters: state.novelChapters.map((chapter) =>
            chapter.id === id ? { ...chapter, ...updates, updatedAt: Date.now() } : chapter,
          ),
        }));
        const updatedChapter = get().novelChapters.find((chapter) => chapter.id === id);
        if (updatedChapter) {
          syncNovelChapterMirrors([updatedChapter]);
        }
      },

      deleteNovelChapter: (id) => {
        get().deleteNovelChapters([id]);
      },

      deleteNovelChapters: (ids) => {
        const idSet = new Set(ids);
        const removedChapters = get().novelChapters.filter((chapter) => idSet.has(chapter.id));
        set((state) => ({
          novelChapters: state.novelChapters.filter((chapter) => !idSet.has(chapter.id)),
        }));
        removeNovelChapterMirrors(removedChapters);
      },

      setWorkflowConfig: (updates) => {
        set((state) => ({
          workflowConfig: {
            ...state.workflowConfig,
            ...updates,
          },
        }));
      },

      saveAgentWorkData: (key, data, episodeId) => {
        const now = Date.now();
        const id = createId("work");
        const item: AgentWorkData = { id, key, episodeId, data, createdAt: now, updatedAt: now };
        set((state) => ({ agentWorkData: [...state.agentWorkData, item] }));
        return id;
      },

      buildContext: (projectName, taskKey) => {
        const context = buildSkillContextPackage({
          projectName,
          taskKey,
          chapters: get().novelChapters,
          agentWorkData: get().agentWorkData,
          workflowConfig: get().workflowConfig,
        });
        set({ lastContextPackage: context });
        return context;
      },

      addStoryboard: (item = {}) => {
        const id = item.id ?? createId("sb");
        const storyboard: StoryboardItem = {
          id,
          episodeId: item.episodeId ?? "episode-1",
          index: item.index ?? get().storyboards.length + 1,
          trackKey: item.trackKey ?? `track-${get().storyboards.length + 1}`,
          trackId: item.trackId ?? "",
          duration: item.duration ?? 5,
          prompt: item.prompt ?? "",
          videoDesc: item.videoDesc ?? "",
          assetIds: item.assetIds ?? [],
          mediaRef: item.mediaRef,
          state: item.state ?? "idle",
          reason: item.reason,
        };
        set((state) => ({ storyboards: [...state.storyboards, storyboard] }));
        get().rebuildTracks();
        return id;
      },

      updateStoryboard: (id, updates) => {
        set((state) => ({
          storyboards: state.storyboards.map((item) => (item.id === id ? { ...item, ...updates } : item)),
        }));
        get().rebuildTracks();
      },

      bindStoryboardMedia: (id, mediaRef) => {
        get().updateStoryboard(id, { mediaRef });
      },

      createStoryboardsFromChapters: () => {
        const chapters = get().novelChapters;
        if (!chapters.length) return;
        const storyboards = chapters.map<StoryboardItem>((chapter) => ({
          id: createId("sb"),
          episodeId: "episode-1",
          index: chapter.index,
          trackKey: `chapter-${String(chapter.index).padStart(3, "0")}`,
          trackId: "",
          duration: 5,
          prompt: chapter.eventSummary || chapter.title,
          videoDesc: chapter.sourceText.slice(0, 80),
          assetIds: [],
          state: "idle",
        }));
        set({ storyboards });
        get().rebuildTracks();
      },

      rebuildTracks: () => {
        const existing = new Map(get().productionTracks.map((track) => [track.trackKey, track]));
        const grouped = groupStoryboardsIntoTracks(get().storyboards).map((track) => {
          const old = existing.get(track.trackKey);
          return {
            ...track,
            id: old?.id ?? track.id,
            prompt: old?.prompt || track.prompt,
            candidateVideoIds: old?.candidateVideoIds ?? [],
            selectedVideoId: old?.selectedVideoId,
            state: old?.state ?? track.state,
            reason: old?.reason,
          };
        });
        set({ productionTracks: grouped });
      },

      updateTrack: (id, updates) => {
        set((state) => ({
          productionTracks: state.productionTracks.map((track) => (track.id === id ? { ...track, ...updates } : track)),
        }));
      },

      addVideoCandidate: (candidate) => {
        const id = candidate.id ?? createId("video");
        const createdAt = candidate.createdAt ?? Date.now();
        const nextCandidate: VideoCandidate = { ...candidate, id, createdAt };
        set((state) => ({
          videoCandidates: [...state.videoCandidates, nextCandidate],
          productionTracks: state.productionTracks.map((track) =>
            track.id === nextCandidate.trackId
              ? { ...track, candidateVideoIds: [...new Set([...track.candidateVideoIds, id])] }
              : track,
          ),
        }));
        return id;
      },

      updateVideoCandidate: (id, updates) => {
        set((state) => ({
          videoCandidates: state.videoCandidates.map((item) => (item.id === id ? { ...item, ...updates } : item)),
        }));
      },

      selectVideoCandidate: (trackId, videoId) => {
        set((state) => ({
          productionTracks: state.productionTracks.map((track) =>
            track.id === trackId ? { ...track, selectedVideoId: videoId } : track,
          ),
        }));
      },

      deleteVideoCandidate: (id) => {
        set((state) => ({
          videoCandidates: state.videoCandidates.filter((item) => item.id !== id),
          productionTracks: state.productionTracks.map((track) => ({
            ...track,
            candidateVideoIds: track.candidateVideoIds.filter((candidateId) => candidateId !== id),
            selectedVideoId: track.selectedVideoId === id ? undefined : track.selectedVideoId,
          })),
        }));
      },

      resetStudioWorkflow: () => set({ ...initialState }),
    }),
    {
      name: "studio-workflow-store",
      storage: createJSONStorage(() => createProjectScopedStorage("studio-workflow-store")),
      version: 2,
      migrate: (persistedState) => migrateStudioWorkflowState(persistedState),
    },
  ),
);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function migrateStudioWorkflowState(persistedState: unknown) {
  if (!persistedState || typeof persistedState !== "object") return persistedState;
  const state = persistedState as Partial<StudioWorkflowState>;
  return {
    ...state,
    workflowConfig: normalizeWorkflowConfig(state.workflowConfig),
  };
}

function normalizeWorkflowConfig(config: Partial<StudioWorkflowConfig> | undefined): StudioWorkflowConfig {
  return {
    ...config,
    visualManualId: !config?.visualManualId || config.visualManualId === LEGACY_VISUAL_MANUAL_ID
      ? DEFAULT_VISUAL_MANUAL_ID
      : config.visualManualId,
    directorManualId: !config?.directorManualId || config.directorManualId === LEGACY_DIRECTOR_MANUAL_ID
      ? DEFAULT_DIRECTOR_MANUAL_ID
      : config.directorManualId,
  };
}

function getActiveProjectId() {
  return useProjectStore.getState().activeProjectId;
}

function syncNovelChapterMirrors(chapters: NovelChapter[]) {
  const projectId = getActiveProjectId();
  if (!projectId || !window.projectFiles?.writeText) return;

  for (const chapter of chapters) {
    const mirror = buildNovelChapterMirror(projectId, chapter);
    window.projectFiles.writeText(mirror.key, mirror.content).catch((error: unknown) => {
      console.warn("[StudioStore] Failed to write novel chapter mirror:", error);
    });
  }
}

function removeNovelChapterMirrors(chapters: NovelChapter[]) {
  const projectId = getActiveProjectId();
  if (!projectId || !window.projectFiles?.removeText) return;

  for (const chapter of chapters) {
    const mirror = buildNovelChapterMirror(projectId, chapter);
    window.projectFiles.removeText(mirror.key).catch((error: unknown) => {
      console.warn("[StudioStore] Failed to remove novel chapter mirror:", error);
    });
  }
}
