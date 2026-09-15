import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { VideoPreviewModal } from "@/components/ui/media-preview-modal";
import { Button } from "@/components/ui/button";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import { buildStoryboardItemOpenContext } from "./storyboard-open-context";
import { toPreviewSrc, withThumbVariant } from "@/lib/media/preview-src";
import { LocalImage } from "@/components/ui/local-image";
import {
  buildShotKeyframeExtractRequest,
  getShotKeyframesBridge,
  saveVideoFramesAsKeyframes,
  type ShotKeyframeExtractMode,
} from "@/lib/assist/image-studio/shot-keyframe-extraction";
import { useProjectStore } from "@/stores/project/project-store";
import type {
  StoryboardBatchGenerationState,
  StoryboardBatchResumeInfo,
} from "./image-workflow/use-storyboard-batch-generation";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  ShotImageCompareDialog,
  ShotVideoCompareDialog,
  shotCompareAvailability,
} from "./shot-compare-dialogs";

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
  upscale,
  chapterAutoVideo,
}: {
  storyboards: StoryboardItem[];
  onOpenImageWorkflow: (context: ImageWorkflowOpenContext) => void;
  onBackToCanvas?: () => void;
  /** 一键生图(串行批量)状态与控制,由挂载点 useStoryboardBatchGeneration 注入 */
  batch?: {
    state: StoryboardBatchGenerationState;
    start: () => void;
    stop: () => void;
    /** 断点续跑(09-15 P3):上次中断的批量,从游标镜继续 */
    resumable?: StoryboardBatchResumeInfo | null;
  };
  /** 批量超分(09-09 批8:主画布退役,入口迁入面板) */
  upscale?: {
    state: { running: boolean; current?: string };
    start: () => void;
    stop: () => void;
    upscaledCount: number;
    shotCount: number;
  };
  /** 章自动视频(同上迁入) */
  chapterAutoVideo?: {
    status: unknown;
    running: boolean;
    run: () => void;
    openFinal?: () => void;
  };
}) {
  const ordered = storyboards.slice().sort((a, b) => a.index - b.index);
  const withImage = ordered.filter((item) => item.mediaRef?.kind === "image").length;
  const remaining = ordered.length - withImage;
  // 版本对入口(09-15 P1b):图=关键帧两帧对比;视频=当前版 vs 上一版候选
  const videoCandidates = useStudioStore((state) => state.videoCandidates);
  const [framesCompareShotId, setFramesCompareShotId] = useState<string | null>(null);
  const [videoCompareShotId, setVideoCompareShotId] = useState<string | null>(null);
  const framesCompareShot = framesCompareShotId ? ordered.find((item) => item.id === framesCompareShotId) : undefined;
  const videoCompareShot = videoCompareShotId ? ordered.find((item) => item.id === videoCompareShotId) : undefined;
  // 09-14 用户裁定:详情页可看单镜头视频播放——有视频的卡中央▶,弹窗播整镜
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // 截帧回灌(09-15 P1a):弹窗关联镜+busy 态;两动作落在视频查看操作条
  const [videoShotId, setVideoShotId] = useState<string | null>(null);
  const [keyframeBusy, setKeyframeBusy] = useState(false);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const videoShot = videoShotId ? ordered.find((item) => item.id === videoShotId) : undefined;

  const runKeyframeExtraction = async (mode: ShotKeyframeExtractMode) => {
    if (!videoShot || keyframeBusy) return;
    setKeyframeBusy(true);
    try {
      const result = await saveVideoFramesAsKeyframes({ projectId: activeProjectId, storyboard: videoShot, mode });
      if (result.ok) {
        toast.success(mode.kind === "single" ? "已存为关键帧" : "已抽帧,本镜关键帧已更新");
      } else {
        toast.warning(result.message ?? "抽帧失败");
      }
    } finally {
      setKeyframeBusy(false);
    }
  };

  /** 截帧回灌动作(09-15 P1a):视频不在项目内/桥缺失=禁用态+tooltip,不报错弹窗 */
  const keyframeActions = useMemo(() => {
    if (!videoShot) return undefined;
    const extractable = buildShotKeyframeExtractRequest({
      projectId: activeProjectId,
      storyboard: videoShot,
      mode: { kind: "single", timestampS: 0 },
    }) !== null;
    const bridgeAvailable = getShotKeyframesBridge() !== null;
    return {
      busy: keyframeBusy,
      disabledReason: !extractable
        ? "当前视频不在项目内,无法抽帧"
        : !bridgeAvailable
          ? "抽帧通道不可用(仅桌面应用支持)"
          : undefined,
      onSaveCurrentFrame: (currentTimeS: number) => {
        void runKeyframeExtraction({ kind: "single", timestampS: currentTimeS });
      },
      onAutoSample: (count: 3 | 5 | 9) => {
        void runKeyframeExtraction({ kind: "uniform", count });
      },
    };
  }, [videoShot, activeProjectId, keyframeBusy]);

  const openShotVideo = (storyboard: StoryboardItem) => {
    setVideoShotId(storyboard.id);
    setVideoUrl(toPreviewSrc(storyboard.mediaRef!.path!));
  };

  const closeShotVideo = () => {
    setVideoUrl(null);
    setVideoShotId(null);
  };

  const openShot = (storyboard: StoryboardItem) => {
    onOpenImageWorkflow({
      ...buildStoryboardItemOpenContext(storyboard),
      sourceStage: "storyboardPanel",
      sourceStageLabel: "分镜面板",
    });
  };

  return (
    <>
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
          {upscale && upscale.shotCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              data-storyboard-panel-upscale
              disabled={upscale.state.running || upscale.upscaledCount >= upscale.shotCount}
              onClick={() => (upscale.state.running ? upscale.stop() : upscale.start())}
            >
              {upscale.state.running ? "超分中…(点击停止)" : `批量超分(${upscale.upscaledCount}/${upscale.shotCount})`}
            </Button>
          ) : null}
          {chapterAutoVideo ? (
            chapterAutoVideo.running ? (
              <Button size="sm" variant="outline" disabled data-storyboard-panel-auto-video>
                章视频合成中…
              </Button>
            ) : chapterAutoVideo.openFinal ? (
              <Button size="sm" variant="outline" data-storyboard-panel-auto-video-open onClick={chapterAutoVideo.openFinal}>
                打开章视频
              </Button>
            ) : (
              <Button size="sm" variant="outline" data-storyboard-panel-auto-video-run onClick={chapterAutoVideo.run}>
                一键章视频
              </Button>
            )
          ) : null}
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
          ) : batch.resumable ? (
            /* 断点续跑(09-15 P3):上次没跑完的批量,从上次停下的镜继续 */
            <Button
              size="sm"
              variant="outline"
              data-storyboard-panel-generate
              title={`从第 ${batch.resumable.shotIndex} 镜继续,还差 ${batch.resumable.remainingFrames} 帧画面`}
              onClick={batch.start}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              继续生图
            </Button>
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
          {ordered.map((storyboard) => {
            const compare = shotCompareAvailability(storyboard, videoCandidates);
            return (
              <StoryboardPanelCard
                key={storyboard.id}
                storyboard={storyboard}
                onOpen={() => openShot(storyboard)}
                onPlayVideo={
                  storyboard.mediaRef?.kind === "video" && storyboard.mediaRef.path
                    ? () => openShotVideo(storyboard)
                    : undefined
                }
                onCompareFrames={compare.frames ? () => setFramesCompareShotId(storyboard.id) : undefined}
                onCompareVideo={compare.video ? () => setVideoCompareShotId(storyboard.id) : undefined}
              />
            );
          })}
        </div>
      ) : null}
    </div>
      {videoUrl ? (
        <VideoPreviewModal
          videoUrl={videoUrl}
          isOpen
          onClose={closeShotVideo}
          keyframeActions={keyframeActions}
        />
      ) : null}
      {framesCompareShot ? (
        <ShotImageCompareDialog
          storyboard={framesCompareShot}
          open
          onClose={() => setFramesCompareShotId(null)}
        />
      ) : null}
      {videoCompareShot ? (
        <ShotVideoCompareDialog
          projectId={activeProjectId ?? undefined}
          storyboard={videoCompareShot}
          candidates={videoCandidates}
          open
          onClose={() => setVideoCompareShotId(null)}
        />
      ) : null}
    </>
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
  onPlayVideo,
  onCompareFrames,
  onCompareVideo,
}: {
  storyboard: StoryboardItem;
  onOpen: () => void;
  /** 有单镜视频时的播放回调(09-14 用户裁定:详情可看单镜头播放) */
  onPlayVideo?: () => void;
  /** 关键帧两帧对比入口(09-15 P1b;帧≥2 才传入) */
  onCompareFrames?: () => void;
  /** 单镜视频版本对入口(09-15 P1b;有上一版才传入) */
  onCompareVideo?: () => void;
}) {
  const updateStoryboard = useStudioStore((state) => state.updateStoryboard);
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
        {/* 单镜视频播放(09-14 用户裁定):中央▶,点击不冒泡进卡 */}
        {onPlayVideo ? (
          <button
            type="button"
            aria-label={`播放 S${String(storyboard.index).padStart(2, "0")} 单镜视频`}
            data-storyboard-panel-play
            className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/75 text-foreground/90 backdrop-blur-sm transition-colors hover:bg-background/95 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onPlayVideo();
            }}
          >
            <Play className="h-5 w-5 translate-x-0.5" />
          </button>
        ) : null}
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
        {(onCompareFrames || onCompareVideo) ? (
          <div className="mt-1 flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
            {onCompareFrames ? (
              <button
                type="button"
                data-storyboard-compare-frames
                title="左右滑动对比本镜第 1、2 帧关键帧"
                className="rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={onCompareFrames}
              >
                对比两帧
              </button>
            ) : null}
            {onCompareVideo ? (
              <button
                type="button"
                data-storyboard-compare-video
                title="当前版单镜视频与上一版并排同步对比"
                className="rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={onCompareVideo}
              >
                对比上一版
              </button>
            ) : null}
          </div>
        ) : null}
        {storyboard.mediaRef?.kind === "video" ? (
          <label
            className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <span>混音</span>
            <select
              aria-label={`S${String(storyboard.index).padStart(2, "0")} 混音`}
              data-testid="storyboard-audio-mix"
              className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px] text-foreground"
              value={storyboard.audioMix ?? "tts-stack"}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation();
                updateStoryboard(storyboard.id, {
                  audioMix: event.target.value as StoryboardItem["audioMix"],
                });
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <option value="h3-baked">用片内声</option>
              <option value="tts-stack">配音主导</option>
              <option value="mixed">双层混音</option>
            </select>
          </label>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1 text-[11px] text-primary/75 group-hover:text-primary">
          <ImageIcon className="h-3.5 w-3.5" />
          进入图片工作流
        </span>
      </div>
    </div>
  );
}
