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
import { mergeNovelChapterWithMirror, type NovelChapterMirror } from "@/lib/studio/novel";
import { useProjectStore } from "@/stores/project/project-store";
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
  loadNovelChapterMirrorForActiveProject,
  removeNovelChapterMirrorsForActiveProject,
  syncNovelChapterMirrorsForActiveProject,
  syncSourceBibleMirrorForActiveProject,
} from "./studio-store-runtime";
import {
  continuityAssetVersionKey,
  healStaleFingerprintDrift,
  invalidateStoryboardsForAssetVersionChanges,
  markStale,

  trackSourceFingerprint,
  videoCandidateFingerprint,
} from "./studio-store-continuity-helpers";
import type {
  AgentWorkData,
  EntityExtractionResult,
  EpisodeOutline,
  ImageWorkflowGraph,
  MediaGenerationTask,
  NovelChapter,
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
  SceneSegmentRecord,
} from "@/types/studio";
import type { StudioWorkflowState, StudioWorkflowStore } from "./studio-store-types";

export type { StudioWorkflowState } from "./studio-store-types";
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

// T2(11-04) 水合竞态补存布防:zustand 5 的水合 merge 与 onRehydrateStorage 纠正写
// 都发生在 hasHydrated 置位前,分片存储的水合守卫必拒这些保存;置位后 zustand 不会
// 自动补存——窗口期存活于合并态的编辑要等下一次 setState 才落盘,之前退出即丢。
// 守卫拒写时(onHydrationSaveDropped)布防一次性 onFinishHydration,置位后用全量态
// setState 触发包装 set 的 setItem 把合并态补写落盘。armed 位防重复;触发前先复位,
// 补存时 hasHydrated 已 true 守卫放行,至多一次回弹,不成环。
let studioHydrationResaveArmed = false;
/** 测试注出口(生产仅 createStudioWorkflowShardedStorage options 引用;同
 *  __resetModuleStorageWriteLockForTests 先例)——store 级补存链用例直接驱动 */
export const armPostHydrationResave = (): void => {
  if (studioHydrationResaveArmed) return;
  studioHydrationResaveArmed = true;
  const fire = () => {
    studioHydrationResaveArmed = false;
    // 补写静默执行(no-console 仅许 warn/error;拒写侧 error 尾注已声明
    // 「已布防自动补写」,无需第二行日志)
    useStudioStore.setState(useStudioStore.getState());
  };
  if (useStudioStore.persist.hasHydrated()) {
    fire();
    return;
  }
  const unsub = useStudioStore.persist.onFinishHydration(() => {
    unsub();
    fire();
  });
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
      }, async (chapter) => {
        // 1127 正文真源读回注入:读整份正文文件(novel/chapters/<章>.md,唯一真源)并解析,
        // 供 slice 按 design §1.1 与内存条目合并。注意:studio-workflow 章分片是工作区数据
        // (内容可被导演流程覆写为剧本稿),不是小说正文——正文真源恒为正文文件。
        // pid 缺失/读失败=fail-open 返回 null(loadNovelChapterMirror 内处理)。
        return loadNovelChapterMirrorForActiveProject(chapter);
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
        // 1127 正文真源对齐（design §1.1）：两次装载之后、第一次 switchSeq 校验之前读
        // 正文文件。多出的这一次 await 在快照 latest 与 seq 校验之前，原有竞态守卫不受
        // 影响（镜像读取期间发起的更新切章会让本次装载在校验处过期早退）。文件读不到
        // =null（fail-open，只按装载到的分片走）。
        let switchMirror: NovelChapterMirror | null = null;
        const switchTarget = current.novelChapters.find((chapter) => chapter.id === chapterId);
        if (pid && switchTarget) {
          switchMirror = await loadNovelChapterMirrorForActiveProject(switchTarget);
        }
        // await 期间又有切章发起:本次装载已过期,不得回写(目标章+前章装载段+镜像读取段均受此守卫)
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
        // 1127 file-wins 对齐：装载条目与正文文件合并——轻索引条目（无正文）正文/元数据
        // 全取文件；条目已有正文且库内修订号严格大于文件修订号（两边都有）=「App 刚保存、
        // 文件写回未落盘」保留库内；其余以文件为准。事件字段只补库内空缺。合并后再走
        // D1 预警（文件救回正文即不误报）与下方原有 set()。
        const { chapter: alignedChapter, changed: switchAlignedChanged, changedFields: switchAlignedFields } = switchMirror
          ? mergeNovelChapterWithMirror(activeChapter, switchMirror, "file-wins")
          : { chapter: activeChapter, changed: false, changedFields: [] as string[] };
        if (switchAlignedChanged) {
          // R5/AC7（design §1.1 入口 2）：切章对齐与启动对齐同规——合并真取到文件内容
          // 即记 chapterTextReconciled（category:storage / level:warn，上下文含 chapterId
          // 与 changedFields）；「库内修订号更新保留库内」时 merge 无变化，不记日志。
          void logEvent({
            level: "warn",
            category: "storage",
            operationId: "chapterTextReconciled",
            message: "切章对齐：目标章正文与正文文件不一致，已按正文文件回填",
            context: { chapterId, changedFields: switchAlignedFields },
          });
        }
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
        if (!alignedChapter.sourceText?.trim() && sourceTextBeforeSwitch) {
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
              ? alignedChapter
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
      // 1127 启动对齐(design §1.1):激活章与正文文件做一次 file-wins 对齐。有变化 set()
      // 回填并写诊断日志 chapterTextReconciled——随后的一次保存会把激活章的库内分片重写成
      // 与文件一致。无变化/文件缺失/无激活章均不动(fail-open),返回 null。
      reconcileActiveChapterText: async () => {
        const { novelChapters, activeChapterId } = get();
        if (!activeChapterId) return null;
        const chapter = novelChapters.find((item) => item.id === activeChapterId);
        if (!chapter) return null;
        const mirror = await loadNovelChapterMirrorForActiveProject(chapter);
        if (!mirror) return null;
        const { chapter: merged, changed, changedFields } = mergeNovelChapterWithMirror(
          chapter,
          mirror,
          "file-wins",
        );
        if (!changed) return null;
        set((state) => ({
          novelChapters: state.novelChapters.map((item) => (
            item.id === activeChapterId ? merged : item
          )),
        }));
        void logEvent({
          level: "warn",
          category: "storage",
          operationId: "chapterTextReconciled",
          message: "启动对齐：激活章正文与正文文件不一致，已按正文文件回填",
          context: { chapterId: activeChapterId, changedFields },
        });
        return merged;
      },
      appendNovelText: novelSlice.appendNovelText,
      replaceNovelText: novelSlice.replaceNovelText,
      updateNovelChapter: novelSlice.updateNovelChapter,
      ensureNovelChapterBody: novelSlice.ensureNovelChapterBody,
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
      reviewStoryboardImage: storyboardSlice.reviewStoryboardImage,
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
        // T2(11-04)：守卫拒写时布防水合后补存（见 armPostHydrationResave 注释）
        onHydrationSaveDropped: armPostHydrationResave,
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
          // W1(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):
          // 水合自愈——分片里的 sourceFingerprint 是上次 merge 存档的快照串,
          // 离线 CLI 直写分片(update-storyboards-voice / 手术脚本)改指纹内字段
          // 却不重算指纹也不置 stale,快照永久滞旧。存档指纹≠现算指纹且已有产出
          // ⇒ 水合即标脏,裸写遗留的「脏而未标」不再穿过应用侧比对。
          ...(Array.isArray(persisted.storyboards)
            ? { storyboards: healStaleFingerprintDrift(persisted.storyboards) }
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
        if (!state) return;
        if (!state.activeChapterId) {
          const chapters = state.novelChapters ?? [];
          const firstFull = chapters.find((chapter) => typeof chapter.sourceText === "string");
          if (!firstFull) return;
          useStudioStore.setState({ activeChapterId: firstFull.id });
          useStudioStore.getState().slimNonActiveChapters();
        }
        // 1127 启动对齐（design §1.1 入口 1）：回调末尾一律对激活章做一次正文文件
        // 对齐——常态水合（activeChapterId 随 partialize 持久化）与 legacy 锚定两路
        // 都覆盖（R5/AC7）；无激活章时 action 自身安全早退，零副作用。
        void useStudioStore.getState().reconcileActiveChapterText();
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
