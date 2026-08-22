// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/app/theme-store";

/**
 * DigitalRainBackground — 黑客帝国机械波浪式数字雨背景。
 *
 * 设计要点：
 * - 竖向字符瀑布流（英文字母 + 数字），每列独立速度。
 * - 左右方向的正弦波浪式明暗起伏（机械波浪感），周期 ~8s。
 * - 拖尾效果：每帧用半透明背景色覆盖而非 clearRect。
 * - 头部字符高亮，拖尾逐级衰减。
 * - 仅深色模式渲染；浅色模式返回 null。
 * - 受 enableScanlines 开关控制（复用现有视觉特效开关）。
 * - 不可见时暂停 rAF 省电；prefers-reduced-motion 时静态渲染。
 */
export function DigitalRainBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const enableScanlines = useThemeStore((s) => s.enableScanlines);

  // 浅色模式或开关关闭时不渲染
  if (theme !== "dark" || enableScanlines === false) return null;

  return <DigitalRainCanvas canvasRef={canvasRef} />;
}

// ─── 实现细节 ──────────────────────────────────────────────

interface RainColumn {
  /** 当前字符顶部 y 坐标（像素，CSS 空间） */
  y: number;
  /** 下落速度（px/frame） */
  speed: number;
  /** 该列尾部长度（可见字符数） */
  trailLength: number;
  /** 字符序列（循环缓冲） */
  chars: string[];
  /** 波浪相位偏移（让每列波浪不完全同步） */
  wavePhase: number;
}

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const COLUMN_WIDTH = 18; // px
const FONT_SIZE = 14; // px
const WAVE_PERIOD_MS = 8000; // 机械波浪周期
const BASE_OPACITY = 0.13; // 低调氛围强度
const TRAIL_FADE = 0.085; // 拖尾衰减覆盖 alpha
const DPR_CAP = 2;
/** 氛围背景不需要 60fps;30fps 足够,主线程让给交互 */
const FRAME_INTERVAL_MS = 33;

function randomChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)];
}

function DigitalRainCanvas({
  canvasRef,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let cssWidth = 0;
    let cssHeight = 0;
    let columns: RainColumn[] = [];
    let rafId = 0;
    const startTime = performance.now();
    let running = true;
    /** 主题色每帧 getComputedStyle 是同步样式计算,缓存到 resize/可见性恢复时刷新 */
    let cachedBgRgb: [number, number, number] = [23, 25, 28];
    let cachedPrimaryHsl: [number, number, number] = [212, 100, 48];
    let lastFrameAt = 0;
    /** 任意指针按下(拖节点/拖画布/点按钮)期间暂停绘制,交互优先 */
    let pointerHeld = false;
    /** 滚轮/触控板捏合缩放期间也暂停(滚轮没有 pointerdown,得单独拦) */
    let wheelScrolling = false;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;

    // 读取主题色（CSS 变量 --primary 是 "H S%" 三元组字符串）
    function readPrimaryHsl(): [number, number, number] {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary")
        .trim();
      const parts = raw.split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
        return [parts[0], parts[1], parts[2]];
      }
      return [212, 100, 48]; // fallback: #0091ff
    }

    function readBackgroundRgb(): [number, number, number] {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      const parts = raw.split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
        // HSL → RGB
        return hslToRgb(parts[0], parts[1] / 100, parts[2] / 100);
      }
      return [23, 25, 28]; // fallback: #17191c
    }

    function hslToRgb(h: number, s: number, l: number): [number, number, number] {
      h /= 360;
      let r: number, g: number, b: number;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    function initColumns() {
      const colCount = Math.max(1, Math.ceil(cssWidth / COLUMN_WIDTH));
      const oldColumns = columns;
      columns = [];
      for (let i = 0; i < colCount; i++) {
        const trailLength = 8 + Math.floor(Math.random() * 14);
        const chars: string[] = [];
        for (let j = 0; j < trailLength; j++) chars.push(randomChar());
        // 尽量复用旧列状态，避免 resize 时全部重置
        const old = oldColumns[i];
        columns.push({
          y: old ? old.y : Math.random() * cssHeight,
          speed: 0.4 + Math.random() * 0.8,
          trailLength,
          chars,
          wavePhase: (i / colCount) * Math.PI * 2,
        });
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      cssWidth = canvas!.clientWidth || window.innerWidth;
      cssHeight = canvas!.clientHeight || window.innerHeight;
      canvas!.width = Math.round(cssWidth * dpr);
      canvas!.height = Math.round(cssHeight * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      initColumns();
    }

    function drawFrame() {
      if (!running) return;
      rafId = requestAnimationFrame(drawFrame);

      const now = performance.now();
      if (pointerHeld || wheelScrolling) return; // 交互(拖/缩放)期间让出主线程
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
      const elapsed = now - startTime;

      // 拖尾覆盖（用背景色半透明覆盖整个 canvas）
      const [bgR, bgG, bgB] = cachedBgRgb;
      ctx!.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, ${TRAIL_FADE})`;
      ctx!.fillRect(0, 0, cssWidth, cssHeight);

      const [h, s, l] = cachedPrimaryHsl;
      const waveT = (elapsed % WAVE_PERIOD_MS) / WAVE_PERIOD_MS;
      const waveAngle = waveT * Math.PI * 2;

      ctx!.font = `${FONT_SIZE}px "JetBrains Mono", "SF Mono", "Menlo", monospace`;
      ctx!.textBaseline = "top";

      const colCount = columns.length;
      for (let i = 0; i < colCount; i++) {
        const col = columns[i];

        // 机械波浪：基于列索引 + 时间的正弦调制
        const waveMod = 0.5 + 0.5 * Math.sin((i / colCount) * Math.PI * 3 + waveAngle + col.wavePhase);
        const colOpacity = BASE_OPACITY * (0.35 + waveMod * 0.65);

        // 偶尔刷新尾部字符
        if (Math.random() < 0.08) {
          const idx = Math.floor(Math.random() * col.chars.length);
          col.chars[idx] = randomChar();
        }

        // 绘制拖尾字符（从尾到头，alpha 递增）
        for (let j = 0; j < col.trailLength; j++) {
          const charY = col.y - j * FONT_SIZE;
          if (charY < -FONT_SIZE || charY > cssHeight) continue;

          const trailRatio = j / col.trailLength;
          const charAlpha = (1 - trailRatio) * colOpacity;
          const isHead = j === 0;

          if (isHead) {
            // 头部高亮
            ctx!.fillStyle = `hsla(${h}, ${s}%, ${Math.min(l + 25, 80)}%, ${Math.min(charAlpha * 2.5, 0.9)})`;
          } else {
            ctx!.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${charAlpha})`;
          }

          ctx!.fillText(col.chars[j], i * COLUMN_WIDTH, charY);
        }

        // 下落
        col.y += col.speed * 1.2;
        // 超出底部后从顶部重新开始（带随机延迟）
        if (col.y - col.trailLength * FONT_SIZE > cssHeight) {
          col.y = -Math.random() * 200;
          col.speed = 0.4 + Math.random() * 0.8;
          col.trailLength = 8 + Math.floor(Math.random() * 14);
          for (let j = 0; j < col.trailLength; j++) col.chars[j] = randomChar();
        }
      }
    }

    // ─── 启动 ───
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const refreshThemeCache = () => {
      cachedBgRgb = readBackgroundRgb();
      cachedPrimaryHsl = readPrimaryHsl();
    };
    refreshThemeCache();
    resize();

    if (prefersReducedMotion) {
      // 静态单帧
      drawFrame();
      running = false;
    } else {
      running = true;
      rafId = requestAnimationFrame(drawFrame);
    }

    // ─── 事件监听 ───
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!running) {
          resize();
          drawFrame();
        } else {
          resize();
        }
      }, 200);
    };
    window.addEventListener("resize", onResize);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!prefersReducedMotion) {
        running = true;
        refreshThemeCache(); // 回来顺手刷新主题色(可能刚切了主题)
        rafId = requestAnimationFrame(drawFrame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onPointerDown = () => {
      pointerHeld = true;
    };
    const onPointerUp = () => {
      pointerHeld = false;
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true });

    // 滚轮/捏合缩放没有 pointerdown,得靠 wheel 事件 + 去抖判断「正在缩放」
    const onWheel = () => {
      wheelScrolling = true;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelScrolling = false; }, 180);
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      clearTimeout(wheelTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerUp, { capture: true });
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      className="digital-rain-canvas"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  );
}
