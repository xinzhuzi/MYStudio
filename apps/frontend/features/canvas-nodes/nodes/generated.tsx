// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { LocalImage } from "@/components/ui/local-image";
import { ResolutionBadge, probeImagePixelSize } from "@/components/ui/image-resolution-badge";
import { toPreviewSrc, withThumbVariant } from "@/lib/media/preview-src";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import type { ImageWorkflowGeneratedNode } from "@/types/studio";
import type { CanvasNodeDefinition } from "../node-registry";

/** 成图节点定义(09-08 P3):生图链最后一步——触发+展示;不能单独生图
 *  (09-07 用户终裁:提示词等输入全部来自上游连线) */
export const generatedNodeDefinition: CanvasNodeDefinition = {
  typeId: "generated",
  label: "成图",
  icon: ImageIcon,
  iconClassName: "border-primary/30 bg-primary/10 text-primary",
  width: 560,
  defaultExpanded: true,
  handles: [
    {
      kind: "target",
      label: "图",
      position: "Left",
      className: "border-info/40! bg-info/20!",
      title: "输入口:上游提示词(正/负)/无衣物/NSFW/参考图连这里",
    },
    {
      kind: "source",
      label: "成图",
      position: "Right",
      className: "border-info/40! bg-info/20!",
      title: "输出口:结果可连下游成图/无衣物图口继续精修",
    },
  ],
  summary: (node) => {
    const status = node.status;
    if (status === "generating" || status === "queued") return "正在生成…";
    if (status === "failed") {
      const reason = typeof node.errorReason === "string" ? node.errorReason : "";
      return `生成失败${reason ? `:${reason.slice(0, 30)}` : ""}`;
    }
    if (status === "ready" && typeof node.resultUrl === "string" && node.resultUrl) {
      const res = typeof node.resolution === "string" ? node.resolution : "";
      return `已生成${res ? ` · ${res}` : ""}(点开看结果)`;
    }
    return "等待生成——连线后点生成";
  },
};

/**
 * 成图节点共享视图态(09-09 单源上提):生成中判定+结果像素探测+超分幂等
 * 判据(up4x- 文件名或长边超限)。两画布编辑器经此 hook 消费,不再各抄一份。
 */
export function useGeneratedNodeMeta(node: ImageWorkflowGeneratedNode) {
  const generating = node.status === "generating" || node.status === "queued";
  const [imageLongSide, setImageLongSide] = useState(0);
  useEffect(() => {
    if (!node.resultUrl) {
      setImageLongSide(0);
      return;
    }
    let cancelled = false;
    void probeImagePixelSize(toPreviewSrc(node.resultUrl)).then((size) => {
      if (cancelled || !size) return;
      setImageLongSide(Math.max(size.width, size.height));
    });
    return () => {
      cancelled = true;
    };
  }, [node.resultUrl]);
  const alreadyUpscaled =
    (node.resultUrl || "").includes("up4x-") || imageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  return { generating, imageLongSide, alreadyUpscaled };
}

/** 单图结果框(共享):无结果=中性「等待生成」占位(失败原因不进卡,09-03 裁定) */
export function GeneratedImageFrame({
  node,
  thumb,
}: {
  node: ImageWorkflowGeneratedNode;
  thumb?: boolean;
}) {
  if (!node.resultUrl) {
    return (
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">等待生成</div>
      </div>
    );
  }
  const previewSrc = toPreviewSrc(node.resultUrl);
  return (
    <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
      <span className="relative flex h-full w-full">
        <LocalImage
          src={thumb ? withThumbVariant(previewSrc) : previewSrc}
          alt={node.title}
          className="h-full w-full object-cover"
          eager
          previewable
        />
        <ResolutionBadge src={previewSrc} />
      </span>
    </div>
  );
}

/**
 * 批量图片组渲染(09-02 用户终裁;09-09 随编辑器上提单源):
 * 图片上左右箭头切图,右下角当前序号;不做叠卡/展开网格/张数角标。
 * 生效组(不变量见 effectiveBatchImages)由画布侧算好注入——超分/单张
 * 重生成后旧 batch 不再显示。
 */
export function BatchImageArea({
  node,
  images,
}: {
  node: ImageWorkflowGeneratedNode;
  images: string[];
}) {
  const [viewIndex, setViewIndex] = useState(0);
  // 图片数变化(重新生成)时钳回有效范围
  const safeIndex = Math.min(viewIndex, Math.max(0, images.length - 1));
  const current = images[safeIndex] ?? node.resultUrl ?? "";

  if (!node.resultUrl) {
    return (
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {/* 失败原因不进卡(09-03 用户裁定:弹窗呈现);占位保持中性文案 */}
          等待生成
        </div>
      </div>
    );
  }

  const isGroup = images.length > 1;

  return (
    <div className="nodrag nopan relative">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        <span className="relative flex h-full w-full">
          <LocalImage
            src={toPreviewSrc(current)}
            alt={`${node.title} ${safeIndex + 1}`}
            className="h-full w-full object-cover"
            eager
            previewable
            previewImages={images.length > 1 ? images.map((url) => toPreviewSrc(url)) : undefined}
            previewIndex={images.length > 1 ? safeIndex : undefined}
          />
          <ResolutionBadge src={toPreviewSrc(current)} />
        </span>
      </div>
      {isGroup ? (
        <>
          <button
            type="button"
            aria-label="上一张"
            disabled={safeIndex === 0}
            className="absolute left-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-card/85 text-card-foreground backdrop-blur-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => setViewIndex(safeIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={safeIndex === images.length - 1}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-card/85 text-card-foreground backdrop-blur-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => setViewIndex(safeIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {/* 右下角轻序号:当前/总数,当前张即主图(resultUrl 同步) */}
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-foreground backdrop-blur-sm">
            {safeIndex + 1} / {images.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * 成图编辑器骨架(09-09 单源上提,两画布共用):共享=图区默认单图框+
 * 视图态 hook+布局;差异经注入——
 * - imageArea 覆盖图区(图片工作室传批量组)
 * - paramsRow=参数行(两画布列数/回落语义各异,含 panels 层模型选择器,
 *   故整行由画布侧渲染)
 * - children=画布专属块(状态行/MJ·Ideogram 参数/参考容量提示)
 * - actionsRow=操作行渲染函数,收 meta(generating/alreadyUpscaled)
 */
export function GeneratedNodeEditor({
  node,
  thumb,
  imageArea,
  paramsRow,
  children,
  actionsRow,
}: {
  node: ImageWorkflowGeneratedNode;
  thumb?: boolean;
  imageArea?: React.ReactNode;
  paramsRow?: React.ReactNode;
  children?: React.ReactNode;
  actionsRow?: (meta: {
    generating: boolean;
    alreadyUpscaled: boolean;
  }) => React.ReactNode;
}) {
  const meta = useGeneratedNodeMeta(node);
  return (
    <div className="space-y-3">
      {imageArea ?? <GeneratedImageFrame node={node} thumb={thumb} />}
      {paramsRow}
      {children}
      {actionsRow?.(meta)}
      {/* 09-07 用户终裁:成图=生图链最后一步(触发+展示),不能单独生图——
          卡上零提示词框(无上游时点生成由生成链阻断并指路,见 run-node-generation) */}
    </div>
  );
}
