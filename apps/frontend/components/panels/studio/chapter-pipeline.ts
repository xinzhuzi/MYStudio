/**
 * 章级流水线编排(10-11 pipeline-human-node-automation 批5,design §2.6,
 * G10/G9):useChapterPipelineOrchestrator(hook,见 useChapterPipelineOrchestrator.ts)
 * 的执行核心——串 [资产生成(批2)] → [衍生闭环(批3)] → [分镜绑定(批4)] → 章验收卡。
 *
 * 关键口径:
 * - 步间门=上步全 terminal:双信号——①子编排的批次态 store 不在 running
 *   (防「并入在途批次后,在途循环还要派下一张」的门提前竞态);②该步 kind
 *   的本章媒体任务全部 terminal(succeeded/failed/canceled);超时
 *   (默认 90min,D3 本地最坏链预算)不死锁,标记后继续(失败不阻塞精神);
 * - failed 不阻塞走例外:失败任务进验收卡例外口径,后续步照跑;
 * - 断点续跑(G9 落盘):编排状态=任务聚合视图(mediaTasks 本就落盘);
 *   App 重启后 recomputeChapterPipelineAggregate 重算聚合卡,不重发已
 *   terminal 任务;重启前残留的 queued/running 任务(执行体已随进程消亡)
 *   首次重算时收口为 failed(禁永久 running 假活),重跑由各层幂等跳过
 *   已成产物(同指纹 succeeded 复用/已有图跳过/已绑镜跳过);
 * - 章验收卡双落位:本模块只产卡(聚合纯函数),落位=任务中心 orb 终态
 *   收据(use-task-center pipeline 域)+ 分镜面板横幅(ChapterAcceptanceBanner);
 * - 批6 失效传播接入:发车前盖戳章剧本指纹(发车指纹台账),漂移的已终态
 *   下游任务进卡 staleCount(chapter-pipeline-stale 派生视图)。
 */
import { toast } from "sonner";
import { create } from "zustand";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { MediaGenerationTask } from "@/types/studio";
import { runChapterScriptAssetGeneration } from "./script-asset-batch";
import { runDerivedAssetChain } from "./derived-asset-chain";
import {
  collectStaleDownstreamTasksFromStore,
  computeChapterScriptFingerprint,
  currentScriptFingerprintSnapshot,
  DOWNSTREAM_TASK_KINDS,
  useChapterUpstreamStore,
} from "./chapter-pipeline-stale";
import {
  runStoryboardAssetBinding,
  storyboardHasVisual,
  useStoryboardBindingStore,
} from "./storyboard-asset-binding";
import { useDerivedChainStore } from "./derived-asset-chain";
import { useScriptAssetBatchStore } from "./script-asset-batch";

// ── 步定义与门信号 ─────────────────────────────────────────────────────────

export type ChapterPipelineStepKey = "assets" | "derived" | "storyboardBinding";

export const CHAPTER_PIPELINE_STEPS: ReadonlyArray<{
  key: ChapterPipelineStepKey;
  label: string;
  /** 步间门监听的媒体任务 kind(该步发车的任务族)。 */
  kinds: readonly string[];
  /** 子编排批次态 store 的本章运行态(并入在途批次的门信号①)。 */
  runStatusOf: (chapterId: string) => "running" | "done" | undefined;
}> = [
  {
    key: "assets",
    label: "资产生成",
    kinds: ["scriptAsset"],
    runStatusOf: (chapterId) =>
      useScriptAssetBatchStore.getState().runsByChapter[chapterId]?.status,
  },
  {
    key: "derived",
    label: "衍生闭环",
    kinds: ["derivedAssetImage"],
    runStatusOf: (chapterId) =>
      useDerivedChainStore.getState().runsByChapter[chapterId]?.status,
  },
  {
    key: "storyboardBinding",
    label: "分镜绑定",
    kinds: ["storyboardImage"],
    runStatusOf: (chapterId) =>
      useStoryboardBindingStore.getState().runsByChapter[chapterId]?.status,
  },
];

/** D3 时序预算:本地 24 张最坏 ≈65min;步间门超时取 90min 裕量,超时不死锁。 */
export const CHAPTER_PIPELINE_GATE_TIMEOUT_MS = 90 * 60 * 1000;

export interface ChapterStepGateOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export interface ChapterStepGateResult {
  settled: boolean;
  timedOut: boolean;
  /** 超时时尚未 terminal 的任务数(诊断口径)。 */
  pendingCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 步间门:等待「子批次不在途 + 本章该步 kind 任务全 terminal」。
 * 不抛异常;超时返回 timedOut(调用方记录后继续,编排不死锁)。
 */
export async function waitChapterStepSettled(
  chapterId: string,
  stepKey: ChapterPipelineStepKey,
  options: ChapterStepGateOptions = {},
): Promise<ChapterStepGateResult> {
  const step = CHAPTER_PIPELINE_STEPS.find((item) => item.key === stepKey);
  if (!step) return { settled: true, timedOut: false, pendingCount: 0 };
  const pollMs = Math.max(options.pollMs ?? 500, 1);
  const timeoutMs = options.timeoutMs ?? CHAPTER_PIPELINE_GATE_TIMEOUT_MS;
  const startedAt = Date.now();
  for (;;) {
    const runStatus = step.runStatusOf(chapterId);
    const pending = useStudioStore.getState().mediaTasks.filter(
      (task) =>
        task.episodeId === chapterId &&
        step.kinds.includes(task.kind) &&
        (task.status === "queued" || task.status === "running"),
    ).length;
    if (runStatus !== "running" && pending === 0) {
      return { settled: true, timedOut: false, pendingCount: 0 };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { settled: false, timedOut: true, pendingCount: pending };
    }
    await sleep(pollMs);
  }
}

// ── 章验收卡(聚合纯函数:任务台账+分镜现势+绑定例外+stale 派生) ─────────────

export interface ChapterAcceptanceCard {
  chapterId: string;
  generatedAt: number;
  /** true=App 重启后重算的聚合卡(无新发车;耗时/成本不编造)。 */
  recomputed: boolean;
  assets: {
    total: number;
    success: number;
    failed: number;
    /** 最新态仍失败的目标(点击直达资产页处理)。 */
    failedNames: string[];
  };
  derived: {
    total: number;
    success: number;
    failed: number;
    failedNames: string[];
  };
  storyboard: {
    totalShots: number;
    ready: number;
    unbound: number;
    /** 绑定例外清单条数(多义/零命中/缺图/绑定失败)。 */
    exceptions: number;
  };
  /** 批6:上游剧本已变更,已终态下游任务数(禁静默用旧)。 */
  staleCount: number;
  staleSampleTargetIds: string[];
  /** 会话内报表可得时给;重启重算不编造。 */
  durationMs?: number;
  spentCny?: number;
}

/** 每 targetId 取最新任务(台账追加序=时间序;retry 链最新者为准)。 */
function latestTaskPerTarget(tasks: MediaGenerationTask[]): Map<string, MediaGenerationTask> {
  const latest = new Map<string, MediaGenerationTask>();
  for (const task of tasks) latest.set(task.targetId, task);
  return latest;
}

function summarizeTaskFamily(
  tasks: MediaGenerationTask[],
): { total: number; success: number; failed: number; failedNames: string[] } {
  let success = 0;
  let failed = 0;
  const failedNames: string[] = [];
  for (const task of latestTaskPerTarget(tasks).values()) {
    if (task.status === "success") success += 1;
    else if (task.status === "failed") {
      failed += 1;
      failedNames.push(task.targetId);
    }
  }
  return { total: success + failed, success, failed, failedNames };
}

export function buildChapterAcceptanceCard(
  chapterId: string,
  extra: { recomputed?: boolean; durationMs?: number } = {},
): ChapterAcceptanceCard {
  const state = useStudioStore.getState();
  const chapterTasks = state.mediaTasks.filter((task) => task.episodeId === chapterId);
  const assets = summarizeTaskFamily(
    chapterTasks.filter((task) => task.kind === "scriptAsset"),
  );
  const derived = summarizeTaskFamily(
    chapterTasks.filter((task) => task.kind === "derivedAssetImage"),
  );
  const shots = state.storyboards.filter((item) => item.episodeId === chapterId);
  const ready = shots.filter((shot) => storyboardHasVisual(shot)).length;
  const exceptions =
    useStoryboardBindingStore.getState().runsByChapter[chapterId]?.report?.exceptions.length ?? 0;
  const stale = collectStaleDownstreamTasksFromStore(chapterId);
  // 成本=批2 报表 + 批3 报表(批3 的 spentCny 已剔除批2 基线);重启后报表
  // 不在(非持久),不编造——undefined
  const batchReport =
    useScriptAssetBatchStore.getState().runsByChapter[chapterId]?.report;
  const chainReport =
    useDerivedChainStore.getState().runsByChapter[chapterId]?.report;
  const spentCny =
    batchReport || chainReport
      ? (batchReport?.spentCny ?? 0) + (chainReport?.spentCny ?? 0)
      : undefined;
  return {
    chapterId,
    generatedAt: Date.now(),
    recomputed: Boolean(extra.recomputed),
    assets,
    derived,
    storyboard: {
      totalShots: shots.length,
      ready,
      unbound: shots.length - ready,
      exceptions,
    },
    staleCount: stale.length,
    staleSampleTargetIds: stale.slice(0, 8).map((item) => item.targetId),
    durationMs: extra.durationMs,
    spentCny,
  };
}

/** 全绿=验收卡横幅消失的条件(G10:有未绑/stale/失败常驻,全绿消失)。 */
export function chapterAcceptanceAllGreen(card: ChapterAcceptanceCard): boolean {
  return (
    card.assets.failed === 0 &&
    card.derived.failed === 0 &&
    card.storyboard.exceptions === 0 &&
    card.staleCount === 0 &&
    card.storyboard.totalShots > 0 &&
    card.storyboard.unbound === 0
  );
}

/** 收据/横幅共用的一句话汇总(orb 终态收据 + toast 单一收口同文)。 */
export function chapterAcceptanceSummary(card: ChapterAcceptanceCard): string {
  const parts = [
    `资产 ${card.assets.success}/${card.assets.total || 0}`,
    `衍生 ${card.derived.success}/${card.derived.total || 0}`,
    `分镜 ${card.storyboard.ready}/${card.storyboard.totalShots}`,
  ];
  if (card.staleCount) parts.push(`过期 ${card.staleCount}`);
  return `章流水线：${parts.join(" · ")}`;
}

// ── 编排批次态(zustand 非持久:过程视图;聚合真源=mediaTasks 落盘) ────────────

export type ChapterPipelineStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "failed";

export interface ChapterPipelineStepView {
  key: ChapterPipelineStepKey;
  label: string;
  status: ChapterPipelineStepStatus;
  note?: string;
}

export interface ChapterPipelineRunView {
  chapterId: string;
  status: "running" | "done";
  steps: ChapterPipelineStepView[];
  startedAt?: number;
  finishedAt?: number;
  card?: ChapterAcceptanceCard;
  /** true=重启重算聚合(无发车过程,steps 由聚合卡反推)。 */
  recomputed?: boolean;
}

interface ChapterPipelineState {
  runsByChapter: Record<string, ChapterPipelineRunView>;
  /** 本会话是否已做过僵尸任务收口(App 重启后仅首次重算做,防误伤在途)。 */
  zombieReconciled: boolean;
  startRun: (chapterId: string) => void;
  patchStep: (
    chapterId: string,
    step: ChapterPipelineStepKey,
    patch: Partial<Omit<ChapterPipelineStepView, "key" | "label">>,
  ) => void;
  finishRun: (chapterId: string, card: ChapterAcceptanceCard) => void;
  setRecomputed: (chapterId: string, card: ChapterAcceptanceCard) => void;
  clearRun: (chapterId: string) => void;
}

function freshSteps(): ChapterPipelineStepView[] {
  return CHAPTER_PIPELINE_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    status: "pending" as const,
  }));
}

export const useChapterPipelineStore = create<ChapterPipelineState>()((set) => ({
  runsByChapter: {},
  zombieReconciled: false,
  startRun: (chapterId) =>
    set((state) => ({
      runsByChapter: {
        ...state.runsByChapter,
        [chapterId]: {
          chapterId,
          status: "running",
          steps: freshSteps(),
          startedAt: Date.now(),
        },
      },
    })),
  patchStep: (chapterId, step, patch) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      if (!run) return state;
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...run,
            steps: run.steps.map((item) =>
              item.key === step ? { ...item, ...patch } : item,
            ),
          },
        },
      };
    }),
  finishRun: (chapterId, card) =>
    set((state) => {
      const run = state.runsByChapter[chapterId];
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            ...(run ?? {
              chapterId,
              status: "running" as const,
              steps: freshSteps(),
              startedAt: card.generatedAt,
            }),
            status: "done",
            card,
            finishedAt: Date.now(),
          },
        },
      };
    }),
  setRecomputed: (chapterId, card) =>
    set((state) => {
      const existing = state.runsByChapter[chapterId];
      if (existing?.status === "running") return state; // 不碰在途
      return {
        runsByChapter: {
          ...state.runsByChapter,
          [chapterId]: {
            chapterId,
            status: "done",
            recomputed: true,
            card,
            steps: stepsFromCard(card),
            finishedAt: card.generatedAt,
          },
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

/** 重启重算的 steps 反推(聚合卡 → 步骤级 done/skipped,过程态不编造)。 */
function stepsFromCard(card: ChapterAcceptanceCard): ChapterPipelineStepView[] {
  return CHAPTER_PIPELINE_STEPS.map((step) => {
    if (step.key === "assets") {
      return {
        key: step.key,
        label: step.label,
        status: card.assets.total > 0 ? ("done" as const) : ("skipped" as const),
      };
    }
    if (step.key === "derived") {
      return {
        key: step.key,
        label: step.label,
        status: card.derived.total > 0 ? ("done" as const) : ("skipped" as const),
      };
    }
    return {
      key: step.key,
      label: step.label,
      status:
        card.storyboard.totalShots > 0 && card.storyboard.ready > 0
          ? ("done" as const)
          : ("skipped" as const),
    };
  });
}

// ── 断点续跑:僵尸任务收口 + 重算聚合(不重发) ────────────────────────────────

/** 会话启动时间戳(bundle 装载时刻):早于它的在途任务=重启残留,执行体已死。 */
const SESSION_STARTED_AT = Date.now();

/**
 * App 重启后的僵尸任务收口:本会话首次重算时,把**会话启动前**残留的
 * queued/running 下游任务标 failed(执行体已随进程消亡,禁永久 running
 * 假活;G9 台账可续,重跑由各层幂等跳过已成产物)。双防线:
 * ①本会话仅首次(会话内新发的在途任务不动);②updatedAt<会话启动
 * (即使首次收口撞上会话内已开跑的批次,也不误伤)。
 */
export function reconcileZombieRunningTasks(chapterId: string): number {
  const store = useChapterPipelineStore.getState();
  if (store.zombieReconciled) return 0;
  useChapterPipelineStore.setState({ zombieReconciled: true });
  const state = useStudioStore.getState();
  const zombies = state.mediaTasks.filter(
    (task) =>
      task.episodeId === chapterId &&
      (DOWNSTREAM_TASK_KINDS as readonly string[]).includes(task.kind) &&
      (task.status === "queued" || task.status === "running") &&
      (task.updatedAt ?? task.createdAt) < SESSION_STARTED_AT,
  );
  for (const task of zombies) {
    state.failMediaTask(
      task.id,
      "App 重启中断，任务未收口（重跑章流水线可从断点续跑）",
      task.checkpointRef,
    );
  }
  return zombies.length;
}

/**
 * 重启恢复入口:重算本章聚合卡(任务台账+分镜现势+stale 派生),**不重发**
 * 任何已 terminal 任务;残留僵尸任务收口为 failed。在途编排不碰。
 */
export function recomputeChapterPipelineAggregate(chapterId: string): ChapterAcceptanceCard {
  reconcileZombieRunningTasks(chapterId);
  const card = buildChapterAcceptanceCard(chapterId, { recomputed: true });
  useChapterPipelineStore.getState().setRecomputed(chapterId, card);
  return card;
}

// ── 章级编排入口 ─────────────────────────────────────────────────────────────

export interface RunChapterPipelineInput {
  chapterId: string;
  projectId: string | null;
  visualManualId: string | undefined;
  /** 测试注入:替换三步执行体(缺省=真实批2/批3/批4 入口)。 */
  steps?: Partial<Record<ChapterPipelineStepKey, (input: RunChapterPipelineInput) => Promise<unknown>>>;
  /** 步间门参数(测试用)。 */
  gate?: ChapterStepGateOptions;
}

const DEFAULT_STEP_RUNNERS: Record<
  ChapterPipelineStepKey,
  (input: RunChapterPipelineInput) => Promise<unknown>
> = {
  assets: (input) => runChapterScriptAssetGeneration(input),
  derived: (input) => runDerivedAssetChain(input),
  storyboardBinding: (input) => runStoryboardAssetBinding(input),
};

/**
 * 章级流水线编排:串 资产生成 → 衍生闭环 → 分镜绑定 → 章验收卡。
 * 防重入(同章在途并入提示);failed 不阻塞走例外;返回终态聚合卡
 * (前置整体不可跑时各步自行可见提示,卡仍产出——聚合不撒谎)。
 */
export async function runChapterPipeline(
  input: RunChapterPipelineInput,
): Promise<ChapterAcceptanceCard> {
  const { chapterId } = input;
  const pipelineStore = useChapterPipelineStore.getState();
  const running = pipelineStore.runsByChapter[chapterId];
  if (running?.status === "running") {
    toast.info("章流水线进行中，已并入在途编排（当前步跑完自动进下一步）");
    return buildChapterAcceptanceCard(chapterId);
  }

  // 批6 发车盖戳:本章下游任务在此剧本指纹下发车;此后剧本变更→stale 派生可见
  useChapterUpstreamStore
    .getState()
    .recordDispatch(
      chapterId,
      computeChapterScriptFingerprint(chapterId, currentScriptFingerprintSnapshot()),
    );

  const runners = { ...DEFAULT_STEP_RUNNERS, ...input.steps };
  const toastId = `chapter-pipeline:${chapterId}`;
  // 僵尸收口(重启残留 running 任务会卡死步间门;首调防线见函数注释)
  reconcileZombieRunningTasks(chapterId);
  useChapterPipelineStore.getState().startRun(chapterId);
  const startedAt = Date.now();
  toast.loading("章流水线发车：资产生成 → 衍生闭环 → 分镜绑定", { id: toastId });

  for (const step of CHAPTER_PIPELINE_STEPS) {
    useChapterPipelineStore.getState().patchStep(chapterId, step.key, {
      status: "running",
      note: undefined,
    });
    // ── 发步(子编排自带防重入/失败收口/可见提示;返回 report=跑了新批,
    //    null=并入在途/前置不满足/无可跑行,由返回值+门后子批次态判读) ──
    let dispatched: unknown = null;
    try {
      dispatched = await runners[step.key](input);
    } catch (error) {
      // 子编排不应抛(各自兜底);此处兜编排层意外——步标 failed 不阻塞后续步
      const message = error instanceof Error ? error.message : String(error);
      useChapterPipelineStore.getState().patchStep(chapterId, step.key, {
        status: "failed",
        note: message,
      });
      continue;
    }
    // ── 步间门:上步全 terminal 才进下步(双信号,见 waitChapterStepSettled) ──
    const gate = await waitChapterStepSettled(chapterId, step.key, input.gate);
    let status: ChapterPipelineStepStatus;
    let note: string | undefined;
    if (gate.timedOut) {
      status = "failed";
      note = `等待超时：仍有 ${gate.pendingCount} 个任务未收口（已继续后续步骤）`;
    } else if (dispatched === null || dispatched === undefined) {
      // 未跑新批:null 返回 + 门后子批次 done=并入的在途批已等完(计 done);
      // 其余=前置不满足/无可跑行(计 skipped,子编排已 toast 可见原因)
      status = step.runStatusOf(chapterId) === "done" ? "done" : "skipped";
      if (status === "skipped") note = "前置不满足或无可跑行（详见提示）";
    } else {
      status = "done";
    }
    useChapterPipelineStore.getState().patchStep(chapterId, step.key, { status, note });
  }

  const card = buildChapterAcceptanceCard(chapterId, {
    durationMs: Date.now() - startedAt,
  });
  useChapterPipelineStore.getState().finishRun(chapterId, card);

  const descriptionParts = [
    card.durationMs != null ? `耗时 ${Math.round(card.durationMs / 1000)}s` : null,
    card.spentCny != null ? `成本 ¥${card.spentCny}` : null,
    card.staleCount ? `⚠ ${card.staleCount} 项产物基于旧剧本（已标过期）` : null,
    card.assets.failed ? `资产失败：${card.assets.failedNames.join("、")}` : null,
    card.derived.failed ? `衍生失败：${card.derived.failedNames.join("、")}` : null,
  ].filter(Boolean);
  const hasProblems =
    card.assets.failed > 0 ||
    card.derived.failed > 0 ||
    card.storyboard.exceptions > 0 ||
    card.staleCount > 0 ||
    card.storyboard.unbound > 0;
  if (hasProblems) {
    toast.warning(chapterAcceptanceSummary(card), {
      id: toastId,
      description: descriptionParts.join("\n") || undefined,
    });
  } else {
    toast.success(chapterAcceptanceSummary(card), {
      id: toastId,
      description: descriptionParts.join("\n") || undefined,
    });
  }
  return card;
}
