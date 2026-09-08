// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 「显示 ComfyUI 高级节点」全局开关(三期 通用节点,prd 裁定 6 分层):
 * 关(默认)=普通用户只见大白话节点+策展效果节点;开=画布节点搜索解锁
 * 全量生态节点(英文原名+分类)。
 *
 * 形态:localStorage 持久化 + 跨组件/跨窗口订阅(useSyncExternalStore)。
 * 设置页开关与画布搜索过滤的接线留集成期——本 hook 是唯一真源,
 * 两处入口都读写它即可保持一致。
 */

import { useCallback, useSyncExternalStore } from "react";

/** 存储键(导出供测试与集成期诊断/迁移工具引用,勿随意改名=存量用户偏好) */
export const COMFY_ADVANCED_NODES_STORAGE_KEY = "comfy-show-advanced-nodes";

const STORAGE_KEY = COMFY_ADVANCED_NODES_STORAGE_KEY;

/** 当前值缓存(null=未从 localStorage 读过;写入/失效时更新) */
let cachedValue: boolean | null = null;
/** 订阅者(hook 实例);写入后逐个通知触发重渲 */
const listeners = new Set<() => void>();

function readFromStorage(): boolean {
  try {
    // "1"=开;其余(缺省/"0"/脏值)=关——默认关,普通用户不见专家节点
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage 不可用(隐私模式/受限环境):回落默认关
    return false;
  }
}

function getSnapshot(): boolean {
  if (cachedValue === null) cachedValue = readFromStorage();
  return cachedValue;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 跨窗口同步:别的窗口(或同窗口脚本直写 localStorage 后派发的)storage
// 事件 → 失效缓存并通知。模块级单次注册,与应用同生命周期。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // 只认本键;key=null(localStorage.clear())也刷新,防悬挂脏缓存
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cachedValue = null;
    notify();
  });
}

/** 非组件侧读取(节点搜索过滤等一次性判定用;组件侧请用 hook 保订阅) */
export function isComfyAdvancedNodesEnabled(): boolean {
  return getSnapshot();
}

/** 写入真源:更新缓存 → 尽力持久化 → 通知订阅者 */
export function setComfyAdvancedNodes(value: boolean): void {
  cachedValue = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage 不可用时仅会话内生效(照 CanvasViewportControls 先例)
  }
  notify();
}

export interface UseComfyAdvancedNodesResult {
  /** 是否显示高级(全量)节点;缺省 false */
  showAdvancedNodes: boolean;
  setAdvancedNodes: (value: boolean) => void;
  toggleAdvancedNodes: () => void;
}

/** 设置页/画布入口共用的开关 hook(actions 引用稳定) */
export function useComfyAdvancedNodes(): UseComfyAdvancedNodesResult {
  const showAdvancedNodes = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const setAdvancedNodes = useCallback((value: boolean) => setComfyAdvancedNodes(value), []);
  const toggleAdvancedNodes = useCallback(() => setComfyAdvancedNodes(!getSnapshot()), []);
  return { showAdvancedNodes, setAdvancedNodes, toggleAdvancedNodes };
}
