// Copyright 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 媒体预览模态组件 (Media Preview Modals)
 * 用于全屏预览图片和视频
 * 支持: HTTP URL / data URI / local-image:// 协议
 *
 * 10-25 用户令换件:图片大图预览弃用 yet-another-react-lightbox,改自研轻量灯箱
 * (全事件自控)。替换根因(YARL 双 bug 实弹):
 * ① 连环关两窗——灯箱 portal 在 body 下,宿主 Radix Dialog 的 DismissableLayer
 *   在 document 层监听 pointerdown;灯箱任何指针事件对 Radix 而言都是
 *   「内容树之外」→ 点灯箱背景关灯箱的同时 Radix 也把宿主弹窗关了。
 *   自研件在 portal 根 stopPropagation(pointerdown/click),事件到不了
 *   document,Radix 永远看不见灯箱内的交互——穿透根除。
 * ② X 无效——YARL 工具栏按钮事件经其内部层再出 portal,与 Radix 的
 *   pointer-events 锁/层叠上下文互相绞;自研 X 是普通按钮+显式
 *   stopPropagation,行为确定。
 * 能力对齐原 YARL 配置:滚轮缩放(1x~4x)/双击放大还原/拖拽平移/工具栏
 * 放大缩小/Esc 关闭/背景点击关闭(仅背景)/批量组左右箭头与方向键翻页/
 * 像素角标;动画瞬时(09-03「连点跟手」裁定)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
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

/** 缩放上下限与步进(对齐原 ZOOM_CONFIG:maxZoomPixelRatio 4 / zoomInMultiplier 2.5)。 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.6;
/** 灯箱全局置顶(10-19 裁定沿用:必须压过 Radix overlay 的层叠上下文)。 */
const LIGHTBOX_Z_INDEX = 2147483640;

export function ImagePreviewModal({
  imageUrl,
  imageUrls,
  initialIndex,
  isOpen,
  onClose,
}: ImagePreviewModalProps) {
  const slideUrls = useMemo(
    () => (imageUrls && imageUrls.length > 0 ? imageUrls : [imageUrl]),
    [imageUrls, imageUrl],
  );
  const [index, setIndex] = useState(initialIndex ?? 0);
  const [scale, setScale] = useState(MIN_SCALE);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // 重开/切图重置(弹窗重开或图组变化不残留上次缩放/平移/翻页)
  useEffect(() => {
    if (isOpen) {
      setIndex(initialIndex ?? 0);
      setScale(MIN_SCALE);
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen, initialIndex, imageUrls]);

  const clampIndex = useCallback(
    (next: number) => Math.min(Math.max(next, 0), slideUrls.length - 1),
    [slideUrls.length],
  );
  const navigate = useCallback(
    (delta: number) => {
      setIndex((current) => clampIndex(current + delta));
      setScale(MIN_SCALE);
      setPan({ x: 0, y: 0 });
    },
    [clampIndex],
  );
  const zoomBy = useCallback((factor: number) => {
    setScale((current) => {
      const next = current * factor;
      if (next <= MIN_SCALE) {
        setPan({ x: 0, y: 0 });
        return MIN_SCALE;
      }
      return Math.min(next, MAX_SCALE);
    });
  }, []);

  // 键盘:capture 阶段拦下(Esc/方向键不再漏给宿主 Radix 的 document 监听=不连环关)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.stopPropagation();
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.stopPropagation();
        event.preventDefault();
        navigate(1);
      }
    },
    [navigate, onClose],
  );

  // 滚轮缩放须非 passive(preventDefault 阻断页面滚动)——React onWheel 有 passive
  // 风险,恒走原生监听
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },
    [zoomBy],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    const stage = stageRef.current;
    stage?.addEventListener("wheel", handleWheel, { passive: false });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      stage?.removeEventListener("wheel", handleWheel);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, handleKeyDown, handleWheel]);

  if (!isOpen) return null;

  const currentUrl = slideUrls[clampIndex(index)] ?? imageUrl;
  const multi = slideUrls.length > 1;

  const stopRoot = (event: React.SyntheticEvent) => {
    // 反穿透核心:灯箱内一切指针/键盘事件到不了 document——宿主 Radix
    // DismissableLayer(监听 document pointerdown)看不见灯箱,点击永不
    // 顺带关掉宿主弹窗
    event.stopPropagation();
  };

  const onBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    stopRoot(event);
    if (event.target === event.currentTarget) onClose();
  };

  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    stopRoot(event);
    if (scale <= MIN_SCALE) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.baseX + (event.clientX - drag.startX), y: drag.baseY + (event.clientY - drag.startY) });
  };
  const onStagePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    stopRoot(event);
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  return createPortal(
    <div
      // 反穿透:根上拦 pointerdown(React 合成事件冒泡段)——Radix 的 document
      // 级监听泡不到;层叠显式最大值压过一切宿主上下文
      className="fixed inset-0 flex items-center justify-center bg-black/85"
      style={{ zIndex: LIGHTBOX_Z_INDEX, pointerEvents: "auto" }}
      onPointerDown={stopRoot}
      onClick={onBackdropClick}
      onDoubleClick={stopRoot}
      data-image-preview-lightbox
      role="dialog"
      aria-modal="true"
      aria-label="图片全屏预览"
    >
      {/* 工具栏:像素角标 + 缩放钮 + 关闭X(全部显式事件,永不失效) */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <span className="pointer-events-none select-none rounded-md bg-black/50 px-2 py-1 font-mono text-[11px] text-white/85">
          <ResolutionBadge src={currentUrl} />
        </span>
        <button
          type="button"
          aria-label="缩小"
          className="rounded-md bg-black/50 p-2 text-white/85 transition-colors hover:bg-black/70"
          onClick={(event) => { event.stopPropagation(); zoomBy(1 / ZOOM_STEP); }}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="放大"
          className="rounded-md bg-black/50 p-2 text-white/85 transition-colors hover:bg-black/70"
          onClick={(event) => { event.stopPropagation(); zoomBy(ZOOM_STEP); }}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="关闭预览"
          className="rounded-md bg-black/50 p-2 text-white/85 transition-colors hover:bg-black/70"
          onClick={(event) => { event.stopPropagation(); onClose(); }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 批量组计数 */}
      {multi && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 select-none rounded-md bg-black/50 px-2.5 py-1 font-mono text-xs text-white/85">
          {clampIndex(index) + 1} / {slideUrls.length}
        </div>
      )}

      {/* 翻页箭头(仅批量组;恒渲染,端点 disabled——对齐原 YARL 交互口径) */}
      {multi && (
        <button
          type="button"
          aria-label="上一张"
          disabled={clampIndex(index) <= 0}
          className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/85 transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
          onClick={(event) => { event.stopPropagation(); navigate(-1); }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {multi && (
        <button
          type="button"
          aria-label="下一张"
          disabled={clampIndex(index) >= slideUrls.length - 1}
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/85 transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
          onClick={(event) => { event.stopPropagation(); navigate(1); }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* 图台:缩放/平移/拖拽;点击图本体不关(仅背景关,防误触) */}
      <div
        ref={stageRef}
        className="flex max-h-[92vh] max-w-[94vw] items-center justify-center overflow-hidden"
        style={{ cursor: scale > MIN_SCALE ? "grab" : "default" }}
        onClick={stopRoot}
        onDoubleClick={(event) => {
          stopRoot(event);
          if (scale > MIN_SCALE) {
            setScale(MIN_SCALE);
            setPan({ x: 0, y: 0 });
          } else {
            setScale(2);
          }
        }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <img
          src={currentUrl}
          alt="Preview"
          draggable={false}
          className="max-h-[92vh] max-w-[94vw] select-none object-contain transition-transform duration-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "center center" }}
        />
      </div>
    </div>,
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
    /** 「存为关键帧」:当前播放时刻(秒) */
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
    const currentTime = videoRef.current?.currentTime;
    if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
      keyframeActions?.onSaveCurrentFrame?.(currentTime);
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
              {keyframeActions?.busy ? "抽帧中…" : "存为关键帧"}
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
                onClick={() => keyframeActions?.onAutoSample?.(count)}
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
