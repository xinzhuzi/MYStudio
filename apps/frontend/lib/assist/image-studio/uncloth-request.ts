// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { ImageWorkflowGraph, ImageWorkflowUnclothNode } from "@/types/studio";
import { resolveUnclothParams } from "@/lib/assist/image-studio/uncloth-defaults";

/**
 * 无衣物链请求组装(09-04-krea2-uncloth-node):成图节点触发时,上游
 * uncloth 节点封装的完整管线(双分割+两遍采样)由 sidecar 执行,结果直通
 * 成图。链式输入(uncloth 的上游 uncloth)按序收集,提示词回落顺序=
 * uncloth.prompt → 其上游提示词节点。
 */

export interface UnclothChainRequest {
  /** 管线输入图(链式时按序:第一个是最终输入) */
  inputImageUrl: string;
  /** 驱动两遍采样的文本 */
  prompt: string;
  /** uncloth 节点 id(结果回显) */
  unclothNodeId: string;
  /** resolveUnclothParams 的全量生效参数 */
  params: ReturnType<typeof resolveUnclothParams>;
}

export function findUnclothUpstream(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
): ImageWorkflowUnclothNode | undefined {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.target !== generatedNodeId) continue;
    const source = nodesById.get(edge.source);
    if (source?.type === "uncloth") return source;
  }
  return undefined;
}

/** 组装管线请求;输入图/文本缺位返回 null(调用方阻断并指路) */
export function buildUnclothChainRequest(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
): UnclothChainRequest | { error: string } {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const uncloth = findUnclothUpstream(graph, generatedNodeId);
  if (!uncloth) return { error: "未找到无衣物上游" };

  // 图输入:沿 uncloth 上游递归取第一张可用图(链式时取最上游)
  const imageOf = (nodeId: string, depth = 0): string | undefined => {
    if (depth > 8) return undefined;
    for (const edge of graph.edges) {
      if (edge.target !== nodeId) continue;
      const source = nodesById.get(edge.source);
      if (!source) continue;
      if (source.type === "reference" && source.imageUrl) return source.imageUrl;
      if (source.type === "generated" && source.resultUrl) return source.resultUrl;
      if (source.type === "uncloth") {
        const upstreamImage = imageOf(source.id, depth + 1);
        if (upstreamImage) return upstreamImage;
      }
    }
    return undefined;
  };
  const inputImageUrl = imageOf(uncloth.id);
  if (!inputImageUrl) return { error: "无衣物节点还没挂输入图:连一张参考图或有结果的成图" };

  // 文本:uncloth.prompt 优先,回落其上游提示词节点
  const promptTextNode = graph.nodes.find(
    (node): node is Extract<ImageWorkflowGraph["nodes"][number], { type: "prompt" }> =>
      node.type === "prompt" &&
      graph.edges.some((edge) => edge.source === node.id && edge.target === uncloth.id),
  );
  const prompt = (uncloth.prompt?.trim() || promptTextNode?.prompt?.trim() || "").trim();
  if (!prompt) return { error: "无衣物节点缺重绘提示词:填节点内提示词或连一条提示词边" };

  return {
    inputImageUrl,
    prompt,
    unclothNodeId: uncloth.id,
    params: resolveUnclothParams(uncloth),
  };
}
