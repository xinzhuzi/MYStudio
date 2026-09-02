// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 媒体预览模态组件 (Media Preview Modals)
 * 用于全屏预览图片和视频
 * 支持: HTTP URL / data URI / local-image:// 协议
 *
 * 图片大图预览整体套用 yet-another-react-lightbox(MIT)+ 官方 Zoom 插件:
 * 滚轮缩放 / 双击放大还原 / 触控板与触屏捏合 / 拖拽平移 / 工具栏
 * 放大缩小按钮 / Esc 与背景点击关闭,均为插件自带能力,零手写手势。
 * 批量组传入 imageUrls 时弹窗内可左右箭头/方向键翻页整组图。
 * 左上角像素角标经 render.toolbar 注入,与默认工具栏并存。
 */

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";

interface ImagePreviewModalProps {
  imageUrl: string;
  /** 批量组:弹窗内可翻页查看的全部图址(缺省/空=单图 imageUrl) */
  imageUrls?: string[];
  /** 批量组:弹窗初始展示索引(缺省 0) */
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({
  imageUrl,
  imageUrls,
  initialIndex,
  isOpen,
  onClose,
}: ImagePreviewModalProps) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const previewSlides = (imageUrls && imageUrls.length > 0 ? imageUrls : [imageUrl])
    .map((src) => ({ src, alt: "Preview" }));
  const startIndex = Math.min(Math.max(initialIndex ?? 0, 0), previewSlides.length - 1);

  return createPortal(
    <Lightbox
      open={isOpen}
      close={onClose}
      controller={{ closeOnBackdropClick: true }}
      slides={previewSlides}
      index={startIndex}
      plugins={[Zoom]}
      zoom={{
        // 滚轮/触控板滚动缩放默认关闭,显式开启(桌面看图核心诉求)
        scrollToZoom: true,
      }}
      carousel={{ finite: true }}
      labels={{
        Close: "关闭预览",
        "Zoom in": "放大",
        "Zoom out": "缩小",
        Previous: "上一张",
        Next: "下一张",
      }}
      toolbar={{
        buttons: [
          <span
            key="resolution-badge"
            style={{ pointerEvents: "none", cursor: "default", alignSelf: "center" }}
            aria-hidden
          >
            <ResolutionBadge src={imageUrl} />
          </span>,
          "close",
        ],
      }}
      styles={{ container: { backgroundColor: "rgba(0, 0, 0, .82)" } }}
    />,
    document.body,
  );
}

interface VideoPreviewModalProps {
  videoUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoPreviewModal({
  videoUrl,
  isOpen,
  onClose,
}: VideoPreviewModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <video
          src={videoUrl}
          controls
          autoPlay
          className="max-w-full max-h-[90vh] object-contain"
        />
        <button
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
