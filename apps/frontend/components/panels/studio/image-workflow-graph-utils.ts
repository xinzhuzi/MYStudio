import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  StoryboardItem,
} from "@/types/studio";

export function nextNodePosition(graph: ImageWorkflowGraph, type: ImageWorkflowNode["type"]) {
  const count = graph.nodes.filter((node) => node.type === type).length;
  return type === "reference"
    ? { x: 80, y: 80 + count * 260 }
    : type === "prompt"
      ? { x: 560, y: 500 + count * 320 }
      : { x: 620, y: 120 + count * 300 };
}

export function resolveGenerationTargetNodeId(graph: ImageWorkflowGraph, nodeId: string) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return undefined;
  if (node.type === "generated") return node.id;
  if (node.type !== "prompt") return undefined;
  const edgeTarget = graph.edges.find((edge) => edge.source === node.id)?.target;
  const targetNodeId = edgeTarget || node.targetNodeId;
  return graph.nodes.some((item) => item.id === targetNodeId && item.type === "generated")
    ? targetNodeId
    : undefined;
}

export function resolveActionGeneratedNode(
  graph: ImageWorkflowGraph,
  selectedNodeId: string | null,
  preferredGeneratedNodeId: string | null,
) {
  const selectedTargetId = selectedNodeId
    ? resolveGenerationTargetNodeId(graph, selectedNodeId)
    : undefined;
  const preferredTargetId =
    preferredGeneratedNodeId &&
    graph.nodes.some(
      (node) => node.type === "generated" && node.id === preferredGeneratedNodeId,
    )
      ? preferredGeneratedNodeId
      : undefined;
  const fallbackTargetId =
    selectedTargetId ??
    preferredTargetId ??
    graph.nodes
      .filter((node) => node.type === "prompt")
      .map((node) => resolveGenerationTargetNodeId(graph, node.id))
      .find(Boolean) ??
    graph.nodes.find((node): node is ImageWorkflowGeneratedNode => node.type === "generated")?.id;
  return graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === fallbackTargetId,
  );
}

export function resolveOpenContextGeneratedNodeId(
  graph: ImageWorkflowGraph,
  context: ImageWorkflowOpenContext,
) {
  const generatedNodes = graph.nodes.filter(
    (node): node is ImageWorkflowGeneratedNode => node.type === "generated",
  );
  const resultMatch = context.resultImagePath
    ? generatedNodes.find((node) => node.resultUrl === context.resultImagePath)
    : undefined;
  const promptMatch = context.prompt
    ? generatedNodes.find((node) => node.prompt === context.prompt)
    : undefined;
  return resultMatch?.id ?? promptMatch?.id ?? generatedNodes[0]?.id ?? null;
}

export function findLinkedPromptNodeForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  return graph.nodes.find(
    (node): node is ImageWorkflowPromptNode =>
      node.type === "prompt" &&
      (node.targetNodeId === generatedNodeId || inputNodeIds.includes(node.id)),
  );
}

export function focusNodeIdsForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
) {
  const generatedNode = graph.nodes.find(
    (node): node is ImageWorkflowGeneratedNode =>
      node.type === "generated" && node.id === generatedNodeId,
  );
  if (!generatedNode) return [];
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  const promptNode = findLinkedPromptNodeForGenerated(graph, generatedNodeId);
  const nearbyReferenceNodeIds = graph.nodes
    .filter(
      (node): node is ImageWorkflowReferenceNode =>
        node.type === "reference" && inputNodeIds.includes(node.id),
    )
    .sort(
      (left, right) =>
        Math.abs(left.position.y - generatedNode.position.y) -
        Math.abs(right.position.y - generatedNode.position.y),
    )
    .slice(0, 3)
    .map((node) => node.id);
  return Array.from(new Set([
    ...nearbyReferenceNodeIds,
    generatedNode.id,
    ...(promptNode ? [promptNode.id] : []),
  ]));
}

export function workflowTargetLabel(
  graph: ImageWorkflowGraph,
  context: AssetImageWorkflowContext | undefined,
  storyboards: StoryboardItem[],
  targetStoryboardId: string,
) {
  if (graph.target.kind === "asset") return assetTargetLabel(graph.target, context);
  const storyboardId =
    graph.target.kind === "storyboard" && graph.target.id
      ? graph.target.id
      : targetStoryboardId;
  if (storyboardId) {
    const storyboard = storyboards.find((item) => item.id === storyboardId);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${storyboardId}`;
  }
  if (graph.target.kind === "material" && graph.target.id) return `项目素材 · ${graph.target.id}`;
  return "未绑定目标";
}

export function openContextTargetLabel(
  context: ImageWorkflowOpenContext,
  storyboards: StoryboardItem[],
) {
  if (isAssetOpenContext(context)) return assetTargetLabel(context.target, context);
  if (context.target.kind === "storyboard" && context.target.id) {
    const storyboard = storyboards.find((item) => item.id === context.target.id);
    return storyboard
      ? `分镜 ${storyboard.index} · ${storyboard.prompt.slice(0, 24)}`
      : `分镜 · ${context.target.id}`;
  }
  if (context.target.kind === "material" && context.target.id) return `项目素材 · ${context.target.id}`;
  return context.title || "当前图片工作流";
}

export function isSameImageWorkflowTarget(
  left: ImageWorkflowGraph["target"],
  right: ImageWorkflowGraph["target"],
) {
  return imageWorkflowTargetKey(left) === imageWorkflowTargetKey(right);
}

export function assetWorkflowContextKey(context: ImageWorkflowOpenContext) {
  return [context.imageWorkflowId ?? "", imageWorkflowTargetKey(context.target)].join("|");
}

export function isAssetOpenContext(
  context: ImageWorkflowOpenContext | undefined,
): context is AssetImageWorkflowContext {
  return Boolean(context?.target.kind === "asset" && context.target.assetType);
}

export function createOpenImageWorkflowGraph(
  context: ImageWorkflowOpenContext,
  projectName: string,
) {
  let graph = createImageWorkflowGraph({
    id: context.imageWorkflowId,
    name: `${projectName} · ${context.title} 图片工作流`,
    target: context.target,
  });
  const generatedNodeId = createId("gen");
  const promptNodeId = createId("prompt");
  const referenceImagePath = context.sourceImagePath || context.resultImagePath;
  const referenceNodeId = referenceImagePath ? createId("ref") : "";
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  if (referenceImagePath) {
    graph = addReferenceImageNode(graph, {
      id: referenceNodeId,
      title: context.target.kind === "storyboard" ? "当前分镜参考图" : "来源参考图",
      imageUrl: referenceImagePath,
      source: context.target,
      position: { x: 80, y: 100 },
    });
  }
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt: context.prompt ?? "",
    position: { x: referenceImagePath ? 620 : 160, y: 120 },
  });
  graph = addPromptImageNode(graph, {
    id: promptNodeId,
    title: "图片生成",
    prompt: context.prompt ?? "",
    aspectRatio: imageSettings.defaultAspectRatio,
    resolution: imageSettings.defaultResolution,
    quality: "standard",
    targetNodeId: generatedNodeId,
    position: { x: referenceImagePath ? 560 : 160, y: 500 },
  });
  if (context.resultImagePath) {
    graph = setGeneratedImageResult(graph, generatedNodeId, {
      imageUrl: context.resultImagePath,
    });
  }
  if (referenceNodeId) {
    graph = connectImageWorkflowNodes(graph, {
      source: referenceNodeId,
      target: generatedNodeId,
    });
  }
  return connectImageWorkflowNodes(graph, {
    source: promptNodeId,
    target: generatedNodeId,
  });
}

export function imageWorkflowTargetKey(target: ImageWorkflowGraph["target"]) {
  return [target.kind, target.assetType ?? "", target.parentId ?? "", target.id ?? ""].join(":");
}

export function assetTargetLabel(
  target: ImageWorkflowGraph["target"],
  context?: AssetImageWorkflowContext,
) {
  if (target.kind !== "asset") return "未绑定资产";
  const typeLabel =
    target.assetType === "character"
      ? "角色衍生"
      : target.assetType === "scene"
        ? "场景衍生"
        : "道具衍生";
  return `${typeLabel} · ${context?.title || target.id || "未命名"}`;
}
