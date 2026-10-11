/**
 * 「本章资产一键生成」编排(10-11 pipeline-human-node-automation 批2,G7/G15/G16):
 * 遍历本章提取批次全部行(角色/场景/道具)→ 逐行派发/复用批1 的 scriptAsset
 * 媒体任务(runScriptAssetMediaTask:生成→入库→断言哨兵);串行发车(与
 * batchGenerateAssets 的 API 池串行约定一致,防限流);
 * - 防重入:同章在途批并入(照 useNovelPipelineActions 事件分析批处理模式,
 *   进度常驻单 toast,不另起一批);
 * - 成本护栏(fail-closed 硬中止):发车前预估(张数×估价)+ 逐张开检,
 *   累计+本张>单章上限(默认 ¥10 可调)→ 该张不发(已完成不回滚);
 *   纯本地通道零计费恒放行;未估价云端通道按 ¥0 计并在报表标注(不编造单价);
 * - 跑完报表:成功/失败/跳过/拦截、渠道分布、耗时、成本(累计 vs 预估);
 * - 失败清单:报表行级落账,失败行可单独重试(重试仍过护栏;重走
 *   runScriptAssetMediaTask 产 retryOf 链台账——队列的 retryFailedMediaTasks
 *   只翻台账不执行,scriptAsset 的执行体在桥接层,故重试复用本模块)。
 * 进度与报表态存 zustand(非持久):切走再回来进度/失败清单不丢;
 * 任务真身落 MediaGenerationTask 台账(批1),断点续跑由队列承担。
 */
import { toast } from "sonner";
import { create } from "zustand";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  SCRIPT_ASSET_IMAGE_FEATURES,
  channelEstimateLabel,
  costGuardAllowsDispatch,
  estimateImageChannel,
  formatCny,
  type ScriptAssetGenerationType,
} from "@/lib/studio/script-asset-cost";
import { useScriptAssetCostStore } from "@/stores/studio/script-asset-cost-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { EntityExtractionResult } from "@/types/studio";
import { ensureLocalAssetForRow } from "./useScriptAssetGenerationActions";
import { runScriptAssetMediaTask, scriptAssetTargetKey } from "./script-asset-media-task";
import { getRowImage, uniqueByName, type AssetRow } from "./script-asset-generation-model";

// ── 行收集:本章提取批次 → AssetRow(镜像 useScriptAssetGenerationData 口径,只取本章) ──

/** 本章提取批次全部行(角色→场景→道具,批内按名去重;asset 由三库按名回填)。 */
export function buildChapterAssetRows(
  chapterId: string,
  projectId: string | null,
): AssetRow[] {
  const batch = useStudioStore
    .getState()
    .entityExtractions.find((item) => item.episodeId === chapterId);
  if (!batch) return [];
  return assetRowsFromBatch(batch, projectId);
}

export function assetRowsFromBatch(
  batch: EntityExtractionResult,
  projectId: string | null,
): AssetRow[] {
  const characters = useCharacterLibraryStore.getState().characters;
  const scenes = useSceneStore.getState().scenes;
  const props = usePropsLibraryStore.getState().items;
  const characterByName = uniqueByName(
    projectId ? characters.filter((item) => item.projectId === projectId) : characters,
  );
  const sceneByName = uniqueByName(
    projectId ? scenes.filter((item) => item.projectId === projectId) : scenes,
  );
  const propByName = uniqueByName(
    projectId ? props.filter((item) => item.projectId === projectId) : props,
  );
  const rows: AssetRow[] = [];
  const seen = new Set<string>();
  const push = (row: AssetRow) => {
    const key = `${row.type}:${row.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const item of batch.characters) {
    push({
      type: "character",
      id: item.characterId,
      name: item.name,
      note: item.note,
      asset: characterByName.get(item.name),
    });
  }
  for (const item of batch.scenes) {
    push({
      type: "scene",
      id: item.sceneId,
      name: item.name,
      note: item.note,
      asset: sceneByName.get(item.name),
    });
  }
  for (const item of batch.props) {
    push({
      type: "prop",
      id: item.assetId,
      name: item.name,
      note: item.note,
      asset: propByName.get(item.name),
    });
  }
  return rows;
}

// ── 批次态(zustand 非持久:本会话进度/最近报表;任务真身在 MediaGenerationTask) ──

export type ScriptAssetBatchRowStatus =
  | "success"
  | "failed"
  | "skipped-existing"
  | "skipped-reused"
  | "blocked";

export interface ScriptAssetBatchRowOutcome {
  targetId: string;
  name: string;
  type: ScriptAssetGenerationType;
  status: ScriptAssetBatchRowStatus;
  statusLabel: string;
  errorReason?: string;
  /** 发车归属渠道标签(渠道分布口径)。 */
  channelLabel?: string;
  /** 本张计划成本(元;本地/未估价=0)。 */
  costCny: number;
  /** 云端通道但估价表未配置单价(按 ¥0 计,报表警示)。 */
  unpriced: boolean;
  taskId?: string;
}

export interface ScriptAssetBatchReport {
  chapterId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  total: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  blockedCount: number;
  rows: ScriptAssetBatchRowOutcome[];
  /** 发车前预估(待生成张 × 首绑估价,元)。 */
  estimatedCny: number;
  /** 实发车累计(计划口径,元)。 */
  spentCny: number;
  capCny: number;
  /** 未估价云端通道张数(按 ¥0 计)。 */
  unpricedCount: number;
  /** 渠道分布(发车归属,含并入在途)。 */
  channelCounts: Array<{ label: string; count: number }>;
}

export interface ScriptAssetBatchRunView {
  chapterId: string;
  status: "running" | "done";
  progress: { done: number; total: number; currentName: string };
  report?: ScriptAssetBatchReport;
}

interface ScriptAssetBatchState {
  runsByChapter: Record<string, ScriptAssetBatchRunView>;
  startRun: (chapterId: string, total: number) => void;
  updateProgress: (chapterId: string, done: number, total: number, currentName: string) => void;
  finishRun: (chapterId: string, report: ScriptAssetBatchReport) => void;
  patchReportRow: (chapterId: string, row: ScriptAssetBatchRowOutcome) => void;
  clearRun: (chapterId: string) => void;
}

export const useScriptAssetBatchStore = create<ScriptAssetBatchState>()((set) => ({
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
          [chapterId]: { ...(run ?? { chapterId, status: "running", progress: { done: 0, total: 0, currentName: "" } }), status: "done", report, progress: { done: report.total, total: report.total, currentName: "" } },
        },
      };
    }),
  patchReportRow: (chapterId, row) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run?.report) return state;
      const rows = run.report.rows.map((item) => (item.targetId === row.targetId ? row : item));
      const report = recountReport({ ...run.report, rows });
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: { ...run, report },
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

function recountReport(report: ScriptAssetBatchReport): ScriptAssetBatchReport {
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;
  let spentCny = 0;
  let unpricedCount = 0;
  const channelCountMap = new Map<string, number>();
  for (const row of report.rows) {
    if (row.status === "success") successCount += 1;
    else if (row.status === "failed") failedCount += 1;
    else if (row.status === "blocked") blockedCount += 1;
    else skippedCount += 1;
    // 成功/失败/复用=已发车张计成本;跳过(已有图)/拦截=0
    if (row.status !== "skipped-existing" && row.status !== "blocked") {
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
    skippedCount,
    blockedCount,
    spentCny,
    unpricedCount,
    channelCounts: [...channelCountMap.entries()].map(([label, count]) => ({ label, count })),
  };
}

// ── 一键编排入口 ─────────────────────────────────────────────────────────

const ROW_STATUS_LABELS: Record<ScriptAssetBatchRowStatus, string> = {
  success: "成功",
  failed: "失败",
  "skipped-existing": "已有图跳过",
  "skipped-reused": "复用/并入在途",
  blocked: "护栏拦截",
};

export interface RunChapterScriptAssetsInput {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
}

/**
 * 一键生成本章提取批次全部资产行。返回跑完报表;防重入/前置不合规则返回 null
 * (原因走 toast,可见不静默)。
 */
export async function runChapterScriptAssetGeneration(
  input: RunChapterScriptAssetsInput,
): Promise<ScriptAssetBatchReport | null> {
  const { chapterId, projectId } = input;
  const batchStore = useScriptAssetBatchStore.getState();
  const running = batchStore.runsByChapter[chapterId];
  if (running?.status === "running") {
    toast.info(
      `本章一键生成进行中(${running.progress.done}/${running.progress.total}),已并入在途批次`,
    );
    return null;
  }
  if (!input.visualManualId) {
    toast.error("请先在「风格与导演」中选择视觉手册");
    return null;
  }
  const bridge = getStudioAssetsBridge();
  if (!bridge?.getByName || !bridge.add) {
    toast.error("资产库接口仅在桌面应用中可用，无法一键生成");
    return null;
  }
  const rows = buildChapterAssetRows(chapterId, projectId);
  if (!rows.length) {
    toast.info("本章提取批次没有可生成的资产行");
    return null;
  }

  // 行先落地本地资产(批1 契约:scriptAsset 任务要求 row.asset 在场)
  const prepared = rows.map((row) =>
    ensureLocalAssetForRow(row, { activeProjectId: projectId, productionEpisodeId: chapterId }),
  );
  const costState = useScriptAssetCostStore.getState();
  const capCny = costState.chapterCapCny;

  // 发车前预估:待生成张(已有图跳过)× 各功能首绑通道估价
  const plan = prepared.map((row) => ({
    row,
    hasImage: Boolean(getRowImage(row)),
    channel: estimateImageChannel(
      SCRIPT_ASSET_IMAGE_FEATURES[row.type],
      costState.prices,
    ),
  }));
  const pendingCount = plan.filter((item) => !item.hasImage).length;
  if (pendingCount === 0) {
    toast.info(`本章 ${prepared.length} 行资产均已有图，无需生成`);
    return null;
  }
  const estimatedCny = plan
    .filter((item) => !item.hasImage)
    .reduce((sum, item) => sum + (item.channel?.priceCny ?? 0), 0);

  const total = prepared.length;
  const toastId = `script-asset-batch:${chapterId}`;
  batchStore.startRun(chapterId, total);
  const startedAt = Date.now();
  toast.loading(
    `一键生成发车：${pendingCount}/${total} 张待生成，预估 ${formatCny(estimatedCny)}（上限 ${formatCny(capCny)}）`,
    { id: toastId },
  );

  const outcomes: ScriptAssetBatchRowOutcome[] = [];
  let done = 0;
  const channelCountMap = new Map<string, number>();
  let spentCny = 0;
  let unpricedCount = 0;
  let loopError: unknown = null;

  try {
    for (const item of plan) {
      const { row, hasImage, channel } = item;
      const targetId = scriptAssetTargetKey(row);
      const price = channel?.priceCny ?? 0;
      const unpriced = !channel || (!channel.priced && !channel.isLocal);
      const channelLabel = channel ? channelEstimateLabel(channel) : "未绑定通道";

      if (hasImage) {
        outcomes.push({
          targetId,
          name: row.name,
          type: row.type,
          status: "skipped-existing",
          statusLabel: ROW_STATUS_LABELS["skipped-existing"],
          costCny: 0,
          unpriced: false,
        });
        done += 1;
        useScriptAssetBatchStore.getState().updateProgress(chapterId, done, total, "");
        continue;
      }

      // 成本护栏(fail-closed):累计+本张>上限→本张不发,已完成不回滚
      if (!costGuardAllowsDispatch(spentCny, price, capCny)) {
        outcomes.push({
          targetId,
          name: row.name,
          type: row.type,
          status: "blocked",
          statusLabel: ROW_STATUS_LABELS.blocked,
          errorReason: `成本护栏：本章累计 ${formatCny(spentCny)} ＋ 本张 ${formatCny(price)} 超单章上限 ${formatCny(capCny)}，未发车（可到 设置·云端AI·成本估价 调整上限后重试）`,
          costCny: 0,
          unpriced: false,
        });
        done += 1;
        useScriptAssetBatchStore.getState().updateProgress(chapterId, done, total, "");
        continue;
      }

      useScriptAssetBatchStore.getState().updateProgress(chapterId, done, total, row.name);
      toast.loading(`一键生成中（${done}/${total}）：${row.name}`, { id: toastId });
      const result = await runScriptAssetMediaTask({
        row,
        visualManualId: input.visualManualId,
        projectId,
        chapterId,
      });
      // 发车即计成本(计划口径):失败张也可能已烧生成费,fail-closed 方向多计不少计
      spentCny += price;
      if (unpriced) unpricedCount += 1;
      channelCountMap.set(channelLabel, (channelCountMap.get(channelLabel) ?? 0) + 1);

      if (result.status === "success") {
        outcomes.push({
          targetId,
          name: row.name,
          type: row.type,
          status: "success",
          statusLabel: ROW_STATUS_LABELS.success,
          channelLabel,
          costCny: price,
          unpriced,
          taskId: result.taskId,
        });
      } else if (result.status === "skipped") {
        outcomes.push({
          targetId,
          name: row.name,
          type: row.type,
          status: "skipped-reused",
          statusLabel: ROW_STATUS_LABELS["skipped-reused"],
          channelLabel,
          costCny: price,
          unpriced,
          taskId: result.taskId,
        });
      } else {
        outcomes.push({
          targetId,
          name: row.name,
          type: row.type,
          status: "failed",
          statusLabel: ROW_STATUS_LABELS.failed,
          errorReason: result.errorReason,
          channelLabel,
          costCny: price,
          unpriced,
          taskId: result.taskId,
        });
      }
      done += 1;
      useScriptAssetBatchStore.getState().updateProgress(chapterId, done, total, "");
    }
  } catch (error) {
    // 编排循环内不应有未接异常(runScriptAssetMediaTask 自带失败收口);
    // 万一炸出(如本地资产落地抛错),批次必须收口成终态——否则在途标记
    // 毒死防重入,本章永远「进行中」。
    loopError = error;
  }

  const finishedAt = Date.now();
  const report = recountReport({
    chapterId,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    total,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    blockedCount: 0,
    rows: outcomes,
    estimatedCny,
    spentCny,
    capCny,
    unpricedCount,
    channelCounts: [...channelCountMap.entries()].map(([label, count]) => ({ label, count })),
  });
  useScriptAssetBatchStore.getState().finishRun(chapterId, report);

  if (loopError) {
    toast.error(
      `本章一键生成中断：${loopError instanceof Error ? loopError.message : String(loopError)}（已完成 ${done}/${total} 行，失败清单见资产生成区）`,
      { id: toastId },
    );
    return report;
  }

  const summaryParts = [`成 ${report.successCount}`, `失 ${report.failedCount}`];
  if (report.skippedCount) summaryParts.push(`跳 ${report.skippedCount}`);
  if (report.blockedCount) summaryParts.push(`护栏拦截 ${report.blockedCount}`);
  const summary = `本章资产生成完成：${summaryParts.join(" · ")}`;
  const descriptionParts = [
    report.channelCounts.length
      ? `渠道：${report.channelCounts.map((c) => `${c.label}×${c.count}`).join(" · ")}`
      : null,
    `耗时 ${formatDurationMs(report.durationMs)}`,
    `成本 ${formatCny(report.spentCny)}／预估 ${formatCny(report.estimatedCny)}（上限 ${formatCny(capCny)}）`,
    report.unpricedCount
      ? `⚠ ${report.unpricedCount} 张走未估价云端通道（按 ¥0 计），请到 设置·云端AI·成本估价 补单价`
      : null,
    report.failedCount
      ? `失败：${report.rows.filter((r) => r.status === "failed").map((r) => r.name).join("、")}`
      : null,
  ].filter(Boolean);
  if (report.failedCount > 0) {
    toast.error(summary, { id: toastId, description: descriptionParts.join("\n") });
  } else {
    toast.success(summary, { id: toastId, description: descriptionParts.join("\n") });
  }
  return report;
}

// ── 失败行单独重试(失败清单 UI 用) ───────────────────────────────────────

export interface RetryScriptAssetRowInput {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
  type: ScriptAssetGenerationType;
  name: string;
}

/**
 * 失败/拦截行单独重试:重走 runScriptAssetMediaTask(产 retryOf 台账链),
 * 发车前仍过成本护栏(以报表累计口径);成功/失败回写报表行。
 */
export async function retryScriptAssetBatchRow(input: RetryScriptAssetRowInput): Promise<void> {
  const { chapterId, projectId } = input;
  const run = useScriptAssetBatchStore.getState().runsByChapter[chapterId];
  const targetId = `${input.type}:${input.name}`;
  const toastId = `script-asset-retry:${chapterId}:${targetId}`;
  if (!input.visualManualId) {
    toast.error("请先在「风格与导演」中选择视觉手册", { id: toastId });
    return;
  }
  const rows = buildChapterAssetRows(chapterId, projectId);
  const matched = rows.find((row) => row.type === input.type && row.name === input.name);
  if (!matched) {
    toast.error(`本章提取批次找不到资产行：${targetId}`, { id: toastId });
    return;
  }
  const row = ensureLocalAssetForRow(matched, {
    activeProjectId: projectId,
    productionEpisodeId: chapterId,
  });

  const costState = useScriptAssetCostStore.getState();
  const channel = estimateImageChannel(
    SCRIPT_ASSET_IMAGE_FEATURES[row.type],
    costState.prices,
  );
  const price = channel?.priceCny ?? 0;
  const channelLabel = channel ? channelEstimateLabel(channel) : "未绑定通道";
  const spentBase = run?.report?.spentCny ?? 0;
  if (!costGuardAllowsDispatch(spentBase, price, costState.chapterCapCny)) {
    toast.error(
      `成本护栏：重试「${input.name}」需 ${formatCny(price)}，本章已累计 ${formatCny(spentBase)}，超上限 ${formatCny(costState.chapterCapCny)}，未发车`,
      { id: toastId },
    );
    return;
  }

  toast.loading(`正在重试「${input.name}」...`, { id: toastId });
  const result = await runScriptAssetMediaTask({
    row,
    visualManualId: input.visualManualId,
    projectId,
    chapterId,
  });
  const unpriced = !channel || (!channel.priced && !channel.isLocal);
  const outcome: ScriptAssetBatchRowOutcome =
    result.status === "success"
      ? {
          targetId,
          name: row.name,
          type: row.type,
          status: "success",
          statusLabel: ROW_STATUS_LABELS.success,
          channelLabel,
          costCny: price,
          unpriced,
          taskId: result.taskId,
        }
      : result.status === "skipped"
        ? {
            targetId,
            name: row.name,
            type: row.type,
            status: "skipped-reused",
            statusLabel: ROW_STATUS_LABELS["skipped-reused"],
            channelLabel,
            costCny: price,
            unpriced,
            taskId: result.taskId,
          }
        : {
            targetId,
            name: row.name,
            type: row.type,
            status: "failed",
            statusLabel: ROW_STATUS_LABELS.failed,
            errorReason: result.errorReason,
            channelLabel,
            costCny: price,
            unpriced,
            taskId: result.taskId,
          };
  useScriptAssetBatchStore.getState().patchReportRow(chapterId, outcome);
  if (result.status === "failed") {
    toast.error(`重试「${input.name}」失败：${result.errorReason ?? "未知错误"}`, { id: toastId });
  } else if (result.status === "skipped") {
    toast.info(`「${input.name}」已有在途/已成任务，已并入`, { id: toastId });
  } else {
    toast.success(`重试「${input.name}」成功`, { id: toastId });
  }
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, "0")}秒` : `${seconds}秒`;
}
