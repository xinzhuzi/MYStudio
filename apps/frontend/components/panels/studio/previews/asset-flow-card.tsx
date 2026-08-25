import { useEffect, useState } from "react";
import { ImageIcon, ImageOff, Loader2, PackageOpen, RefreshCw, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDirectImageUpscale } from "../use-direct-image-upscale";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import type { AssetImageWorkflowContext, ImageWorkflowTarget } from "@/types/studio";
import type { ProductionFlowAssetCard } from "../workflow-node-model";
import { ResolutionBadge, probeImagePixelSize } from "@/components/ui/image-resolution-badge";
import { toPreviewSrc, withThumbVariant } from "./preview-src";
import { PreviewImage } from "./preview-image";

export function AssetFlowCard({
  card,
  onOpenAssetImageWorkflow,
}: {
  card: ProductionFlowAssetCard;
  onOpenAssetImageWorkflow?: (context: AssetImageWorkflowContext) => void;
}) {
  const status = card.generationState ?? (card.mediaPath ? "已完成" : "未生成");
  const directUpscale = useDirectImageUpscale();
  const assetUpscaleTarget = isAssetWorkflowTarget(card.imageWorkflowTarget) && card.imageWorkflowTarget.id
    ? {
        assetType: card.imageWorkflowTarget.assetType as "character" | "scene" | "prop",
        id: card.imageWorkflowTarget.id,
        parentId: card.imageWorkflowTarget.parentId,
      }
    : null;
  const assetUpscaling = assetUpscaleTarget != null
    && directUpscale.busyKey === `asset:${assetUpscaleTarget.id}`;
  const [assetImageLongSide, setAssetImageLongSide] = useState(0);
  // 已-4K 预判用原图真实尺寸(IPC 文件头探测,带缓存):展示 <img> 是缩略图,
  // onLoad naturalWidth 只能量到 512,不能再用。
  useEffect(() => {
    if (!card.mediaPath) return;
    let cancelled = false;
    void probeImagePixelSize(toPreviewSrc(card.mediaPath)).then((size) => {
      if (cancelled || !size) return;
      setAssetImageLongSide(Math.max(size.width, size.height));
    });
    return () => {
      cancelled = true;
    };
  }, [card.mediaPath]);
  const assetAlreadyUpscaled = (card.mediaPath || "").includes("up4x-")
    || assetImageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const canOpenImageWorkflow =
    card.isDerived &&
    Boolean(card.sourceImagePath || card.imageWorkflowId || card.mediaPath) &&
    isAssetWorkflowTarget(card.imageWorkflowTarget);
  const openImageWorkflow = () => {
    if (!isAssetWorkflowTarget(card.imageWorkflowTarget)) return;
    onOpenAssetImageWorkflow?.({
      target: card.imageWorkflowTarget,
      title: card.name,
      prompt: card.prompt,
      sourceImagePath: card.sourceImagePath,
      resultImagePath: card.mediaPath,
      imageWorkflowId: card.imageWorkflowId,
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: `衍生资产 · ${card.name}`,
    });
  };
  const showStatusChip = status !== "已完成";
  const previewFrame = (
    <>
      {card.mediaPath ? (
        <PreviewImage
          src={withThumbVariant(toPreviewSrc(card.mediaPath))}
          alt={card.name}
          className="h-full w-full object-contain"
          fallbackLabel="成图丢失"
        />
      ) : status === "生成中" ? (
        <RefreshCw className="h-8 w-8 animate-spin text-primary/70" />
      ) : (
        <PackageOpen className="h-9 w-9 text-muted-foreground/55" />
      )}
      {card.mediaPath ? <ResolutionBadge src={toPreviewSrc(card.mediaPath)} /> : null}
    </>
  );
  return (
    <div
      className="min-h-[214px] rounded-md border border-border bg-card p-3 text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
      data-parent-asset-id={card.parentAssetId ?? ""}
      data-asset-generation-state={status}
    >
      {canOpenImageWorkflow ? (
        <button
          type="button"
          aria-label={`打开${card.name}图片工作流`}
          data-asset-workflow-image-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-type={card.imageWorkflowTarget?.assetType ?? ""}
          data-asset-workflow-name={card.name}
          className="nodrag nopan nowheel relative flex h-[112px] w-full items-center justify-center overflow-hidden rounded-md border border-info/35 bg-muted/30 ring-offset-background hover:border-info/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2"
          onClick={(event) => {
            event.stopPropagation();
            openImageWorkflow();
          }}
        >
          {previewFrame}
        </button>
      ) : (
        <div className="relative flex h-[112px] items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/30">
          {previewFrame}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {card.typeLabel} / {card.runtimeType}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            card.isDerived
              ? "bg-warning/20 text-foreground"
              : "bg-success/20 text-foreground",
          )}
        >
          {card.isDerived ? "衍生" : "原资产"}
        </span>
      </div>
      {showStatusChip || (card.isDerived && !card.sourceImagePath) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showStatusChip ? (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                status === "生成中" &&
                  "border-primary/30 bg-primary/12 text-primary/80",
                status === "生成失败" &&
                  "border-destructive/30 bg-destructive/12 text-destructive/80",
                status === "未生成" &&
                  "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {status}
            </span>
          ) : null}
          {card.isDerived && !card.sourceImagePath ? (
            <span className="max-w-full truncate rounded border border-viz-glow/30 bg-viz-glow/10 px-1.5 py-0.5 text-[9px] text-warning/80">
              缺父资产图
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-card-foreground">
        {card.name}
      </p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
        {card.reason || card.note || "等待补充资产描述。"}
      </p>
      {card.prompt ? (
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
          生成提示：{card.prompt}
        </p>
      ) : null}
      {canOpenImageWorkflow ? (
        <button
          type="button"
          data-asset-workflow-id={card.imageWorkflowId ?? ""}
          data-asset-workflow-type={card.imageWorkflowTarget?.assetType ?? ""}
          data-asset-workflow-name={card.name}
          className="nodrag nopan nowheel mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-info/35 bg-info/10 px-2 text-[10px] font-medium text-info/80 hover:bg-info/16"
          onClick={(event) => {
            event.stopPropagation();
            openImageWorkflow();
          }}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          进入图片工作流
        </button>
      ) : null}
      {assetUpscaleTarget && card.mediaPath ? (
        <button
          type="button"
          data-asset-upscale-id={assetUpscaleTarget.id}
          disabled={assetUpscaling || assetAlreadyUpscaled}
          title={assetAlreadyUpscaled ? `已达 4K(${assetImageLongSide}px 长边)，无需再超分` : "本地 Real-ESRGAN 原生 ×4 放大(1K→4K)"}
          className="nodrag nopan nowheel mt-1.5 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-[10px] font-medium text-foreground hover:border-viz-glow/45 disabled:opacity-60"
          onClick={(event) => {
            event.stopPropagation();
            void directUpscale.upscaleAssetImage(assetUpscaleTarget, card.mediaPath as string);
          }}
        >
          {assetUpscaling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ZoomIn className="h-3.5 w-3.5" />}
          超分 4K
        </button>
      ) : null}
    </div>
  );
}

export function isAssetWorkflowTarget(
  target: ImageWorkflowTarget | undefined,
): target is AssetImageWorkflowContext["target"] {
  return target?.kind === "asset" && Boolean(target.assetType);
}

export function EmptyDerivedAssetCard() {
  return (
    <div className="flex min-h-[214px] flex-col items-center justify-center rounded-md border border-border bg-card/85 p-3 text-center">
      <ImageOff className="h-10 w-10 text-muted-foreground/55" />
      <p className="mt-3 text-[11px] text-muted-foreground">无衍生资产</p>
    </div>
  );
}
