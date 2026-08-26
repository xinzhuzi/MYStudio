// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * 交互门闸——拖拽/滑动/缩放进行中一律不加载图片数据,静止稳定后才开始。
 *
 * 用户裁定(2026-08-26):交互期间新图片不产生任何网络/解码请求(渲染同尺寸
 * 占位),交互结束静止 5 秒后开闸批量加载(比首版 1s 更保守);已加载的图
 * 粘性显示,绝不卸载闪烁。接闸方:工作流画布 viewport 移动(onMoveStart/
 * End,覆盖拖拽/滚轮/捏合)、分镜面板与画布瓦片的滚动容器(onScroll)。
 * 未接闸的场景默认开闸,行为与引入前完全一致。
 *
 * 提示:InteractionDeferHint(同目录 interaction-defer-hint.tsx)在关闸期间
 * 展示「交互中·已暂停加载/停手 Ns 后加载」倒计时,让暂停可感知。
 */

/** 交互结束后静止多久才开闸加载(用户裁定 2026-08-26:1s→5s)。 */
export const SETTLE_DEBOUNCE_MS = 5000;

let active = false;
let settling = false;
let releaseDeadline = 0;
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
  if (settling) {
    settling = false;
    notify();
  }
  if (!active) {
    active = true;
    notify();
  }
}

/**
 * 交互结束:静止 SETTLE_DEBOUNCE_MS 后开闸。无条件调用——onMoveEnd 对
 * wheel 手势未必携带 event,按 event 门控会让闸门永久关死(实弹教训)。
 * 未关闸时是无害空操作。
 */
export function interactionDeferEnd(settleMs: number = SETTLE_DEBOUNCE_MS) {
  if (!active) return;
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseDeadline = Date.now() + settleMs;
  settling = true;
  notify();
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    settling = false;
    if (active) {
      active = false;
      notify();
    }
  }, settleMs);
}

/** 门闸瞬时快照(提示组件倒计时用):active=交互中,settleing=停手倒计时中。 */
export function getInteractionDeferInfo(): {
  active: boolean;
  settling: boolean;
  remainMs: number;
} {
  return {
    active,
    settling,
    remainMs: settling ? Math.max(0, releaseDeadline - Date.now()) : 0,
  };
}

/** 仅测试:强制复位并清空计时器。 */
export function __resetInteractionDeferForTests() {
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = undefined;
  active = false;
  settling = false;
  revealedSources.clear();
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

/** 门闸相位订阅(提示组件用):idle=开闸 / active=交互中 / settling=停手倒计时。 */
export function useInteractionDeferPhase(): "idle" | "active" | "settling" {
  return useSyncExternalStore(
    subscribe,
    () => (active ? (settling ? "settling" : "active") : "idle"),
    () => "idle" as const,
  );
}

/**
 * 会话级已放行源登记(用户裁定 2026-08-26:「已加载的不要再加载,不重复
 * 做做好了的」):一旦某图源放行过,本会话内任何重新挂载立即可见——不再
 * 占位、不再等 5s、不再发起请求(浏览器缓存直接命中)。
 */
const revealedSources = new Set<string>();

export function isInteractionSourceRevealed(src: string): boolean {
  return revealedSources.has(src);
}

/**
 * 粘性显示(源级):src 已放行过 → 立即 true;否则等首个稳定窗口。
 * 不传 src = 仅闸门级粘性(组件实例语义,视频等少量场景)。
 */
export function useRevealWhenSettled(src?: string): boolean {
  const settled = useInteractionSettled();
  const [revealed, setRevealed] = useState(() => !src || revealedSources.has(src) || settled);
  useEffect(() => {
    // 闸门开或源已知 → 放行并登记;src 变化(换图/回退图)自动重估
    const next = !src || revealedSources.has(src) || settled;
    if (next && src) revealedSources.add(src);
    setRevealed((previous) => (previous === next ? previous : next));
  }, [settled, src]);
  return revealed;
}

/**
 * 等待交互静止(用户裁定 2026-08-26:交互期间「加载到内存」的一切逻辑都不执行):
 * 已开闸立即返回;关闸中则挂起,直到 5s 防抖结束开闸才放行。探测 IPC 等
 * 非图片加载路径统一经此排队。
 */
export function whenInteractionSettled(): Promise<void> {
  if (!active) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (active) return;
      listeners.delete(check);
      resolve();
    };
    listeners.add(check);
  });
}

/** 一次性豁免:下一次阶段到达不开闸(测试桥程序化设阶段用,消费即失效)。 */
let suppressNextArrival = false;
export function suppressNextInteractionDeferArrival() {
  suppressNextArrival = true;
}
export function consumeInteractionDeferArrivalSuppression(): boolean {
  const value = suppressNextArrival;
  suppressNextArrival = false;
  return value;
}

/** 滚动容器接线:onScroll 时关闸,静止后开闸。 */
export function handleDeferScroll() {
  interactionDeferBegin();
  interactionDeferEnd();
}
