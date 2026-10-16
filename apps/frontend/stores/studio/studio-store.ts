import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  createStudioWorkflowShardedStorage,
  loadStudioChapterWorkspace,
} from "@/lib/storage/project-storage";
import {
  buildAttributionContextFromState,
  chapterKeyOfDomainItem,
} from "@/lib/storage/studio-workflow-shards";
import { toast } from "sonner";
import { logEvent } from "@/lib/diagnostics/logger";
import { useProjectStore } from "@/stores/project/project-store";
import {
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow";
import { createMaterialSliceActions } from "./material-slice";
import { createRunTaskSliceActions } from "./run-task-slice";
import { createImageWorkflowSliceActions } from "./image-workflow-slice";
import { createConfigSliceActions, clampEpisodeDurationMin } from "./config-slice";
import { createNovelSliceActions } from "./novel-slice";
import { createMemorySliceActions } from "./memory-slice";
import { createEntitySliceActions } from "./entity-slice";
import { createProductionSliceActions } from "./production-slice";
import { createSceneSegmentSliceActions } from "./scene-segment-slice";
import { createAgentWorkSliceActions } from "./agent-work-slice";
import { createStoryboardSliceActions } from "./storyboard-slice";
import { groupStoryboardsIntoTracks } from "@/lib/studio/production";
// 08-27 二期 R2:锚写入的父媒体路径改走共享候选解析(纯函数,零运行时依赖,
// 与面板 buildWorkbenchAssetMediaMap 同一取图事实源)
import {
  createHumanContinuityAssetApproval,
 
 
  normalizeContinuityAssetVersion,
 
 
} from "@/lib/studio/visual-continuity";
import {
  filterPersistedImageWorkflows,
  migrateStudioWorkflowState,
  reapInterruptedTaskLedgers,
  STUDIO_RENDERER_BOOT_TIME,
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
 
  trackSourceFingerprint,
  videoCandidateFingerprint,
} from "./studio-store-continuity-helpers";
import type {
  StoryboardKeyframe,
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
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";

interface StudioWorkflowState {
  materials: StudioMaterial[];
  novelChapters: NovelChapter[];
  /** 窗口化 v1：激活章（工作区装载对象）；null/缺省=未窗口化（legacy 全量内存） */
  activeChapterId?: string | null;
  /** A批 R1（10-14-audit4-residuals）：切章装载中标志——ScriptTab 据此禁用生成/审核/可编辑并显示装载中；瞬态位不落盘（persist partialize 剥除，防「杀进程于切章中」水合出恒禁用）。可选字段（同 activeChapterId 先例）：缺省=未在装载，存量全量构造点零涟漪 */
  chapterSwitchLoading?: boolean;
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
  bindMaterialToStoryboard: (storyboardId: string, materialId: string, h3DurationUs?: number) => void;
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
  writeStoryboardVlmReview: (id: string, artifact: VlmReviewArtifactV1, evidencePath?: string) => void;
  bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef, h3DurationUs?: number) => void;
  setStoryboardKeyframes: (
    id: string,
    frames: StoryboardKeyframe[],
    reason: "backfill" | "generate" | "upscale" | "plan" | "edit",
  ) => void;
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
  chapterSwitchLoading: false,
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

// 09-06 切章竞态守卫:快切两章时,先发的慢装载后到会把新章工作区整组回写成旧章
let studioChapterSwitchSeq = 0;

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
      const runTaskSlice = createRunTaskSliceActions(set as never, get as never);
      const imageWorkflowSlice = createImageWorkflowSliceActions(set as never, get as never);
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
        const switchSeq = ++studioChapterSwitchSeq;
        // R1（A批）：装载中标志——ScriptTab 据此禁用生成/审核/可编辑并显示装载中；
        // 竞速下只有最新一次装载负责清位（finally 内 seq 校验），先发过期装载不清
        set({ chapterSwitchLoading: true });
        try {
        let loaded: Awaited<ReturnType<typeof loadStudioChapterWorkspace>> = null;
        if (pid) {
          try {
            loaded = await loadStudioChapterWorkspace(pid, chapterId);
          } catch (error) {
            // R2（A批）：装载失败 fail-closed——不回退无正文索引条目（瘦身条目无
            // sourceText 会被判「原创」照常组装），也不翻转激活章（保持在原章）；
            // toast 明示错误。过期装载（期间又有切章）静默，由最新一次装载负责提示。
            console.warn("[StudioStore] 章节工作区装载失败，保持在原章:", error);
            if (switchSeq === studioChapterSwitchSeq) {
              toast.error(
                `章节工作区装载失败，已停留在原章：${error instanceof Error ? error.message : String(error)}`,
              );
            }
            return;
          }
        }
        // G1 前章并入(design §1.3):agentWorkData 按章归属,切到第 N 章会把第 N-1 章
        // scriptDraft 逐出内存(F4),「上一集剧本」原料断链;用同一装载器二次装载目标章的
        // 前一章,仅并入其 agentWorkData(其余域不取,内存增量=前章工作区一小块);
        // 失败/无分片静默跳过(该节实发链本有非空守卫,缺失=不注入)。前章条目下次切章按
        // episodeId 归属照常逐出;保存按条目 episodeId 归前章分片,无错写风险(F9)。
        let previousLoaded: Awaited<ReturnType<typeof loadStudioChapterWorkspace>> = null;
        if (pid) {
          const targetIndex = current.novelChapters.findIndex((chapter) => chapter.id === chapterId);
          const previousChapter = targetIndex > 0 ? current.novelChapters[targetIndex - 1] : undefined;
          if (previousChapter) {
            try {
              previousLoaded = await loadStudioChapterWorkspace(pid, previousChapter.id);
            } catch {
              // 前章装载失败静默跳过:缺失=不注入上一集剧本节(design §1.3)
            }
          }
        }
        // await 期间又有切章发起:本次装载已过期,不得回写(目标章+前章装载段均受此守卫)
        if (switchSeq !== studioChapterSwitchSeq) return;
        // R3（A批）：快照后移——state 快照（:285 的 current）早于两次 await，装载完成后
        // 若仍按过期快照整体覆盖，装载期写入（在途流式落库/用户编辑旧章字段/对目标章的
        // 中途保存）会被回滚。装载完成（且仍是最新一次切章）后取最新 state 按字段合并：
        // 共享条目与章列表按最新读，装载期写入不丢。
        const latest = get();
        const latestAttributionContext = buildAttributionContextFromState(
          latest as unknown as Record<string, unknown>,
        );
        const previousAgentWorkData = previousLoaded?.domains.agentWorkData;
        const activeChapter = (loaded?.novelChapter as NovelChapter | undefined)
          ?? latest.novelChapters.find((chapter) => chapter.id === chapterId);
        if (!activeChapter) return;
        // D1（livefire18 腿3①）：装载成功但文丢预警——R2 fail-closed 只盖「装载抛错」，
        // 这里盖「装载成功但正文空」：激活章定谳后 sourceText 空/blank，而装载前
        // 内存同章仍有非 blank 正文 → G1 类静默丢文（章会被误判「原创」照常组装）。
        // 盘上侧（diskSourceText）为防御性冗余而非独立触发侧（livefire18 深度
        // review 定谳）：activeChapter 优先取盘上章条目，盘上非 blank 即无丢文、
        // 预警首句已假 ⇒ 盘上侧恒只在「无 pid/盘上缺条目」时为空串，判定侧实际
        // 恒为内存同章；保留取值仅为与内存侧对称的纵深防御。仅落诊断 warn 不改
        // 装载语义；logEvent 全 try/catch 永不炸产线。两侧取值均按「trim 非空才
        // 有效」——空白串不得短路掉另一侧（负例专测：studio-store.test.ts
        // 「D1 负例:空白串不算正文」）。
        const diskChapter = loaded?.novelChapter as NovelChapter | undefined;
        const diskSourceText = typeof diskChapter?.sourceText === "string" && diskChapter.sourceText.trim()
          ? diskChapter.sourceText
          : "";
        const memorySourceText = latest.novelChapters.find((chapter) => chapter.id === chapterId)?.sourceText;
        const sourceTextBeforeSwitch =
          diskSourceText
          || (typeof memorySourceText === "string" && memorySourceText.trim() ? memorySourceText : "");
        if (!activeChapter.sourceText?.trim() && sourceTextBeforeSwitch) {
          void logEvent({
            level: "warn",
            category: "storage",
            operationId: "chapterSwitch.sourceTextLost",
            message: "章节工作区装载成功但正文缺失（装载前同章仍有正文）",
            context: { chapterId, projectId: pid },
          });
        }
        const mergeWindow = (key: keyof StudioWorkflowState, loadedItems: unknown) => {
          const latestItems = latest[key] as unknown[];
          const chapterKeyOf = (item: unknown) =>
            chapterKeyOfDomainItem(key, item, latestAttributionContext);
          if (!Array.isArray(loadedItems)) {
            return latestItems.filter((item) => chapterKeyOf(item) === null);
          }
          // P3（10-15 livefire18）读侧去重：loadedIds 提前构建，shared 分支并入同一
          // 去重——id 已在盘上装载集的 shared（unattributed）条目以盘上为准，内存副本
          // 不再双份，掐断切章泵源（活体：videoCandidates 7id×128 / imageWorkflows
          // 14id×128，每次切章该 id ×2 忠实落盘循环放大）。loaded 数组内部的存量重复
          // 由写侧压实（planStudioWorkflowShards 按 id 压实）借每-50-保存全量自愈清淤。
          const itemIdOf = (item: unknown) => (item as { id?: unknown })?.id ?? null;
          const loadedIds = new Set(
            loadedItems.map((item) => itemIdOf(item)),
          );
          const shared = latestItems.filter((item) => {
            if (chapterKeyOf(item) !== null) return false;
            const itemId = itemIdOf(item);
            return itemId === null || !loadedIds.has(itemId);
          });
          // 装载期对目标章的新写入（分片读像里没有的条目）一并保留，按 id 去重防双份
          const midLoadTargetWrites = latestItems.filter((item) => {
            const itemId = itemIdOf(item);
            if (itemId !== null && loadedIds.has(itemId)) return false;
            return chapterKeyOf(item) === chapterId;
          });
          return [...shared, ...loadedItems, ...midLoadTargetWrites];
        };
        set({
          activeChapterId: chapterId,
          novelChapters: latest.novelChapters.map((chapter) => (
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
          // 10-14 livefire17 D4:实体提取集随窗——章归属域(studio-workflow-shards.ts
          // :97-100 chapterId??episodeId 直接归属)唯一漏网,合并集补齐后与分片规则一一对应
          entityExtractions: mergeWindow("entityExtractions", loaded?.domains.entityExtractions) as EntityExtractionResult[],
          agentWorkData: [
            ...mergeWindow("agentWorkData", loaded?.domains.agentWorkData),
            ...(Array.isArray(previousAgentWorkData) ? previousAgentWorkData : []),
          ] as AgentWorkData[],
          imageWorkflows: mergeWindow("imageWorkflows", loaded?.domains.imageWorkflows) as ImageWorkflowGraph[],
        });
        get().rebuildTracks();
        } finally {
          // R1：装载结束（完成/失败/过期早退）清装载中标志——竞速下仅最新一次装载清位
          if (switchSeq === studioChapterSwitchSeq) {
            set({ chapterSwitchLoading: false });
          }
        }
      },
      appendNovelText: novelSlice.appendNovelText,
      replaceNovelText: novelSlice.replaceNovelText,
      updateNovelChapter: novelSlice.updateNovelChapter,
      saveSourceBible: novelSlice.saveSourceBible,
      setWorkflowConfig: configSlice.setWorkflowConfig,

      startAgentRun: runTaskSlice.startAgentRun,
      finishAgentRun: runTaskSlice.finishAgentRun,
      failAgentRun: runTaskSlice.failAgentRun,
      cancelAgentRun: runTaskSlice.cancelAgentRun,
      retryAgentRun: runTaskSlice.retryAgentRun,
      startMediaTask: runTaskSlice.startMediaTask,
      finishMediaTask: runTaskSlice.finishMediaTask,
      failMediaTask: runTaskSlice.failMediaTask,
      cancelMediaTask: runTaskSlice.cancelMediaTask,
      retryMediaTask: runTaskSlice.retryMediaTask,
      retryFailedMediaTasks: runTaskSlice.retryFailedMediaTasks,

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
      writeStoryboardVlmReview: storyboardSlice.writeStoryboardVlmReview,
      bindStoryboardMedia: storyboardSlice.bindStoryboardMedia,
      setStoryboardKeyframes: storyboardSlice.setStoryboardKeyframes,

      createImageWorkflow: imageWorkflowSlice.createImageWorkflow,
      upsertImageWorkflow: imageWorkflowSlice.upsertImageWorkflow,
      updateImageWorkflow: imageWorkflowSlice.updateImageWorkflow,
      deleteImageWorkflow: imageWorkflowSlice.deleteImageWorkflow,
      applyImageWorkflowResultToStoryboard: imageWorkflowSlice.applyImageWorkflowResultToStoryboard,
      applyImageWorkflowResultToAsset: imageWorkflowSlice.applyImageWorkflowResultToAsset,

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
      // R1（A批）：chapterSwitchLoading 是瞬态位，不落盘——若持久化，「杀进程于切章中」
      // 会在下次启动水合出 true，生成/审核/可编辑被恒禁用且无恢复入口
      partialize: (state) => {
        const { chapterSwitchLoading: _transientLoading, ...rest } = state;
        return rest as StudioWorkflowStore;
      },
      migrate: (persistedState) => migrateStudioWorkflowState(persistedState),
      merge: (persistedState, currentState) => {
        const persisted = persistedState && typeof persistedState === "object"
          ? persistedState as Partial<StudioWorkflowState>
          : {};
        // 存量钳制：单集参考时长上限 3 分钟，老版本写过的超限值（如 8）水合即归一
        const persistedConfig = persisted.workflowConfig;
        // 水合收割(1016 控制球僵尸徽章修复):上一会话退出时卡在
        // queued/running 的台账没有在途 runner 会再落终态,水合即改判
        // failed(应用重启，任务中断),否则徽章计数永久挂死
        const reapedLedgers = reapInterruptedTaskLedgers({
          agentRuns: persisted.agentRuns,
          mediaTasks: persisted.mediaTasks,
          bootTime: STUDIO_RENDERER_BOOT_TIME,
        });
        if (reapedLedgers.reapedCount > 0) {
          console.warn(
            `[studio-workflow] 水合收割 ${reapedLedgers.reapedCount} 条上一会话中断的任务(queued/running → failed)`,
          );
        }
        return {
          ...currentState,
          ...persisted,
          ...(reapedLedgers.agentRuns !== undefined
            ? { agentRuns: reapedLedgers.agentRuns }
            : {}),
          ...(reapedLedgers.mediaTasks !== undefined
            ? { mediaTasks: reapedLedgers.mediaTasks }
            : {}),
          ...(persistedConfig
            ? {
                workflowConfig: {
                  ...persistedConfig,
                  ...("episodeDurationMin" in persistedConfig
                    ? { episodeDurationMin: clampEpisodeDurationMin(persistedConfig.episodeDurationMin) }
                    : {}),
                },
              }
            : {}),
          imageWorkflows: filterPersistedImageWorkflows(persisted.imageWorkflows),
        };
      },
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
