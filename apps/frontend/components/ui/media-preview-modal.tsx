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

import { useCallback, useEffect, useMemo, useState } from "react";
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

// yarl 官方要求(README「plugins must be defined outside」):plugins 及
// 各配置对象须保持引用稳定——内联字面量每次渲染都触发插件/配置重置,
// zoom 状态被清(放大点了没效果,jsdom+装机实弹双双复现;09-03 根修)。
const LIGHTBOX_PLUGINS = [Zoom];
const CONTROLLER_CONFIG = { closeOnBackdropClick: true };
// 缩放配置:滚轮/触控板滚动缩放默认关闭,显式开启(桌面看图核心诉求)。
// maxZoomPixelRatio 默认 1=最大只放大到原始像素 1:1——大图在不满容器的
// 场景视觉变化极小(09-03 用户裁定「需要再放大」),放开到 4 倍原始像素
// 看细节;步幅 2.5 一步到位看大。
const ZOOM_CONFIG = { scrollToZoom: true, maxZoomPixelRatio: 4, zoomInMultiplier: 2.5 };
const CAROUSEL_CONFIG = { finite: true };
// 点击跟手(09-03 用户裁定「按钮非常不灵敏」):fade/swipe 默认 250/500ms,
// 动画播放期间导航与缩放的点击被吞——连点无反应;zoom 动画同理。全部
// 置 0 立即生效,连点跟手。
const ANIMATION_CONFIG = { fade: 0, swipe: 0, zoom: 0 };
const LABELS = {
  Close: "关闭预览",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  Previous: "上一张",
  Next: "下一张",
};
const CONTAINER_STYLES = {
  container: {
    backgroundColor: "rgba(0, 0, 0, .82)",
    // Radix 模态锁穿透(09-03):从 Radix Dialog(如生成记录弹窗)内
    // 打开预览时,Radix 给 body 置 pointer-events:none 且只恢复自身
    // 内容树;Lightbox portal 在 body 下、不在该树内——不显式恢复
    // 则放大/缩小/关闭全部点不动(可见但僵死)。
    pointerEvents: "auto" as const,
  },
};

export function ImagePreviewModal({
  imageUrl,
  imageUrls,
  initialIndex,
  isOpen,
  onClose,
}: ImagePreviewModalProps) {
  // 受控翻页索引:初始=props;弹窗重开或图组变化时重置(避免上次翻页残留)
  const [indexState, setIndexState] = useState(initialIndex ?? 0);
  useEffect(() => {
    setIndexState(initialIndex ?? 0);
  }, [isOpen, initialIndex]);
  const callbacks = useMemo(
    () => ({
      view: ({ index: nextIndex }: { index: number }) => setIndexState(nextIndex),
    }),
    [],
  );
  // 工具栏含 ResolutionBadge(随图变化),useMemo 稳定引用
  const toolbar = useMemo(
    () => ({
      buttons: [
        <span
          key="resolution-badge"
          style={{ pointerEvents: "none", cursor: "default", alignSelf: "center" }}
          aria-hidden
        >
          <ResolutionBadge src={imageUrl} />
        </span>,
        "close",
      ] as React.ReactNode[],
    }),
    [imageUrl],
  );

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

  return createPortal(
    <Lightbox
      open={isOpen}
      close={onClose}
      controller={CONTROLLER_CONFIG}
      slides={previewSlides}
      index={indexState}
      on={callbacks}
      plugins={LIGHTBOX_PLUGINS}
      zoom={ZOOM_CONFIG}
      carousel={CAROUSEL_CONFIG}
      animation={ANIMATION_CONFIG}
      labels={LABELS}
      toolbar={toolbar}
      styles={CONTAINER_STYLES}
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
