// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 全仓唯一图片展示组件(08-30 合一裁定:吸收 previews/PreviewImage,
 * 淘汰双胞胎包装与双归一化)。
 *
 * - src 归一化走 toPreviewSrc(preview-src.ts,全仓唯一入口)
 * - fallback=备用图地址(失败换图);fallbackLabel=终态占位文案(默认「图片加载失败」)
 * - resolutionBadge:左上角真实像素尺寸角标(例如 1920×1080)
 * - previewable:右下角常驻「展示」角标,点击经 portal 全屏弹 ImagePreviewModal
 *   看原图(自动剥 ?thumb=1);角标 stopPropagation 不触发宿主点击导航
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { ImagePreviewModal } from "@/components/ui/media-preview-modal";

interface LocalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: string;
  /** 终态失败占位文案(fallback 图也失败/未提供时展示) */
  fallbackLabel?: string;
  /** 开启后在图片左上角叠加真实像素尺寸角标(默认关闭,关闭时渲染结构与纯 <img> 一致) */
  resolutionBadge?: boolean;
  /** 显式 loading="eager"(React Flow 等容器内原生 lazy 失效,见 6988a6f) */
  eager?: boolean;
  /** 内置「展示」大图入口(08-30 裁定:节点图链路看图一律可放大看原图) */
  previewable?: boolean;
  /** 大图地址;缺省取 src 剥 ?thumb=1(消费方普遍传缩略变体) */
  previewSrc?: string;
  /** 批量组:弹窗内可翻页查看的全部图址(缺省=单图);纯增量可选,存量调用方零影响 */
  previewImages?: string[];
  /** 批量组:弹窗初始展示索引(缺省 0) */
  previewIndex?: number;
}

export function LocalImage({
  src,
  fallback,
  fallbackLabel = "图片加载失败",
  className,
  alt,
  resolutionBadge = false,
  eager = false,
  previewable = false,
  previewSrc,
  previewImages,
  previewIndex,
  ...props
}: LocalImageProps) {
  const [error, setError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(() => toPreviewSrc(src));
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleError = () => {
    if (!error && fallback) {
      setError(true);
      setCurrentSrc(toPreviewSrc(fallback));
    } else {
      setError(true);
    }
  };

  useEffect(() => {
    setCurrentSrc(toPreviewSrc(src));
    setError(false);
  }, [src]);

  if (error && !fallback) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/30 text-muted-foreground",
          className,
        )}
        data-local-image-failed={alt ?? ""}
        data-preview-image-failed={alt ?? ""}
        style={props.style}
      >
        <ImageOff className="h-5 w-5 text-muted-foreground/50" />
        <span className="px-1 text-center text-[9px] leading-3">{fallbackLabel}</span>
      </div>
    );
  }

  const image = (
    <img
      src={currentSrc}
      alt={alt}
      className={resolutionBadge || previewable ? cn("h-full w-full", className) : className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={handleError}
      {...props}
    />
  );

  if (!resolutionBadge && !previewable) return image;

  return (
    <span className="relative block h-full w-full">
      {image}
      {resolutionBadge ? <ResolutionBadge src={currentSrc} /> : null}
      {previewable ? (
        <>
          <button
            type="button"
            aria-label={alt ? `展示大图 ${alt}` : "展示大图"}
            title="全屏查看原图"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className="nodrag nopan absolute bottom-1.5 right-1.5 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/95 px-2 text-[10px] font-medium text-foreground transition-colors hover:border-primary/45 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-muted/40"
          >
            <Maximize2 className="h-3 w-3" />
            展示
          </button>
          {previewOpen
            ? createPortal(
                <ImagePreviewModal
                  imageUrl={previewSrc ?? currentSrc.replace(/\?thumb=1$/, "")}
                  imageUrls={previewImages && previewImages.length > 0 ? previewImages : undefined}
                  initialIndex={previewIndex}
                  isOpen
                  onClose={() => setPreviewOpen(false)}
                />,
                document.body,
              )
            : null}
        </>
      ) : null}
    </span>
  );
}
