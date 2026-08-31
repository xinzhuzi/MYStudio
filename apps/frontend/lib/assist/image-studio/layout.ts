// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type {
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowNodePosition,
} from "@/types/studio";

/**
 * 图片工作室画布布局(纯函数)。
 *
 * 三列泳道:参考图列 / 提示词列 / 成图列;成图列按「成图→成图链代」逐代
 * 右移,链式图生图的代际关系一眼可读。与分镜画布的 lib/studio 布局模块
 * 互不依赖(该模块在并行收敛中,此处自成单源)。
 */
export const IMAGE_STUDIO_COLUMN_X = {
  reference: 80,
  prompt: 480,
  generated: 1010,
} as const;

/** 成图列每一「代」的横向步距(卡片宽 560 + 间距) */
export const IMAGE_STUDIO_GENERATED_STEP = 620;

const START_Y = 40;
const ROW_STRIDE = {
  reference: 380,
  prompt: 320,
  // 成图卡带内嵌提示词面板时 ~720px,行距须盖住最高形态防整理后叠卡
  generated: 760,
} as const;

/** 成图节点的链代:上游成图→成图连线的最长路径深度(0 起) */
export function generatedChainDepth(graph: ImageWorkflowGraph): Map<string, number> {
  const depths = new Map<string, number>();
  const generatedById = new Map(
    graph.nodes
      .filter((node): node is Extract<ImageWorkflowNode, { type: "generated" }> => node.type === "generated")
      .map((node) => [node.id, node]),
  );
  const upstreamGenerated = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!generatedById.has(edge.target)) continue;
    const list = upstreamGenerated.get(edge.target) ?? [];
    if (generatedById.has(edge.source)) list.push(edge.source);
    upstreamGenerated.set(edge.target, list);
  }
  const visit = (id: string, trail: Set<string>): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = upstreamGenerated.get(id) ?? [];
    const depth = parents.length === 0
      ? 0
      : 1 + Math.max(...parents.map((parent) => visit(parent, trail)));
    trail.delete(id);
    depths.set(id, depth);
    return depth;
  };
  for (const id of generatedById.keys()) visit(id, new Set());
  return depths;
}

function stackColumn<T extends ImageWorkflowNode>(
  nodes: T[],
  x: number,
  stride: number,
): Map<string, ImageWorkflowNodePosition> {
  const positions = new Map<string, ImageWorkflowNodePosition>();
  nodes
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((node, index) => {
      positions.set(node.id, { x, y: START_Y + index * stride });
    });
  return positions;
}

/** 「整理布局」:全图按三列泳道+成图链代重排,返回重排后的图副本 */
export function layoutImageStudioGraph(graph: ImageWorkflowGraph): ImageWorkflowGraph {
  const positions = new Map<string, ImageWorkflowNodePosition>();
  for (const [type, x] of [
    ["reference", IMAGE_STUDIO_COLUMN_X.reference],
    ["prompt", IMAGE_STUDIO_COLUMN_X.prompt],
  ] as const) {
    for (const [id, position] of stackColumn(
      graph.nodes.filter((node) => node.type === type),
      x,
      type === "reference" ? ROW_STRIDE.reference : ROW_STRIDE.prompt,
    )) {
      positions.set(id, position);
    }
  }
  const depths = generatedChainDepth(graph);
  const generatedByDepth = new Map<number, Extract<ImageWorkflowNode, { type: "generated" }>[]>();
  for (const node of graph.nodes) {
    if (node.type !== "generated") continue;
    const depth = depths.get(node.id) ?? 0;
    const list = generatedByDepth.get(depth) ?? [];
    list.push(node);
    generatedByDepth.set(depth, list);
  }
  for (const [depth, nodes] of generatedByDepth) {
    for (const [id, position] of stackColumn(
      nodes,
      IMAGE_STUDIO_COLUMN_X.generated + depth * IMAGE_STUDIO_GENERATED_STEP,
      ROW_STRIDE.generated,
    )) {
      positions.set(id, position);
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
  };
}

/** 指定列的下一个空位(该列当前最大 y + 行距;空列从起点开始) */
export function nextColumnPosition(
  graph: ImageWorkflowGraph,
  type: "reference" | "prompt" | "generated",
): ImageWorkflowNodePosition {
  const x = type === "generated"
    ? IMAGE_STUDIO_COLUMN_X.generated
    : IMAGE_STUDIO_COLUMN_X[type];
  const sameColumn = graph.nodes.filter((node) => node.type === type);
  if (sameColumn.length === 0) return { x, y: START_Y };
  const maxY = Math.max(...sameColumn.map((node) => node.position.y));
  return { x, y: maxY + ROW_STRIDE[type] };
}
