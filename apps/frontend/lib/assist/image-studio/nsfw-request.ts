// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ImageWorkflowGraph, ImageWorkflowNsfwNode, ImageWorkflowPromptNode } from "@/types/studio";

/**
 * NSFW破限链检测(09-07-nsfw-pro-node):成图节点上游挂 nsfw 节点时,
 * 生成请求注入 use_lora —— sidecar Krea2 挂「Krea2-NSFW专业流」固定
 * LoRA 栈(Mystic XXX v3@1.0 + pussy@0.3)+ 12 带重平衡,ComfyUI 桥
 * 路由 krea2_nsfw_pro 模板。与 uncloth 不同:不换管线/不换端点,只是
 * 正常 t2i/i2i 请求的参数增强,故本模块只做检测与提示词通道解析。
 */

/** 消费 use_lora 的本地引擎(其余本地引擎 **ctx 静默吞掉,须事前阻断) */
const NSFW_PRO_MODELS = new Set(["krea2-turbo", "comfyui-bridge"]);

export function isNsfwProModel(model: string | undefined): boolean {
  return model !== undefined && NSFW_PRO_MODELS.has(model);
}

/** 成图节点的 nsfw 上游(连线互斥规则保证单链,取第一根) */
export function findNsfwUpstream(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
): ImageWorkflowNsfwNode | undefined {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.target !== generatedNodeId) continue;
    const source = nodesById.get(edge.source);
    if (source?.type === "nsfw") return source;
  }
  return undefined;
}

/**
 * nsfw 节点上游的提示词节点(单根规则保证唯一;无提示词边返回 undefined,
 * 调用方回落成图节点内联提示词并提示连线)。
 */
export function findPromptViaNsfw(
  graph: ImageWorkflowGraph,
  nsfwNodeId: string,
): ImageWorkflowPromptNode | undefined {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.target !== nsfwNodeId) continue;
    const source = nodesById.get(edge.source);
    if (source?.type === "prompt") return source;
  }
  return undefined;
}
