// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * connecting 兼容口高亮(09-09 照 ComfyUI 视觉反馈):拖线进行中给全图
 * 「松手可连」的目标口加呼吸光晕——此前只有口型拦截没有提示,用户不知道
 * 线能落到哪。判定与画布 isValidConnection 同源(业务域规则+comfy 口型),
 * DOM 类标记驱动,零节点卡重渲染。
 *
 * 方向:只处理「从输出口拖出」的主场景(高亮兼容输入口);反向拖线
 * (从输入口拖出)不给高亮,口型拦截照常生效。
 */

import { comfyGenericPortTypesCompatible } from "@/lib/assist/image-studio/comfy-generic-connection";
import { isValidImageConnection } from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowGraph } from "@/types/studio";

const GLOW_CLASS = "connect-compatible-glow";
const HANDLE_DIR_ATTR = "data-canvas-handle-dir";

/** 拖线开始:标记全图兼容目标口(源节点自身的口不高亮) */
export function markCompatibleHandles(
  graph: ImageWorkflowGraph,
  source: { nodeId?: string | null; handleId?: string | null },
): void {
  clearCompatibleHandles();
  const sourceNodeId = source.nodeId ?? null;
  if (!sourceNodeId) return;
  for (const node of graph.nodes) {
    if (node.id === sourceNodeId) continue;
    const handles = document.querySelectorAll(
      `.react-flow__node[data-id="${node.id}"] .react-flow__handle[${HANDLE_DIR_ATTR}="target"]`,
    );
    handles.forEach((element) => {
      const handleId = element.getAttribute("data-handleid");
      const compatible = isValidImageConnection(graph, {
        source: sourceNodeId,
        sourceHandle: source.handleId ?? null,
        target: node.id,
        targetHandle: handleId,
      }) && comfyGenericPortTypesCompatible(graph, {
        source: sourceNodeId,
        sourceHandle: source.handleId ?? null,
        target: node.id,
        targetHandle: handleId,
      });
      if (compatible) element.classList.add(GLOW_CLASS);
    });
  }
}

/** 拖线结束/取消:清全部光晕标记 */
export function clearCompatibleHandles(): void {
  document.querySelectorAll(`.${GLOW_CLASS}`).forEach((element) => {
    element.classList.remove(GLOW_CLASS);
  });
}
