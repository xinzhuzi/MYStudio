/**
 * C2 全书提取控制面板(父任务 D14/D25;design §7)。
 *
 * 订阅口径:组件不复制 runner 状态——单一真源=useAssetsBookExtractionStore,
 * 由 refresh() 轮询 C1 台账(store/extraction/extraction-run.json,每章落盘)+
 * 单例在飞标记(isEntityExtractionInFlight)推导面板状态;D25 重启收口在读取
 * 侧统一(不在飞时 running/quota_wait 一律视作 paused,由用户点「继续」)。
 *
 * 模型只读显示取 runner 实际 resolve 链(entityExtraction → universalAi,镜像
 * createRunnerDeps.getResolvedModel);额度窗口(R7)显示「等待额度重置至 HH:MM」;
 * ETA=近 20 章成功耗时均值 × 剩余章数,quota_wait 时叠加等待时长(design §9)。
 * 失败清单点击 switchChapter 跳章(R3);运行中联动禁用单章提取按钮见
 * AssetsBatchCard(AC4,D12「仅锁提取相关按钮」)。
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  BookText,
  ChevronDown,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { StatusPill, type StatusPillState } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { aiManager } from "@/lib/ai/ai-manager";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import {
  createRunnerDeps,
  isEntityExtractionInFlight,
  pauseEntityExtraction,
  runEntityExtraction,
} from "@/lib/studio/entity-extraction-runner";
import {
  createElectronLedgerStorage,
  normalizeLedgerForStartup,
  readLedger,
  type ExtractionRunLedger,
  type ExtractionRunStatus,
} from "@/lib/studio/entity-extraction-ledger";
import { chapterNumberFromId } from "@/lib/studio/entity-appearances";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";

// ── 纯推导(测试锚) ─────────────────────────────────────────────────────────

export type BookExtractionStatus = "idle" | "running" | "paused" | "quota_wait" | "done";

export interface BookExtractionFailure {
  chapterId: string;
  error: string;
}

/** 台账状态 × 单例在飞标记 → 面板状态(D25:不在飞时 running/quota_wait 收口 paused)。 */
export function deriveBookExtractionStatus(
  ledgerStatus: ExtractionRunStatus | null,
  inFlight: boolean,
): BookExtractionStatus {
  if (!ledgerStatus) return inFlight ? "running" : "idle";
  if (inFlight) return ledgerStatus === "paused" ? "running" : ledgerStatus;
  return ledgerStatus === "running" || ledgerStatus === "quota_wait" ? "paused" : ledgerStatus;
}

/** ETA 样本窗口:近 20 章成功耗时(design §7)。 */
const ETA_RECENT_WINDOW = 20;

/**
 * ETA(design §7/§9):近 20 章成功耗时均值 × 剩余(pending/running)章数;
 * quota_wait 时叠加距重置时刻的等待时长;无样本或无剩余 → null。
 */
export function computeExtractionEtaMs(input: {
  chapters: Record<string, { state?: string; ms?: number }>;
  nowMs: number;
  quotaWaitResumeAt?: number | null;
}): number | null {
  const successMs = Object.entries(input.chapters)
    .filter(([, entry]) => entry.state === "success" && typeof entry.ms === "number" && entry.ms > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, entry]) => entry.ms as number);
  if (!successMs.length) return null;
  const remaining = Object.values(input.chapters).filter(
    (entry) => entry.state === "pending" || entry.state === "running",
  ).length;
  if (remaining === 0) return null;
  const recent = successMs.slice(-ETA_RECENT_WINDOW);
  const average = recent.reduce((sum, ms) => sum + ms, 0) / recent.length;
  let eta = average * remaining;
  if (input.quotaWaitResumeAt && input.quotaWaitResumeAt > input.nowMs) {
    eta += input.quotaWaitResumeAt - input.nowMs;
  }
  return Math.round(eta);
}

/** ETA 展示分档:秒/分钟/小时/天。 */
export function formatEtaMs(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  if (ms < 48 * 3_600_000) return `${(ms / 3_600_000).toFixed(1)} 小时`;
  return `${(ms / 86_400_000).toFixed(1)} 天`;
}

/** 额度窗口重置时刻(R7):恒 HH:MM(hourCycle h23,不随 locale 出 24 点)。 */
export function formatQuotaResetTime(resumeAt: number): string {
  return new Date(resumeAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** 模型只读显示:runner 实际 resolve 链(镜像 createRunnerDeps.getResolvedModel)。 */
export function resolveEntityExtractionModel(): string | null {
  return (
    aiManager.resolve({ agent: "entityExtraction" })?.model ??
    aiManager.resolve({ agent: "universalAi" })?.model ??
    null
  );
}

// ── 面板状态(单一订阅源;组件零本地复制) ──────────────────────────────────

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deriveBookExtractionPatch(
  ledger: ExtractionRunLedger | null,
  inFlight: boolean,
): {
  status: BookExtractionStatus;
  runId: string | null;
  model: string | null;
  range: [number, number] | null;
  resumeAt: number | null;
  etaMs: number | null;
  counts: { success: number; failed: number; skipped: number; pending: number };
  failures: BookExtractionFailure[];
} {
  if (!ledger) {
    return {
      status: inFlight ? "running" : "idle",
      runId: null,
      model: null,
      range: null,
      resumeAt: null,
      etaMs: null,
      counts: { success: 0, failed: 0, skipped: 0, pending: 0 },
      failures: [],
    };
  }
  const counts = { success: 0, failed: 0, skipped: 0, pending: 0 };
  const failures: BookExtractionFailure[] = [];
  for (const [chapterId, entry] of Object.entries(ledger.chapters)) {
    if (entry.state === "success") counts.success += 1;
    else if (entry.state === "failed") {
      counts.failed += 1;
      failures.push({ chapterId, error: entry.error ?? "未知错误" });
    } else if (entry.state === "skipped") counts.skipped += 1;
    else counts.pending += 1;
  }
  const quotaWaiting = ledger.status === "quota_wait" && inFlight;
  return {
    status: deriveBookExtractionStatus(ledger.status, inFlight),
    runId: ledger.runId,
    model: ledger.model,
    range: ledger.range,
    resumeAt: ledger.resumeAt,
    etaMs: computeExtractionEtaMs({
      chapters: ledger.chapters,
      nowMs: Date.now(),
      quotaWaitResumeAt: quotaWaiting ? ledger.resumeAt : null,
    }),
    counts,
    failures: failures.sort((left, right) =>
      chapterNumberFromId(left.chapterId) - chapterNumberFromId(right.chapterId),
    ),
  };
}

/** 台账轮询间隔:runner 每章落盘,2s 粒度足够 UI 刷新且 IPC 开销可忽略。 */
const BOOK_REFRESH_INTERVAL_MS = 2000;

export interface AssetsBookExtractionState {
  status: BookExtractionStatus;
  runId: string | null;
  model: string | null;
  range: [number, number] | null;
  counts: { success: number; failed: number; skipped: number; pending: number };
  resumeAt: number | null;
  etaMs: number | null;
  failures: BookExtractionFailure[];
  lastError: string | null;
  /** 读台账+在飞标记 → 同步面板状态(桥/项目缺失时静默保持现状)。 */
  refresh: (projectId?: string) => Promise<void>;
  /** 开始/继续/仅重跑失败/强制重提 的统一发车口(retryFailed/forceNew 区分)。 */
  start: (input: {
    projectId: string;
    projectName: string;
    range: [number, number];
    forceNew?: boolean;
    retryFailed?: boolean;
  }) => Promise<void>;
  /** 暂停当前 run(当前章完成后停;D14)。 */
  pause: () => void;
}

export const useAssetsBookExtractionStore = create<AssetsBookExtractionState>()((set, get) => ({
  status: "idle",
  runId: null,
  model: null,
  range: null,
  counts: { success: 0, failed: 0, skipped: 0, pending: 0 },
  resumeAt: null,
  etaMs: null,
  failures: [],
  lastError: null,

  refresh: async (projectId) => {
    const bridge = getProjectFilesBridge();
    if (!projectId || !bridge) return;
    try {
      const ledger = await readLedger(createElectronLedgerStorage(projectId, bridge));
      const inFlight = isEntityExtractionInFlight();
      // D25 重启收口:不在飞时 running/quota_wait 一律视作 paused(resumeAt 保留展示)
      const normalized = ledger && !inFlight ? normalizeLedgerForStartup(ledger) : ledger;
      set(deriveBookExtractionPatch(normalized, inFlight));
    } catch {
      // 台账读取失败不打断面板:保持现有状态,下一轮轮询再试
    }
  },

  start: async (input) => {
    if (isEntityExtractionInFlight()) {
      set({ lastError: "全书提取已在运行中(单例防重入;主跑与旁路互斥)" });
      return;
    }
    let deps: ReturnType<typeof createRunnerDeps>;
    try {
      deps = createRunnerDeps({
        projectId: input.projectId,
        projectName: input.projectName,
      });
    } catch (error) {
      set({ lastError: errorText(error) });
      return;
    }
    set({ status: "running", range: input.range, lastError: null });
    try {
      const summary = await runEntityExtraction(deps, {
        range: input.range,
        ...(input.forceNew ? { forceNew: true } : {}),
        ...(input.retryFailed ? { retryFailed: true } : {}),
      });
      // D26 漂移挂起:runner 以 paused+drift 返回,向用户点明换模型事实
      set(
        summary.drift
          ? {
              runId: summary.runId,
              status: summary.status,
              counts: summary.counts,
              lastError: `模型漂移:第 ${chapterNumberFromId(summary.drift.chapterId)} 章检测到 ${summary.drift.model},已暂停(确要换模型请「强制重提」)`,
            }
          : { runId: summary.runId, status: summary.status, counts: summary.counts },
      );
    } catch (error) {
      set({ lastError: errorText(error) });
    }
    await get().refresh(input.projectId);
  },

  pause: () => {
    if (!pauseEntityExtraction()) {
      set({ lastError: "没有正在运行的全书提取,无需暂停" });
    }
  },
}));

// ── 组件 ────────────────────────────────────────────────────────────────────

const STATUS_VIEW: Record<
  BookExtractionStatus,
  { pill: StatusPillState; label: string }
> = {
  idle: { pill: "unknown", label: "未开始" },
  running: { pill: "checking", label: "运行中" },
  paused: { pill: "unknown", label: "已暂停" },
  quota_wait: { pill: "unknown", label: "等待额度" },
  done: { pill: "ready", label: "已完成" },
};

export function AssetsBookExtractionCard({ totalChapters }: { totalChapters: number }) {
  const status = useAssetsBookExtractionStore((state) => state.status);
  const ledgerModel = useAssetsBookExtractionStore((state) => state.model);
  const range = useAssetsBookExtractionStore((state) => state.range);
  const counts = useAssetsBookExtractionStore((state) => state.counts);
  const resumeAt = useAssetsBookExtractionStore((state) => state.resumeAt);
  const etaMs = useAssetsBookExtractionStore((state) => state.etaMs);
  const failures = useAssetsBookExtractionStore((state) => state.failures);
  const lastError = useAssetsBookExtractionStore((state) => state.lastError);
  const start = useAssetsBookExtractionStore((state) => state.start);
  const pause = useAssetsBookExtractionStore((state) => state.pause);
  const refresh = useAssetsBookExtractionStore((state) => state.refresh);

  const projectId = useProjectStore((state) => state.activeProjectId);
  const projectName = useProjectStore((state) => state.activeProject?.name) ?? "漫影工作室项目";
  const switchChapter = useStudioStore((state) => state.switchChapter);

  // 轮询订阅:挂载即读一次(App 重启后恢复 paused 视图),运行期每 2s 刷
  useEffect(() => {
    void refresh(projectId ?? undefined);
    const timer = window.setInterval(() => {
      void refresh(projectId ?? undefined);
    }, BOOK_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, refresh]);

  const [open, setOpen] = useState(true);
  // 起止章为表单草稿(非 runner 状态);台账 range 优先用于继续/重试
  const [startDraft, setStartDraft] = useState("1");
  const [endDraft, setEndDraft] = useState(String(Math.max(1, totalChapters)));

  const busy = status === "running" || status === "quota_wait";
  const startNum = Number.parseInt(startDraft, 10);
  const endNum = Number.parseInt(endDraft, 10);
  const draftRangeValid =
    Number.isInteger(startNum) &&
    Number.isInteger(endNum) &&
    startNum >= 1 &&
    endNum >= startNum &&
    endNum <= totalChapters;
  const activeRange: [number, number] | null =
    range ?? (draftRangeValid ? [startNum, endNum] : null);

  const launch = (options: { forceNew?: boolean; retryFailed?: boolean } = {}) => {
    if (!projectId || !draftRangeValid) return;
    void start({ projectId, projectName, range: [startNum, endNum], ...options });
  };
  const relaunch = (options: { forceNew?: boolean; retryFailed?: boolean } = {}) => {
    if (!projectId || !activeRange) return;
    void start({ projectId, projectName, range: activeRange, ...options });
  };

  const modelLabel = ledgerModel ?? resolveEntityExtractionModel();
  const total = activeRange ? activeRange[1] - activeRange[0] + 1 : 0;
  const processed = counts.success + counts.failed + counts.skipped;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const statusView = STATUS_VIEW[status];

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 items-center gap-2 rounded-md text-left"
        >
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")}
          />
          <BookText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">全书提取</span>
          <span className="text-xs text-muted-foreground">
            逐章提取角色/场景/道具并入三库,断点续跑
          </span>
        </button>
        <StatusPill state={statusView.pill} label={statusView.label} />
      </div>

      {open ? (
        <div className="space-y-4 border-t border-border/70 px-4 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="book-extraction-start">起始章</Label>
              <Input
                id="book-extraction-start"
                type="number"
                min={1}
                max={totalChapters}
                className="h-8 w-24 font-mono"
                value={startDraft}
                disabled={busy}
                onChange={(event) => setStartDraft(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="book-extraction-end">结束章</Label>
              <Input
                id="book-extraction-end"
                type="number"
                min={1}
                max={totalChapters}
                className="h-8 w-24 font-mono"
                value={endDraft}
                disabled={busy}
                onChange={(event) => setEndDraft(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>模型(只读)</Label>
              <p className="flex h-8 items-center font-mono text-sm text-foreground/90">
                {modelLabel ?? "未配置"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={status !== "idle" || !draftRangeValid}
              onClick={() => launch()}
            >
              <Play className="h-4 w-4" />
              开始提取
            </Button>
            <Button size="sm" disabled={!busy} onClick={pause}>
              <Pause className="h-4 w-4" />
              暂停
            </Button>
            <Button size="sm" disabled={status !== "paused"} onClick={() => relaunch()}>
              <Play className="h-4 w-4" />
              继续
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={status !== "paused" && status !== "done"}
              onClick={() => relaunch({ retryFailed: true })}
            >
              <RotateCcw className="h-4 w-4" />
              仅重跑失败
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={status !== "paused" && status !== "done"}
              onClick={() => relaunch({ forceNew: true })}
            >
              <RefreshCw className="h-4 w-4" />
              强制重提
            </Button>
          </div>

          {status !== "idle" ? (
            <div className="space-y-2">
              {/* ui/progress 包装层不把 value 透传给 Radix Root,aria-valuenow 需自带 */}
              <Progress value={progressPct} aria-valuenow={progressPct} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="text-success">成功 {counts.success}</span>
                <span className="text-destructive/90">失败 {counts.failed}</span>
                <span>跳过 {counts.skipped}</span>
                <span>剩余 {counts.pending}</span>
                {etaMs !== null ? (
                  <>
                    <span>预计剩余</span>
                    <span className="font-mono text-foreground/80">
                      {formatEtaMs(etaMs)}
                    </span>
                  </>
                ) : null}
              </div>
              {status === "quota_wait" && resumeAt !== null ? (
                <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
                  等待额度重置至 {formatQuotaResetTime(resumeAt)}(到点自动续跑,不计失败)
                </p>
              ) : null}
              {lastError ? (
                <p className="text-xs text-destructive/90">{lastError}</p>
              ) : null}
            </div>
          ) : lastError ? (
            <p className="text-xs text-destructive/90">{lastError}</p>
          ) : null}

          {failures.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/80">
                失败清单(点击跳章,可在章内重试)
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {failures.map((failure) => (
                  <Button
                    key={failure.chapterId}
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start gap-2 px-2 py-1 text-left text-xs"
                    onClick={() => {
                      void switchChapter(failure.chapterId);
                    }}
                  >
                    <span className="font-mono">
                      第 {chapterNumberFromId(failure.chapterId)} 章
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {failure.error}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
