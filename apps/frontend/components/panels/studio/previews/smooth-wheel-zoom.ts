// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useRef, type RefObject } from "react";
import { interactionDeferBegin, interactionDeferEnd } from "./interaction-defer";

/**
 * 滚轮平滑缩放(用户裁定 2026-08-26:「滚轮速度过快,跟不上/没有插值平滑」)。
 *
 * React Flow 默认走 d3-zoom 逐事件直应用:高速滚轮(120Hz+)每个事件同步改
 * transform + RF store 更新,主线程跟不上即掉帧。本挂钩接管滚轮:
 * - capture 阶段截获 wheel(preventDefault+stopPropagation,d3 不再处理),
 *   增量累积,**每帧(rAF)最多应用一次**——任意滚轮速度都恒定 ≤1 次更新/帧;
 * - 指数插值 factor = exp(-Δ·k)(d3 同款手感),光标位置为缩放锚点;
 * - 程序化 setViewport 不会触发 RF 的 onMoveStart,门闸由本挂钩自管:
 *   每个 wheel 关闸,最后一次应用 +160ms 后 interactionDeferEnd(5s 防抖照常)。
 */

/** 指数灵敏度(d3 默认 -deltaY/100·…同量级,取微调值)。 */
const WHEEL_SENSITIVITY = 0.0022;
/** 滚轮流停止后多久认为手势结束(交还门闸 end)。 */
const WHEEL_SETTLE_TAIL_MS = 160;

export interface SmoothWheelZoomViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SmoothWheelZoomApi {
  getViewport: () => SmoothWheelZoomViewport | null;
  setViewport: (viewport: SmoothWheelZoomViewport) => void;
}

export function useSmoothWheelZoom(
  containerRef: RefObject<HTMLElement | null>,
  api: SmoothWheelZoomApi | null,
  { minZoom, maxZoom }: { minZoom: number; maxZoom: number },
) {
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let accumulated = 0;
    let rafId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let anchorX = 0;
    let anchorY = 0;

    // 手势期间直接改 viewport 元素 transform(零 React/零 store/零全树样式重算
    // ——2026-08-26 trace 实证每帧 setViewport 造成 UpdateLayoutTree×61);
    // 停手才一次性 commit 回 store。viewport 元素缺失时回退逐帧 setViewport。
    const viewportEl = () =>
      element.querySelector<HTMLElement>(".react-flow__viewport") ?? null;
    let pending: SmoothWheelZoomViewport | null = null;

    const apply = () => {
      rafId = null;
      const current = apiRef.current;
      if (!current) return;
      const base = pending ?? current.getViewport();
      if (!base) return;
      const delta = accumulated;
      accumulated = 0;
      const zoom = Math.min(maxZoom, Math.max(minZoom, base.zoom * Math.exp(-delta * WHEEL_SENSITIVITY)));
      const scale = zoom / base.zoom;
      const x = anchorX - (anchorX - base.x) * scale;
      const y = anchorY - (anchorY - base.y) * scale;
      pending = { x, y, zoom };
      const el = viewportEl();
      if (el) {
        el.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      } else {
        current.setViewport({ x, y, zoom });
      }
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        // 手势结束:一次性提交 store(RF/d3 与视觉态对齐),随后交还门闸
        const commit = pending;
        pending = null;
        if (commit) current.setViewport(commit);
        interactionDeferEnd();
      }, WHEEL_SETTLE_TAIL_MS);
    };

    const onWheel = (event: WheelEvent) => {
      // .nowheel 豁免(React Flow 同款语义):节点内滚动区(分镜视频卡/技能
      // 摘要等 overflow-y-auto 容器)的滚轮必须留给原生滚动——capture 拦截
      // 若不豁免,preventDefault 会吞掉所有内嵌列表的滚动(08-26 用户实证)。
      if (event.target instanceof Element && event.target.closest(".nowheel")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      anchorX = event.clientX - rect.left;
      anchorY = event.clientY - rect.top;
      accumulated += event.deltaY;
      interactionDeferBegin();
      if (rafId === null) {
        rafId = requestAnimationFrame(apply);
      }
    };

    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel, { capture: true });
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
    };
  }, [containerRef, minZoom, maxZoom]);
}
