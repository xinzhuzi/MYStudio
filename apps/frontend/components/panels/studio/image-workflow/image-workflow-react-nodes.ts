import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import type { ImageWorkflowNodeData, ImageWorkflowReactNode } from "./image-workflow-node-card";
import { findLinkedPromptNodeForGenerated } from "./image-workflow-graph-utils";

type ImageWorkflowAsyncNodeAction = (nodeId: string, opts?: { denoise?: boolean }) => void | Promise<void>;

export type CreateImageWorkflowReactNodesOptions = {
  graph: ImageWorkflowGraph | undefined;
  selectedNodeId: string | null;
  storyboards: StoryboardItem[];
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowAsyncNodeAction;
  onUpscale: ImageWorkflowAsyncNodeAction;
  onApplyToStoryboard: ImageWorkflowNodeData["onApplyToStoryboard"];
  onDelete: ImageWorkflowNodeData["onDelete"];
  onExtract?: ImageWorkflowNodeData["onExtract"];
};

export function createImageWorkflowReactNodes({
  graph,
  selectedNodeId,
  storyboards,
  onUpdate,
  onGenerate,
  onUpscale,
  onApplyToStoryboard,
  onDelete,
  onExtract,
}: CreateImageWorkflowReactNodesOptions): ImageWorkflowReactNode[] {
  // 回调直挂稳定引用(拖动帧内画布 hook 全部 useCallback),配合节点卡片
  // memo 的 data 引用比较,拖动时整组卡片不重渲染。
  return (graph?.nodes ?? []).map((node) => ({
    id: node.id,
    type: "imageWorkflow",
    position: node.position,
    data: {
      node,
      promptNode:
        node.type === "generated" && graph
          ? findLinkedPromptNodeForGenerated(graph, node.id)
          : undefined,
      selected: node.id === selectedNodeId,
      storyboards,
      onUpdate,
      onGenerate,
      onUpscale,
      onApplyToStoryboard,
      onDelete,
      onExtract,
    },
  }));
}
