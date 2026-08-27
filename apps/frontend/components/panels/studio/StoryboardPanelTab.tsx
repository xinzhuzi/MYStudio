import { useState } from "react";
import { ArrowLeft, History, Image as ImageIcon, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import { buildStoryboardItemOpenContext } from "./storyboard-open-context";
import { toPreviewSrc, withThumbVariant } from "./previews/preview-src";
import { PreviewImage } from "./previews/preview-image";
import { handleDeferScroll } from "./previews/interaction-defer";
import { InteractionDeferHint } from "./previews/interaction-defer-hint";
import type { StoryboardBatchGenerationState } from "./image-workflow/use-storyboard-batch-generation";
import { StoryboardKeyframeBackfillDialog } from "./StoryboardKeyframeBackfillDialog";

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
  const [backfillOpen, setBackfillOpen] = useState(false);
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
          <InteractionDeferHint />
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
        <Button
          size="sm"
          variant="outline"
          data-storyboard-panel-backfill
          title="导入回接脚本 mapping.json,把旧镜图接入新分镜的关键帧序列"
          onClick={() => setBackfillOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          回接旧镜图
        </Button>
      </div>

      <StoryboardKeyframeBackfillDialog open={backfillOpen} onClose={() => setBackfillOpen(false)} />

      {ordered.length ? (
        <div
          className="mt-3 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3 overflow-y-auto pr-1"
          onScroll={handleDeferScroll}
        >
          {ordered.map((storyboard) => {
            const mediaPath = storyboard.mediaRef?.kind === "image" ? storyboard.mediaRef.path : undefined;
            return (
              <button
                key={storyboard.id}
                type="button"
                data-storyboard-panel-shot={storyboard.id}
                className="group flex flex-col rounded-lg border border-border/70 bg-card/70 text-left transition-colors hover:border-primary/50"
                onClick={() => openShot(storyboard)}
                title={`进入分镜 ${storyboard.index} 图片工作流`}
              >
                {/* 统一 176px 高度框 + object-contain:分镜图混有 16:9/方图/竖图
                    (最长约 1:2.1),完整显示零裁切且网格行高恒定(自然高度曾致
                    网格行塌陷成 13px 扁条,勿改回 h-auto)。
                    注意:卡片本体不可加 overflow-hidden——网格定高(flex-1)+
                    条目 overflow-hidden 会触发 Chromium 行高坍缩(实测 45px);
                    裁切下沉到媒体框(overflow-hidden rounded-t-lg),卡片圆角
                    由 border-radius 裁自身背景。 */}
                <div className="relative h-44 w-full overflow-hidden rounded-t-lg bg-muted/40">
                  {mediaPath ? (
                    <PreviewImage
                      src={withThumbVariant(toPreviewSrc(mediaPath))}
                      alt={storyboard.prompt}
                      className="h-full w-full object-contain"
                      fallbackLabel="成图丢失"
                      eager
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                      未生成
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                    S{String(storyboard.index).padStart(2, "0")}
                  </span>
                  {mediaPath ? <ResolutionBadge src={toPreviewSrc(mediaPath)} /> : null}
                  {storyboard.keyframes?.length ? (
                    <span className="absolute bottom-1 left-1 flex items-center gap-1" data-storyboard-frame-dots>
                      {storyboard.keyframes.map((frame) => (
                        <span
                          key={frame.frameId}
                          title={`${frame.frameId}${frame.mediaRef?.path ? "" : " · 缺图"}`}
                          className={`h-1.5 w-1.5 rounded-full ${frame.mediaRef?.path ? "bg-primary/80" : "bg-muted-foreground/40"}`}
                        />
                      ))}
                    </span>
                  ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
                  {/* 文案不截断(用户裁定:分镜面板要展示完全;videoDesc 实测最长 56 字) */}
                  <p className="text-[11px] leading-4 text-foreground">
                    {storyboard.videoDesc || storyboard.prompt}
                  </p>
                  {storyboard.lines ? (
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      {storyboard.lines}
                    </p>
                  ) : null}
                  <span className="mt-auto inline-flex items-center gap-1 text-[10px] text-primary/75 group-hover:text-primary">
                    <ImageIcon className="h-3 w-3" />
                    进入图片工作流
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
