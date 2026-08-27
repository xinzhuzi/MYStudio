import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import { PreviewImage } from "./previews/preview-image";
import { toPreviewSrc, withThumbVariant } from "./previews/preview-src";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import type { StoryboardItem } from "@/types/studio";
import type {
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";

/** 详情媒体框高度:宽屏三栏占满首屏剩余可视高度(视口相对+22rem 下限);
 * 窄屏纵向堆叠时回落固定 h-56,避免三栏各吃一屏把页面拉得过长。 */
const DETAIL_MEDIA_BOX_CLASS = "h-56 lg:h-[max(22rem,calc(100vh-25rem))]";

function shotDotClass(row: {
  fresh: boolean;
  videoUrl: string | null;
  job?: RemotionRenderJobV1;
}): string {
  const running = row.job?.status === "running" || row.job?.status === "queued";
  if (row.fresh) return "bg-success";
  if (row.videoUrl) return "bg-warning";
  if (running) return "bg-info animate-pulse";
  if (row.job?.status === "failed") return "bg-destructive";
  return "bg-muted-foreground/40";
}
/**
 * 单镜生产总览 — 「Remotion 单镜生产」进入后的第一屏。
 *
 * 按镜头标号选择,当前镜的视频/画面/音频一屏尽览(用户裁定 08-27:详情占满布局,
 * 其他镜头默认不展示,点击镜号才在顶部展开横向滑动条;选中即收起)。
 * 布局纪律:媒体框定高 + object-contain(竖图零裁切);卡片不挂
 * overflow-hidden(定高网格+条目裁切会触发 Chromium 行高坍缩,当日实测)。
 */
export function ShotProductionOverview({
  projectId,
  storyboards,
  jobs,
  currentShotSlots,
  queueLoading,
  onBackToCanvas,
}: {
  projectId?: string;
  /** 当前章节的分镜(挂载点已按章节过滤) */
  storyboards: StoryboardItem[];
  jobs: RemotionRenderJobV1[];
  currentShotSlots: RemotionCurrentSlotV1[];
  queueLoading?: boolean;
  onBackToCanvas?: () => void;
}) {
  const ordered = useMemo(
    () => storyboards.slice().sort((a, b) => a.index - b.index),
    [storyboards],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [stripOpen, setStripOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0];

  // 展开横滑条时把当前镜滚入视野居中,两侧相邻镜同时可见(jsdom 无布局引擎,守卫跳过)。
  useEffect(() => {
    if (!stripOpen || !stripRef.current) return;
    const active = stripRef.current.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [stripOpen, selectedId]);

  /** 每镜视频产物:当前修订版 slot 优先;无 slot 时回退该镜最新成功任务
   *  (跨修订版=旧版产物,显式标注不冒充当前版——防旧音配新词门禁同源纪律)。 */
  const rows = useMemo(
    () =>
      ordered.map((storyboard) => {
        const revision = Math.max(1, storyboard.outputVersion ?? 1);
        const slot = currentShotSlots.find(
          (item) =>
            item.target.kind === "shot"
            && item.target.chapterId === storyboard.episodeId
            && item.target.shotId === storyboard.id
            && item.target.shotRevision === revision,
        );
        const job =
          slot?.job
          ?? jobs.find(
            (item) =>
              item.target.kind === "shot"
              && item.target.chapterId === storyboard.episodeId
              && item.target.shotId === storyboard.id
              && item.target.shotRevision === revision
              && (item.status === "running" || item.status === "queued"),
          );
        const freshUrl =
          slot?.outputPath && projectId
            ? buildProjectFileUrl(projectId, `remotion/${slot.outputPath}`)
            : null;
        const staleJob = freshUrl
          ? undefined
          : jobs
              .filter(
                (item) =>
                  item.target.kind === "shot"
                  && item.target.chapterId === storyboard.episodeId
                  && item.target.shotId === storyboard.id
                  && item.status === "succeeded"
                  && item.outputPath,
              )
              .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0))[0];
        const staleUrl =
          staleJob?.outputPath && projectId
            ? buildProjectFileUrl(projectId, `remotion/${staleJob.outputPath}`)
            : null;
        return {
          storyboard,
          job,
          videoUrl: freshUrl ?? staleUrl,
          videoStaleRevision:
            staleUrl && staleJob?.target.kind === "shot" ? staleJob.target.shotRevision : undefined,
          fresh: Boolean(freshUrl),
        };
      }),
    [ordered, currentShotSlots, jobs, projectId],
  );

  const readyVideos = rows.filter((row) => row.fresh).length;
  const staleVideos = rows.filter((row) => !row.fresh && row.videoUrl).length;
  const withImage = ordered.filter((item) => item.mediaRef?.kind === "image").length;
  const withVoice = ordered.filter((item) =>
    item.shotAudioBindings?.some((binding) => binding.role === "voice"),
  ).length;

  const selectedRow = rows.find((row) => row.storyboard.id === selected?.id);
  const mediaPath =
    selected?.mediaRef?.kind === "image" ? selected.mediaRef.path : undefined;

  return (
    <section
      aria-label="单镜生产总览"
      data-shot-production-overview
      className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border/70 bg-card/60 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {onBackToCanvas ? (
            <Button
              size="sm"
              variant="ghost"
              data-workbench-back
              onClick={onBackToCanvas}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回节点图
            </Button>
          ) : null}
          <h3 className="text-base font-semibold text-foreground">单镜生产总览</h3>
          <span className="text-sm text-muted-foreground">
            {ordered.length
              ? `${ordered.length} 个分镜 · ${readyVideos} 个视频${staleVideos ? ` · ${staleVideos} 个旧版可看` : ""} · ${withImage} 个画面 · ${withVoice} 个旁白配音${queueLoading ? " · 读取渲染队列…" : ""}`
              : "尚无分镜,请先生成分镜表"}
          </span>
        </div>
        {selected && selectedRow ? (
          <Button
            size="sm"
            variant="outline"
            data-shot-strip-toggle
            aria-expanded={stripOpen}
            aria-controls="shot-strip"
            aria-label={`${stripOpen ? "收起" : "展开"}镜号横滑条,当前镜头 S${String(selected.index).padStart(2, "0")}`}
            title={stripOpen ? "收起镜号横滑条" : "展开镜号横滑条,点选其他镜头"}
            onClick={() => setStripOpen((open) => !open)}
            className="shrink-0 gap-1.5 font-mono"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${shotDotClass(selectedRow)}`} />
            S{String(selected.index).padStart(2, "0")}
            <ChevronDown
              className={`h-3.5 w-3.5 motion-safe:transition-transform ${stripOpen ? "rotate-180" : ""}`}
            />
          </Button>
        ) : null}
      </div>

      {/* 镜号横滑条:点击镜号才唤出,单行横滑;状态点一眼分辨(绿=当前版视频/琥珀=旧版
          可看/蓝=渲染中/红=失败/灰=未生成);选中任一镜即收起,把布局还给当前镜详情。 */}
      {ordered.length && stripOpen ? (
        <div
          id="shot-strip"
          ref={stripRef}
          aria-label="选择分镜镜头"
          data-shot-chip-strip
          className="flex gap-1 overflow-x-auto border-b border-border/60 bg-background/40 px-1 py-1.5"
        >
          {rows.map(({ storyboard, videoUrl, fresh, job }) => {
            const running = job?.status === "running" || job?.status === "queued";
            const failed = job?.status === "failed";
            const active = storyboard.id === selected?.id;
            return (
              <button
                key={storyboard.id}
                type="button"
                data-shot-chip={storyboard.id}
                aria-pressed={active}
                title={`S${String(storyboard.index).padStart(2, "0")} · ${fresh ? "已有当前版单镜视频" : videoUrl ? "有旧版单镜视频(内容已更新,需重渲)" : running ? "渲染中" : failed ? "渲染失败" : "未生成视频"}`}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 font-mono text-[11px] leading-none transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                onClick={() => {
                  setSelectedId(storyboard.id);
                  setStripOpen(false);
                }}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${shotDotClass({ fresh, videoUrl, job })}`} />
                {String(storyboard.index).padStart(2, "0")}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 当前镜详情:视频 / 画面 / 音频 三栏一屏尽览 */}
      {selected && selectedRow ? (
        <div className="flex flex-col gap-3" data-shot-detail={selected.id}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono font-semibold text-foreground">
                S{String(selected.index).padStart(2, "0")}
              </span>
              <span className="text-muted-foreground">
                时长 {selected.durationTarget ?? selected.duration ?? "—"}s · 第 {Math.max(1, selected.outputVersion ?? 1)} 版
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                data-shot-video-status={
                  selectedRow.fresh
                    ? "ready"
                    : selectedRow.videoUrl
                      ? "stale"
                      : selectedRow.job?.status === "running"
                        ? "running"
                        : selectedRow.job?.status === "failed"
                          ? "failed"
                          : "none"
                }
              >
                {selectedRow.fresh
                  ? "单镜视频已生成"
                  : selectedRow.videoUrl
                    ? `旧版单镜视频(第 ${selectedRow.videoStaleRevision ?? "?"} 版产物) · 当前内容已更新,需重渲`
                    : selectedRow.job?.status === "running"
                      ? `渲染中 ${Math.round((selectedRow.job.progress ?? 0) * 100)}%`
                      : selectedRow.job?.status === "failed"
                        ? "渲染失败"
                        : "单镜视频未生成"}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-foreground">
              {selected.videoDesc || selected.prompt}
            </p>
            {selected.lines ? (
              <p className="mt-1 border-l-2 border-primary/40 pl-2 text-xs leading-5 text-muted-foreground">
                {selected.lines}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
            {/* 单镜视频 */}
            <figure className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="text-[11px] font-medium text-muted-foreground">单镜视频（含旁白配音与音效）</figcaption>
              <div className={`flex ${DETAIL_MEDIA_BOX_CLASS} items-center justify-center overflow-hidden rounded-md border border-border/70 bg-black`}>
                {selectedRow.videoUrl ? (
                  <video
                    controls
                    preload="metadata"
                    src={selectedRow.videoUrl}
                    className="h-full w-full object-contain"
                    data-shot-video={selected.id}
                  />
                ) : (
                  <span className="px-4 text-center text-[11px] text-muted-foreground">
                    {selectedRow.job?.status === "running"
                      ? `渲染中 ${Math.round((selectedRow.job.progress ?? 0) * 100)}%`
                      : selectedRow.job?.status === "failed"
                        ? "渲染失败,可在下方分镜音频操作区重试"
                        : "尚未生成单镜视频"}
                  </span>
                )}
              </div>
            </figure>

            {/* 分镜画面:完整显示零裁切 */}
            <figure className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="text-[11px] font-medium text-muted-foreground">分镜画面</figcaption>
              <div className={`relative flex ${DETAIL_MEDIA_BOX_CLASS} items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/30`}>
                {mediaPath ? (
                  <>
                    <PreviewImage
                      src={withThumbVariant(toPreviewSrc(mediaPath))}
                      alt={selected.prompt}
                      className="h-full w-full object-contain"
                      fallbackLabel="成图丢失"
                      eager
                    />
                    <ResolutionBadge src={toPreviewSrc(mediaPath)} />
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">未生成分镜图</span>
                )}
              </div>
            </figure>

            {/* 本镜音频 */}
            <figure className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="text-[11px] font-medium text-muted-foreground">本镜音频</figcaption>
              <div className={`flex ${DETAIL_MEDIA_BOX_CLASS} flex-col gap-2 overflow-y-auto rounded-md border border-border/70 bg-background/40 p-2.5`}>
                {selected.shotAudioBindings?.length ? (
                  selected.shotAudioBindings.map((binding) => (
                    <ShotAudioRow key={binding.bindingId} binding={binding} />
                  ))
                ) : (
                  <span className="text-[11px] text-muted-foreground">本镜未绑定音频</span>
                )}
                <p className="mt-auto text-[10px] leading-4 text-muted-foreground">
                  旁白配音与音效已压进单镜视频;背景音乐、环境声只在全章成片里混入。
                </p>
              </div>
            </figure>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ShotAudioRow({ binding }: { binding: RemotionShotAudioBindingV2 }) {
  const label = binding.role === "voice" ? "旁白配音" : "音效";
  const audioUrl =
    binding.source.kind === "project-file"
      ? buildProjectFileUrl(binding.source.projectId, binding.source.relativePath)
      : null;
  return (
    <div className="flex flex-col gap-1 rounded border border-border/60 bg-card/60 p-2" data-shot-audio={binding.bindingId}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {Math.round(binding.durationUs / 1000) / 1000}s · 音量 {Math.round(binding.volume * 100)}%
        </span>
      </div>
      {audioUrl ? (
        <audio controls preload="none" src={audioUrl} className="h-8 w-full" />
      ) : (
        <span className="text-[10px] text-muted-foreground">音频文件不在项目内,无法试听</span>
      )}
    </div>
  );
}
