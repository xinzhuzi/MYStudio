"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFeatureReady } from "@/lib/ai/feature-router";
import { callFeatureMultimodalAPI } from "@/lib/ai/feature-router";
import { runSemanticQcLayer } from "@/lib/studio/qc/semantic-runner";
import {
  runVisionPreflight,
  type VisionPreflightDecisionInput,
  type VisionPreflightFrameInput,
} from "@/lib/studio/qc/vision-preflight-runner";

interface ChapterQcFinding {
  code: string;
  layer: string;
  severity: "blocker" | "warn" | "info";
  shotId?: string;
  shotOrdinal?: number;
  message: string;
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
  }, [activeReportKey]);

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
        </>
      )}
    </div>
  );
}
