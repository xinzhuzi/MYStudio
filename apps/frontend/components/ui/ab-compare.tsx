// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * 图片 A/B 对比基件(09-15 teman-absorption P1b,自研仿设计):
 * canvas 双图层等比 contain → 指针横拖分割线(左=A 右=B)→ 圆形放大镜
 * 以指针为中心 drawImage 放大采样(默认 3x,2-7x 滑杆可调)。
 * 纯展示基件:零数据源概念,只吃两张图地址与角标文案。
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ABCompareProps {
  /** 左侧图(A/旧版) */
  urlA: string;
  /** 右侧图(B/新版) */
  urlB: string;
  labelA?: string;
  labelB?: string;
  /** 容器高度(css 值;默认 420px) */
  height?: number | string;
  className?: string;
}

const ZOOM_MIN = 2;
const ZOOM_MAX = 7;
const ZOOM_DEFAULT = 3;
/** 放大镜采样半径(px,展示尺寸) */
const LOUPE_RADIUS = 64;

interface LoadedImage {
  element: HTMLImageElement;
  width: number;
  height: number;
}

function loadImage(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const element = new Image();
    element.onload = () => resolve({ element, width: element.naturalWidth, height: element.naturalHeight });
    element.onerror = () => resolve(null);
    element.src = url;
  });
}

/** contain-fit:等比缩放居中(两图各自独立 fit,同框对齐) */
function containFit(image: LoadedImage, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height) || 1;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  return { dx: (width - drawWidth) / 2, dy: (height - drawHeight) / 2, drawWidth, drawHeight };
}

export function ABCompare({ urlA, urlB, labelA = "A", labelB = "B", height = 420, className }: ABCompareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dividerRatio, setDividerRatio] = useState(0.5);
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT);
  const [imageA, setImageA] = useState<LoadedImage | null>(null);
  const [imageB, setImageB] = useState<LoadedImage | null>(null);
  const [loupeAt, setLoupeAt] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  // 换图重置分割线(默认居中,两图各半)
  useEffect(() => {
    setDividerRatio(0.5);
    setImageA(null);
    setImageB(null);
    let alive = true;
    void Promise.all([loadImage(urlA), loadImage(urlB)]).then(([nextA, nextB]) => {
      if (!alive) return;
      setImageA(nextA);
      setImageB(nextB);
    });
    return () => {
      alive = false;
    };
  }, [urlA, urlB]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return; // jsdom 无 2d 上下文:静默跳过绘制,DOM 行为不受影响
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const dividerX = width * dividerRatio;
    const paintHalf = (image: LoadedImage | null, side: "left" | "right") => {
      if (!image) return;
      const fit = containFit(image, width, height);
      context.save();
      context.beginPath();
      if (side === "left") context.rect(0, 0, dividerX, height);
      else context.rect(dividerX, 0, width - dividerX, height);
      context.clip();
      context.drawImage(image.element, fit.dx, fit.dy, fit.drawWidth, fit.drawHeight);
      context.restore();
    };
    paintHalf(imageA, "left");
    paintHalf(imageB, "right");

    // 圆形放大镜:以指针为中心,同屏分割线比例放大双图
    if (loupeAt) {
      const radius = LOUPE_RADIUS;
      context.save();
      context.beginPath();
      context.arc(loupeAt.x, loupeAt.y, radius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "#111";
      context.fillRect(loupeAt.x - radius, loupeAt.y - radius, radius * 2, radius * 2);
      const magnify = (image: LoadedImage | null, side: "left" | "right") => {
        if (!image) return;
        const fit = containFit(image, width, height);
        // 采样窗:指针点在「已绘制图」上的位置,放大 zoom 倍后落回指针中心
        const sampleX = (loupeAt.x - fit.dx) / fit.drawWidth * image.width;
        const sampleY = (loupeAt.y - fit.dy) / fit.drawHeight * image.height;
        const sourceSize = (radius * 2) / zoom;
        context.save();
        context.beginPath();
        if (side === "left") context.rect(loupeAt.x - radius, loupeAt.y - radius, dividerX - (loupeAt.x - radius), radius * 2);
        else context.rect(dividerX, loupeAt.y - radius, loupeAt.x + radius - dividerX, radius * 2);
        context.clip();
        context.drawImage(
          image.element,
          sampleX - sourceSize / 2,
          sampleY - sourceSize / 2,
          sourceSize,
          sourceSize,
          loupeAt.x - radius,
          loupeAt.y - radius,
          radius * 2,
          radius * 2,
        );
        context.restore();
      };
      magnify(imageA, "left");
      magnify(imageB, "right");
      context.strokeStyle = "rgba(255,255,255,.9)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(loupeAt.x, loupeAt.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    // 分割线(canvas 层;DOM 拖柄另设)
    context.strokeStyle = "rgba(255,255,255,.95)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(dividerX, 0);
    context.lineTo(dividerX, height);
    context.stroke();
  }, [dividerRatio, imageA, imageB, loupeAt, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 画布尺寸与容器同宽(设备像素比对齐,DPR>1 时按物理像素绘制)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const resize = () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      draw();
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const pointerToCanvas = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      ratioX: (event.clientX - rect.left) / rect.width,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 指针捕获不可用(旧环境):拖拽仍跟随 move 事件,仅可能中途离场丢拖
    }
    const point = pointerToCanvas(event);
    if (point) setDividerRatio(Math.min(1, Math.max(0, point.ratioX)));
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointerToCanvas(event);
    if (!point) return;
    setLoupeAt({ x: point.x, y: point.y });
    if (draggingRef.current) setDividerRatio(Math.min(1, Math.max(0, point.ratioX)));
  };
  const endDrag = () => {
    draggingRef.current = false;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setDividerRatio((ratio) => Math.max(0, ratio - step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setDividerRatio((ratio) => Math.min(1, ratio + step));
    }
  };

  const bothMissing = !imageA && !imageB;

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`} data-ab-compare>
      <div
        role="slider"
        aria-label="对比分割线位置"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(dividerRatio * 100)}
        tabIndex={0}
        data-ab-compare-stage={`${Math.round(dividerRatio * 100)}`}
        data-ab-compare-loupe={loupeAt ? "on" : "off"}
        className="relative w-full select-none overflow-hidden rounded-md border border-border/70 bg-black"
        style={{ height: typeof height === "number" ? `${height}px` : height, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          endDrag();
          setLoupeAt(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <canvas ref={canvasRef} className="h-full w-full" data-ab-compare-canvas />
        {/* DOM 拖柄:与 canvas 分割线重合,焦点/命中都在这层 */}
        <div
          aria-hidden
          data-ab-compare-divider
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white/95"
          style={{ left: `${dividerRatio * 100}%` }}
        >
          <span className="absolute top-1/2 left-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/60">
            <span className="absolute h-4 w-0.5 bg-white/80" />
            <span className="absolute h-0.5 w-4 bg-white/80" />
          </span>
        </div>
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90" data-ab-compare-label="a">
          {labelA}
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/90" data-ab-compare-label="b">
          {labelB}
        </span>
        {bothMissing ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/70" data-ab-compare-empty>
            图片不可用
          </span>
        ) : null}
        {!imageA && imageB ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-destructive/70 px-1.5 py-0.5 text-[11px] text-white" data-ab-compare-missing="a">
            {labelA}加载失败
          </span>
        ) : null}
        {imageA && !imageB ? (
          <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-destructive/70 px-1.5 py-0.5 text-[11px] text-white" data-ab-compare-missing="b">
            {labelB}加载失败
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          放大
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.5}
            value={zoom}
            aria-label="放大镜倍数"
            data-ab-compare-zoom
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
          />
          <span className="font-mono" data-ab-compare-zoom-value>{zoom}x</span>
        </label>
        <span className="ml-auto hidden sm:inline">拖动图片分割;指针处圆形放大镜跟随</span>
      </div>
    </div>
  );
}
