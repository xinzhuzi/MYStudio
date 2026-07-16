import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import type { ImageWorkflowNodeData, ImageWorkflowReactNode } from "./image-workflow-node-card";
import { findLinkedPromptNodeForGenerated } from "./image-workflow-graph-utils";

type ImageWorkflowAsyncNodeAction = (nodeId: string) => void | Promise<void>;

export type CreateImageWorkflowReactNodesOptions = {
  graph: ImageWorkflowGraph | undefined;
  selectedNodeId: string | null;
  storyboards: StoryboardItem[];
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowAsyncNodeAction;
  onApplyToStoryboard: ImageWorkflowNodeData["onApplyToStoryboard"];
  onDelete: ImageWorkflowNodeData["onDelete"];
};

export function createImageWorkflowReactNodes({
  graph,
  selectedNodeId,
  storyboards,
  onUpdate,
  onGenerate,
  onApplyToStoryboard,
  onDelete,
}: CreateImageWorkflowReactNodesOptions): ImageWorkflowReactNode[] {
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
      onGenerate: (nodeId: string) => void onGenerate(nodeId),
      onApplyToStoryboard,
      onDelete,
    },
  }));
}
