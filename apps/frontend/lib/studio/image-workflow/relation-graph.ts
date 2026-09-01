/**
 * 上下游关系图(09-02-relation-highlight):一度关系纯函数。
 * 选中节点 → 其直接相连的边集(任一端命中)。
 */

export interface RelationEdgeLike {
  id: string;
  source: string;
  target: string;
}

/** 一度相关边:边的任一端 === nodeId */
export function relatedEdges(
  edges: readonly RelationEdgeLike[],
  nodeId: string | null,
): Set<string> {
  const result = new Set<string>();
  if (!nodeId) return result;
  for (const edge of edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      result.add(edge.id);
    }
  }
  return result;
}
