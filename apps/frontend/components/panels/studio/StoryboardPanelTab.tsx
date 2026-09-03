import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import { buildStoryboardItemOpenContext } from "./storyboard-open-context";
import { toPreviewSrc, withThumbVariant } from "@/lib/media/preview-src";
import { LocalImage } from "@/components/ui/local-image";
import type { StoryboardBatchGenerationState } from "./image-workflow/use-storyboard-batch-generation";

/**
 * 分镜面板 — 当前章节全部分镜的全量视图(与单镜图片工作流严格区分)。
 *
 * 入口:工作流节点图「分镜面板」节点的「进入」按钮(targetStage=storyboardPanel)。
 * 每张卡片点击即进入该镜的图片工作流(返回时回到本面板,经 sourceStage 回跳)。
 */
export function StoryboardPanelTab({
  storyboards,
  onOpenImageWorkflow,
  onBackToCanvas,
  batch,
}: {
  storyboards: StoryboardItem[];
  onOpenImageWorkflow: (context: ImageWorkflowOpenContext) => void;
  onBackToCanvas?: () => void;
  /** 一键生图(串行批量)状态与控制,由挂载点 useStoryboardBatchGeneration 注入 */
  batch?: {
    state: StoryboardBatchGenerationState;
    start: () => void;
    stop: () => void;
  };
}) {
  const ordered = storyboards.slice().sort((a, b) => a.index - b.index);
  const withImage = ordered.filter((item) => item.mediaRef?.kind === "image").length;
  const remaining = ordered.length - withImage;

  const openShot = (storyboard: StoryboardItem) => {
    onOpenImageWorkflow({
      ...buildStoryboardItemOpenContext(storyboard),
      sourceStage: "storyboardPanel",
      sourceStageLabel: "分镜面板",
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" data-storyboard-panel-tab>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {onBackToCanvas ? (
            <Button
              size="sm"
              variant="ghost"
              data-storyboard-panel-back
              onClick={onBackToCanvas}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回节点图
            </Button>
          ) : null}
          <h3 className="text-base font-semibold text-foreground">分镜面板</h3>
          <span className="text-sm text-muted-foreground">
            {ordered.length ? `${ordered.length} 个分镜 · ${withImage} 个画面` : "尚无分镜,请先生成分镜表"}
          </span>
        </div>
        {batch ? (
          batch.state.running ? (
            <div className="flex items-center gap-2" data-storyboard-panel-batch-running>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                一键生图 {batch.state.done}/{batch.state.total}
                {batch.state.currentShotIndex != null ? ` · S${String(batch.state.currentShotIndex).padStart(2, "0")}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                data-storyboard-panel-batch-stop
                onClick={batch.stop}
                title="当前分镜完成后停止"
              >
                <Square className="h-3.5 w-3.5" />
                停止
              </Button>
            </div>
          ) : remaining > 0 ? (
            <Button
              size="sm"
              variant="paid"
              data-storyboard-panel-generate
              title={`串行生成剩余 ${remaining} 个未生成分镜`}
              onClick={batch.start}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              一键生图
            </Button>
          ) : null
        ) : null}
      </div>

      {ordered.length ? (
        <div
          className="mt-4 grid min-h-0 flex-1 grid-cols-2 content-start gap-6 overflow-y-auto p-1 pr-3"
        >
          {ordered.map((storyboard) => (
            <StoryboardPanelCard
              key={storyboard.id}
              storyboard={storyboard}
              onOpen={() => openShot(storyboard)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 分镜卡(用户裁定 08-27 晚):每行 2 张大卡、留空隙、竖向滚动;
 * 媒体框 16:9 画幅 + 多帧左右按钮切换(回接后每镜常为 2 关键帧)。
 * 外层用 div(卡内含切换 button,button 嵌套非法),点击整卡进图工作流。
 */
function StoryboardPanelCard({
  storyboard,
  onOpen,
}: {
  storyboard: StoryboardItem;
  onOpen: () => void;
}) {
  // 仅有图帧参与轮播;无帧/无图退回 mediaRef 单图
  const frames = useMemo(() => {
    const withPath = (storyboard.keyframes ?? []).filter((frame) => frame.mediaRef?.path);
    if (withPath.length) return withPath.map((frame) => frame.mediaRef!.path);
    return storyboard.mediaRef?.kind === "image" && storyboard.mediaRef.path
      ? [storyboard.mediaRef.path]
      : [];
  }, [storyboard]);
  const [frameIndex, setFrameIndex] = useState(0);
  const currentPath = frames[frameIndex];
  const goFrame = (delta: number) => {
    if (frames.length < 2) return;
    setFrameIndex((previous) => (previous + delta + frames.length) % frames.length);
  };

  return (
    <div
      data-storyboard-panel-shot={storyboard.id}
      role="button"
      tabIndex={0}
      className="group flex cursor-pointer flex-col rounded-lg border border-border/70 bg-card/70 text-left transition-colors hover:border-primary/50 focus-visible:border-primary/60 focus-visible:outline-none"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      title={`进入分镜 ${storyboard.index} 图片工作流`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-muted/40">
        {currentPath ? (
          <LocalImage
            key={currentPath}
            src={withThumbVariant(toPreviewSrc(currentPath))}
            alt={storyboard.prompt}
            className="h-full w-full object-contain"
            fallbackLabel="成图丢失"
            eager
            previewable
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
            未生成
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
          S{String(storyboard.index).padStart(2, "0")}
        </span>
        {currentPath ? <ResolutionBadge src={toPreviewSrc(currentPath)} className="right-1 left-auto top-1" /> : null}
        {/* 多帧左右切换(用户裁定):圆形半透明箭头,点击不冒泡进卡 */}
        {frames.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="上一帧"
              data-storyboard-frame-prev
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/70 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-background/90 hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                goFrame(-1);
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="下一帧"
              data-storyboard-frame-next
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/70 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-background/90 hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                goFrame(1);
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span
              className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-background/70 px-2 py-0.5 backdrop-blur-sm"
              data-storyboard-frame-dots
            >
              {frames.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  aria-label={`第 ${index + 1} 帧`}
                  className={`h-2 w-2 rounded-full transition-colors ${index === frameIndex ? "bg-primary" : "bg-muted-foreground/40 hover:bg-muted-foreground/70"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFrameIndex(index);
                  }}
                />
              ))}
              <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">
                {frameIndex + 1}/{frames.length}
              </span>
            </span>
          </>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
        {/* 文案不截断(用户裁定:分镜面板要展示完全;大卡下整段可读) */}
        <p className="text-xs leading-5 text-foreground">
          {storyboard.videoDesc || storyboard.prompt}
        </p>
        {storyboard.lines ? (
          <p className="whitespace-pre-line text-[11px] leading-5 text-muted-foreground">
            {storyboard.lines.replace(/<br\s*\/?>/gi, "\n")}
          </p>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1 text-[11px] text-primary/75 group-hover:text-primary">
          <ImageIcon className="h-3.5 w-3.5" />
          进入图片工作流
        </span>
      </div>
    </div>
  );
}
