// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";

/**
 * 参考图编号与请求顺序的单源(09-03 用户裁定:参考图要有标号,AI 按数组
 * 顺序识别——节点上显示的编号必须与发往引擎的数组顺序同源,永不漂移)。
 *
 * 排序=参考源节点画布位置(y 主 x 辅,id 兜底):视觉序即数组序;本地
 * Krea2 只消费第 1 张,画布最上面的参考即第 1 张,语义直白。
 * 编号(「参考图 N」)只标参考图节点;链式上游成图(结果作参考)参与
 * 数组排序但不显示编号(其自身有节点卡可辨)。
 */

export function orderedReferenceSources<T extends ImageWorkflowNode>(
  graph: Pick<ImageWorkflowGraph, "nodes" | "edges">,
  targetNodeId: string,
): T[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sources: ImageWorkflowNode[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.target !== targetNodeId) continue;
    const source = nodesById.get(edge.source);
    if (!source || seen.has(source.id)) continue;
    if (source.type !== "reference" && source.type !== "generated") continue;
    seen.add(source.id);
    sources.push(source);
  }
  return sources.sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.position.x - b.position.x ||
      a.id.localeCompare(b.id),
  ) as T[];
}

/** 参考图节点在其所连成图的参考序列中的编号(1 起);未连线/多出边取首条 */
export function referenceIndexOf(
  graph: Pick<ImageWorkflowGraph, "nodes" | "edges">,
  referenceNodeId: string,
): number | undefined {
  const target = graph.edges.find((edge) => edge.source === referenceNodeId)?.target;
  if (!target) return undefined;
  const ordered = orderedReferenceSources(graph, target).filter((node) => node.type === "reference");
  const index = ordered.findIndex((node) => node.id === referenceNodeId);
  return index >= 0 ? index + 1 : undefined;
}
