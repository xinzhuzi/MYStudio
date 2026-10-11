/**
 * 衍生链闭环(10-11 pipeline-human-node-automation 批3,G17/R2):
 * 「落地衍生资产」后自动接续——落地(derived-asset-sync 幂等落地)→ 收集衍生
 * 生成任务(useProductionPlanningActions.collectDerivedAssetGenerationTasks,
 * 已有图条目天然跳过=断点续跑)→ 缺父图的衍生**先**派父 scriptAsset 任务
 * (批1 桥接,含断言哨兵)→ 父图就绪后派 derivedAssetImage 任务(队列既有
 * kind,本模块为其提供执行体;任务中心 label 已在)。
 * - 排序=出场频率/主次(G17):角色 importance(protagonist>supporting>npc)
 *   优先,同档按父资产在本章分镜的出场数降序——主角色先出图可提前人审;
 * - 单条失败不阻塞其余:失败/护栏拦截/父失败进例外清单,批完统一重试
 *   (retryFailedDerivedChainEntries,语义同 retryFailedMediaTasks(derivedAssetImage)
 *   但真正执行——队列只翻台账不跑执行体,执行体在桥接层,与批2 同理);
 * - 成本护栏(G7/¥10 章上限共享):父图+衍生图逐张开检,基线并入批2 报表
 *   已累计口径(同一章同一预算);纯本地通道零计费恒放行;
 * - 完成定义=衍生图落进对应行(variation.referenceImage/scene.referenceImage/
 *   prop.imageUrl 非空,断言哨兵),不靠 toast 消失判断。
 * 注意:衍生生成复用 generateAsset 编排链(禁新建第二套生图链);角色变体经
 * assetId=variationId 桥接(orchestrator 的 store 写回对非角色 id 天然 no-op,
 * 变体行由本模块显式 updateVariation 写,不污染父角色)。
 */
import { toast } from "sonner";
import { create } from "zustand";
import { generateAsset } from "@/lib/studio/asset-generation-orchestrator";
import {
  buildEntityResolver,
  createMystudioDerivedSinks,
  syncDerivedAssets,
} from "@/lib/studio/derived-asset-sync";
import {
  SCRIPT_ASSET_IMAGE_FEATURES,
  channelEstimateLabel,
  costGuardAllowsDispatch,
  estimateImageChannel,
  formatCny,
  type ScriptAssetGenerationType,
} from "@/lib/studio/script-asset-cost";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { MediaGenerationTask, ScriptPlan, StoryboardItem } from "@/types/studio";
import { nameMatches } from "./asset-matching";
import { runScriptAssetMediaTask } from "./script-asset-media-task";
import { ensureLocalAssetForRow } from "./useScriptAssetGenerationActions";
import { collectDerivedAssetGenerationTasks } from "./useProductionPlanningActions";
import { findPlanForEpisode, getRowImage, type AssetRow } from "./script-asset-generation-model";
import { useScriptAssetBatchStore } from "./script-asset-batch";

/** 衍生图未落盘的固定台账文案(断言哨兵,例外清单分诊锚)。 */
export const DERIVED_ASSET_ASSERTION_FAILURE = "assertion:衍生图未落盘";

// ── 排序(纯函数):主次(importance)优先,同档按出场频率 ───────────────────

export type ParentImportance = "protagonist" | "supporting" | "npc";

const IMPORTANCE_RANK: Record<ParentImportance, number> = {
  protagonist: 3,
  supporting: 2,
  npc: 1,
};

/**
 * 父资产在本章分镜的出场计数(逐镜 associateAssetsNames 归并;名+模糊经
 * nameMatches 互认,「监工赵四」与「赵四」等近似引用并入同一桶)。
 */
export function buildParentAppearanceCounts(
  storyboards: ReadonlyArray<Pick<StoryboardItem, "associateAssetsNames">>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shot of storyboards) {
    const names = [...new Set((shot.associateAssetsNames ?? []).filter(Boolean))];
    for (const shotName of names) {
      counts.set(shotName, (counts.get(shotName) ?? 0) + 1);
      for (const [known, count] of counts) {
        if (known !== shotName && nameMatches(shotName, known)) {
          counts.set(known, count);
        }
      }
    }
  }
  return counts;
}

function appearanceCountOf(counts: Map<string, number>, name: string): number {
  let count = counts.get(name) ?? 0;
  for (const [shotName, shotCount] of counts) {
    if (shotName !== name && nameMatches(name, shotName)) count += shotCount;
  }
  return count;
}

/**
 * 衍生链排序键:importance(角色档;场景/道具无档=0)↓,出场频率↓。
 * 返回负值数组逐段比较,平局保持收集序(导演预划顺序)。
 */
export function deriveChainSortKey(input: {
  parentName: string;
  importance: ParentImportance | undefined;
  appearanceCount: number;
}): number[] {
  const rank = input.importance ? IMPORTANCE_RANK[input.importance] : 0;
  return [-rank, -input.appearanceCount];
}

// ── 批次态(zustand 非持久;任务真身在 MediaGenerationTask 台账) ──────────

export type DerivedChainRowStatus =
  | "success"
  | "failed"
  | "parent-failed"
  | "blocked"
  | "skipped-reused"
  | "unmatched";

export interface DerivedChainRowOutcome {
  /** derivedAssetImage targetId:derived:{parentName}:{state}。 */
  key: string;
  parentName: string;
  state: string;
  kind: ScriptAssetGenerationType;
  status: DerivedChainRowStatus;
  statusLabel: string;
  errorReason?: string;
  /** 成功=衍生图地址(受管路径)。 */
  imageRef?: string;
  /** derivedAssetImage 任务 id。 */
  taskId?: string;
  /** 补派的父 scriptAsset 任务 id(缺父图时)。 */
  parentTaskId?: string;
  channelLabel?: string;
  costCny: number;
  unpriced: boolean;
}

export interface DerivedChainReport {
  chapterId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** 落地+匹配到的衍生条目数(报表行数)。 */
  total: number;
  successCount: number;
  failedCount: number;
  blockedCount: number;
  skippedCount: number;
  unmatchedCount: number;
  rows: DerivedChainRowOutcome[];
  /** 本次落地的衍生行数(幂等落地:已存在不重建)。 */
  landedCount: number;
  /** 已有图无需生成的条目数(断点续跑口径:已成的衍生不重跑)。 */
  alreadyCompleteCount: number;
  /** 补派父任务并成功的条目数。 */
  parentGeneratedCount: number;
  /** 本链累计成本(元;不含批2 基线)。 */
  spentCny: number;
  capCny: number;
  unpricedCount: number;
  channelCounts: Array<{ label: string; count: number }>;
}

export interface DerivedChainRunView {
  chapterId: string;
  status: "running" | "done";
  progress: { done: number; total: number; currentName: string };
  report?: DerivedChainReport;
}

interface DerivedChainState {
  runsByChapter: Record<string, DerivedChainRunView>;
  startRun: (chapterId: string, total: number) => void;
  updateProgress: (chapterId: string, done: number, total: number, currentName: string) => void;
  finishRun: (chapterId: string, report: DerivedChainReport) => void;
  patchReportRow: (chapterId: string, row: DerivedChainRowOutcome) => void;
  clearRun: (chapterId: string) => void;
}

export const useDerivedChainStore = create<DerivedChainState>()((set) => ({
  runsByChapter: {},
  startRun: (chapterId, total) =>
    set((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [chapterId]: { chapterId, status: "running", progress: { done: 0, total, currentName: "" } },
      },
    })),
  updateProgress: (chapterId, done, total, currentName) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run || run.status !== "running") return state;
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: { ...run, progress: { done, total, currentName } },
        },
      };
    }),
  finishRun: (chapterId, report) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...(run ?? { chapterId, status: "running" as const, progress: { done: 0, total: 0, currentName: "" } }),
            status: "done",
            report,
            progress: { done: report.total, total: report.total, currentName: "" },
          },
        },
      };
    }),
  patchReportRow: (chapterId, row) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run?.report) return state;
      const rows = run.report.rows.map((item) => (item.key === row.key ? row : item));
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: { ...run, report: recountDerivedReport({ ...run.report, rows }) },
        },
      };
    }),
  clearRun: (chapterId) =>
    set((state) => {
      if (!(chapterId in state.runsByChapter)) return state;
      const { [chapterId]: _removed, ...rest } = state.runsByChapter;
      return { runsByChapter: rest };
    }),
}));

function recountDerivedReport(report: DerivedChainReport): DerivedChainReport {
  let successCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;
  let unmatchedCount = 0;
  let spentCny = 0;
  let unpricedCount = 0;
  const channelCountMap = new Map<string, number>();
  for (const row of report.rows) {
    if (row.status === "success") successCount += 1;
    else if (row.status === "failed" || row.status === "parent-failed") failedCount += 1;
    else if (row.status === "blocked") blockedCount += 1;
    else if (row.status === "unmatched") unmatchedCount += 1;
    else skippedCount += 1;
    if (row.status !== "unmatched" && row.status !== "blocked") {
      spentCny += row.costCny;
      if (row.unpriced) unpricedCount += 1;
      if (row.channelLabel) {
        channelCountMap.set(row.channelLabel, (channelCountMap.get(row.channelLabel) ?? 0) + 1);
      }
    }
  }
  return {
    ...report,
    successCount,
    failedCount,
    blockedCount,
    skippedCount,
    unmatchedCount,
    spentCny,
    unpricedCount,
    channelCounts: [...channelCountMap.entries()].map(([label, count]) => ({ label, count })),
  };
}

const ROW_STATUS_LABELS: Record<DerivedChainRowStatus, string> = {
  success: "成功",
  failed: "失败",
  "parent-failed": "父资产图未就绪",
  blocked: "护栏拦截",
  "skipped-reused": "复用/并入在途",
  unmatched: "父资产未匹配",
};

// ── 执行体:derivedAssetImage 任务(生成→行落图→断言哨兵) ─────────────────

interface DerivedImageRunPlan {
  inputFingerprint: string;
  /** 生成回调:跑 generateAsset 并把图写进行,返回落定的图地址(失败抛错)。 */
  generate: () => Promise<string>;
  /** 断言哨兵:从行现势核衍生图非空(禁信生成链自报)。 */
  assertLandedImage: () => string | undefined;
}

function derivedImageTargetId(parentName: string, state: string): string {
  return `derived:${parentName}:${state}`;
}

function stableStringify(value: unknown): string {
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

function findReusableDerivedTask(
  targetId: string,
  inputFingerprint: string,
): MediaGenerationTask | undefined {
  const tasks = useStudioStore.getState().mediaTasks;
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i];
    if (
      task.kind === "derivedAssetImage" &&
      task.targetId === targetId &&
      task.inputFingerprint === inputFingerprint &&
      (task.status === "success" || task.status === "running")
    ) {
      return task;
    }
  }
  return undefined;
}

function latestFailedDerivedTask(
  targetId: string,
  inputFingerprint: string,
): MediaGenerationTask | undefined {
  const tasks = useStudioStore.getState().mediaTasks;
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i];
    if (
      task.kind === "derivedAssetImage" &&
      task.targetId === targetId &&
      task.inputFingerprint === inputFingerprint &&
      task.status === "failed"
    ) {
      return task;
    }
  }
  return undefined;
}

function writeDerivedCheckpoint(taskId: string, phase: string) {
  useStudioStore.setState((state) => ({
    mediaTasks: state.mediaTasks.map((task) =>
      task.id === taskId
        ? { ...task, checkpointRef: `phase:${phase}`, updatedAt: Date.now() }
        : task,
    ),
  }));
}

type DerivedImageTaskResult =
  | { status: "success"; taskId: string; imageRef: string }
  | { status: "skipped"; taskId: string; imageRef?: string }
  | { status: "failed"; taskId: string; errorReason: string };

async function runDerivedAssetImageTask(input: {
  targetId: string;
  plan: DerivedImageRunPlan;
  channelLabel: string;
  /** 章归属(D6:任务台账绑章,切章不中断)。 */
  episodeId: string;
}): Promise<DerivedImageTaskResult> {
  const { targetId, plan, channelLabel, episodeId } = input;
  const reusable = findReusableDerivedTask(targetId, plan.inputFingerprint);
  if (reusable) {
    return { status: "skipped", taskId: reusable.id, imageRef: reusable.outputRef ?? undefined };
  }
  const previousFailed = latestFailedDerivedTask(targetId, plan.inputFingerprint);
  const store = useStudioStore.getState();
  const taskId = store.startMediaTask({
    kind: "derivedAssetImage",
    targetId,
    episodeId,
    provider: channelLabel,
    inputFingerprint: plan.inputFingerprint,
    checkpointRef: "phase:queued",
    retryOf: previousFailed?.id,
  });
  try {
    writeDerivedCheckpoint(taskId, "generating");
    await plan.generate();
    writeDerivedCheckpoint(taskId, "asserting");
    const asserted = plan.assertLandedImage();
    if (!asserted) {
      store.failMediaTask(taskId, DERIVED_ASSET_ASSERTION_FAILURE, "phase:assertion");
      return { status: "failed", taskId, errorReason: DERIVED_ASSET_ASSERTION_FAILURE };
    }
    store.finishMediaTask(taskId, { outputRef: asserted, checkpointRef: "phase:done" });
    return { status: "success", taskId, imageRef: asserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.failMediaTask(taskId, message, "phase:thrown");
    return { status: "failed", taskId, errorReason: message };
  }
}

// ── 链编排入口 ─────────────────────────────────────────────────────────────

export interface RunDerivedChainInput {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
}

/**
 * 链上下文(闭包注入,零模块级可变态——并发章互串不可能):chapterId 供任务
 * 台账 episodeId 绑定(D6 切章不中断)+ 角色变体生成落章目录;resolver 供
 * 父图落位后逐条重建衍生计划(参考图须吃到刚生成的父图)。
 */
interface ChainContext extends RunDerivedChainInput {
  resolver: ReturnType<typeof buildEntityResolver>;
  importanceByName: Map<string, ParentImportance>;
  appearanceCounts: Map<string, number>;
}

/**
 * 落地衍生资产并自动接续生成(「落地衍生资产」按钮的新全链口径)。前置不满足
 * 或防重入命中返回 null(原因走 toast,可见不静默);报表与例外清单落
 * useDerivedChainStore,任务真身落 MediaGenerationTask 台账。
 */
export async function runDerivedAssetChain(
  input: RunDerivedChainInput,
): Promise<DerivedChainReport | null> {
  const { chapterId, projectId } = input;
  if (!projectId) {
    toast.error("未选择项目，无法落地衍生资产");
    return null;
  }
  const chainStore = useDerivedChainStore.getState();
  const running = chainStore.runsByChapter[chapterId];
  if (running?.status === "running") {
    toast.info(
      `衍生链闭环进行中(${running.progress.done}/${running.progress.total}),已并入在途批次`,
    );
    return null;
  }

  const state = useStudioStore.getState();
  const plan = findPlanForEpisode(state.scriptPlans, chapterId);
  if (!plan) {
    toast.error("尚无导演规划：请先到「分镜视频生成」完成导演规划节点");
    return null;
  }
  const batch =
    state.entityExtractions.find((item) => item.episodeId === plan.episodeId) ??
    state.entityExtractions[0];
  if (!batch) {
    toast.error("尚无实体库：请先在「剧本资产管理」完成资产提取");
    return null;
  }

  // ── 步1 落地(幂等:已存在行不重建;未匹配父资产计数留例外清单) ──
  const resolver = buildEntityResolver(
    batch.characters.map((item) => ({
      id: item.characterId,
      name: item.name,
      aliases: item.aliases,
    })),
    batch.scenes.map((item) => ({ id: item.sceneId, name: item.name })),
    batch.props.map((item) => ({ id: item.assetId, name: item.name })),
  );
  const { created, summary } = syncDerivedAssets(plan.derivedAssetPlan, {
    projectId,
    resolver,
    ...createMystudioDerivedSinks(),
  });
  if (!input.visualManualId) {
    // 落地已完成(行已在库),生成段需要视觉手册——明示而非静默半跑
    toast.error(
      `衍生资产已落地 ${summary.created} 条，但未选择视觉手册，未接续生成（请到「风格与导演」选择后再点）`,
    );
    return null;
  }

  // ── 步2 排序+逐条收集(已有图条目天然跳过=断点续跑;G17 主次→出场频率) ──
  const chain: ChainContext = {
    ...input,
    resolver,
    importanceByName: new Map(
      batch.characters
        .filter((item) => item.importance)
        .map((item) => [item.name, item.importance as ParentImportance]),
    ),
    appearanceCounts: buildParentAppearanceCounts(
      state.storyboards.filter((item) => item.episodeId === chapterId),
    ),
  };
  const ordered = buildOrderedChainEntries(plan.derivedAssetPlan, resolver, chain);
  const unmatchedItems = plan.derivedAssetPlan.filter(
    (item) => !resolver(item.parentAssetId),
  );

  const costState = useScriptAssetCostStore.getState();
  const capCny = costState.chapterCapCny;
  // 章预算共享(G7):批2 一键生成已累计的口径并入基线(同一章同一上限)
  const batchSpentBase =
    useScriptAssetBatchStore.getState().runsByChapter[chapterId]?.report?.spentCny ?? 0;
  let spentCny = batchSpentBase;
  let parentGeneratedCount = 0;
  let loopError: unknown = null;

  const total = ordered.length + unmatchedItems.length;
  const alreadyCompleteCount = Math.max(
    plan.derivedAssetPlan.length - unmatchedItems.length - ordered.length,
    0,
  );
  const toastId = `derived-chain:${chapterId}`;
  useDerivedChainStore.getState().startRun(chapterId, Math.max(total, 1));
  const startedAt = Date.now();
  toast.loading(
    `衍生链发车：${ordered.length} 条待生成（缺父图自动补父），未匹配 ${unmatchedItems.length} 条进例外清单`,
    { id: toastId },
  );

  const outcomes: DerivedChainRowOutcome[] = unmatchedItems.map((item) => ({
    key: derivedImageTargetId(item.parentAssetId, item.state),
    parentName: item.parentAssetId,
    state: item.state,
    kind: "character",
    status: "unmatched",
    statusLabel: ROW_STATUS_LABELS.unmatched,
    errorReason: "父资产未匹配（不在实体库，请先补资产提取）",
    costCny: 0,
    unpriced: false,
  }));

  let done = 0;
  try {
    for (const entry of ordered) {
      const label = `${entry.parentName}·${entry.state}`;
      useDerivedChainStore.getState().updateProgress(chapterId, done, total, label);
      toast.loading(`衍生链中（${done}/${total}）：${label}`, { id: toastId });
      const outcome = await runDerivedChainEntry(entry, chain, {
        getSpent: () => spentCny,
        addSpent: (value) => {
          spentCny += value;
        },
        onParentGenerated: () => {
          parentGeneratedCount += 1;
        },
      });
      outcomes.push(outcome);
      done += 1;
      useDerivedChainStore.getState().updateProgress(chapterId, done, total, "");
    }
  } catch (error) {
    // 单条失败已由 runDerivedChainEntry 收口成行结果;此处兜编排层异常,
    // 批次必须收终态——否则在途标记毒死防重入,本章永远「进行中」
    loopError = error;
  }

  const finishedAt = Date.now();
  const report = recountDerivedReport({
    chapterId,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    total,
    successCount: 0,
    failedCount: 0,
    blockedCount: 0,
    skippedCount: 0,
    unmatchedCount: 0,
    rows: outcomes,
    landedCount: created.length,
    alreadyCompleteCount,
    parentGeneratedCount,
    spentCny: Math.max(spentCny - batchSpentBase, 0),
    capCny,
    unpricedCount: 0,
    channelCounts: [],
  });
  useDerivedChainStore.getState().finishRun(chapterId, report);

  if (loopError) {
    toast.error(
      `衍生链中断：${loopError instanceof Error ? loopError.message : String(loopError)}（已完成 ${done}/${total}，例外清单见资产生成区）`,
      { id: toastId },
    );
    return report;
  }

  const failedNames = report.rows
    .filter((row) => row.status === "failed" || row.status === "parent-failed")
    .map((row) => `${row.parentName}·${row.state}`);
  const summaryParts = [`成 ${report.successCount}`, `失 ${report.failedCount}`];
  if (report.skippedCount) summaryParts.push(`跳 ${report.skippedCount}`);
  if (report.blockedCount) summaryParts.push(`护栏拦截 ${report.blockedCount}`);
  if (report.unmatchedCount) summaryParts.push(`未匹配 ${report.unmatchedCount}`);
  if (report.alreadyCompleteCount) summaryParts.push(`已成跳过 ${report.alreadyCompleteCount}`);
  const descriptionParts = [
    `落地 ${report.landedCount} 条 · 补父图 ${report.parentGeneratedCount} 张`,
    report.channelCounts.length
      ? `渠道：${report.channelCounts.map((c) => `${c.label}×${c.count}`).join(" · ")}`
      : null,
    `本章累计成本 ${formatCny(report.spentCny)}（上限 ${formatCny(capCny)}）`,
    report.unpricedCount
      ? `⚠ ${report.unpricedCount} 张走未估价云端通道（按 ¥0 计）`
      : null,
    failedNames.length ? `失败：${failedNames.join("、")}` : null,
  ].filter(Boolean);
  if (report.failedCount > 0 || report.blockedCount > 0 || report.unmatchedCount > 0) {
    toast.error(`衍生链完成：${summaryParts.join(" · ")}`, {
      id: toastId,
      description: descriptionParts.join("\n"),
    });
  } else {
    toast.success(`衍生链完成：${summaryParts.join(" · ")}`, {
      id: toastId,
      description: descriptionParts.join("\n"),
    });
  }
  return report;
}

// ── 单条链(父图先行→衍生图):失败不抛,收口成行结果(不阻塞其余) ───────────

interface OrderedDerivedEntry {
  key: string;
  kind: ScriptAssetGenerationType;
  parentName: string;
  state: string;
  /** 父资产 id(三库行 id)。 */
  parentId: string;
  /** 父资产行(三库已落地;缺图时先补父)。 */
  parentRow: AssetRow;
  /** 导演预划原条目(父图落位后重建衍生计划用)。 */
  planItem: ScriptPlan["derivedAssetPlan"][number];
  imagePlan: DerivedImageRunPlan;
}

interface EntryRunHooks {
  getSpent: () => number;
  addSpent: (value: number) => void;
  onParentGenerated: () => void;
}

async function runDerivedChainEntry(
  entryIn: OrderedDerivedEntry,
  chain: ChainContext,
  hooks: EntryRunHooks,
): Promise<DerivedChainRowOutcome> {
  let entry = entryIn;
  const costState = useScriptAssetCostStore.getState();
  const channel = estimateImageChannel(
    SCRIPT_ASSET_IMAGE_FEATURES[entry.kind],
    costState.prices,
  );
  const price = channel?.priceCny ?? 0;
  const unpriced = !channel || (!channel.priced && !channel.isLocal);
  const channelLabel = channel ? channelEstimateLabel(channel) : "未绑定通道";
  const capCny = costState.chapterCapCny;

  // ── 父图先行:缺父图先派 scriptAsset(批1 链,含断言哨兵) ──
  let parentTaskId: string | undefined;
  let parentCostCny = 0;
  if (!getRowImage(entry.parentRow)) {
    if (!costGuardAllowsDispatch(hooks.getSpent(), price, capCny)) {
      return {
        key: entry.key,
        parentName: entry.parentName,
        state: entry.state,
        kind: entry.kind,
        status: "blocked",
        statusLabel: ROW_STATUS_LABELS.blocked,
        errorReason: `成本护栏：本章累计 ${formatCny(hooks.getSpent())} ＋ 父图 ${formatCny(price)} 超上限 ${formatCny(capCny)}，未发车`,
        costCny: 0,
        unpriced: false,
      };
    }
    hooks.addSpent(price);
    parentCostCny = price;
    const ensured = ensureLocalAssetForRow(entry.parentRow, {
      activeProjectId: chain.projectId,
      productionEpisodeId: chain.chapterId,
    });
    const parentResult = await runScriptAssetMediaTask({
      row: ensured,
      visualManualId: chain.visualManualId!,
      projectId: chain.projectId,
      chapterId: chain.chapterId,
    });
    parentTaskId = parentResult.taskId;
    const freshParent = readParentRowFresh(ensured);
    if (parentResult.status === "failed" || !getRowImage(freshParent)) {
      return {
        key: entry.key,
        parentName: entry.parentName,
        state: entry.state,
        kind: entry.kind,
        status: "parent-failed",
        statusLabel: ROW_STATUS_LABELS["parent-failed"],
        errorReason:
          parentResult.status === "failed"
            ? `父资产图生成失败：${parentResult.errorReason ?? "未知错误"}`
            : "父资产图未就绪（生成完成但行上无图）",
        parentTaskId,
        costCny: parentCostCny,
        unpriced,
        channelLabel,
      };
    }
    if (parentResult.status === "success") hooks.onParentGenerated();
    // 父图落位后重建衍生计划:参考图/提示词装配必须吃到刚生成的父图
    // (链首发时的计划是在缺父图状态下收集的,参考图为空)
    const rebuilt = buildImagePlanForPlanItem(entry.planItem, chain);
    entry = rebuilt
      ? { ...entry, parentRow: freshParent, imagePlan: rebuilt.plan }
      : { ...entry, parentRow: freshParent };
  }

  // ── 衍生图护栏(fail-closed;已完成不回滚) ──
  if (!costGuardAllowsDispatch(hooks.getSpent(), price, capCny)) {
    return {
      key: entry.key,
      parentName: entry.parentName,
      state: entry.state,
      kind: entry.kind,
      status: "blocked",
      statusLabel: ROW_STATUS_LABELS.blocked,
      errorReason: `成本护栏：本章累计 ${formatCny(hooks.getSpent())} ＋ 衍生图 ${formatCny(price)} 超上限 ${formatCny(capCny)}，未发车`,
      costCny: parentCostCny,
      unpriced: false,
      channelLabel: parentCostCny ? channelLabel : undefined,
    };
  }

  const result = await runDerivedAssetImageTask({
    targetId: entry.key,
    plan: entry.imagePlan,
    channelLabel,
    episodeId: chain.chapterId,
  });
  // 发车即计(计划口径;失败张也可能已烧生成费,fail-closed 方向多计不少计)
  hooks.addSpent(price);
  const rowCostCny = parentCostCny + price;

  if (result.status === "success") {
    return {
      key: entry.key,
      parentName: entry.parentName,
      state: entry.state,
      kind: entry.kind,
      status: "success",
      statusLabel: ROW_STATUS_LABELS.success,
      imageRef: result.imageRef,
      taskId: result.taskId,
      parentTaskId,
      costCny: rowCostCny,
      unpriced,
      channelLabel,
    };
  }
  if (result.status === "skipped") {
    return {
      key: entry.key,
      parentName: entry.parentName,
      state: entry.state,
      kind: entry.kind,
      status: "skipped-reused",
      statusLabel: ROW_STATUS_LABELS["skipped-reused"],
      imageRef: result.imageRef,
      taskId: result.taskId,
      parentTaskId,
      costCny: rowCostCny,
      unpriced,
      channelLabel,
    };
  }
  return {
    key: entry.key,
    parentName: entry.parentName,
    state: entry.state,
    kind: entry.kind,
    status: "failed",
    statusLabel: ROW_STATUS_LABELS.failed,
    errorReason: result.errorReason,
    taskId: result.taskId,
    parentTaskId,
    costCny: rowCostCny,
    unpriced,
    channelLabel,
  };
}

// ── 计划条目 → 排序后的链条目(逐条收集,父图落位后可重建) ───────────────────

/**
 * 单条计划条目 → 衍生图执行计划。走 collectDerivedAssetGenerationTasks 的
 * 单条收集(提示词装配/参考图解析与其零偏差);已有图或行缺失返回 null。
 */
function buildImagePlanForPlanItem(
  item: ScriptPlan["derivedAssetPlan"][number],
  chain: ChainContext,
): { plan: DerivedImageRunPlan; kind: ScriptAssetGenerationType } | null {
  const single = collectDerivedAssetGenerationTasks(
    [item],
    chain.resolver,
    chain.visualManualId!,
    chain.projectId ?? "",
    chain.chapterId,
  );
  const variationTask = single.characterVariationTasks[0];
  if (variationTask) {
    return {
      kind: "character",
      plan: {
        inputFingerprint: stableStringify({
          fingerprintKind: "derivedAssetImage:v1",
          parentAssetId: item.parentAssetId,
          state: item.state,
          variationTaskName: variationTask.name,
        }),
        generate: async () => {
          const result = await generateAsset({
            // assetId=variationId:orchestrator 的 store 写回对非角色 id
            // 天然 no-op,变体行由下方 updateVariation 显式写,不污染父角色
            assetId: variationTask.variationId,
            assetType: "character",
            projectId: chain.projectId ?? undefined,
            chapterId: chain.chapterId,
            name: variationTask.name,
            description: `${variationTask.name}（角色衍生）`,
            isDerivative: true,
            visualManualId: chain.visualManualId!,
            skipPolish: true,
            existingPrompt: variationTask.prompt,
            referenceImages: variationTask.referenceImages,
            imageWorkflowId: variationTask.imageWorkflowId,
          });
          if (result.phase !== "done" || !result.imageLocalPath) {
            throw new Error(result.error ?? "角色衍生图生成失败");
          }
          useCharacterLibraryStore
            .getState()
            .updateVariation(variationTask.characterId, variationTask.variationId, {
              referenceImage: result.imageLocalPath,
            });
          return result.imageLocalPath;
        },
        assertLandedImage: () =>
          useCharacterLibraryStore
            .getState()
            .getVariationById(variationTask.characterId, variationTask.variationId)
            ?.referenceImage,
      },
    };
  }
  const storeTask = single.storeTasks[0];
  if (!storeTask) return null;
  const assertLanded =
    storeTask.assetType === "scene"
      ? () => useSceneStore.getState().getSceneById(storeTask.assetId)?.referenceImage
      : () => usePropsLibraryStore.getState().getPropById(storeTask.assetId)?.imageUrl;
  return {
    kind: storeTask.assetType,
    plan: {
      inputFingerprint: stableStringify({
        fingerprintKind: "derivedAssetImage:v1",
        parentAssetId: item.parentAssetId,
        state: item.state,
        assetId: storeTask.assetId,
      }),
      generate: async () => {
        const result = await generateAsset({
          ...storeTask,
          chapterId: storeTask.chapterId ?? chain.chapterId,
        });
        if (result.phase !== "done" || !result.imageLocalPath) {
          throw new Error(result.error ?? "衍生图生成失败");
        }
        return result.imageLocalPath;
      },
      assertLandedImage: assertLanded,
    },
  };
}

/**
 * 计划条目 → 排序后的链条目:逐条单收(collect 对已有图条目天然跳过=断点续跑,
 * 返回 null 不进链),排序=G17 主次→出场频率,平局保持导演预划原序。
 */
function buildOrderedChainEntries(
  derivedAssetPlan: ScriptPlan["derivedAssetPlan"],
  resolver: ChainContext["resolver"],
  chain: ChainContext,
): OrderedDerivedEntry[] {
  const entries: Array<{ entry: OrderedDerivedEntry; sortKey: number[]; order: number }> = [];
  let order = 0;

  for (const item of derivedAssetPlan) {
    const target = resolver(item.parentAssetId);
    if (!target) continue;
    const parentRow = findParentRow(target);
    if (!parentRow) continue;
    const built = buildImagePlanForPlanItem(item, chain);
    if (!built) continue; // 已有图(断点续跑跳过)或衍生行缺失
    entries.push({
      entry: {
        key: derivedImageTargetId(parentRow.name, item.state),
        kind: built.kind,
        parentName: parentRow.name,
        state: item.state,
        parentId: parentRow.id,
        parentRow,
        planItem: item,
        imagePlan: built.plan,
      },
      sortKey: deriveChainSortKey({
        parentName: parentRow.name,
        importance: chain.importanceByName.get(parentRow.name),
        appearanceCount: appearanceCountOf(chain.appearanceCounts, parentRow.name),
      }),
      order: order++,
    });
  }

  return entries
    .sort((left, right) => {
      for (let i = 0; i < left.sortKey.length; i += 1) {
        if (left.sortKey[i] !== right.sortKey[i]) return left.sortKey[i] - right.sortKey[i];
      }
      return left.order - right.order;
    })
    .map((item) => item.entry);
}

/** 解析目标 → 父资产行(三库现势;缺行=本地资产未落地,由 ensure 兜)。 */
function findParentRow(target: {
  kind: "character" | "scene" | "prop";
  id: string;
}): AssetRow | null {
  if (target.kind === "character") {
    const asset = useCharacterLibraryStore.getState().getCharacterById(target.id);
    return asset ? { type: "character", id: asset.id, name: asset.name, asset } : null;
  }
  if (target.kind === "scene") {
    const asset = useSceneStore.getState().getSceneById(target.id);
    return asset ? { type: "scene", id: asset.id, name: asset.name, asset } : null;
  }
  const asset = usePropsLibraryStore.getState().getPropById(target.id);
  return asset ? { type: "prop", id: asset.id, name: asset.name, asset } : null;
}

// ── 重试(例外清单:单条/批完统一) ─────────────────────────────────────────

export interface RetryDerivedChainInput extends RunDerivedChainInput {
  parentName: string;
  state: string;
}

/** 例外行单独重试:重走单条链(父图先行+护栏),成功/失败回写报表行。 */
export async function retryDerivedChainRow(input: RetryDerivedChainInput): Promise<void> {
  const outcome = await rerunDerivedEntryMatching(input);
  if (outcome) {
    useDerivedChainStore.getState().patchReportRow(input.chapterId, outcome);
    const label = `${input.parentName}·${input.state}`;
    if (outcome.status === "success") {
      toast.success(`重试「${label}」成功`);
    } else if (outcome.status === "skipped-reused") {
      toast.info(`「${label}」已有在途/已成任务，已并入`);
    } else {
      toast.error(`重试「${label}」失败：${outcome.errorReason ?? "未知错误"}`);
    }
  }
}

/**
 * 批完统一重试(G17):例外清单(失败/父失败/护栏拦截)逐条串行重跑,回写报表。
 * 语义=retryFailedMediaTasks(derivedAssetImage) 但真正执行(队列只翻台账)。
 */
export async function retryFailedDerivedChainEntries(
  input: RunDerivedChainInput,
): Promise<void> {
  const run = useDerivedChainStore.getState().runsByChapter[input.chapterId];
  const rows = run?.report?.rows.filter(
    (row) =>
      row.status === "failed" || row.status === "parent-failed" || row.status === "blocked",
  );
  if (!rows?.length) {
    toast.info("例外清单为空，无需重试");
    return;
  }
  const toastId = `derived-chain-retry:${input.chapterId}`;
  toast.loading(`衍生链统一重试：${rows.length} 条...`, { id: toastId });
  for (const row of rows) {
    await retryDerivedChainRow({ ...input, parentName: row.parentName, state: row.state });
  }
  toast.success(`衍生链统一重试完成：${rows.length} 条已重跑（结果见例外清单）`, { id: toastId });
}

async function rerunDerivedEntryMatching(
  input: RetryDerivedChainInput,
): Promise<DerivedChainRowOutcome | null> {
  const state = useStudioStore.getState();
  const plan = findPlanForEpisode(state.scriptPlans, input.chapterId);
  if (!plan || !input.visualManualId || !input.projectId) {
    toast.error("缺少导演规划/视觉手册/项目，无法重试衍生链");
    return null;
  }
  const batch =
    state.entityExtractions.find((item) => item.episodeId === plan.episodeId) ??
    state.entityExtractions[0];
  if (!batch) {
    toast.error("尚无实体库，无法重试衍生链");
    return null;
  }
  const resolver = buildEntityResolver(
    batch.characters.map((item) => ({ id: item.characterId, name: item.name, aliases: item.aliases })),
    batch.scenes.map((item) => ({ id: item.sceneId, name: item.name })),
    batch.props.map((item) => ({ id: item.assetId, name: item.name })),
  );
  // 落地先行(重试时行可能已被清理,幂等补齐)
  syncDerivedAssets(plan.derivedAssetPlan, {
    projectId: input.projectId,
    resolver,
    ...createMystudioDerivedSinks(),
  });
  const chain: ChainContext = {
    ...input,
    resolver,
    importanceByName: new Map(
      batch.characters
        .filter((item) => item.importance)
        .map((item) => [item.name, item.importance as ParentImportance]),
    ),
    appearanceCounts: buildParentAppearanceCounts(
      state.storyboards.filter((item) => item.episodeId === input.chapterId),
    ),
  };
  const ordered = buildOrderedChainEntries(plan.derivedAssetPlan, resolver, chain);
  const entry = ordered.find(
    (item) => item.parentName === input.parentName && item.state === input.state,
  );
  if (!entry) {
    toast.error(`衍生条目已不在待生成清单：${input.parentName}·${input.state}`);
    return null;
  }
  const batchReport =
    useScriptAssetBatchStore.getState().runsByChapter[input.chapterId]?.report;
  const chainReport =
    useDerivedChainStore.getState().runsByChapter[input.chapterId]?.report;
  let spent = (batchReport?.spentCny ?? 0) + (chainReport?.spentCny ?? 0);
  return runDerivedChainEntry(entry, chain, {
    getSpent: () => spent,
    addSpent: (value) => {
      spent += value;
    },
    onParentGenerated: () => undefined,
  });
}

// ── 内部辅助 ───────────────────────────────────────────────────────────────

function readParentRowFresh(row: AssetRow): AssetRow {
  const assetId = row.asset?.id ?? row.id;
  if (row.type === "character") {
    const asset = useCharacterLibraryStore.getState().getCharacterById(assetId);
    return asset ? { ...row, asset } : row;
  }
  if (row.type === "scene") {
    const asset = useSceneStore.getState().getSceneById(assetId);
    return asset ? { ...row, asset } : row;
  }
  const asset = usePropsLibraryStore.getState().getPropById(assetId);
  return asset ? { ...row, asset } : row;
}
