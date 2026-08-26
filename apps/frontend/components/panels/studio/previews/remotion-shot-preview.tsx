import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Gauge,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchRemotionShotRenderRequest } from "@/lib/studio/remotion-shot-render-request";
import type {
  ProductionFlowNodeModel,
  ProductionFlowRemotionShot,
} from "../workflow-node-model";
import { PreviewImage } from "./preview-image";

export function RemotionShotPreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const shots = node.remotionShots ?? [];
  const summary = node.remotionSummary;
  return (
    <div className="remotion-shot-preview nodrag nowheel max-h-[480px] space-y-3 overflow-y-auto overscroll-contain pr-1">
      <div className="flex items-center justify-between gap-2 rounded-md border border-info/25 bg-info/20/[0.06] px-3 py-2 text-[10px] text-info/80">
        <span className="font-semibold">当前章节 · {summary?.total ?? shots.length} 个分镜</span>
        <span className="text-info/80/70">每个分镜单独渲染一条 MP4 短片</span>
      </div>
      <div
        aria-label="Remotion 分镜生产链路"
        className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 rounded-md border border-info/25 bg-info/20/[0.06] px-2 py-2 text-[10px] text-info/80"
      >
        <RemotionFlowStep label="分镜物料" detail="图像 · 音频 · 字幕" />
        <ArrowRight className="h-3.5 w-3.5 text-info/70" />
        <RemotionFlowStep label="单镜合成" detail="逐镜渲染出片" />
        <ArrowRight className="h-3.5 w-3.5 text-info/70" />
        <RemotionFlowStep label="单镜 MP4" detail="每镜一条成片" />
      </div>
      <div className="grid grid-cols-4 gap-2 rounded-md border border-info/25 bg-info/20/[0.06] p-2 text-card-foreground">
        <RemotionSummaryCell label="分镜" value={`${summary?.total ?? shots.length}`} />
        <RemotionSummaryCell label="已完成" value={`${summary?.succeeded ?? 0}`} tone="success" />
        <RemotionSummaryCell label="进行中" value={`${(summary?.running ?? 0) + (summary?.queued ?? 0)}`} tone="active" />
        <RemotionSummaryCell label="阻塞/失败" value={`${(summary?.blocked ?? 0) + (summary?.failed ?? 0)}`} tone="warning" />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-info/80">
          <Gauge className="h-3.5 w-3.5" />
          Remotion 渲染 · 并发 {node.remotionQueueConcurrency ?? 1}
        </span>
        <span>{summary?.chapterReady ? "全部单镜 MP4 已就绪，可进入原生 Studio" : "全部单镜成功后才可进入原生 Studio"}</span>
      </div>
      {shots.length ? (
        <div className="grid grid-cols-2 gap-2">
          {shots.map((shot) => (
          <div
            key={shot.shotId}
            className={cn(
              "min-w-0 rounded-md border border-border bg-card p-2.5 text-card-foreground",
              shot.status === "running" && "border-primary/45",
              shot.status === "succeeded" && "border-success/35",
              (shot.status === "failed" || shot.status === "blocked" || shot.status === "canceled") && "border-viz-glow/45",
            )}
            data-remotion-shot-id={shot.shotId}
            data-remotion-shot-status={shot.status}
          >
            <div className="flex gap-2">
              <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded border border-border/70 bg-muted/30">
                {shot.mediaPath ? (
                  <PreviewImage
                    src={shot.mediaPath}
                    alt={shot.title}
                    className="h-full w-full object-cover"
                    fallbackLabel="首帧丢失"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] text-muted-foreground">无首帧</div>
                )}
                <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[9px] font-semibold text-foreground">
                  S{String(shot.index).padStart(2, "0")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-[10px] font-medium">{shot.title}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex h-5 items-center gap-1 rounded-md border border-info/35 bg-info/10 px-1.5 text-[9px] font-medium text-info/90 transition-colors hover:border-info/60 hover:bg-info/18 disabled:cursor-not-allowed disabled:opacity-45"
                      data-remotion-shot-render={shot.shotId}
                      title="单镜生产:仅生成/重渲本镜 MP4(自动补齐该镜配音与音效)"
                      disabled={shot.status === "queued"
                        || shot.status === "running"
                        || ((summary?.running ?? 0) + (summary?.queued ?? 0)) > 0}
                      onClick={() => dispatchRemotionShotRenderRequest(shot.shotId)}
                    >
                      <Play className="h-2.5 w-2.5" />
                      生成本镜
                    </button>
                    <RemotionStatusIcon status={shot.status} />
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                  <span>{remotionStatusLabel(shot.status)}</span>
                  <span className="tabular-nums">{Math.round(shot.progress * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      shot.status === "failed" || shot.status === "blocked" ? "bg-viz-glow" : "bg-info/20",
                    )}
                    style={{ width: `${Math.max(0, Math.min(1, shot.progress)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-2 truncate text-[9px] text-muted-foreground" title={shot.outputPath ?? shot.error}>
              {shot.error ? `失败：${shot.error}` : shot.outputPath ? `MP4 · ${basename(shot.outputPath)}` : shot.jobId ? `任务 ${shot.jobId}` : "等待提交渲染任务"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
              <span className="rounded border border-border px-1.5 py-0.5">第 {shot.revision ?? 1} 版</span>
              <span
                className={cn("rounded border px-1.5 py-0.5", shot.ttsStatus === "ready" ? "border-success/35 text-success/80" : "border-viz-glow/35 text-warning/80")}
                title="旁白配音是否已生成就绪"
              >
                旁白配音 {shot.ttsStatus === "ready" ? "已就绪" : shot.ttsStatus === "pending" ? "待生成" : shot.ttsStatus === "failed" ? "失败" : "缺失"}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">音轨 {shot.shotAudioBindingCount ?? 0} 条</span>
              <span className={cn("rounded border px-1.5 py-0.5", shot.sfxStatus === "ready" ? "border-success/35 text-success/80" : "border-border text-muted-foreground")}>
                音效 {shot.sfxStatus === "ready" ? "已就绪" : "未添加"}
              </span>
              <span className={cn("rounded border px-1.5 py-0.5", shot.chapterSharedAudioReferenced ? "border-primary/35 text-primary/80" : "border-border text-muted-foreground")}>
                背景 BGM {shot.chapterSharedAudioReferenced ? "全章共用" : "未配置"}
              </span>
              {shot.duplicateMixRisk ? <span className="rounded border border-destructive/45 px-1.5 py-0.5 text-destructive/80">重复混音风险</span> : null}
            </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-card/70 px-3 py-6 text-center text-[10px] text-muted-foreground">
          分镜面板尚未提供当前章节的分镜物料；生成分镜后，这里会按顺序显示每个 Remotion shot job、进度和 MP4。
        </div>
      )}
      {summary?.error ? (
        <div className="rounded-md border border-viz-glow/35 bg-viz-glow/10 px-3 py-2 text-[10px] text-warning/80">
          队列读取失败：{summary.error}
        </div>
      ) : null}
    </div>
  );
}

function RemotionFlowStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="min-w-0 rounded border border-info/15 bg-background/20 px-2 py-1.5">
      <div className="truncate font-semibold">{label}</div>
      <div className="mt-0.5 truncate text-[9px] text-info/80/65">{detail}</div>
    </div>
  );
}

function RemotionSummaryCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "active" | "warning";
}) {
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 text-[13px] font-semibold tabular-nums",
        tone === "success" && "text-success/80",
        tone === "active" && "text-info/80",
        tone === "warning" && "text-warning/80",
      )}>{value}</div>
    </div>
  );
}

function RemotionStatusIcon({ status }: { status: ProductionFlowRemotionShot["status"] }) {
  if (status === "succeeded") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "running" || status === "queued") return <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />;
  if (status === "failed" || status === "blocked" || status === "canceled") return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-viz-glow" />;
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function remotionStatusLabel(status: ProductionFlowRemotionShot["status"]) {
  return {
    pending: "待提交",
    ready: "待排队",
    queued: "排队中",
    running: "渲染中",
    succeeded: "已完成",
    failed: "失败",
    blocked: "阻塞",
    canceled: "已取消",
    stale: "需重渲",
  }[status];
}

function basename(value: string) {
  const normalized = value.split("\\").join("/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}
