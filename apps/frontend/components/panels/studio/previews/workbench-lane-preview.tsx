import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Film,
  ImageOff,
  Layers3,
} from "lucide-react";
import {
  formatRendererLabel,
  normalizeRemotionRendererSummary,
} from "../workflow-node-model";
import type { ProductionFlowNodeModel } from "../workflow-node-model";

export function WorkbenchLanePreview({
  node,
}: {
  node: ProductionFlowNodeModel;
}) {
  const tracks = node.workbenchTracks ?? [];
  const rendererSummary = node.remotionSummary
    ? normalizeRemotionRendererSummary(node.rendererSummary)
    : node.rendererSummary ?? { requested: "ffmpeg" as const };
  const exportReady = node.remotionSummary
    ? rendererSummary.actual === "remotion" && Boolean(rendererSummary.outputPath)
    : Boolean(node.finalExportPath);
  return (
    <div className="workbench-lane-preview nodrag nowheel max-h-[320px] space-y-3 overflow-y-auto overscroll-contain pr-1">
      {node.remotionSummary ? (
        <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/20/[0.06] px-3 py-2 text-[10px] text-success/80">
          <span>单镜 MP4</span>
          <span className="text-success/80/70">配音、音效已压入</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>原生 Remotion Studio</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>全章合成</span>
          <span className="text-success/80/70">只补背景音乐、环境声</span>
          <ArrowRight className="h-3.5 w-3.5 text-success/70" />
          <span>章节 MP4</span>
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-card px-3 py-2 text-[10px] text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">请求渲染器 {formatRendererLabel(rendererSummary.requested)}</span>
          <span className="text-muted-foreground">
            {rendererSummary.actual
              ? `${formatRendererLabel(rendererSummary.lastRequested ?? rendererSummary.requested)} → ${formatRendererLabel(rendererSummary.actual)}`
              : "尚未验证成片"}
          </span>
        </div>
        {!node.remotionSummary && rendererSummary.fallbackEffectIds?.length ? (
          <div className="mt-1 text-warning/80">回退效果：{rendererSummary.fallbackEffectIds.join("、")}</div>
        ) : null}
        {rendererSummary.lastJobId || rendererSummary.outputPath ? (
          <div className="mt-1 grid gap-1 text-muted-foreground">
            {rendererSummary.lastJobId ? <span>{rendererSummary.lastJobId}</span> : null}
            {rendererSummary.outputPath ? <span className="truncate" title={rendererSummary.outputPath}>{rendererSummary.outputPath}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-card-foreground">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {node.remotionSummary ? "章节 Remotion 导出" : "最终导出"}
          </div>
          <div className="mt-1 truncate text-[11px] text-card-foreground">
            {node.remotionSummary
              ? rendererSummary.outputPath || "等待 ChapterVideo 通过原生 Studio 导出"
              : node.finalExportPath || "等待候选片段全部选中后导出"}
          </div>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-[10px] font-medium text-foreground">
          {exportReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {exportReady ? "READY" : "PENDING"}
        </span>
      </div>
      {tracks.length && !node.remotionSummary ? <div className="grid grid-cols-2 gap-2">
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="min-w-0 rounded-md border border-border bg-card p-2.5 text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                    T{String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[11px] font-medium text-card-foreground">
                    {track.id}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                  {track.prompt || track.reason || "等待生成视频提示词"}
                </p>
              </div>
              <span className="shrink-0 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                {track.state}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <WorkbenchStat
                icon={<Layers3 className="h-3 w-3" />}
                label="分镜"
                value={track.storyboardCount}
              />
              <WorkbenchStat
                icon={<ImageOff className="h-3 w-3" />}
                label="素材"
                value={track.mediaCount}
              />
              <WorkbenchStat
                icon={<Clock3 className="h-3 w-3" />}
                label="时长"
                value={`${track.duration}s`}
              />
              <WorkbenchStat
                icon={<Film className="h-3 w-3" />}
                label="候选"
                value={track.videoCount}
              />
            </div>
            <div className="mt-2 truncate rounded border border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
              selectedVideoPath:{" "}
              <span className="text-foreground">
                {track.selectedVideoPath || "未选择候选片段"}
              </span>
            </div>
          </div>
        ))}
      </div> : null}
    </div>
  );
}

function WorkbenchStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0 rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}
