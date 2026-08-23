import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import { buildStoryboardItemOpenContext } from "./WorkflowNodePreviews";
import { toPreviewSrc } from "./WorkbenchTrackCard";

/**
 * 分镜面板 — 当前章节全部分镜的全量视图(与单镜图片工作流严格区分)。
 *
 * 入口:工作流节点图「分镜面板」节点的「进入」按钮(targetStage=storyboardPanel)。
 * 每张卡片点击即进入该镜的图片工作流(返回时回到本面板,经 sourceStage 回跳)。
 */
export function StoryboardPanelTab({
  storyboards,
  onOpenImageWorkflow,
}: {
  storyboards: StoryboardItem[];
  onOpenImageWorkflow: (context: ImageWorkflowOpenContext) => void;
}) {
  const ordered = storyboards.slice().sort((a, b) => a.index - b.index);
  const withImage = ordered.filter((item) => item.mediaRef?.kind === "image").length;
  const firstUngenerated = ordered.find((item) => item.mediaRef?.kind !== "image") ?? ordered[0];

  const openShot = (storyboard: StoryboardItem) => {
    onOpenImageWorkflow({
      ...buildStoryboardItemOpenContext(storyboard),
      sourceStage: "storyboardPanel",
      sourceStageLabel: "分镜面板",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-storyboard-panel-tab>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-foreground">分镜面板</h3>
          <span className="text-sm text-muted-foreground">
            {ordered.length ? `${ordered.length} 个分镜 · ${withImage} 个画面` : "尚无分镜,请先生成分镜表"}
          </span>
        </div>
        {firstUngenerated ? (
          <Button
            size="sm"
            data-storyboard-panel-generate
            title={`进入分镜 ${firstUngenerated.index} 图片工作流(首个未生成分镜)`}
            onClick={() => openShot(firstUngenerated)}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            分镜生图
          </Button>
        ) : null}
      </div>

      {ordered.length ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3 overflow-y-auto pr-1">
          {ordered.map((storyboard) => {
            const mediaPath = storyboard.mediaRef?.kind === "image" ? storyboard.mediaRef.path : undefined;
            return (
              <button
                key={storyboard.id}
                type="button"
                data-storyboard-panel-shot={storyboard.id}
                className="group flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card/70 text-left transition-colors hover:border-primary/50"
                onClick={() => openShot(storyboard)}
                title={`进入分镜 ${storyboard.index} 图片工作流`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
                  {mediaPath ? (
                    <img
                      src={toPreviewSrc(mediaPath)}
                      alt={storyboard.prompt}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                      未生成
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                    S{String(storyboard.index).padStart(2, "0")}
                  </span>
                  {mediaPath ? (
                    <span className="absolute right-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-foreground">
                      已生成
                    </span>
                  ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
                  <p className="line-clamp-2 text-[11px] leading-4 text-foreground">
                    {storyboard.videoDesc || storyboard.prompt}
                  </p>
                  {storyboard.lines ? (
                    <p className="line-clamp-1 text-[10px] leading-4 text-muted-foreground">
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
