import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Loader2, ZoomIn } from "lucide-react";
import { useDirectImageUpscale } from "../use-direct-image-upscale";
import { isUpscaledMediaPath, UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import type { ImageWorkflowOpenContext } from "@/types/studio";
import type { ProductionFlowNodeModel } from "../workflow-node-model";
import { buildStoryboardImageOpenContext } from "../storyboard-open-context";
import { ResolutionBadge, probeImagePixelSize } from "@/components/ui/image-resolution-badge";
import { PreviewImage } from "./preview-image";
import { TextPreview } from "./text-preview";
import { toPreviewSrc, withThumbVariant } from "./preview-src";
import { handleDeferScroll } from "./interaction-defer";

/**
 * 4K 预判(超分按钮禁用判据,非显示用):up4x- 输出路径必然 ≥4K(同步可靠);
 * 其余依赖 <img> naturalWidth(onLoad 尽力而为——后端守卫兜底)。
 * 显示角标统一走 ResolutionBadge(真实像素分档)。
 */
function tileAlready4k(mediaPath: string | undefined, longSide: number | undefined): boolean {
  if (isUpscaledMediaPath(mediaPath)) return true;
  return (longSide ?? 0) > UPSCALE_INPUT_MAX_LONG_SIDE;
}

/** 画布瓦片网格截断数:画布节点只为顺滑负责,全量走分镜面板独立界面
 * (2026-08-26 架构瘦身:82 图内嵌=巨节点卡顿根源)。 */
const CANVAS_TILE_CAP = 8;

export function StoryboardGridPreview({
  node,
  onOpenImageWorkflow,
  onOpenStoryboardPanel,
}: {
  node: ProductionFlowNodeModel;
  onOpenImageWorkflow?: (context: ImageWorkflowOpenContext) => void;
  /** 「查看全部」入口:跳分镜面板独立界面(画布瘦身后的全量视图) */
  onOpenStoryboardPanel?: () => void;
}) {
  const allTiles = useMemo(() => node.storyboardTiles ?? [], [node.storyboardTiles]);
  const tiles = useMemo(
    () => (allTiles.length > CANVAS_TILE_CAP ? allTiles.slice(0, CANVAS_TILE_CAP) : allTiles),
    [allTiles],
  );
  const hiddenCount = allTiles.length - tiles.length;
  const directUpscale = useDirectImageUpscale();
  const [tileLongSides, setTileLongSides] = useState<Record<string, number>>({});
  // 4K 预判用原图真实尺寸(IPC 文件头探测,带缓存):展示 <img> 已改缩略图,
  // onLoad naturalWidth 量到的是 512 缩略图,不能再用。
  useEffect(() => {
    let cancelled = false;
    for (const tile of tiles) {
      if (!tile.mediaPath) continue;
      void probeImagePixelSize(toPreviewSrc(tile.mediaPath)).then((size) => {
        if (cancelled || !size) return;
        const longSide = Math.max(size.width, size.height);
        setTileLongSides((previous) =>
          previous[tile.id] === longSide ? previous : { ...previous, [tile.id]: longSide },
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [tiles]);
  if (!tiles.length) return <TextPreview node={node} />;
  return (
    <div
      className="nodrag nowheel max-h-[360px] overflow-y-auto overscroll-contain pr-1"
      onScroll={handleDeferScroll}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
        {tiles.map((tile) => {
          // 任意分镜瓦片都是生图入口:无工作流/无图的新分镜点击后由画布按需创建
          // 绑定该分镜的工作流(2026-08-22 实证:canOpenWorkflow 旧门禁把 82 个
          // 新分镜挡在门外,首次生图无入口——只有二次进入才需要 imageWorkflowId)
          const canOpenWorkflow = Boolean(tile.id && onOpenImageWorkflow);
          const openStoryboardImageWorkflow = () => {
            onOpenImageWorkflow?.(buildStoryboardImageOpenContext(tile));
          };
          const previewTile = (
            <>
              {tile.mediaPath ? (
                <PreviewImage
                  src={withThumbVariant(tile.mediaPath)}
                  alt={tile.title}
                  className="h-full w-full object-cover"
                  fallbackLabel="成图丢失"
                  previewable
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                  未生成
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                S{String(tile.index).padStart(2, "0")}
              </span>
              <span className="absolute right-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-foreground">
                {tile.state}
              </span>
              {tile.mediaPath ? (
                <ResolutionBadge
                  src={toPreviewSrc(tile.mediaPath)}
                  className="bottom-1 right-1 top-auto"
                />
              ) : null}
            </>
          );
          return (
          <div key={tile.id} className="min-w-0">
            {canOpenWorkflow ? (
              <button
                type="button"
                aria-label={`打开分镜 ${tile.index} 图片工作流`}
                data-storyboard-id={tile.id}
                data-storyboard-workflow-image-id={tile.imageWorkflowId ?? ""}
                data-storyboard-workflow-id={tile.imageWorkflowId}
                className="nodrag nopan nowheel relative block aspect-video w-full overflow-hidden rounded-md border border-info/35 bg-muted/30 text-left ring-offset-background hover:border-info/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2"
                onClick={openStoryboardImageWorkflow}
              >
                {previewTile}
              </button>
            ) : (
              <div className="relative aspect-video overflow-hidden rounded border border-border bg-muted/30">
                {previewTile}
              </div>
            )}
            {canOpenWorkflow ? (
              <button
                type="button"
                data-storyboard-id={tile.id}
                data-storyboard-workflow-id={tile.imageWorkflowId}
                className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-1 text-[10px] text-muted-foreground hover:border-primary/45 hover:text-foreground"
                onClick={openStoryboardImageWorkflow}
              >
                <ImageIcon className="h-3 w-3" />
                进入分镜图片工作流
              </button>
            ) : null}
            {tile.mediaPath ? (
              <button
                type="button"
                data-storyboard-upscale-id={tile.id}
                disabled={directUpscale.busyKey === `storyboard:${tile.id}` || tileAlready4k(tile.mediaPath, tileLongSides[tile.id])}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-1 text-[10px] text-muted-foreground hover:border-viz-glow/45 hover:text-foreground disabled:opacity-60"
                title={tileAlready4k(tile.mediaPath, tileLongSides[tile.id])
                  ? "已是 4K 超分结果，无需再放大"
                  : "本地 Real-ESRGAN 原生 ×4 放大(超分后视觉审核重置)"}
                onClick={(event) => {
                  event.stopPropagation();
                  void directUpscale.upscaleStoryboardImage(tile.id);
                }}
              >
                {directUpscale.busyKey === `storyboard:${tile.id}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ZoomIn className="h-3 w-3" />
                )}
                超分 4K
              </button>
            ) : null}
            <p className="mt-1 line-clamp-1 text-[10px] text-foreground">
              {tile.title}
            </p>
            {tile.lines ? (
              <p className="line-clamp-1 text-[10px] text-muted-foreground">
                {tile.lines}
              </p>
            ) : null}
          </div>
        );
        })}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          data-storyboard-open-panel
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-info/40 bg-muted/30 px-2 py-1.5 text-[10px] font-medium text-foreground hover:border-info/70"
          title={`画布仅预览前 ${CANVAS_TILE_CAP} 镜保证顺滑;全量 ${allTiles.length} 镜在分镜面板独立界面查看`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenStoryboardPanel?.();
          }}
        >
          <ImageIcon className="h-3 w-3" />
          共 {allTiles.length} 镜 · 还有 {hiddenCount} 镜在分镜面板
        </button>
      ) : null}
    </div>
  );
}
