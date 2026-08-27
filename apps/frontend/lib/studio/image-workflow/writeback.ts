import type { ImageWorkflowGeneratedNode, ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import { getGeneratedNode, setGeneratedImageResult } from "./graph-build";

export interface AssetImageWorkflowPatch {
  imageUrl: string;
  imageWorkflowId: string;
  imageWorkflowNodeId: string;
  generatedAt?: number;
}
/**
 * 分镜挂图→工作流成图节点的联动愈合:批量脚本等旁路会把图直接写进
 * storyboard.mediaRef(2026-08-23 实证 21 镜),工作流成图节点因此空置,
 * 两个界面状态对不上。此处把首个无结果的 generated 节点补挂该图,
 * 使图像节点图与分镜面板所见一致(幂等:已有结果/无图不动)。
 */
export function ensureStoryboardImageResult(
  graph: ImageWorkflowGraph,
  mediaRefPath: string | undefined,
  /** G7(M1d):多帧流按 frameId 定位空节点,消"首个空 gen"歧义;缺省维持原行为 */
  frameId?: string,
): ImageWorkflowGraph {
  if (!mediaRefPath) return graph;
  const emptyNodes = graph.nodes.filter(
    (candidate): candidate is ImageWorkflowGeneratedNode =>
      candidate.type === "generated" && !candidate.resultUrl,
  );
  const node = frameId
    ? emptyNodes.find((candidate) => candidate.frameId === frameId) ?? emptyNodes[0]
    : emptyNodes[0];
  if (!node) return graph;
  return setGeneratedImageResult(graph, node.id, { imageUrl: mediaRefPath });
}
export function buildStoryboardImageWorkflowPatch(
  graph: ImageWorkflowGraph,
  nodeId: string,
): Pick<StoryboardItem, "mediaRef" | "imageWorkflowId" | "imageWorkflowNodeId" | "state"> {
  const node = getGeneratedNode(graph, nodeId);
  if (!node.resultUrl) {
    throw new Error("生成节点还没有可回写的图片");
  }
  return {
    mediaRef: {
      kind: "image",
      path: node.resultUrl,
      imageWorkflowId: graph.id,
      imageWorkflowNodeId: node.id,
    },
    imageWorkflowId: graph.id,
    imageWorkflowNodeId: node.id,
    state: "ready",
  };
}

export function buildAssetImageWorkflowPatch(
  graph: ImageWorkflowGraph,
  nodeId: string,
): AssetImageWorkflowPatch {
  const node = getGeneratedNode(graph, nodeId);
  if (!node.resultUrl) {
    throw new Error("生成节点还没有可回写的图片");
  }
  return {
    imageUrl: node.resultUrl,
    imageWorkflowId: graph.id,
    imageWorkflowNodeId: node.id,
    generatedAt: node.generatedAt,
  };
}
