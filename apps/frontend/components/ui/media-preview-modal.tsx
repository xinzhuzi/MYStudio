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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** 截帧回灌动作(09-15 P1a):提供时视频下方渲染操作条;纯展示基件,
   *  抽帧/落库由上层(分镜面板)注入回调,本组件只上报当前播放时刻。 */
  keyframeActions?: {
    /** 「存为关键帧」:当前播放帧(秒) */
    onSaveCurrentFrame?: (currentTimeS: number) => void;
    /** 「自动抽帧」:3/5/9 帧均匀采样 */
    onAutoSample?: (count: 3 | 5 | 9) => void;
    /** 抽帧进行中(按钮禁用+进度文案,不锁模态) */
    busy?: boolean;
    /** 禁用原因(tooltip 大白话;非空=两动作禁用,如「视频不在项目内」) */
    disabledReason?: string;
  };
}

export function VideoPreviewModal({
  videoUrl,
  isOpen,
  onClose,
  keyframeActions,
}: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const disabled = Boolean(keyframeActions?.disabledReason);
  const actionsDisabled = disabled || Boolean(keyframeActions?.busy);
  const tooltip = keyframeActions?.disabledReason ?? (keyframeActions?.busy ? "正在抽帧…" : undefined);

  const reportCurrentTime = () => {
    const currentTimeS = videoRef.current?.currentTime;
    if (typeof currentTimeS === "number" && Number.isFinite(currentTimeS)) {
      keyframeActions?.onSaveCurrentFrame?.(currentTimeS);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(event) => event.stopPropagation()}>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          autoPlay
          className="max-w-full max-h-[86vh] object-contain"
          data-video-preview-player
        />
        {keyframeActions ? (
          <div
            className="mt-2 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-border/40 bg-background/90 px-3 py-2 backdrop-blur-xs"
            data-video-keyframe-actions
          >
            <button
              type="button"
              disabled={actionsDisabled || !keyframeActions.onSaveCurrentFrame}
              title={tooltip ?? "把当前播放的这一帧存为本镜关键帧"}
              className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              data-video-keyframe-save
              onClick={reportCurrentTime}
            >
              {keyframeActions.busy ? "抽帧中…" : "存为关键帧"}
            </button>
            <span className="text-xs text-muted-foreground" data-video-keyframe-sample-label>自动抽帧</span>
            {([3, 5, 9] as const).map((count) => (
              <button
                key={count}
                type="button"
                disabled={actionsDisabled || !keyframeActions.onAutoSample}
                title={tooltip ?? `均匀抽 ${count} 帧,更新本镜关键帧(最多留 4 帧)`}
                className="rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                data-video-keyframe-sample={count}
                onClick={() => keyframeActions.onAutoSample?.(count)}
              >
                {count} 帧
              </button>
            ))}
          </div>
        ) : null}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute top-2 right-2 p-2 rounded-full bg-background/80 hover:bg-background text-foreground border border-border/40 backdrop-blur-xs transition-all"
          aria-label="关闭预览"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
