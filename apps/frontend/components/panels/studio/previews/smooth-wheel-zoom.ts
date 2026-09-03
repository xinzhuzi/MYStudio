// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useRef, type RefObject } from "react";

/**
 * 画布手势直改(滚轮缩放 + 空白 pane 拖拽平移)。
 *
 * React Flow/d3 默认逐事件同步写 transform 进 store,主线程跟不上即掉帧
 * (trace 实证 UpdateLayoutTree×562)。本挂钩两条手势全部改为:
 * - 手势期间直接改 .react-flow__viewport 元素 transform(零 React/零 store),
 *   停手 160ms 尾一次性 setViewport 提交对齐 RF/d3;
 * - 滚轮:增量累积,每帧(rAF)最多应用一次,exp(-Δ·k) 指数插值+光标锚点;
 * - 拖拽:仅空白 pane 左键(节点/nodrag 不碰);画布需同时设 panOnDrag={false}
 *   让 RF 正规退出 pane 拖拽(不靠 stopPropagation 吞事件——那会误杀 pane
 *   点击取消选中);拖拽产生移动后吞掉后续 click(防误触发 pane click);
 * - 滚轮与拖拽共享同一 pending 视口(交替手势不跳变);
 */

/** 指数灵敏度(d3 同量级微调值)。 */
const WHEEL_SENSITIVITY = 0.0022;
/** 手势停止后多久提交 store(视口持久化)。 */
const GESTURE_SETTLE_TAIL_MS = 160;
/** 拖拽位移累计超过该阈值才算手势(点击不被误判)。 */
const DRAG_THRESHOLD_PX = 2;

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
    /** 滚轮/拖拽共享的未提交视口(交替手势同基准,不跳变)。 */
    let pending: SmoothWheelZoomViewport | null = null;
    /** 本提交窗开始时的 store 基准:提交时若 store 已被外部改写(视口控制
     * 按钮/fitView),放弃覆盖——最后写入者优先。 */
    let pendingBase: SmoothWheelZoomViewport | null = null;

    const viewportEl = () =>
      element.querySelector<HTMLElement>(".react-flow__viewport") ?? null;

    /** 手势静止尾部:一次性提交 store(视口持久化)。 */
    const scheduleCommit = () => {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        const commit = pending;
        const base = pendingBase;
        pending = null;
        pendingBase = null;
        const current = apiRef.current;
        if (commit && current) {
          const store = current.getViewport();
          const externalWrite = base != null && store != null
            && (store.x !== base.x || store.y !== base.y || store.zoom !== base.zoom);
          if (!externalWrite) current.setViewport(commit);
        }
      }, GESTURE_SETTLE_TAIL_MS);
    };

    const applyImperative = (next: SmoothWheelZoomViewport) => {
      if (pending === null) {
        const store = apiRef.current?.getViewport();
        if (store) pendingBase = store;
      }
      pending = next;
      const el = viewportEl();
      if (el) {
        el.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
      } else {
        apiRef.current?.setViewport(next);
      }
    };

    // ── 滚轮缩放 ─────────────────────────────────────────────
    const applyWheelFrame = () => {
      rafId = null;
      const current = apiRef.current;
      if (!current) return;
      const base = pending ?? current.getViewport();
      if (!base) return;
      const delta = accumulated;
      accumulated = 0;
      const zoom = Math.min(maxZoom, Math.max(minZoom, base.zoom * Math.exp(-delta * WHEEL_SENSITIVITY)));
      const scale = zoom / base.zoom;
      applyImperative({
        x: anchorX - (anchorX - base.x) * scale,
        y: anchorY - (anchorY - base.y) * scale,
        zoom,
      });
      scheduleCommit();
    };

    const onWheel = (event: WheelEvent) => {
      // .nowheel 豁免(React Flow 同款语义):节点内滚动区(overflow-y-auto
      // 容器)的滚轮留给原生滚动。
      if (event.target instanceof Element && event.target.closest(".nowheel")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      anchorX = event.clientX - rect.left;
      anchorY = event.clientY - rect.top;
      accumulated += event.deltaY;
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      if (rafId === null) {
        rafId = requestAnimationFrame(applyWheelFrame);
      }
    };

    // ── 空白 pane 拖拽平移(画布需配 panOnDrag={false}) ──────
    let dragActive = false;
    let dragPointerId = -1;
    let dragLastX = 0;
    let dragLastY = 0;
    let dragMovedPx = 0;

    const paneAt = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      if (target.closest(".react-flow__node")) return null;
      if (target.closest("[class*='nodrag']")) return null;
      const pane = target.closest(".react-flow__pane");
      return pane instanceof HTMLElement ? pane : null;
    };

    /** 拖拽产生移动后吞掉随之合成的 click(防误触发 pane click/取消选中)。 */
    const suppressNextClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const clearStaleClickSuppression = () => {
      element.removeEventListener("click", suppressNextClick, { capture: true });
    };

    const onPointerDown = (event: PointerEvent) => {
      // 09-03 用户裁定:鼠标左键不得拖拽画布,平移唯一入口=右键/中键
      // (use-mouse-button-pan 应用层接管)。本层拖拽平移整段退役,仅保留
      // 滚轮平滑缩放;此分支只留 click 抑制清理职责。
      if (event.shiftKey) return;
      if ((event.button !== 0 && event.button !== 1) || !event.isPrimary) return;
      if (!paneAt(event.target)) return;
      // 上一轮拖拽若未伴随 click 合成(异常路径),滞留的一次性抑制器在此
      // 清理——绝不吞下一次真实点击。
      clearStaleClickSuppression();
      // 拖拽平移退役:不激活 dragActive(右/中键平移在 use-mouse-button-pan)
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragActive || event.pointerId !== dragPointerId) return;
      const dx = event.clientX - dragLastX;
      const dy = event.clientY - dragLastY;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      dragMovedPx += Math.abs(dx) + Math.abs(dy);
      if (dragMovedPx < DRAG_THRESHOLD_PX) return;
      if (dragMovedPx === Math.abs(dx) + Math.abs(dy)) {
        // 首个有效移动:登记 click 抑制(拖拽不是点击)
        element.addEventListener("click", suppressNextClick, { capture: true, once: true });
      }
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      const base = pending ?? apiRef.current?.getViewport();
      if (!base) return;
      applyImperative({ ...base, x: base.x + dx, y: base.y + dy });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragActive || event.pointerId !== dragPointerId) return;
      dragActive = false;
      dragPointerId = -1;
      if (dragMovedPx >= DRAG_THRESHOLD_PX) {
        event.preventDefault();
        scheduleCommit();
      }
      // 未移动 = 纯点击:不吞、不提交,pane click 交给 RF(取消选中等)
    };

    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    element.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onPointerUp, { capture: true });
    return () => {
      element.removeEventListener("wheel", onWheel, { capture: true });
      element.removeEventListener("pointerdown", onPointerDown, { capture: true });
      element.removeEventListener("click", suppressNextClick, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerUp, { capture: true });
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      // 拖拽/滚轮中途卸载(切阶段等):尽力补交未提交视口,消除"回跳"边缘;
      // 实例若已随画布销毁则静默放弃(不会比不补交更糟)。
      const commit = pending;
      pending = null;
      pendingBase = null;
      if (commit) {
        try {
          apiRef.current?.setViewport(commit);
        } catch {
          // 实例已销毁:无操作
        }
      }
    };
  }, [containerRef, minZoom, maxZoom]);
}
