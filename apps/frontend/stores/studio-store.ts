import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import {
  buildAssetImageWorkflowPatch,
  buildStoryboardImageWorkflowPatch,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow";
import { buildMediaRefFromMaterial, createMaterialRecord } from "@/lib/studio/material";
import {
  appendNovelChapters,
  buildNovelChapterMirror,
  parseNovelChapters,
  replaceNovelChapters,
} from "@/lib/studio/novel";
import { groupStoryboardsIntoTracks } from "@/lib/studio/production";
import {
  createHumanVisualReview,
  markContinuityDependentsStale,
  visualContinuityFingerprint,
  visualReviewInputFingerprint,
} from "@/lib/studio/visual-continuity";
import {
  buildProjectEventGraph,
  projectEventGraphToMemoryRecords,
  retrieveProjectMemory,
} from "@/lib/studio/event-graph";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useProjectStore } from "@/stores/project-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import type {
  AgentWorkData,
  AgentWorkKey,
  ContinuityAssetVersion,
  EntityExtractionResult,
  EpisodeOutline,
  ImageWorkflowGraph,
  ImageWorkflowTarget,
  HumanVisualReviewInput,
  MediaGenerationTask,
  MediaGenerationTaskKind,
  NovelChapter,
  ProjectEventGraphRecord,
  ProjectMemoryContext,
  ProjectMemoryQuery,
  ProjectMemoryRecord,
  ProductionTrack,
  ScriptPlan,
  SeriesBible,
  StudioAgentRun,
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
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  episodeOutlines: EpisodeOutline[];
  storyboards: StoryboardItem[];
  continuityAssetVersions: ContinuityAssetVersion[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  imageWorkflows: ImageWorkflowGraph[];
  agentRuns: StudioAgentRun[];
  mediaTasks: MediaGenerationTask[];
  eventGraph: ProjectEventGraphRecord[];
  projectMemoryRecords: ProjectMemoryRecord[];
  workflowConfig: StudioWorkflowConfig;
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
  startAgentRun: (input: {
    key: AgentWorkKey;
    phase: string;
    inputSummary: string;
    inputFingerprint?: string;
    checkpointRef?: string;
    retryOf?: string;
  }) => string;
  finishAgentRun: (id: string, output?: { outputRef?: string; outputRefs?: string[]; checkpointRef?: string }) => void;
  failAgentRun: (id: string, errorReason: string, checkpointRef?: string) => void;
  cancelAgentRun: (id: string, errorReason?: string, checkpointRef?: string) => void;
  retryAgentRun: (id: string) => string | null;
  startMediaTask: (input: {
    kind: MediaGenerationTaskKind;
    targetId: string;
    episodeId?: string;
    provider?: string;
    runId?: string;
    checkpointRef?: string;
    inputFingerprint?: string;
    retryOf?: string;
  }) => string;
  finishMediaTask: (id: string, output?: { outputRef?: string; outputRefs?: string[]; checkpointRef?: string }) => void;
  failMediaTask: (id: string, errorReason: string, checkpointRef?: string) => void;
  cancelMediaTask: (id: string, errorReason?: string, checkpointRef?: string) => void;
  retryMediaTask: (id: string) => string | null;
  retryFailedMediaTasks: (kind?: MediaGenerationTaskKind) => string[];
  rebuildProjectMemoryFromChapters: (projectId: string) => void;
  retrieveProjectMemory: (query: ProjectMemoryQuery) => ProjectMemoryContext;
  purgeProjectMemory: (projectId: string) => void;
  saveAgentWorkData: (key: AgentWorkKey, data: string, episodeId?: string) => string;
  saveEntityExtraction: (result: EntityExtractionResult) => void;
  saveScriptPlan: (plan: ScriptPlan) => void;
  saveSeriesBible: (bible: SeriesBible) => void;
  saveEpisodeOutline: (outline: EpisodeOutline) => void;
  addStoryboard: (item?: Partial<StoryboardItem>) => string;
  replaceContinuityAssetVersions: (items: ContinuityAssetVersion[]) => void;
  replaceStoryboardsForEpisode: (episodeId: string, items: StoryboardItem[]) => void;
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  reviewStoryboardHuman: (id: string, review: HumanVisualReviewInput) => void;
  bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef) => void;
  createImageWorkflow: (input?: Parameters<typeof createImageWorkflowGraph>[0]) => string;
  upsertImageWorkflow: (graph: ImageWorkflowGraph) => void;
  updateImageWorkflow: (id: string, updates: Partial<ImageWorkflowGraph>) => void;
  deleteImageWorkflow: (id: string) => void;
  applyImageWorkflowResultToStoryboard: (storyboardId: string, workflowId: string, nodeId: string) => void;
  applyImageWorkflowResultToAsset: (target: ImageWorkflowTarget, workflowId: string, nodeId: string) => void;
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
  entityExtractions: [],
  scriptPlans: [],
  seriesBible: null,
  episodeOutlines: [],
  storyboards: [],
  continuityAssetVersions: [],
  productionTracks: [],
  videoCandidates: [],
  imageWorkflows: [],
  agentRuns: [],
  mediaTasks: [],
  eventGraph: [],
  projectMemoryRecords: [],
  workflowConfig: {
    autoAnalyzeEventsOnImport: false,
    episodeDurationMin: 3,
  },
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

      startAgentRun: (input) => {
        const id = createId("run");
        const now = Date.now();
        const previous = input.retryOf ? get().agentRuns.find((run) => run.id === input.retryOf) : undefined;
        const run: StudioAgentRun = {
          id,
          key: input.key,
          phase: input.phase,
          status: "running",
          inputSummary: input.inputSummary,
          inputFingerprint: input.inputFingerprint,
          retryOf: input.retryOf,
          retryCount: previous ? (previous.retryCount ?? 0) + 1 : 0,
          checkpointRef: input.checkpointRef,
          startedAt: now,
        };
        set((state) => ({ agentRuns: [...state.agentRuns, run] }));
        return id;
      },

      finishAgentRun: (id, output = {}) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  ...output,
                  status: "success",
                  finishedAt: now,
                  errorReason: undefined,
                }
              : run,
          ),
        }));
      },

      failAgentRun: (id, errorReason, checkpointRef) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  status: "failed",
                  errorReason,
                  checkpointRef: checkpointRef ?? run.checkpointRef,
                  finishedAt: now,
                }
              : run,
          ),
        }));
      },

      cancelAgentRun: (id, errorReason = "Cancelled", checkpointRef) => {
        const now = Date.now();
        set((state) => ({
          agentRuns: state.agentRuns.map((run) =>
            run.id === id
              ? {
                  ...run,
                  status: "canceled",
                  errorReason,
                  checkpointRef: checkpointRef ?? run.checkpointRef,
                  finishedAt: now,
                }
              : run,
          ),
        }));
      },

      retryAgentRun: (id) => {
        const previous = get().agentRuns.find((run) => run.id === id);
        if (!previous) return null;
        return get().startAgentRun({
          key: previous.key,
          phase: previous.phase,
          inputSummary: previous.inputSummary,
          inputFingerprint: previous.inputFingerprint,
          checkpointRef: previous.checkpointRef,
          retryOf: previous.id,
        });
      },

      startMediaTask: (input) => {
        const id = createId("media-task");
        const now = Date.now();
        const previous = input.retryOf ? get().mediaTasks.find((task) => task.id === input.retryOf) : undefined;
        const task: MediaGenerationTask = {
          id,
          kind: input.kind,
          targetId: input.targetId,
          episodeId: input.episodeId,
          provider: input.provider,
          runId: input.runId,
          checkpointRef: input.checkpointRef,
          inputFingerprint: input.inputFingerprint,
          retryOf: input.retryOf,
          retryCount: previous ? (previous.retryCount ?? 0) + 1 : 0,
          status: "running",
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ mediaTasks: [...state.mediaTasks, task] }));
        return id;
      },

      finishMediaTask: (id, output = {}) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  ...output,
                  status: "success",
                  errorReason: undefined,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      failMediaTask: (id, errorReason, checkpointRef) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: "failed",
                  errorReason,
                  checkpointRef: checkpointRef ?? task.checkpointRef,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      cancelMediaTask: (id, errorReason = "Cancelled", checkpointRef) => {
        const now = Date.now();
        set((state) => ({
          mediaTasks: state.mediaTasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: "canceled",
                  errorReason,
                  checkpointRef: checkpointRef ?? task.checkpointRef,
                  updatedAt: now,
                  finishedAt: now,
                }
              : task,
          ),
        }));
      },

      retryMediaTask: (id) => {
        const previous = get().mediaTasks.find((task) => task.id === id);
        if (!previous || previous.status !== "failed") return null;
        return get().startMediaTask({
          kind: previous.kind,
          targetId: previous.targetId,
          episodeId: previous.episodeId,
          provider: previous.provider,
          runId: previous.runId,
          checkpointRef: previous.checkpointRef,
          inputFingerprint: previous.inputFingerprint,
          retryOf: previous.id,
        });
      },

      retryFailedMediaTasks: (kind) =>
        get().mediaTasks
          .filter((task) => task.status === "failed" && (!kind || task.kind === kind))
          .map((task) => get().retryMediaTask(task.id))
          .filter((id): id is string => Boolean(id)),

      rebuildProjectMemoryFromChapters: (projectId) => {
        const eventGraph = buildProjectEventGraph({
          projectId,
          chapters: get().novelChapters,
        });
        const memoryRecords = projectEventGraphToMemoryRecords(eventGraph);
        set((state) => ({
          eventGraph: [
            ...state.eventGraph.filter((record) => record.projectId !== projectId),
            ...eventGraph,
          ],
          projectMemoryRecords: [
            ...state.projectMemoryRecords.filter((record) => record.projectId !== projectId || record.kind !== "event"),
            ...memoryRecords,
          ],
        }));
      },

      retrieveProjectMemory: (query) => retrieveProjectMemory(get().projectMemoryRecords, query),

      purgeProjectMemory: (projectId) => {
        set((state) => ({
          eventGraph: state.eventGraph.filter((record) => record.projectId !== projectId),
          projectMemoryRecords: state.projectMemoryRecords.filter((record) => record.projectId !== projectId),
        }));
      },

      saveAgentWorkData: (key, data, episodeId) => {
        const now = Date.now();
        const id = createId("work");
        const item: AgentWorkData = { id, key, episodeId, data, createdAt: now, updatedAt: now };
        set((state) => ({ agentWorkData: [...state.agentWorkData, item] }));
        if (key === "productionPlan" && /本地成片输出[:：]\s*\S+/.test(data)) {
          const taskId = get().startMediaTask({
            kind: "finalExport",
            targetId: episodeId ?? id,
            episodeId,
            provider: "ffmpeg-local",
            inputFingerprint: data,
          });
          get().finishMediaTask(taskId, { outputRef: id });
        }
        return id;
      },

      saveEntityExtraction: (result) => {
        set((state) => ({
          entityExtractions: [
            ...state.entityExtractions.filter((item) => item.episodeId !== result.episodeId),
            result,
          ],
        }));
      },

      saveScriptPlan: (plan) => {
        set((state) => ({
          scriptPlans: [
            ...state.scriptPlans.filter((item) => item.episodeId !== plan.episodeId),
            plan,
          ],
        }));
      },

      saveSeriesBible: (bible) => {
        set({ seriesBible: bible });
      },

      saveEpisodeOutline: (outline) => {
        set((state) => ({
          episodeOutlines: [
            ...state.episodeOutlines.filter((item) => item.episodeId !== outline.episodeId),
            outline,
          ],
        }));
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
          imageWorkflowId: item.imageWorkflowId,
          imageWorkflowNodeId: item.imageWorkflowNodeId,
          shouldGenerateImage: item.shouldGenerateImage,
          sourceEvidence: item.sourceEvidence,
          orderedReferenceManifest: item.orderedReferenceManifest,
          continuityState: item.continuityState,
          visualReview: item.visualReview,
          audioRef: item.audioRef,
          state: item.state ?? "idle",
          reason: item.reason,
          stale: item.stale,
          staleReason: item.staleReason,
          staleSince: item.staleSince,
          sourceRunId: item.sourceRunId,
          sourceFingerprint: item.sourceFingerprint ?? storyboardSourceFingerprint(item),
          outputVersion: item.outputVersion,
          emotion: item.emotion,
          orientation: item.orientation,
          spatialRelation: item.spatialRelation,
          associateAssetsNames: item.associateAssetsNames,
          lines: item.lines,
          speakerId: item.speakerId,
          sound: item.sound,
        };
        set((state) => ({ storyboards: [...state.storyboards, storyboard] }));
        get().rebuildTracks();
        return id;
      },

      replaceContinuityAssetVersions: (items) => {
        set({
          continuityAssetVersions: items.map((item) => ({
            ...item,
            referenceImagePaths: [...item.referenceImagePaths],
          })),
        });
      },

      replaceStoryboardsForEpisode: (episodeId, items) => {
        set((state) => ({
          storyboards: [
            ...state.storyboards.filter((item) => item.episodeId !== episodeId),
            ...items.map((item) => {
              const previous = state.storyboards.find((current) => current.id === item.id);
              return previous
                ? mergeStoryboardReplacement(previous, { ...previous, ...item }, "storyboard source changed")
                : { ...item, sourceFingerprint: item.sourceFingerprint ?? storyboardSourceFingerprint(item) };
            }),
          ],
        }));
        get().rebuildTracks();
      },

      updateStoryboard: (id, updates) => {
        const { visualReview: _ignoredVisualReview, ...safeUpdates } = updates;
        if (Object.keys(safeUpdates).length === 0) return;
        const previous = get().storyboards.find((item) => item.id === id);
        const previousReviewFingerprint = previous ? visualReviewInputFingerprint(previous) : undefined;
        set((state) => ({
          storyboards: state.storyboards.map((item) =>
            item.id === id ? mergeStoryboardReplacement(item, { ...item, ...safeUpdates }, "storyboard source changed") : item,
          ),
        }));
        const current = get().storyboards.find((item) => item.id === id);
        if (
          previousReviewFingerprint
          && current
          && previousReviewFingerprint !== visualReviewInputFingerprint(current)
        ) {
          set((state) => ({
            storyboards: markContinuityDependentsStale(
              state.storyboards.map((item) => item.id === id && item.visualReview
                ? {
                    ...item,
                    visualReview: {
                      ...item.visualReview,
                      status: "pending" as const,
                      reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
                    },
                  }
                : item),
              id,
            ),
          }));
        }
        get().rebuildTracks();
      },

      reviewStoryboardHuman: (id, reviewInput) => {
        const storyboard = get().storyboards.find((item) => item.id === id);
        if (!storyboard) throw new Error(`分镜 ${id} 不存在`);
        const visualReview = createHumanVisualReview(storyboard, reviewInput);
        set((state) => ({
          storyboards: state.storyboards.map((item) => item.id === id ? { ...item, visualReview } : item),
        }));
      },

      bindStoryboardMedia: (id, mediaRef) => {
        get().updateStoryboard(id, { mediaRef });
        const storyboard = get().storyboards.find((item) => item.id === id);
        const taskId = get().startMediaTask({
          kind: mediaRef.kind === "audio" ? "ttsAudio" : "storyboardImage",
          targetId: id,
          episodeId: storyboard?.episodeId,
          provider: mediaRef.kind,
          inputFingerprint: storyboard ? storyboardSourceFingerprint(storyboard) : undefined,
        });
        get().finishMediaTask(taskId, {
          outputRef: mediaRef.path,
          outputRefs: [mediaRef.path, mediaRef.imageWorkflowId, mediaRef.imageWorkflowNodeId].filter(
            (ref): ref is string => Boolean(ref),
          ),
        });
      },

      createImageWorkflow: (input = {}) => {
        const graph = createImageWorkflowGraph(input);
        set((state) => ({
          imageWorkflows: [
            graph,
            ...state.imageWorkflows.filter((item) => item.id !== graph.id),
          ],
        }));
        return graph.id;
      },

      upsertImageWorkflow: (graph) => {
        set((state) => ({
          imageWorkflows: [
            graph,
            ...state.imageWorkflows.filter((item) => item.id !== graph.id),
          ],
        }));
      },

      updateImageWorkflow: (id, updates) => {
        set((state) => ({
          imageWorkflows: state.imageWorkflows.map((item) =>
            item.id === id
              ? { ...item, ...updates, id: item.id, updatedAt: updates.updatedAt ?? Date.now() }
              : item,
          ),
        }));
      },

      deleteImageWorkflow: (id) => {
        set((state) => ({
          imageWorkflows: state.imageWorkflows.filter((item) => item.id !== id),
        }));
      },

      applyImageWorkflowResultToStoryboard: (storyboardId, workflowId, nodeId) => {
        const graph = get().imageWorkflows.find((item) => item.id === workflowId);
        if (!graph) return;
        const patch = buildStoryboardImageWorkflowPatch(graph, nodeId);
        get().updateStoryboard(storyboardId, patch);
        if (patch.mediaRef) {
          const storyboard = get().storyboards.find((item) => item.id === storyboardId);
          const taskId = get().startMediaTask({
            kind: "storyboardImage",
            targetId: storyboardId,
            episodeId: storyboard?.episodeId,
            provider: "image",
            checkpointRef: `${workflowId}:${nodeId}`,
            inputFingerprint: storyboard ? storyboardSourceFingerprint(storyboard) : undefined,
          });
          get().finishMediaTask(taskId, {
            outputRef: patch.mediaRef.path,
            outputRefs: [patch.mediaRef.path, workflowId, nodeId],
            checkpointRef: `${workflowId}:${nodeId}`,
          });
        }
      },

      applyImageWorkflowResultToAsset: (target, workflowId, nodeId) => {
        if (target.kind !== "asset" || !target.assetType || !target.id) return;
        const graph = get().imageWorkflows.find((item) => item.id === workflowId);
        if (!graph) return;
        const patch = buildAssetImageWorkflowPatch(graph, nodeId);
        if (target.assetType === "character") {
          if (!target.parentId) return;
          useCharacterLibraryStore.getState().updateVariation(target.parentId, target.id, {
            referenceImage: patch.imageUrl,
            imageWorkflowId: patch.imageWorkflowId,
            imageWorkflowNodeId: patch.imageWorkflowNodeId,
            generatedAt: patch.generatedAt,
          });
          return;
        }
        if (target.assetType === "scene") {
          useSceneStore.getState().updateScene(target.id, {
            referenceImage: patch.imageUrl,
            imageWorkflowId: patch.imageWorkflowId,
            imageWorkflowNodeId: patch.imageWorkflowNodeId,
          });
          return;
        }
        usePropsLibraryStore.getState().updateProp(target.id, {
          imageUrl: patch.imageUrl,
          imageWorkflowId: patch.imageWorkflowId,
          imageWorkflowNodeId: patch.imageWorkflowNodeId,
        });
      },

      createStoryboardsFromChapters: () => {
        const chapters = get().novelChapters;
        if (!chapters.length) return;
        const storyboards = chapters.map<StoryboardItem>((chapter) => ({
          id: createId("sb"),
          episodeId: chapter.id,
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
        const staleCandidateIds = new Set<string>();
        const grouped = groupStoryboardsIntoTracks(get().storyboards).map((track) => {
          const old = existing.get(track.trackKey);
          const fingerprint = trackSourceFingerprint(track, get().storyboards);
          const sourceChanged = Boolean(old?.sourceFingerprint && old.sourceFingerprint !== fingerprint);
          const shouldMarkStale = sourceChanged && Boolean(old?.candidateVideoIds.length || old?.selectedVideoId);
          if (shouldMarkStale) {
            for (const candidateId of old?.candidateVideoIds ?? []) staleCandidateIds.add(candidateId);
          }
          return {
            ...track,
            id: old?.id ?? track.id,
            prompt: old?.prompt || track.prompt,
            candidateVideoIds: old?.candidateVideoIds ?? [],
            selectedVideoId: old?.selectedVideoId,
            state: old?.state ?? track.state,
            reason: old?.reason,
            stale: shouldMarkStale ? true : old?.stale,
            staleReason: shouldMarkStale ? "storyboard source changed" : old?.staleReason,
            staleSince: shouldMarkStale ? Date.now() : old?.staleSince,
            sourceRunId: old?.sourceRunId,
            sourceFingerprint: fingerprint,
            outputVersion: old?.outputVersion,
          };
        });
        set((state) => ({
          productionTracks: grouped,
          videoCandidates: state.videoCandidates.map((candidate) =>
            staleCandidateIds.has(candidate.id)
              ? markStale(candidate, "track source changed")
              : candidate,
          ),
        }));
      },

      updateTrack: (id, updates) => {
        set((state) => ({
          productionTracks: state.productionTracks.map((track) => (track.id === id ? { ...track, ...updates } : track)),
        }));
      },

      addVideoCandidate: (candidate) => {
        const id = candidate.id ?? createId("video");
        const createdAt = candidate.createdAt ?? Date.now();
        const nextCandidate: VideoCandidate = {
          ...candidate,
          id,
          createdAt,
          stale: candidate.stale ?? false,
          sourceFingerprint: candidate.sourceFingerprint ?? videoCandidateFingerprint(candidate),
          outputVersion: candidate.outputVersion ?? 1,
        };
        set((state) => ({
          videoCandidates: [...state.videoCandidates, nextCandidate],
          productionTracks: state.productionTracks.map((track) =>
            track.id === nextCandidate.trackId
              ? { ...track, candidateVideoIds: [...new Set([...track.candidateVideoIds, id])] }
              : track,
          ),
        }));
        const track = get().productionTracks.find((item) => item.id === nextCandidate.trackId);
        const taskId = get().startMediaTask({
          kind: nextCandidate.provider === "ffmpeg-local" ? "ffmpegTrack" : "modelVideo",
          targetId: id,
          episodeId: track?.episodeId,
          provider: nextCandidate.provider,
          inputFingerprint: nextCandidate.sourceFingerprint,
        });
        if (nextCandidate.state === "ready" || nextCandidate.filePath) {
          get().finishMediaTask(taskId, { outputRef: nextCandidate.filePath ?? id });
        } else if (nextCandidate.state === "failed") {
          get().failMediaTask(taskId, nextCandidate.errorReason ?? "Video candidate generation failed");
        }
        return id;
      },

      updateVideoCandidate: (id, updates) => {
        set((state) => ({
          videoCandidates: state.videoCandidates.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...updates,
                  stale: updates.filePath || updates.state === "ready" ? false : updates.stale ?? item.stale,
                  staleReason: updates.filePath || updates.state === "ready" ? undefined : updates.staleReason ?? item.staleReason,
                  staleSince: updates.filePath || updates.state === "ready" ? undefined : updates.staleSince ?? item.staleSince,
                  sourceFingerprint: updates.sourceFingerprint ?? item.sourceFingerprint ?? videoCandidateFingerprint(item),
                  outputVersion: updates.filePath || updates.state === "ready" ? (item.outputVersion ?? 0) + 1 : item.outputVersion,
                }
              : item,
          ),
        }));
        const candidate = get().videoCandidates.find((item) => item.id === id);
        if (!candidate) return;
        const existingTask = [...get().mediaTasks]
          .reverse()
          .find((task) => task.targetId === id && (task.kind === "ffmpegTrack" || task.kind === "modelVideo"));
        const taskId = existingTask?.status === "running"
          ? existingTask.id
          : get().startMediaTask({
              kind: candidate.provider === "ffmpeg-local" ? "ffmpegTrack" : "modelVideo",
              targetId: id,
              episodeId: get().productionTracks.find((track) => track.id === candidate.trackId)?.episodeId,
              provider: candidate.provider,
              inputFingerprint: candidate.sourceFingerprint,
            });
        if (candidate.state === "ready" || candidate.filePath) {
          get().finishMediaTask(taskId, { outputRef: candidate.filePath ?? id });
        } else if (candidate.state === "failed") {
          get().failMediaTask(taskId, candidate.errorReason ?? "Video candidate generation failed");
        }
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
      version: 8,
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
    entityExtractions: state.entityExtractions ?? [],
    scriptPlans: state.scriptPlans ?? [],
    seriesBible: state.seriesBible ?? null,
    episodeOutlines: state.episodeOutlines ?? [],
    continuityAssetVersions: state.continuityAssetVersions ?? [],
    imageWorkflows: state.imageWorkflows ?? [],
    agentRuns: state.agentRuns ?? [],
    mediaTasks: state.mediaTasks ?? [],
    eventGraph: state.eventGraph ?? [],
    projectMemoryRecords: state.projectMemoryRecords ?? [],
    workflowConfig: normalizeWorkflowConfig(state.workflowConfig),
  };
}

function mergeStoryboardReplacement(previous: StoryboardItem, next: StoryboardItem, staleReason: string): StoryboardItem {
  const previousFingerprint = previous.sourceFingerprint ?? storyboardSourceFingerprint(previous);
  const nextFingerprint = storyboardSourceFingerprint(next);
  const sourceChanged = previousFingerprint !== nextFingerprint;
  const hasOutput = Boolean(previous.mediaRef || previous.audioRef || previous.imageWorkflowId || previous.imageWorkflowNodeId);
  const freshWrite = Boolean(
    next.mediaRef !== previous.mediaRef ||
      next.audioRef !== previous.audioRef ||
      next.imageWorkflowId !== previous.imageWorkflowId ||
      next.imageWorkflowNodeId !== previous.imageWorkflowNodeId,
  );
  if (freshWrite) {
    return {
      ...next,
      stale: false,
      staleReason: undefined,
      staleSince: undefined,
      sourceFingerprint: nextFingerprint,
      outputVersion: (previous.outputVersion ?? 0) + 1,
    };
  }
  if (sourceChanged && hasOutput) {
    return {
      ...next,
      ...markStale(next, staleReason),
      sourceFingerprint: nextFingerprint,
      outputVersion: previous.outputVersion,
    };
  }
  return {
    ...next,
    sourceFingerprint: nextFingerprint,
    outputVersion: previous.outputVersion,
  };
}

function markStale<T extends { stale?: boolean; staleReason?: string; staleSince?: number }>(item: T, reason: string): T {
  return {
    ...item,
    stale: true,
    staleReason: reason,
    staleSince: Date.now(),
  };
}

function storyboardSourceFingerprint(item: Partial<StoryboardItem>) {
  return stableHash({
    episodeId: item.episodeId,
    index: item.index,
    trackKey: item.trackKey,
    duration: item.duration,
    prompt: item.prompt,
    videoDesc: item.videoDesc,
    assetIds: item.assetIds ?? [],
    shouldGenerateImage: item.shouldGenerateImage,
    orderedReferenceManifest: item.orderedReferenceManifest ?? [],
    continuityState: item.continuityState
      ? { ...item.continuityState, inputFingerprint: undefined }
      : undefined,
    lines: item.lines,
    speakerId: item.speakerId,
  });
}

function trackSourceFingerprint(track: ProductionTrack, storyboards: StoryboardItem[]) {
  return stableHash({
    episodeId: track.episodeId,
    trackKey: track.trackKey,
    storyboardIds: track.storyboardIds,
    prompt: track.prompt,
    duration: track.duration,
    storyboardFingerprints: track.storyboardIds.map(
      (id) => storyboards.find((storyboard) => storyboard.id === id)?.sourceFingerprint,
    ),
  });
}

function videoCandidateFingerprint(candidate: Partial<VideoCandidate>) {
  return stableHash({
    trackId: candidate.trackId,
    provider: candidate.provider,
    filePath: candidate.filePath,
  });
}

function stableHash(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

function normalizeWorkflowConfig(config: Partial<StudioWorkflowConfig> | undefined): StudioWorkflowConfig {
  return {
    ...config,
    visualManualId: config?.visualManualId === LEGACY_VISUAL_MANUAL_ID
      ? undefined
      : config?.visualManualId,
    directorManualId: config?.directorManualId === LEGACY_DIRECTOR_MANUAL_ID
      ? undefined
      : config?.directorManualId,
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
