// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布全量生态节点(09-09 用户裁定:开关退役,恒为开启):
 * 图片工作室「效果节点…」永远解锁引擎已装好的全部节点;原 localStorage
 * 开关与设置页「画布解锁全部生态节点」开关行已移除。hook 保留恒真接口
 * (弹窗等既有调用点零改动),历史键 comfy-show-advanced-nodes 不再读。
 */

import { useCallback } from "react";

/** 兼容保留(诊断/迁移工具可能引用);恒开后再无存储真源 */
export const COMFY_ADVANCED_NODES_STORAGE_KEY = "comfy-show-advanced-nodes";

/** 非组件侧读取(恒 true;保留函数供既有调用点) */
export function isComfyAdvancedNodesEnabled(): boolean {
  return true;
}

/** 兼容保留(恒真后无状态可写):no-op */
export function setComfyAdvancedNodes(_value: boolean): void {
  void _value;
}

export interface UseComfyAdvancedNodesResult {
  /** 恒 true(09-09 裁定:全量生态节点常开) */
  showAdvancedNodes: boolean;
  /** 兼容保留:no-op */
  setAdvancedNodes: (value: boolean) => void;
  /** 兼容保留:no-op */
  toggleAdvancedNodes: () => void;
}

/** 画布/弹窗侧共用 hook(恒开;保留签名防调用点炸) */
export function useComfyAdvancedNodes(): UseComfyAdvancedNodesResult {
  const setAdvancedNodes = useCallback((_value: boolean) => undefined, []);
  const toggleAdvancedNodes = useCallback(() => undefined, []);
  return { showAdvancedNodes: true, setAdvancedNodes, toggleAdvancedNodes };
}
