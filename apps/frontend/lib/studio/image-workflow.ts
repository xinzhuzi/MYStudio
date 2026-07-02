import type {
  ImageWorkflowEdge,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowNodePosition,
  ImageWorkflowReferenceNode,
  ImageWorkflowTarget,
  StoryboardItem,
} from "@/types/studio";

export interface CreateImageWorkflowGraphInput {
  id?: string;
  name?: string;
  target?: ImageWorkflowTarget;
  nodes?: ImageWorkflowNode[];
  edges?: ImageWorkflowEdge[];
  createdAt?: number;
}

export interface AddReferenceImageNodeInput {
  id?: string;
  title?: string;
  imageUrl: string;
  position: ImageWorkflowNodePosition;
  source?: ImageWorkflowTarget;
  notes?: string;
  createdAt?: number;
}

export interface AddGeneratedImageNodeInput {
  id?: string;
  title?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio?: string;
  quality?: ImageWorkflowGeneratedNode["quality"];
  resolution?: string;
  position: ImageWorkflowNodePosition;
  createdAt?: number;
}

export interface ImageWorkflowGenerationRequest {
  prompt: string;
  model?: string;
  aspectRatio: string;
  quality: ImageWorkflowGeneratedNode["quality"];
  resolution?: string;
  negativePrompt?: string;
  referenceImages: string[];
}

export function createImageWorkflowGraph(input: CreateImageWorkflowGraphInput = {}): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  return {
    id: input.id ?? createId("image-flow", now),
    name: input.name?.trim() || "图像工作流",
    target: input.target ?? { kind: "free" },
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addReferenceImageNode(
  graph: ImageWorkflowGraph,
  input: AddReferenceImageNodeInput,
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const node: ImageWorkflowReferenceNode = {
    id: input.id ?? createId("ref", now),
    type: "reference",
    title: input.title?.trim() || "参考图",
    imageUrl: input.imageUrl,
    position: input.position,
    source: input.source,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({
    ...graph,
    nodes: [...graph.nodes.filter((item) => item.id !== node.id), node],
  }, now);
}

export function addGeneratedImageNode(
  graph: ImageWorkflowGraph,
  input: AddGeneratedImageNodeInput,
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const node: ImageWorkflowGeneratedNode = {
    id: input.id ?? createId("gen", now),
    type: "generated",
    title: input.title?.trim() || "生成图",
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt,
    model: input.model,
    aspectRatio: input.aspectRatio ?? "16:9",
    quality: input.quality ?? "standard",
    resolution: input.resolution,
    position: input.position,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({
    ...graph,
    nodes: [...graph.nodes.filter((item) => item.id !== node.id), node],
  }, now);
}

export function updateImageWorkflowNode(
  graph: ImageWorkflowGraph,
  nodeId: string,
  updates: Partial<ImageWorkflowNode>,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  return touchGraph({
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      return { ...node, ...updates, id: node.id, type: node.type, updatedAt } as ImageWorkflowNode;
    }),
  }, updatedAt);
}

export function updateImageWorkflowNodePosition(
  graph: ImageWorkflowGraph,
  nodeId: string,
  position: ImageWorkflowNodePosition,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  return updateImageWorkflowNode(graph, nodeId, { position } as Partial<ImageWorkflowNode>, updatedAt);
}

export function removeImageWorkflowNode(
  graph: ImageWorkflowGraph,
  nodeId: string,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  return touchGraph({
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  }, updatedAt);
}

export function connectImageWorkflowNodes(
  graph: ImageWorkflowGraph,
  edge: Omit<ImageWorkflowEdge, "id"> & { id?: string },
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  if (edge.source === edge.target) return graph;
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target || target.type !== "generated") return graph;
  if (graph.edges.some((item) => item.source === edge.source && item.target === edge.target)) return graph;

  return touchGraph({
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: edge.id ?? `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
      },
    ],
  }, updatedAt);
}

export function removeImageWorkflowEdge(
  graph: ImageWorkflowGraph,
  edgeId: string,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  return touchGraph({
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  }, updatedAt);
}

export function buildImageWorkflowGenerationRequest(
  graph: ImageWorkflowGraph,
  nodeId: string,
): ImageWorkflowGenerationRequest {
  const node = getGeneratedNode(graph, nodeId);
  const referenceImages = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.source))
    .flatMap((candidate) => {
      if (!candidate) return [];
      if (candidate.type === "reference") return candidate.imageUrl ? [candidate.imageUrl] : [];
      return candidate.resultUrl ? [candidate.resultUrl] : [];
    });

  return {
    prompt: node.prompt.trim(),
    model: node.model,
    aspectRatio: node.aspectRatio,
    quality: node.quality,
    resolution: node.resolution,
    negativePrompt: node.negativePrompt,
    referenceImages,
  };
}

export function setGeneratedImageStatus(
  graph: ImageWorkflowGraph,
  nodeId: string,
  status: ImageWorkflowGeneratedNode["status"],
  errorReason?: string,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  getGeneratedNode(graph, nodeId);
  return updateImageWorkflowNode(
    graph,
    nodeId,
    { status, errorReason } as Partial<ImageWorkflowNode>,
    updatedAt,
  );
}

export function setGeneratedImageResult(
  graph: ImageWorkflowGraph,
  nodeId: string,
  result: { imageUrl: string; mediaId?: string; generatedAt?: number },
): ImageWorkflowGraph {
  const generatedAt = result.generatedAt ?? Date.now();
  getGeneratedNode(graph, nodeId);
  return updateImageWorkflowNode(
    graph,
    nodeId,
    {
      resultUrl: result.imageUrl,
      resultMediaId: result.mediaId,
      status: "ready",
      errorReason: undefined,
      generatedAt,
    } as Partial<ImageWorkflowNode>,
    generatedAt,
  );
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

export function getGeneratedNode(graph: ImageWorkflowGraph, nodeId: string): ImageWorkflowGeneratedNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== "generated") {
    throw new Error("未找到生成节点");
  }
  return node;
}

export function createId(prefix: string, time = Date.now()) {
  return `${prefix}-${time}-${Math.random().toString(36).slice(2, 8)}`;
}

function touchGraph(graph: ImageWorkflowGraph, updatedAt: number): ImageWorkflowGraph {
  return { ...graph, updatedAt };
}
