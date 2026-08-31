import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
} from "@/types/studio";

/**
 * 画布节点卡片尺寸与初始布局单源。卡片高度为 image-workflow-node-card 的
 * CSS 实测估值(头部 + 16:9 缩略 + 输入区 + padding),各建流路径曾自定
 * 180~380px 间距,远小于实际卡高,导致新图初始即层叠(2026-08-29 实证)。
 * 新建、补挂、手动加节点一律引用此处常量,勿再内联裸坐标。
 *
 * 两列 + 空泳道拓扑(2026-08-29 用户裁定:节点不得遮挡连线):
 *   输入列(左 x=80):提示词在上、参考图随后垂直堆叠;
 *   成图列(右 x=760):逐个垂直排开;
 *   两列之间 ≥120px 空泳道——所有「输入→成图」连线只在泳道里走,
 *   结构上不穿过任何卡片(卡片 Handle 亦为 source 右/target 左,与
 *   左进右出的流向一致)。
 */
export const IMAGE_WORKFLOW_LAYOUT = {
  reference: { width: 420, height: 410, x: 80, baseY: 100, vGap: 120 },
  prompt: { width: 560, height: 400, x: 80, baseY: 100, vGap: 120 },
  generated: { width: 560, height: 440, x: 760, baseY: 120, vGap: 120 },
} as const;

const LEFT_COLUMN_TYPES = new Set<ImageWorkflowNode["type"]>(["reference", "prompt"]);

/** 输入列提示词区第 index 槽(提示词永远在最上方,紧邻成图列顶部) */
export function promptSlotPosition(index: number) {
  const spec = IMAGE_WORKFLOW_LAYOUT.prompt;
  return { x: spec.x, y: spec.baseY + index * (spec.height + spec.vGap) };
}

/** 输入列参考图区第 index 槽(排在 promptCount 个提示词之下) */
export function referenceSlotPosition(index: number, promptCount: number) {
  const prompt = IMAGE_WORKFLOW_LAYOUT.prompt;
  const spec = IMAGE_WORKFLOW_LAYOUT.reference;
  return {
    x: spec.x,
    y: spec.baseY + promptCount * (prompt.height + prompt.vGap)
      + index * (spec.height + spec.vGap),
  };
}

/** 成图列第 index 槽 */
export function generatedSlotPosition(index: number) {
  const spec = IMAGE_WORKFLOW_LAYOUT.generated;
  return { x: spec.x, y: spec.baseY + index * (spec.height + spec.vGap) };
}

/** 同列内最低卡片底边之下再落一张:手动加节点永不与同列既有卡片重叠 */
export function nextStackedPosition(
  nodes: Array<Pick<ImageWorkflowNode, "type" | "position">>,
  type: ImageWorkflowNode["type"],
) {
  const spec = IMAGE_WORKFLOW_LAYOUT[type];
  const columnTypes = LEFT_COLUMN_TYPES.has(type) ? LEFT_COLUMN_TYPES : null;
  let lowest = spec.baseY - (spec.height + spec.vGap);
  for (const node of nodes) {
    if (columnTypes ? !columnTypes.has(node.type) : node.type !== type) continue;
    lowest = Math.max(lowest, node.position.y + IMAGE_WORKFLOW_LAYOUT[node.type].height);
  }
  return { x: spec.x, y: lowest + spec.height + spec.vGap };
}

function stableNodeOrder<T extends ImageWorkflowNode>(nodes: T[]): Array<T & { __order: number }> {
  return nodes.map((node, order) => ({ ...node, __order: order }));
}

/**
 * 任意两张卡片矩形相交(按布局单源尺寸估值)。自动整理的触发判据:
 * 仅存量层叠流触发重排,用户自行摆好的非重叠布局不被自动改动。
 */
export function imageWorkflowHasOverlappingCards(graph: ImageWorkflowGraph): boolean {
  const nodes = graph.nodes;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const sa = IMAGE_WORKFLOW_LAYOUT[a.type];
      const sb = IMAGE_WORKFLOW_LAYOUT[b.type];
      if (a.position.x < b.position.x + sb.width
        && b.position.x < a.position.x + sa.width
        && a.position.y < b.position.y + sb.height
        && b.position.y < a.position.y + sa.height) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 一键整理布局(存量重叠流修复),与新建流同款两列+泳道拓扑:
 * 提示词按其目标成图的帧序排输入列上部(同目标多提示词依次向下,
 * 无目标的排最后),参考图按 continuityOrder 排提示词之下,成图按
 * 建流顺序排右列。只改 position,不动 id/连线/内容,幂等。
 */
export function tidyImageWorkflowLayout(graph: ImageWorkflowGraph): ImageWorkflowGraph {
  const references = stableNodeOrder(
    graph.nodes.filter((node): node is ImageWorkflowReferenceNode => node.type === "reference"),
  );
  const generated = stableNodeOrder(
    graph.nodes.filter((node): node is ImageWorkflowGeneratedNode => node.type === "generated"),
  );
  const prompts = stableNodeOrder(
    graph.nodes.filter((node): node is ImageWorkflowPromptNode => node.type === "prompt"),
  );

  references.sort((left, right) => {
    const leftOrder = left.continuityOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.continuityOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder !== rightOrder
      ? leftOrder - rightOrder
      : (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.__order - right.__order;
  });
  generated.sort((left, right) =>
    (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.__order - right.__order);

  const bandOfGenerated = new Map<string, number>(
    generated.map((node, index) => [node.id, index]),
  );
  // 提示词次序:目标成图的帧序在前;同目标/无目标的按原序垫后
  let orphanOrdinal = 0;
  const promptBandKey = new Map<string, number>();
  for (const prompt of prompts) {
    const edgeTarget = graph.edges.find((edge) => edge.source === prompt.id)?.target;
    const targetGeneratedId = [prompt.targetNodeId, edgeTarget].find(
      (id) => id && bandOfGenerated.has(id),
    );
    promptBandKey.set(
      prompt.id,
      targetGeneratedId !== undefined
        ? bandOfGenerated.get(targetGeneratedId)!
        : generated.length + orphanOrdinal++,
    );
  }
  prompts.sort((left, right) =>
    promptBandKey.get(left.id)! - promptBandKey.get(right.id)!
      || (left.createdAt ?? 0) - (right.createdAt ?? 0)
      || left.__order - right.__order);

  const positionById = new Map<string, { x: number; y: number }>();
  generated.forEach((node, index) => {
    positionById.set(node.id, generatedSlotPosition(index));
  });
  prompts.forEach((node, index) => {
    positionById.set(node.id, promptSlotPosition(index));
  });
  references.forEach((node, index) => {
    positionById.set(node.id, referenceSlotPosition(index, prompts.length));
  });

  if (positionById.size !== graph.nodes.length) {
    // 出现未知类型节点时保持其原位,不做局部丢弃
    for (const node of graph.nodes) {
      if (!positionById.has(node.id)) positionById.set(node.id, node.position);
    }
  }

  let changed = false;
  const nodes = graph.nodes.map((node) => {
    const next = positionById.get(node.id);
    if (!next || (next.x === node.position.x && next.y === node.position.y)) return node;
    changed = true;
    return { ...node, position: next };
  });
  if (!changed) return graph;
  return { ...graph, nodes, updatedAt: Date.now() };
}
