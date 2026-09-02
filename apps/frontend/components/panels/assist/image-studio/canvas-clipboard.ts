import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { connectImageWorkflowNodes } from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowEdge, ImageWorkflowNode } from "@/types/studio";

/**
 * 画布内部剪贴板(09-02-small-batch-misc R1):
 * Ctrl+C 存选中节点集+集内互连线;Ctrl/V 偏移 48px 落新节点(id 重生成,
 * derivedFrom 保留血缘)。会话级内存态(非系统剪贴板,对方同构语义)。
 */

export interface CanvasClipboardSnapshot {
  nodes: ImageWorkflowNode[];
  edges: ImageWorkflowEdge[]; // 仅集内互连(source/target 都在集内)
}

let clipboard: CanvasClipboardSnapshot | null = null;

export function copyNodesToClipboard(nodeIds: readonly string[]): number {
  const graph = useImageStudioStore
    .getState()
    .workflows.find((workflow) => workflow.id === useImageStudioStore.getState().activeWorkflowId);
  if (!graph || nodeIds.length === 0) return 0;
  const idSet = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => idSet.has(node.id));
  const edges = graph.edges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target));
  clipboard = {
    nodes: nodes.map((node) => ({ ...node, position: { ...node.position } })),
    edges: edges.map((edge) => ({ ...edge })),
  };
  return nodes.length;
}

export function clipboardSize(): number {
  return clipboard?.nodes.length ?? 0;
}

/** 粘贴:新 id+偏移落图,返回新节点 id 列表(经 store 单点=撤销单条历史) */
export function pasteFromClipboard(): string[] {
  if (!clipboard || clipboard.nodes.length === 0) return [];
  const store = useImageStudioStore.getState();
  const idMap = new Map<string, string>();
  store.updateActiveWorkflow((current) => {
    let next = current;
    for (const node of clipboard!.nodes) {
      const newId = `${node.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      idMap.set(node.id, newId);
      next = {
        ...next,
        nodes: [
          ...next.nodes,
          {
            ...node,
            id: newId,
            title: node.title.endsWith(" 副本") ? node.title : `${node.title} 副本`,
            position: { x: node.position.x + 48, y: node.position.y + 48 },
            updatedAt: Date.now(),
          } as ImageWorkflowNode,
        ],
      };
    }
    for (const edge of clipboard!.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      // 边复建必经域规则单源(connectImageWorkflowNodes:目标成图/非自环/
      // 去重)——粘贴不私设旁路,规则闸口唯一
      next = connectImageWorkflowNodes(next, { ...edge, id: `${source}->${target}`, source, target });
    }
    return next;
  });
  return [...idMap.values()];
}

/** 供测试隔离:清空内部剪贴板 */
export function __resetClipboardForTests(): void {
  clipboard = null;
}
