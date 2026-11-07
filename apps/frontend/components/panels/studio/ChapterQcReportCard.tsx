"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isFeatureReady } from "@/lib/ai/feature-router";
import { callFeatureMultimodalAPI } from "@/lib/ai/feature-router";
import { runSemanticQcLayer } from "@/lib/studio/qc/semantic-runner";
import {
  runVisionPreflight,
  type VisionPreflightDecisionInput,
  type VisionPreflightFrameInput,
} from "@/lib/studio/qc/vision-preflight-runner";
import {
  CHAPTER_QC_DIMENSIONS,
  CHAPTER_QC_EVALUATOR_LABELS,
  groupDimensionsByCategory,
} from "@rendering/plugins/videoqc/chapter-qc-registry";
import type {
  ChapterQcDimensionCategory,
  ChapterQcEvaluatorKind,
} from "@rendering/plugins/videoqc/chapter-qc-types";
import { QC_CALIBRATION_MIN_RED_CASES, QC_CALIBRATION_MIN_SAMPLES } from "@rendering/plugins/videoqc/chapter-qc-types";

interface ChapterQcFinding {
  code: string;
  layer: string;
  severity: "blocker" | "warn" | "info";
  shotId?: string;
  shotOrdinal?: number;
  message: string;
}

interface ChapterQcRequirement {
  requirementId: string;
  label: string;
  verdict: "pass" | "fail" | "unverified";
  evidenceCodes: string[];
  missing?: string[];
  note?: string;
  category?: ChapterQcDimensionCategory;
  evaluator?: ChapterQcEvaluatorKind;
  weight?: number;
  failingShotOrdinals?: number[];
}

interface ChapterQcHumanReview {
  fullWatched: boolean;
  audioListened: boolean;
  reviewer: string;
  at: number;
  notes?: string;
}

interface ChapterQcReport {
  schemaVersion: number;
  projectId: string;
  chapterId: string;
  createdAt: number;
  durationS?: number;
  shotCount?: number;
  layers: Record<string, { status: string; reason?: string }>;
  findings: ChapterQcFinding[];
  summary: { blockers: number; warns: number; infos: number };
  /** 本轮取证口径与退化留痕(编排器写;三态板说不出「证据是怎么来的」,靠这几条) */
  notes?: string[];
  shots?: Array<{ shotId: string; ordinal: number; frameUrl: string; description?: string }>;
  semantic?: { checked: number; passed: number; failed: number; skipped: number; model?: string };
  vision?: {
    frameCount: number;
    frames: VisionPreflightFrameInput[];
    decisions: VisionPreflightDecisionInput[];
    densityChecked: number;
    frameErrors: number;
    preflight?: {
      checked: number;
      passed: number;
      failed: number;
      skipped: number;
      model?: string;
      finishedAt: number;
    };
  };
  requirements?: ChapterQcRequirement[];
  /** 骨干③:加权维度分(pass 才计分;不影响放行口径) */
  dimensionScore?: { score: number; weightTotal: number; weightPassed: number; deducted: Array<{ requirementId: string; weight: number; reason: "unverified" | "fail" }> };
  /** 骨干⓪:供给完整性自检 */
  supplyChecks?: { checks: Array<{ checkId: string; label: string; verdict: "ok" | "gap" | "blocked"; detail?: string }>; gaps: number; blocked: number };
  /** 骨干②:逐镜期望断言集 */
  expectations?: {
    shots: Array<{ shotId: string; ordinal: number; assertions: Record<string, string> }>;
    coverage: Array<{ key: string; expected: number; forbidden: number; unknown: number }>;
  };
  /** 骨干③:参与本轮判定的信号基线 + 打标金标逐行召回账 */
  calibration?: {
    seriesId: string;
    caseCount: number;
    baselines: Array<{ signalId: string; mean: number; sigma: number; sampleCount: number; seriesSampleCount?: number }>;
    caseScores?: Array<{ requirementId: string; greenTotal: number; greenPassed: number; redTotal: number; redCaught: number }>;
  };
  humanReview?: ChapterQcHumanReview;
}

interface ChapterQcBridge {
  getReport: (payload: { projectId: string; chapterId: string }) => Promise<ChapterQcReport | null>;
  run: (payload: { projectId: string; chapterId: string }) => Promise<{ success: boolean; message?: string; report?: ChapterQcReport }>;
  submitSemantic: (payload: {
    projectId: string;
    chapterId: string;
    model?: string;
    stats: { checked: number; passed: number; failed: number; skipped: number };
    findings: unknown[];
  }) => Promise<{ success: boolean; message?: string }>;
  submitVisionPreflight: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    model?: string;
    stats: { checked: number; passed: number; failed: number; skipped: number };
    findings: unknown[];
  }) => Promise<{ success: boolean; message?: string }>;
  /** 人工复核回写:勾选只看主进程派生三态,不在渲染端算 verdict。 */
  submitHumanReview?: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    fullWatched: boolean;
    audioListened: boolean;
    reviewer: string;
    notes?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  /**
   * 逐行打标金标:渲染端只答「这行盯的问题,这片子里到底有没有」(red/green)。
   * 机器判定那半边由主进程从这份报告抄,所以这里不上报 verdict——渲染端说的不算。
   */
  submitCalibrationCase?: (payload: {
    projectId: string;
    chapterId: string;
    expectedCreatedAt: number;
    requirementId: string;
    label: "red" | "green";
    note?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  onReportUpdated: (listener: (payload: { projectId: string; chapterId: string }) => void) => () => void;
}

declare global {
  interface Window {
    chapterQc?: ChapterQcBridge;
  }
}

const LAYER_LABELS: Array<{ id: string; label: string }> = [
  { id: "structural", label: "结构比对" },
  { id: "ffmpegScan", label: "逐帧扫描" },
  { id: "aesthetic", label: "观感评分" },
  { id: "semantic", label: "语义核对" },
];

/**
 * 成片 QC 体检单(08-19-chapter-video-qc)。
 * semantic=pending 且图片理解 binding 可用时自动跑 L4(渲染端),跑完回写主进程。
 * vision 物料齐全时自动跑 AC4 审片预审；结果仅供人工确认前参考。
 */
export function ChapterQcReportCard(props: { projectId?: string; chapterId: string }) {
  const [report, setReport] = useState<ChapterQcReport | null>(null);
  const [running, setRunning] = useState(false);
  const [semanticRunning, setSemanticRunning] = useState(false);
  const [visionRunning, setVisionRunning] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [caseBusy, setCaseBusy] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [fullWatched, setFullWatched] = useState(false);
  const [audioListened, setAudioListened] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const reviewIds = useId();
  const bridge = typeof window !== "undefined" ? window.chapterQc : undefined;
  const semanticStartedFor = useRef<string | null>(null);
  const visionStartedFor = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const activeScopeRef = useRef("");
  const activeReportKeyRef = useRef("");
  const imageUnderstandingReady = isFeatureReady("image_understanding");
  const activeScope = `${props.projectId ?? ""}:${props.chapterId}`;
  const activeReportKey = `${activeScope}:${report?.createdAt ?? "none"}`;
  activeScopeRef.current = activeScope;
  activeReportKeyRef.current = activeReportKey;

  const load = useCallback(async () => {
    if (!bridge || !props.projectId) return;
    const projectId = props.projectId;
    const chapterId = props.chapterId;
    const requestedScope = `${projectId}:${chapterId}`;
    try {
      const nextReport = await bridge.getReport({ projectId, chapterId });
      if (mountedRef.current && activeScopeRef.current === requestedScope) setReport(nextReport);
    } catch {
      // 报告读取失败保持空态
    }
  }, [bridge, props.projectId, props.chapterId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void load();
    if (!bridge?.onReportUpdated) return;
    const unsubscribe = bridge.onReportUpdated((payload) => {
      if (payload.projectId === props.projectId && payload.chapterId === props.chapterId) void load();
    });
    return unsubscribe;
  }, [load, bridge, props.projectId, props.chapterId]);

  useEffect(() => {
    setVisionRunning(false);
    setVisionError(null);
    setReviewError(null);
  }, [activeReportKey]);

  // 复核勾选只在报告版本切换时对齐报告;同一份报告的回写不清空正在填的表单。
  const reviewSyncedFor = useRef("");
  useEffect(() => {
    const review = report?.humanReview;
    const key = report ? `${report.projectId}:${report.chapterId}:${report.createdAt}` : "";
    if (!key || reviewSyncedFor.current === key) return;
    reviewSyncedFor.current = key;
    setFullWatched(review?.fullWatched ?? false);
    setAudioListened(review?.audioListened ?? false);
    setReviewerName((current) => current || review?.reviewer || "");
  }, [report]);

  const runSemantic = useCallback(async (current: ChapterQcReport) => {
    if (!bridge || !props.projectId || semanticRunning) return;
    const key = `${current.chapterId}:${current.createdAt}`;
    if (semanticStartedFor.current === key) return;
    semanticStartedFor.current = key;
    if (!isFeatureReady("image_understanding")) return; // 未配置图理解模型=正常态,跳过不打扰
    const shots = (current.shots ?? []).filter((shot) => shot.description);
    if (shots.length === 0) return;
    setSemanticRunning(true);
    try {
      const outcome = await runSemanticQcLayer({
        shots: shots.map((shot) => ({
          shotId: shot.shotId,
          ordinal: shot.ordinal,
          frameUrl: shot.frameUrl,
          description: shot.description ?? "",
        })),
        call: (messages) => callFeatureMultimodalAPI("image_understanding", messages),
        readFrameDataUrl: async (frameUrl) => {
          try {
            const result = (await window.projectFiles?.readAsBase64(frameUrl)) as
              | { success: boolean; base64?: string }
              | undefined;
            return result?.success && result.base64 ? result.base64 : null;
          } catch {
            return null;
          }
        },
      });
      if (outcome.stats.checked > 0 || outcome.stats.skipped < shots.length) {
        await bridge.submitSemantic({
          projectId: props.projectId!,
          chapterId: current.chapterId,
          stats: outcome.stats,
          findings: outcome.findings,
        });
        await load();
      }
    } catch {
      // 云端失败=层保持 pending,可下次重跑
    } finally {
      setSemanticRunning(false);
    }
  }, [bridge, props.projectId, semanticRunning, load]);

  useEffect(() => {
    if (report?.layers?.semantic?.status === "pending") void runSemantic(report);
  }, [report, runSemantic]);

  const runVision = useCallback(async (current: ChapterQcReport) => {
    if (!bridge || !props.projectId || visionRunning) return;
    const projectId = props.projectId;
    if (current.projectId !== projectId || current.chapterId !== props.chapterId) return;
    const vision = current.vision;
    if (!vision || vision.preflight || !imageUnderstandingReady) return;
    if (vision.frames.length === 0 || vision.decisions.length === 0) return;
    const key = `${projectId}:${current.chapterId}:${current.createdAt}`;
    if (visionStartedFor.current === key) return;
    visionStartedFor.current = key;
    const isCurrent = () => mountedRef.current && activeReportKeyRef.current === key;
    setVisionError(null);
    setVisionRunning(true);
    try {
      const outcome = await runVisionPreflight({
        frames: vision.frames,
        decisions: vision.decisions,
        call: (messages) => callFeatureMultimodalAPI("image_understanding", messages),
        readFrameDataUrl: async (frameUrl) => {
          try {
            const result = (await window.projectFiles?.readAsBase64(frameUrl)) as
              | { success: boolean; base64?: string }
              | undefined;
            return result?.success && result.base64 ? result.base64 : null;
          } catch {
            return null;
          }
        },
      });
      if (!isCurrent()) return;
      const submitted = await bridge.submitVisionPreflight({
        projectId,
        chapterId: current.chapterId,
        expectedCreatedAt: current.createdAt,
        stats: outcome.stats,
        findings: outcome.findings,
      });
      if (!isCurrent()) return;
      if (!submitted.success) {
        setVisionError(submitted.message?.trim() || "审片预审回写失败");
        await load();
        return;
      }
      await load();
    } catch {
      if (isCurrent()) setVisionError("审片预审运行失败");
    } finally {
      if (isCurrent()) setVisionRunning(false);
    }
  }, [bridge, props.projectId, props.chapterId, visionRunning, imageUnderstandingReady, load]);

  useEffect(() => {
    if (report?.vision && !report.vision.preflight) void runVision(report);
  }, [report, runVision]);

  const submitReview = useCallback(async () => {
    if (!bridge?.submitHumanReview || !props.projectId || !report || reviewSubmitting) return;
    const name = reviewerName.trim();
    if (!name) {
      setReviewError("请先填写复核人");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const submitted = await bridge.submitHumanReview({
        projectId: props.projectId,
        chapterId: report.chapterId,
        expectedCreatedAt: report.createdAt,
        fullWatched,
        audioListened,
        reviewer: name,
      });
      if (!submitted.success) setReviewError(submitted.message?.trim() || "人工复核回写失败");
      await load();
    } catch {
      setReviewError("人工复核回写失败");
    } finally {
      setReviewSubmitting(false);
    }
  }, [bridge, props.projectId, report, reviewSubmitting, reviewerName, fullWatched, audioListened, load]);

  /**
   * 打标:一次点一行的一条金标。同一片子同一行重复点是覆盖(主进程按内容哈希发号),
   * 所以改主意直接再点另一边即可,不需要「取消」这条支路。
   */
  const submitCase = useCallback(async (requirementId: string, label: "red" | "green") => {
    if (!bridge?.submitCalibrationCase || !props.projectId || !report || caseBusy) return;
    setCaseBusy(`${requirementId}:${label}`);
    setCaseError(null);
    try {
      const submitted = await bridge.submitCalibrationCase({
        projectId: props.projectId,
        chapterId: report.chapterId,
        expectedCreatedAt: report.createdAt,
        requirementId,
        label,
      });
      if (!submitted.success) setCaseError(submitted.message?.trim() || "打标写入失败");
      await load();
    } catch {
      setCaseError("打标写入失败");
    } finally {
      setCaseBusy(null);
    }
  }, [bridge, props.projectId, report, caseBusy, load]);

  const rerun = async () => {
    if (!bridge || !props.projectId || running) return;
    setRunning(true);
    try {
      const result = await bridge.run({ projectId: props.projectId, chapterId: props.chapterId });
      if (!result.success) setReport(null);
    } finally {
      setRunning(false);
    }
  };

  if (!bridge) return null;

  const layerStatus = (id: string) => report?.layers?.[id]?.status ?? "none";
  const layerChipClass = (status: string) =>
    status === "passed"
      ? "border-success/30 bg-success/10 text-success"
      : status === "failed"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : status === "skipped" || status === "pending" || status === "none"
          ? "border-border bg-muted/50 text-muted-foreground"
          : "border-border bg-muted/50 text-muted-foreground";
  const visionPreflight = report?.vision?.preflight;
  const requirements = report?.requirements ?? [];
  const passedCount = requirements.filter((item) => item.verdict === "pass").length;
  const failedCount = requirements.filter((item) => item.verdict === "fail").length;
  const unverifiedCount = requirements.length - passedCount - failedCount;
  const releasable = requirements.length > 0 && failedCount === 0 && unverifiedCount === 0;
  const dimensionScore = report?.dimensionScore;
  const supply = report?.supplyChecks;
  const expectations = report?.expectations;
  const calibration = report?.calibration;
  const evidenceNotes = report?.notes ?? [];
  /** 板按注册表分组渲染:行的顺序/类别/权重全来自真源,报告只提供三态。 */
  const rowsById = new Map(requirements.map((item) => [item.requirementId, item]));
  const boardGroups = groupDimensionsByCategory()
    .map((group) => ({
      ...group,
      rows: group.specs
        .map((spec) => ({ spec, row: rowsById.get(spec.requirementId) }))
        .filter((item) => item.row !== undefined),
    }))
    // 报告没这一组的行(旧报告/层未跑)就不留空标题
    .filter((group) => group.rows.length > 0);
  const ungrouped = requirements.filter((item) => !CHAPTER_QC_DIMENSIONS.some((spec) => spec.requirementId === item.requirementId));
  // 两个数不能混:sampleCount 是画带凭的别章样本(判定门槛),seriesSampleCount 是本系列落库总数(含本章)。
  // 只显示前者会把「攒了 1 条」读成「没攒」。
  const maxCalibrationSamples = calibration?.baselines.reduce((max, item) => Math.max(max, item.sampleCount), 0) ?? 0;
  const maxSeriesSamples = calibration?.baselines.reduce(
    (max, item) => Math.max(max, item.seriesSampleCount ?? item.sampleCount),
    0,
  ) ?? 0;
  /** 攒了样本却没有行消费它的信号(只攒不判)——摆出来,免得注册表外悄悄长出一片死字段。 */
  // Set 按字符串比:报告里的 signalId 是落库字段(可能带着本仓还不认的旧名),不能拿闭集类型去卡它。
  const boundSignals = new Set<string>(CHAPTER_QC_DIMENSIONS.flatMap((spec) => spec.calibrationSignals ?? []));
  const unboundSignals = (calibration?.baselines ?? [])
    .map((item) => item.signalId)
    .filter((signalId) => !boundSignals.has(signalId));
  /** 注册表有、这份报告没有的行:旧报告的缺行不许静默当「没这回事」。 */
  const absentRowIds = CHAPTER_QC_DIMENSIONS
    .filter((spec) => !rowsById.has(spec.requirementId))
    .map((spec) => spec.requirementId);
  /**
   * 逐行金标账(打标写入口回读)。没有条目的行=这一行还没有人证过,
   * 按钮正是攒它的地方;有负例却一条没抓到的行,主进程已经把 pass 压成缺证。
   */
  const caseScoreById = new Map(
    (calibration?.caseScores ?? []).map((score) => [score.requirementId, score]),
  );
  const supplyDetail = supply?.checks
    .filter((check) => check.verdict !== "ok")
    .map((check) => `${check.label}:${check.verdict === "blocked" ? "硬矛盾" : "缺料"}${check.detail ? ` — ${check.detail}` : ""}`)
    .join("\n");
  const humanReview = report?.humanReview;
  const visionChipStatus = visionPreflight
    ? visionPreflight.failed > 0
      ? "failed"
      : visionPreflight.checked > 0
        ? "passed"
        : "skipped"
    : visionRunning
      ? "running"
      : imageUnderstandingReady
        ? "pending"
        : "skipped";

  return (
    <div className="rounded-xl border border-border bg-card/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">成片 QC 体检单</span>
          {report && (
            <span className="text-xs text-muted-foreground">
              {report.shotCount ?? 0} 镜 · {report.durationS ? `${report.durationS.toFixed(1)}s` : "—"}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={rerun} disabled={running || !props.projectId}>
          {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          重跑 QC
        </Button>
      </div>

      {!report && (
        <p className="text-xs text-muted-foreground">
          {running ? "QC 运行中…" : "暂无报告;出片后自动生成,或点击「重跑 QC」。"}
        </p>
      )}

      {report && (
        <>
          <div className="flex flex-wrap gap-2">
            {LAYER_LABELS.map((layer) => {
              const status = layerStatus(layer.id);
              const reason = report.layers?.[layer.id]?.reason;
              return (
                <span
                  key={layer.id}
                  title={reason ?? status}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    layerChipClass(status),
                    layer.id === "semantic" && semanticRunning && "animate-pulse",
                  )}
                >
                  {layer.label}
                  {status === "passed" ? " ✓" : status === "failed" ? " ✕" : status === "skipped" ? " 跳过" : status === "pending" ? (semanticRunning ? " 跑中" : " 待跑") : ""}
                </span>
              );
            })}
            {report.vision && (
              <span
                title={visionPreflight ? "审片预审已完成" : visionRunning ? "审片预审运行中" : "审片预审尚未完成"}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  layerChipClass(visionChipStatus),
                  visionRunning && "animate-pulse",
                )}
              >
                审片预审
                {visionRunning
                  ? " 跑中"
                  : visionChipStatus === "passed"
                    ? " ✓"
                    : visionChipStatus === "failed"
                      ? " ✕"
                      : visionChipStatus === "skipped"
                        ? " 暂不可用"
                        : " 待跑"}
              </span>
            )}
          </div>

          {report.summary.blockers + report.summary.warns === 0 && report.summary.infos === 0 && (
            <p className="text-xs text-muted-foreground">四层检查无异常发现。</p>
          )}

          {requirements.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-foreground">三态验收</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-medium",
                    releasable
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning",
                  )}
                >
                  {releasable ? "可放行" : "不放行"}
                </span>
                <span className="text-muted-foreground">
                  通过 {passedCount} · 越限 {failedCount} · 缺证 {unverifiedCount}(缺证不计通过)
                </span>
                {dimensionScore && (
                  <span
                    className="text-muted-foreground"
                    title={[
                      `加权分 ${dimensionScore.weightPassed}/${dimensionScore.weightTotal}:只有 pass 计分`,
                      ...(dimensionScore.deducted.length > 0
                        ? dimensionScore.deducted.map((item) => `−${item.weight} ${item.requirementId}(${item.reason})`)
                        : []),
                    ].join("\n")}
                  >
                    计分 {dimensionScore.score}
                  </span>
                )}
              </div>

              {supply && (
                <p
                  className={cn(
                    "truncate text-xs",
                    supply.blocked > 0 ? "text-destructive" : supply.gaps > 0 ? "text-warning" : "text-muted-foreground",
                  )}
                  title={supplyDetail || `供给自检 ${supply.checks.length} 项全过`}
                >
                  供给 {supply.checks.length} 项:缺料 {supply.gaps} · 硬矛盾 {supply.blocked}
                </p>
              )}

              {expectations && expectations.shots.length > 0 && (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={expectations.coverage
                    .map((row) => `${row.key}:应成立 ${row.expected} 镜 / 不应成立 ${row.forbidden} 镜 / 分镜未记 ${row.unknown} 镜`)
                    .join("\n")}
                >
                  逐镜期望 {expectations.shots.length} 镜 · 未声明 {expectations.coverage.reduce((sum, row) => sum + row.unknown, 0)} 项
                </p>
              )}

              {evidenceNotes.length > 0 && (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={`本轮取证口径与退化留痕(同一格 unverified,是侧车缺位还是抽帧失败,修法不同):\n${evidenceNotes.join("\n")}`}
                >
                  取证留痕 {evidenceNotes.length} 条
                </p>
              )}

              {calibration && (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={[
                    `系列 ${calibration.seriesId}:阈值取本系列实测 mean±2σ(画带剔本章,判的是样本外)`,
                    ...calibration.baselines.map((item) => `${item.signalId}:均值 ${item.mean.toFixed(3)} ±${item.sigma.toFixed(3)}`
                      + `(画带凭别章 ${item.sampleCount} 条${item.seriesSampleCount === undefined || item.seriesSampleCount === item.sampleCount
                        ? ""
                        : `,本系列已攒 ${item.seriesSampleCount} 条,含本章`})`),
                    ...(unboundSignals.length > 0 ? [`无行消费(只攒不判):${unboundSignals.join("、")}`] : []),
                    `打标金标 ${calibration.caseCount} 条:写入口就是每行末尾的「有问题/没问题」(同片同行再点即覆盖),`
                      + `落库时连这一行当时的机器判定一起记;负例攒满 ${QC_CALIBRATION_MIN_RED_CASES} 条而一门一条没抓到,`
                      + "这门被判摆设,pass 压成缺证",
                  ].join("\n")}
                >
                  信号标定 画带凭 别章最高 {maxCalibrationSamples}/{QC_CALIBRATION_MIN_SAMPLES} 条(本系列已攒 {maxSeriesSamples} 条)· 打标集 {calibration.caseCount} 条
                </p>
              )}

              <div className="max-h-64 space-y-1 overflow-y-auto">
                {boardGroups.map((group) => (
                  <div key={group.category}>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{group.label}</span>
                      <span className="tabular-nums opacity-60">{group.weight}</span>
                    </div>
                    {group.rows.map(({ spec, row }) => {
                      const item = row!;
                      const tail = item.missing?.length ? `缺:${item.missing.join("；")}` : item.note ?? "";
                      const score = caseScoreById.get(spec.requirementId);
                      const book = score
                        ? `本行金标:负例 ${score.redCaught}/${score.redTotal} 条抓到、正例 ${score.greenPassed}/${score.greenTotal} 条放行`
                        : "本行还没有金标(没人证过这门抓不抓得住)";
                      return (
                        <div key={spec.requirementId} className="flex items-center gap-2 text-xs" title={tail}>
                          <span
                            className={cn(
                              "w-9 shrink-0 rounded-full border px-1.5 py-0.5 text-center font-medium",
                              item.verdict === "pass"
                                ? "border-success/30 bg-success/10 text-success"
                                : item.verdict === "fail"
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : "border-warning/30 bg-warning/10 text-warning",
                            )}
                          >
                            {item.verdict === "pass" ? "通过" : item.verdict === "fail" ? "越限" : "缺证"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {item.label}
                            {item.failingShotOrdinals?.length ? (
                              <span className="ml-1.5 text-destructive">#{item.failingShotOrdinals.join(" #")}</span>
                            ) : null}
                            {tail ? <span className="ml-1.5 text-muted-foreground">{tail}</span> : null}
                          </span>
                          {bridge.submitCalibrationCase && props.projectId ? (
                            <span className="flex shrink-0 items-center gap-1">
                              {(["red", "green"] as const).map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  disabled={Boolean(caseBusy)}
                                  onClick={() => void submitCase(spec.requirementId, label)}
                                  className={cn(
                                    "shrink-0 rounded-md border px-1 text-[11px] leading-4",
                                    label === "red" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground",
                                    caseBusy ? "opacity-40" : "hover:bg-muted",
                                  )}
                                  title={`${label === "red"
                                    ? "记一条负例:这片子里确实有这一行盯的问题"
                                    : "记一条正例:这一行盯的问题在这片子里没有"}\n${book};打标当时的机器判定一并落库,改主意再点另一边即可覆盖`}
                                >
                                  {label === "red" ? "有问题" : "没问题"}
                                </button>
                              ))}
                            </span>
                          ) : null}
                          {item.evaluator ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground" title={CHAPTER_QC_EVALUATOR_LABELS[item.evaluator]}>
                              {CHAPTER_QC_EVALUATOR_LABELS[item.evaluator]}
                            </span>
                          ) : null}
                          <span className="w-5 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground">{spec.weight}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {absentRowIds.length > 0 && (
                  <div className="text-[11px] text-warning" title={`注册表有、这份报告没有的行按缺证看,不许静默省略:${absentRowIds.join("、")}`}>
                    注册表 {CHAPTER_QC_DIMENSIONS.length} 行,本报告只 {CHAPTER_QC_DIMENSIONS.length - absentRowIds.length} 行(旧报告/层未跑)
                  </div>
                )}
                {ungrouped.length > 0 && (
                  <div className="text-[11px] text-warning">
                    注册表外 {ungrouped.length} 行:{ungrouped.map((item) => item.requirementId).join("、")}
                  </div>
                )}
                {caseError && <div className="text-[11px] text-destructive">{caseError}</div>}
              </div>
            </div>
          )}

          {report.findings.length > 0 && (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {report.findings.map((finding, index) => (
                <li key={`${finding.code}-${index}`} className="flex items-start gap-2 text-xs">
                  {finding.severity === "blocker" ? (
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : finding.severity === "warn" ? (
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                  )}
                  <span className="text-foreground">
                    {finding.shotOrdinal !== undefined ? `#${finding.shotOrdinal} ` : ""}
                    {finding.message}
                    <span className="ml-1.5 text-muted-foreground">{finding.code}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {report.semantic && (
            <p className="text-xs text-muted-foreground">
              语义核对:{report.semantic.passed}/{report.semantic.checked} 镜通过
              {report.semantic.skipped > 0 ? `,${report.semantic.skipped} 镜跳过` : ""}
              {report.semantic.model ? ` · ${report.semantic.model}` : ""}
            </p>
          )}

          {visionPreflight ? (
            <p className="text-xs text-muted-foreground">
              审片预审：{visionPreflight.passed}/{visionPreflight.checked} 项通过
              {visionPreflight.failed > 0 ? `，${visionPreflight.failed} 项需人工复核` : ""}
              {visionPreflight.skipped > 0 ? `，${visionPreflight.skipped} 项暂不可用` : ""}
              {visionPreflight.model ? ` · ${visionPreflight.model}` : ""}
            </p>
          ) : visionError ? (
            <p className="text-xs text-muted-foreground">{visionError}；仍可人工确认。</p>
          ) : report.vision && !imageUnderstandingReady ? (
            <p className="text-xs text-muted-foreground">未配置图片理解模型，审片预审暂不可用；仍可人工确认。</p>
          ) : report.vision && (report.vision.frames.length === 0 || report.vision.decisions.length === 0) ? (
            <p className="text-xs text-muted-foreground">审片预审缺少可判读物料；仍可人工确认。</p>
          ) : visionRunning ? (
            <p className="text-xs text-muted-foreground">审片预审运行中；人工确认不受阻塞。</p>
          ) : null}

          {requirements.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2">
              <label className="flex items-center gap-1.5 text-xs" htmlFor={`${reviewIds}-watch`}>
                <Checkbox
                  id={`${reviewIds}-watch`}
                  checked={fullWatched}
                  onCheckedChange={(checked) => setFullWatched(checked === true)}
                />
                人眼全速看全片
              </label>
              <label className="flex items-center gap-1.5 text-xs" htmlFor={`${reviewIds}-listen`}>
                <Checkbox
                  id={`${reviewIds}-listen`}
                  checked={audioListened}
                  onCheckedChange={(checked) => setAudioListened(checked === true)}
                />
                人耳听全轨
              </label>
              <Input
                aria-label="复核人"
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                placeholder="复核人"
                className="h-7 w-28 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={submitReview}
                disabled={reviewSubmitting || !props.projectId || !bridge.submitHumanReview}
              >
                {reviewSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                提交复核
              </Button>
              {reviewError ? (
                <span className="text-xs text-destructive">{reviewError}</span>
              ) : humanReview ? (
                <span className="text-xs text-muted-foreground">
                  已记:{humanReview.reviewer} · {new Date(humanReview.at).toLocaleString()}
                </span>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
