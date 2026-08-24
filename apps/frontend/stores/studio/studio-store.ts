import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  createStudioWorkflowShardedStorage,
  isSharedDomainItem,
  loadStudioChapterWorkspace,
} from "@/lib/storage/project-storage";
import { useProjectStore } from "@/stores/project/project-store";
import {
  buildAssetImageWorkflowPatch,
  buildStoryboardImageWorkflowPatch,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow";
import { createMaterialSliceActions } from "./material-slice";
import { createConfigSliceActions } from "./config-slice";
import { createNovelSliceActions } from "./novel-slice";
import { createMemorySliceActions } from "./memory-slice";
import { createEntitySliceActions } from "./entity-slice";
import { createProductionSliceActions } from "./production-slice";
import { createSceneSegmentSliceActions } from "./scene-segment-slice";
import { createAgentWorkSliceActions } from "./agent-work-slice";
import { createStoryboardSliceActions } from "./storyboard-slice";
import { groupStoryboardsIntoTracks } from "@/lib/studio/production";
import {
  createHumanContinuityAssetApproval,
 
 
  normalizeContinuityAssetVersion,
 
 
} from "@/lib/studio/visual-continuity";
import {
  migrateStudioWorkflowState,
 
  STUDIO_WORKFLOW_PERSIST_VERSION,
  STUDIO_WORKFLOW_STORAGE_KEY,
} from "./studio-store-persistence";
import {
  createStudioWorkflowId,
  removeNovelChapterMirrorsForActiveProject,
  syncNovelChapterMirrorsForActiveProject,
  syncSourceBibleMirrorForActiveProject,
} from "./studio-store-runtime";
import {
  continuityAssetVersionKey,
  invalidateStoryboardsForAssetVersionChanges,
  markStale,
 
  storyboardSourceFingerprint,
  trackSourceFingerprint,
  videoCandidateFingerprint,
} from "./studio-store-continuity-helpers";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import type {
  AgentWorkData,
  AgentWorkKey,
  ContinuityAssetVersion,
  EntityExtractionResult,
  EpisodeOutline,
  ImageWorkflowGraph,
  ImageWorkflowTarget,
  HumanVisualReviewInput,
  HumanContinuityAssetApprovalInput,
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
  StudioSourceIdentity,
  SceneSegmentRecord,
} from "@/types/studio";

interface StudioWorkflowState {
  materials: StudioMaterial[];
  novelChapters: NovelChapter[];
  /** 窗口化 v1：激活章（工作区装载对象）；null/缺省=未窗口化（legacy 全量内存） */
  activeChapterId?: string | null;
  sourceBible: string;
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  episodeOutlines: EpisodeOutline[];
  storyboards: StoryboardItem[];
  continuityAssetVersions: ContinuityAssetVersion[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  sceneSegments: SceneSegmentRecord[];
  imageWorkflows: ImageWorkflowGraph[];
  agentRuns: StudioAgentRun[];
  mediaTasks: MediaGenerationTask[];
  eventGraph: ProjectEventGraphRecord[];
  projectMemoryRecords: ProjectMemoryRecord[];
  workflowConfig: StudioWorkflowConfig;
}

export type { StudioWorkflowState };

interface StudioWorkflowActions {
  addMaterial: (input: { name: string; localPath: string; size: number; importedAt?: number }) => string;
  deleteMaterial: (id: string) => void;
  bindMaterialToStoryboard: (storyboardId: string, materialId: string) => void;
  importNovelText: (sourceText: string) => void;
  switchChapter: (chapterId: string) => Promise<void>;
  slimNonActiveChapters: () => boolean;
  appendNovelText: (sourceText: string, sourceName?: string) => void;
  replaceNovelText: (sourceText: string, sourceName?: string) => void;
  updateNovelChapter: (id: string, updates: Partial<NovelChapter>) => void;
  saveSourceBible: (text: string) => void;
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
  saveAgentWorkData: (key: AgentWorkKey, data: string, episodeId?: string, identity?: StudioSourceIdentity) => string;
  saveEntityExtraction: (result: EntityExtractionResult) => void;
  saveScriptPlan: (plan: ScriptPlan) => void;
  saveSeriesBible: (bible: SeriesBible) => void;
  saveEpisodeOutline: (outline: EpisodeOutline) => void;
  addStoryboard: (item?: Partial<StoryboardItem>) => string;
  replaceContinuityAssetVersions: (items: ContinuityAssetVersion[]) => void;
  reviewContinuityAssetVersionHuman: (
    assetId: string,
    versionId: string,
    review: HumanContinuityAssetApprovalInput,
  ) => void;
  replaceStoryboardsForEpisode: (episodeId: string, items: StoryboardItem[]) => void;
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  writeStoryboardAudio: (
    id: string,
    updates: Pick<
      StoryboardItem,
      | "audioRef"
      | "shotAudioBindings"
      | "ttsJob"
      | "ttsGenerationId"
      | "ttsBackend"
      | "ttsMocked"
      | "ttsEmotionCapability"
      | "ttsWarning"
    >,
  ) => void;
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
  registerSceneSegment: (record: SceneSegmentRecord) => void;
  removeSceneSegment: (id: string) => void;
  resetStudioWorkflow: () => void;
}
type StudioWorkflowStore = StudioWorkflowState & StudioWorkflowActions;
const initialState: StudioWorkflowState = {
  materials: [],
  novelChapters: [],
  activeChapterId: null,
  sourceBible: "",
  agentWorkData: [],
  entityExtractions: [],
  scriptPlans: [],
  seriesBible: null,
  episodeOutlines: [],
  storyboards: [],
  continuityAssetVersions: [],
  productionTracks: [],
  videoCandidates: [],
  sceneSegments: [],
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

export const useStudioStore = create<StudioWorkflowStore>()(
  persist(
    (set, get) => {
      const materialSlice = createMaterialSliceActions(set as never, get as never);
      const configSlice = createConfigSliceActions(set as never);
      const novelSlice = createNovelSliceActions(set as never, get as never, {
        syncNovelChapterMirrors,
        removeNovelChapterMirrors,
        syncSourceBibleMirror: syncSourceBibleMirrorForActiveProject,
      });
      const memorySlice = createMemorySliceActions(set as never, get as never);
      const entitySlice = createEntitySliceActions(set as never);
      const productionSlice = createProductionSliceActions(set as never);
      const sceneSegmentSlice = createSceneSegmentSliceActions(set as never);
      const agentWorkSlice = createAgentWorkSliceActions(set as never, get as never);
      const storyboardSlice = createStoryboardSliceActions(set as never, get as never);
      return {
      ...initialState,
      addMaterial: materialSlice.addMaterial,
      deleteMaterial: materialSlice.deleteMaterial,
      bindMaterialToStoryboard: materialSlice.bindMaterialToStoryboard,
      importNovelText: novelSlice.importNovelText,

      // ── 窗口化 v1（08-18-store-chapter-windowing）──
      // 非激活章瘦身为轻索引项（正文保留在章分片/镜像，切章时装载）
      slimNonActiveChapters: () => {
        const { novelChapters, activeChapterId } = get();
        if (!activeChapterId) return false;
        const hasFull = novelChapters.some((chapter) => (
          typeof chapter.sourceText === "string" && chapter.id !== activeChapterId
        ));
        if (!hasFull) return false;
        set({
          novelChapters: novelChapters.map((chapter) => {
            if (chapter.id === activeChapterId || typeof chapter.sourceText !== "string") return chapter;
            const { sourceText: _dropped, ...rest } = chapter;
            return rest as NovelChapter;
          }),
        });
        return true;
      },

      // 切章：装载目标章工作区（该章分片+shared 桶），保留无章归属条目，前章数据已被各次 set() 落盘
      switchChapter: async (chapterId) => {
        const pid = useProjectStore.getState().activeProjectId;
        const current = get();
        if (!current.novelChapters.some((chapter) => chapter.id === chapterId)) return;
        if (current.activeChapterId === chapterId) return;
        let loaded: Awaited<ReturnType<typeof loadStudioChapterWorkspace>> = null;
        if (pid) {
          try {
            loaded = await loadStudioChapterWorkspace(pid, chapterId);
          } catch (error) {
            console.warn("[StudioStore] 章节工作区装载失败，回退索引条目:", error);
          }
        }
        const activeChapter = (loaded?.novelChapter as NovelChapter | undefined)
          ?? current.novelChapters.find((chapter) => chapter.id === chapterId);
        if (!activeChapter) return;
        const attributionState = {
          storyboards: current.storyboards,
          productionTracks: current.productionTracks,
        } as unknown as Record<string, unknown>;
        const mergeWindow = (key: keyof StudioWorkflowState, loadedItems: unknown) => {
          const currentItems = current[key] as unknown[];
          if (!Array.isArray(loadedItems)) return currentItems.filter((item) => isSharedDomainItem(key, item, attributionState));
          const shared = currentItems.filter((item) => isSharedDomainItem(key, item, attributionState));
          return [...shared, ...loadedItems];
        };
        set({
          activeChapterId: chapterId,
          novelChapters: current.novelChapters.map((chapter) => (
            chapter.id === chapterId
              ? activeChapter
              : { ...chapter, sourceText: undefined }
          )),
          storyboards: mergeWindow("storyboards", loaded?.domains.storyboards) as StoryboardItem[],
          scriptPlans: mergeWindow("scriptPlans", loaded?.domains.scriptPlans) as ScriptPlan[],
          episodeOutlines: mergeWindow("episodeOutlines", loaded?.domains.episodeOutlines) as EpisodeOutline[],
          mediaTasks: mergeWindow("mediaTasks", loaded?.domains.mediaTasks) as MediaGenerationTask[],
          productionTracks: mergeWindow("productionTracks", loaded?.domains.productionTracks) as ProductionTrack[],
          videoCandidates: mergeWindow("videoCandidates", loaded?.domains.videoCandidates) as VideoCandidate[],
          sceneSegments: mergeWindow("sceneSegments", loaded?.domains.sceneSegments) as SceneSegmentRecord[],
          agentWorkData: mergeWindow("agentWorkData", loaded?.domains.agentWorkData) as AgentWorkData[],
          imageWorkflows: mergeWindow("imageWorkflows", loaded?.domains.imageWorkflows) as ImageWorkflowGraph[],
        });
        get().rebuildTracks();
      },
      appendNovelText: novelSlice.appendNovelText,
      replaceNovelText: novelSlice.replaceNovelText,
      updateNovelChapter: novelSlice.updateNovelChapter,
      saveSourceBible: novelSlice.saveSourceBible,
      setWorkflowConfig: configSlice.setWorkflowConfig,

      startAgentRun: (input) => {
        const id = createStudioWorkflowId("run");
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
        const id = createStudioWorkflowId("media-task");
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

      rebuildProjectMemoryFromChapters: memorySlice.rebuildProjectMemoryFromChapters,
      retrieveProjectMemory: memorySlice.retrieveProjectMemory,
      purgeProjectMemory: memorySlice.purgeProjectMemory,

      saveAgentWorkData: agentWorkSlice.saveAgentWorkData,

      saveEntityExtraction: entitySlice.saveEntityExtraction,
      saveScriptPlan: entitySlice.saveScriptPlan,
      saveSeriesBible: entitySlice.saveSeriesBible,
      saveEpisodeOutline: entitySlice.saveEpisodeOutline,

      addStoryboard: storyboardSlice.addStoryboard,

      replaceContinuityAssetVersions: (items) => {
        const previous = get().continuityAssetVersions;
        const normalized = items.map(normalizeContinuityAssetVersion);
        const nextKeys = new Set(normalized.map(continuityAssetVersionKey));
        const nextByKey = new Map(normalized.map((item) => [continuityAssetVersionKey(item), item]));
        const changedKeys = new Set(
          previous
            .filter((item) => {
              const next = nextByKey.get(continuityAssetVersionKey(item));
              return !next || next.contentFingerprint !== item.contentFingerprint;
            })
            .map(continuityAssetVersionKey),
        );
        for (const item of previous) {
          if (!nextKeys.has(continuityAssetVersionKey(item))) changedKeys.add(continuityAssetVersionKey(item));
        }
        set((state) => ({
          continuityAssetVersions: normalized,
          storyboards: changedKeys.size > 0
            ? invalidateStoryboardsForAssetVersionChanges(state.storyboards, changedKeys)
            : state.storyboards,
        }));
      },

      reviewContinuityAssetVersionHuman: (assetId, versionId, reviewInput) => {
        const key = `${assetId}:${versionId}`;
        const current = get().continuityAssetVersions.find((item) => continuityAssetVersionKey(item) === key);
        if (!current) throw new Error(`连续性资产 ${assetId}/${versionId} 不存在`);
        if (reviewInput.status === "approved" && !current.reviewEvidenceVerifiedAt) {
          throw new Error(`连续性资产 ${assetId}/${versionId} 必须先通过本地缩略图文件与 SHA-256 安全校验`);
        }
        const reviewed = createHumanContinuityAssetApproval(current, reviewInput);
        set((state) => {
          const synchronizedStoryboards = state.storyboards.map((storyboard) => {
            const referencesVersion = storyboard.orderedReferenceManifest?.some((reference) => (
              `${reference.assetId}:${reference.versionId ?? ""}` === key
            ));
            return {
            ...storyboard,
            orderedReferenceManifest: storyboard.orderedReferenceManifest?.map((reference) => (
              `${reference.assetId}:${reference.versionId ?? ""}` === key
                ? {
                    ...reference,
                    contentFingerprint: reviewed.contentFingerprint,
                    approvalFingerprint: reviewed.approvalFingerprint,
                    approved: reviewed.approved,
                  }
                : reference
            )),
            visualReview: referencesVersion && storyboard.visualReview
              ? {
                  ...storyboard.visualReview,
                  status: "pending" as const,
                  reasons: ["引用资产审批状态已变化，必须重新审核"],
                }
              : storyboard.visualReview,
            };
          });
          return {
            continuityAssetVersions: state.continuityAssetVersions.map((item) => (
              continuityAssetVersionKey(item) === key ? reviewed : item
            )),
            storyboards: reviewed.approval?.status === "rejected"
              ? invalidateStoryboardsForAssetVersionChanges(
                  synchronizedStoryboards,
                  new Set([key]),
                  "引用的角色、场景或道具基准资产已被人工驳回",
                  "引用资产已被人工驳回，必须更换资产、重新生成并审核",
                )
              : synchronizedStoryboards,
          };
        });
      },

      replaceStoryboardsForEpisode: storyboardSlice.replaceStoryboardsForEpisode,
      updateStoryboard: storyboardSlice.updateStoryboard,
      writeStoryboardAudio: storyboardSlice.writeStoryboardAudio,
      reviewStoryboardHuman: storyboardSlice.reviewStoryboardHuman,
      bindStoryboardMedia: storyboardSlice.bindStoryboardMedia,

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
        // 窗口化 v1：只为激活章生成分镜（非激活章为轻索引项，无正文）
        const { activeChapterId } = get();
        const chapters = get().novelChapters.filter((chapter) => (
          !activeChapterId || chapter.id === activeChapterId
        ));
        if (!chapters.length) return;
        const storyboards = chapters.map<StoryboardItem>((chapter) => ({
          id: createStudioWorkflowId("sb"),
          episodeId: chapter.id,
          index: chapter.index,
          trackKey: `chapter-${String(chapter.index).padStart(3, "0")}`,
          trackId: "",
          duration: 5,
          prompt: chapter.eventSummary || chapter.title,
          videoDesc: typeof chapter.sourceText === "string" ? chapter.sourceText.slice(0, 80) : chapter.title,
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

      updateTrack: productionSlice.updateTrack,

      addVideoCandidate: (candidate) => {
        const id = candidate.id ?? createStudioWorkflowId("video");
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

      selectVideoCandidate: productionSlice.selectVideoCandidate,
      deleteVideoCandidate: productionSlice.deleteVideoCandidate,
      registerSceneSegment: sceneSegmentSlice.registerSceneSegment,
      removeSceneSegment: sceneSegmentSlice.removeSceneSegment,

      resetStudioWorkflow: () => set({ ...initialState }),
      };
    },
    {
      name: STUDIO_WORKFLOW_STORAGE_KEY,
      // getLiveState/isHydrated 延迟求值注入：project-storage 反向 import 会成环，箭头闭包避开（design.md §2）
      storage: createJSONStorage(() => createStudioWorkflowShardedStorage(STUDIO_WORKFLOW_STORAGE_KEY, {
        getLiveState: (): unknown => useStudioStore.getState(),
        // T4 水合竞态守卫：启动/切项目 rehydrate 窗口内的保存是盲写（空态+误建
        // free 图会清空 manifest 章索引），storage 层 fail-closed 拒写
        isHydrated: (): boolean => useStudioStore.persist.hasHydrated(),
      })),
      version: STUDIO_WORKFLOW_PERSIST_VERSION,
      migrate: (persistedState) => migrateStudioWorkflowState(persistedState),
      // 窗口化 v1：legacy 全量水合后锚定激活章并瘦身（下次保存即写 manifest 轻索引）
      onRehydrateStorage: () => (state) => {
        if (!state || state.activeChapterId) return;
        const chapters = state.novelChapters ?? [];
        const firstFull = chapters.find((chapter) => typeof chapter.sourceText === "string");
        if (!firstFull) return;
        useStudioStore.setState({ activeChapterId: firstFull.id });
        useStudioStore.getState().slimNonActiveChapters();
      },
    },
  ),
);

function syncNovelChapterMirrors(chapters: NovelChapter[]) {
  syncNovelChapterMirrorsForActiveProject(chapters);
}

function removeNovelChapterMirrors(chapters: NovelChapter[]) {
  removeNovelChapterMirrorsForActiveProject(chapters);
}
