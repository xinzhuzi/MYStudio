// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * 交互门闸——拖拽/滑动/缩放进行中一律不加载图片数据,静止稳定后才开始。
 *
 * 用户裁定(2026-08-26):交互期间新图片不产生任何网络/解码请求(渲染同尺寸
 * 占位),交互结束稳定 1000ms 后开闸批量加载;已加载的图粘性显示,绝不卸载
 * 闪烁。接闸方:工作流画布 viewport 移动(onMoveStart/End,覆盖拖拽/滚轮/
 * 捏合)、分镜面板与画布瓦片的滚动容器(onScroll)。未接闸的场景默认开闸,
 * 行为与引入前完全一致。
 */

/** 交互结束后静止多久才开闸加载。 */
const SETTLE_DEBOUNCE_MS = 1000;

let active = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 交互开始(或仍在进行):关闸。连续调用安全,重置开闸计时。 */
export function interactionDeferBegin() {
  if (releaseTimer !== undefined) {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  }
  if (!active) {
    active = true;
    notify();
  }
}

/** 交互结束:静止 SETTLE_DEBOUNCE_MS 后开闸。 */
export function interactionDeferEnd() {
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    if (active) {
      active = false;
      notify();
    }
  }, SETTLE_DEBOUNCE_MS);
}

/** 仅测试:强制复位并清空计时器。 */
export function __resetInteractionDeferForTests() {
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = undefined;
  active = false;
  notify();
}

/** true = 已稳定,允许加载。交互进行中/防抖窗口内为 false。 */
export function useInteractionSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !active,
    () => true,
  );
}

/**
 * 粘性显示:交互中挂载的组件保持占位,直到首个稳定窗口出现后永久放行
 * (此后闸再关也不回退——已加载内容不闪烁卸载,只拦「新加载」)。
 */
export function useRevealWhenSettled(): boolean {
  const settled = useInteractionSettled();
  const [revealed, setRevealed] = useState(settled);
  useEffect(() => {
    if (settled) setRevealed(true);
  }, [settled]);
  return revealed;
}

/** 滚动容器接线:onScroll 时关闸,静止后开闸。 */
export function handleDeferScroll() {
  interactionDeferBegin();
  interactionDeferEnd();
}
