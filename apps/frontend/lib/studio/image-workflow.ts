import type {
  ImageWorkflowEdge,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowNodePosition,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  ImageWorkflowAssetTargetType,
  ImageWorkflowTarget,
  AssetImageWorkflowContext,
  StoryboardItem,
} from "@/types/studio";
import { useAppSettingsStore } from "@/stores/app-settings-store";

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

export interface AddPromptImageNodeInput {
  id?: string;
  title?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio?: string;
  quality?: ImageWorkflowPromptNode["quality"];
  resolution?: string;
  targetNodeId?: string;
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

export interface StoryboardImageWorkflowReferenceInput {
  assetId: string;
  assetType: ImageWorkflowAssetTargetType;
  title?: string;
  imageUrl: string;
  evidence?: string;
}

export interface AssetImageWorkflowPatch {
  imageUrl: string;
  imageWorkflowId: string;
  imageWorkflowNodeId: string;
  generatedAt?: number;
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

export function createAssetImageWorkflowGraph(
  context: AssetImageWorkflowContext,
  projectName: string,
): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph({
    id: context.imageWorkflowId || createId("image-flow"),
    name: `${projectName} · ${context.title} 图片工作流`,
    target: context.target,
  });
  const referenceNodeId = context.sourceImagePath ? createId("ref") : "";
  const generatedNodeId = createId("gen");
  if (context.sourceImagePath) {
    graph = addReferenceImageNode(graph, {
      id: referenceNodeId,
      title: "父资产参考图",
      imageUrl: context.sourceImagePath,
      source: context.target.parentId
        ? {
            kind: "asset",
            assetType: context.target.assetType,
            id: context.target.parentId,
          }
        : undefined,
      position: { x: 80, y: 100 },
    });
  }
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt: context.prompt ?? "",
    aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    position: { x: 620, y: 120 },
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: context.prompt ?? "",
    aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    resolution: useAppSettingsStore.getState().imageGenerationSettings.defaultResolution,
    quality: "standard",
    targetNodeId: generatedNodeId,
    position: { x: 560, y: 500 },
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
  graph = connectImageWorkflowNodes(graph, {
    source: graph.nodes.find((node) => node.type === "prompt" && node.targetNodeId === generatedNodeId)?.id || "",
    target: generatedNodeId,
  });
  return graph;
}

export function ensureAssetImageWorkflowGraph(
  graph: ImageWorkflowGraph,
  context: AssetImageWorkflowContext,
): ImageWorkflowGraph {
  let next: ImageWorkflowGraph = { ...graph, target: context.target };
  if (context.sourceImagePath) {
    next = collapseEquivalentReferenceNodes(next, context.sourceImagePath);
  }
  const referenceNode = context.sourceImagePath
    ? next.nodes.find(
        (node): node is ImageWorkflowReferenceNode =>
          node.type === "reference" && isSameImageReference(node.imageUrl, context.sourceImagePath),
      )
    : undefined;
  const referenceNodeId =
    referenceNode?.id ??
    (context.sourceImagePath ? createId("ref") : "");
  if (context.sourceImagePath && !referenceNode) {
    next = addReferenceImageNode(next, {
      id: referenceNodeId,
      title: "父资产参考图",
      imageUrl: context.sourceImagePath,
      source: context.target.parentId
        ? {
            kind: "asset",
            assetType: context.target.assetType,
            id: context.target.parentId,
          }
        : undefined,
      position: { x: 80, y: 100 },
    });
  }

  let generated = next.nodes.find(
    (node): node is ImageWorkflowGeneratedNode => node.type === "generated",
  );
  if (!generated) {
    const generatedNodeId = createId("gen");
    next = addGeneratedImageNode(next, {
      id: generatedNodeId,
      title: `${context.title} 成图`,
      prompt: context.prompt ?? "",
      aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
      quality: "standard",
      position: { x: 620, y: 120 },
    });
    generated = next.nodes.find(
      (node): node is ImageWorkflowGeneratedNode => node.id === generatedNodeId && node.type === "generated",
    );
  } else if (context.prompt && !generated.prompt.trim()) {
    next = updateImageWorkflowNode(next, generated.id, {
      prompt: context.prompt,
    } as Partial<ImageWorkflowNode>);
  }

  if (generated && context.resultImagePath && !generated.resultUrl) {
    next = setGeneratedImageResult(next, generated.id, {
      imageUrl: context.resultImagePath,
    });
  }
  if (generated) {
    const promptNode = findPromptNodeForGenerated(next, generated.id);
    if (!promptNode) {
      next = addPromptImageNode(next, {
        id: createId("prompt"),
        title: "图片生成",
        prompt: context.prompt || generated.prompt,
        model: generated.model,
        aspectRatio: generated.aspectRatio,
        quality: generated.quality,
        resolution: generated.resolution ?? useAppSettingsStore.getState().imageGenerationSettings.defaultResolution,
        targetNodeId: generated.id,
        position: { x: 560, y: generated.position.y + 380 },
      });
    } else if (context.prompt && !promptNode.prompt.trim()) {
      next = updateImageWorkflowNode(next, promptNode.id, {
        prompt: context.prompt,
      } as Partial<ImageWorkflowNode>);
    }
  }
  if (referenceNodeId && generated) {
    next = connectImageWorkflowNodes(next, {
      source: referenceNodeId,
      target: generated.id,
    });
  }
  if (generated) {
    const promptNode = findPromptNodeForGenerated(next, generated.id);
    if (promptNode) {
      next = connectImageWorkflowNodes(next, {
        source: promptNode.id,
        target: generated.id,
      });
    }
  }
  return next;
}

export function ensureImageWorkflowPromptNodes(graph: ImageWorkflowGraph): ImageWorkflowGraph {
  let next = graph;
  const generatedNodes = next.nodes.filter(
    (node): node is ImageWorkflowGeneratedNode => node.type === "generated",
  );
  for (const generated of generatedNodes) {
    let promptNode = findPromptNodeForGenerated(next, generated.id);
    if (!promptNode) {
      next = addPromptImageNode(next, {
        id: createId("prompt"),
        title: "图片生成",
        prompt: generated.prompt,
        negativePrompt: generated.negativePrompt,
        model: generated.model,
        aspectRatio: generated.aspectRatio,
        quality: generated.quality,
        resolution: generated.resolution ?? useAppSettingsStore.getState().imageGenerationSettings.defaultResolution,
        targetNodeId: generated.id,
        position: { x: generated.position.x - 60, y: generated.position.y + 380 },
      });
      promptNode = findPromptNodeForGenerated(next, generated.id);
    }
    if (promptNode) {
      next = connectImageWorkflowNodes(next, {
        source: promptNode.id,
        target: generated.id,
      });
    }
  }
  return next;
}

export function createStoryboardImageWorkflowGraph({
  storyboard,
  prompt,
  resultImagePath,
  projectName,
  model,
  aspectRatio,
  resolution,
  referenceImages = [],
}: {
  storyboard: Pick<StoryboardItem, "id" | "index" | "prompt">;
  prompt: string;
  resultImagePath: string;
  projectName: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: StoryboardImageWorkflowReferenceInput[];
}): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph({
    name: `${projectName} · 分镜 ${storyboard.index} 图片工作流`,
    target: { kind: "storyboard", id: storyboard.id },
  });
  const generatedNodeId = createId("gen");
  referenceImages.forEach((reference, index) => {
    graph = addReferenceImageNode(graph, {
      id: createId(`ref-${index + 1}`),
      title: reference.title || `参考资产 ${index + 1}`,
      imageUrl: reference.imageUrl,
      source: {
        kind: "asset",
        assetType: reference.assetType,
        id: reference.assetId,
      },
      notes: reference.evidence,
      position: { x: 80, y: 80 + index * 180 },
    });
  });
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `分镜 ${storyboard.index} 成图`,
    prompt: prompt || storyboard.prompt,
    model,
    aspectRatio: aspectRatio ?? useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    resolution,
    position: { x: referenceImages.length ? 620 : 160, y: 120 },
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: prompt || storyboard.prompt,
    model,
    aspectRatio: aspectRatio ?? useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    resolution,
    targetNodeId: generatedNodeId,
    position: { x: referenceImages.length ? 560 : 160, y: 500 },
  });
  for (const reference of graph.nodes.filter((node) => node.type === "reference")) {
    graph = connectImageWorkflowNodes(graph, {
      source: reference.id,
      target: generatedNodeId,
    });
  }
  graph = connectImageWorkflowNodes(graph, {
    source: graph.nodes.find((node) => node.type === "prompt" && node.targetNodeId === generatedNodeId)?.id || "",
    target: generatedNodeId,
  });
  return setGeneratedImageResult(graph, generatedNodeId, {
    imageUrl: resultImagePath,
  });
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
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const node: ImageWorkflowGeneratedNode = {
    id: input.id ?? createId("gen", now),
    type: "generated",
    title: input.title?.trim() || "生成图",
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt,
    model: input.model,
    aspectRatio: input.aspectRatio ?? imageSettings.defaultAspectRatio,
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

export function addPromptImageNode(
  graph: ImageWorkflowGraph,
  input: AddPromptImageNodeInput,
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
  const node: ImageWorkflowPromptNode = {
    id: input.id ?? createId("prompt", now),
    type: "prompt",
    title: input.title?.trim() || "图片生成",
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt,
    model: input.model,
    aspectRatio: input.aspectRatio ?? imageSettings.defaultAspectRatio,
    quality: input.quality ?? "standard",
    resolution: input.resolution ?? imageSettings.defaultResolution,
    targetNodeId: input.targetNodeId,
    position: input.position,
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
  const promptNode = findPromptNodeForGenerated(graph, nodeId);
  const promptSource = promptNode ?? node;
  const referenceImages = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.source))
    .flatMap((candidate) => {
      if (!candidate) return [];
      if (candidate.type === "reference") return candidate.imageUrl ? [candidate.imageUrl] : [];
      if (candidate.type === "generated") return candidate.resultUrl ? [candidate.resultUrl] : [];
      return [];
    });

  return {
    prompt: promptSource.prompt.trim(),
    model: promptSource.model,
    aspectRatio: promptSource.aspectRatio,
    quality: promptSource.quality,
    resolution: promptSource.resolution,
    negativePrompt: promptSource.negativePrompt,
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

export function getGeneratedNode(graph: ImageWorkflowGraph, nodeId: string): ImageWorkflowGeneratedNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== "generated") {
    throw new Error("未找到生成节点");
  }
  return node;
}

function findPromptNodeForGenerated(
  graph: ImageWorkflowGraph,
  generatedNodeId: string,
): ImageWorkflowPromptNode | undefined {
  const inputNodeIds = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  return graph.nodes.find(
    (node): node is ImageWorkflowPromptNode =>
      node.type === "prompt" &&
      (node.targetNodeId === generatedNodeId || inputNodeIds.includes(node.id)),
  );
}

function collapseEquivalentReferenceNodes(
  graph: ImageWorkflowGraph,
  imageUrl: string,
): ImageWorkflowGraph {
  const matchingReferences = graph.nodes.filter(
    (node): node is ImageWorkflowReferenceNode =>
      node.type === "reference" && isSameImageReference(node.imageUrl, imageUrl),
  );
  if (matchingReferences.length <= 1) return graph;

  const [keeper, ...duplicates] = matchingReferences;
  const duplicateIds = new Set(duplicates.map((node) => node.id));
  const edges: ImageWorkflowEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const edge of graph.edges) {
    if (duplicateIds.has(edge.target)) continue;
    const source = duplicateIds.has(edge.source) ? keeper.id : edge.source;
    const key = `${source}->${edge.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      ...edge,
      id: source === edge.source ? edge.id : key,
      source,
    });
  }

  return touchGraph({
    ...graph,
    nodes: graph.nodes.filter((node) => !duplicateIds.has(node.id)),
    edges,
  }, Date.now());
}

function isSameImageReference(left: string | undefined, right: string | undefined) {
  const leftKeys = imageReferenceKeys(left);
  const rightKeys = new Set(imageReferenceKeys(right));
  return leftKeys.some((key) => rightKeys.has(key));
}

function normalizeImageReference(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return normalizeLocalPath(decodeURI(new URL(trimmed).pathname));
    } catch {
      return normalizeLocalPath(trimmed.replace(/^file:\/\//i, ""));
    }
  }
  return normalizeLocalPath(trimmed);
}

function normalizeLocalPath(value: string) {
  return value.replace(/\/+$/, "");
}

function imageReferenceKeys(value: string | undefined) {
  const normalized = normalizeImageReference(value);
  if (!normalized) return [];
  const assetKey = extractProjectAssetImageKey(normalized);
  return assetKey ? [normalized, assetKey] : [normalized];
}

function extractProjectAssetImageKey(normalizedPath: string) {
  const match = normalizedPath.match(/\/assets\/(?:files|thumbs)\/([^/]+)\/([^/.]+)(?:\.[^/]*)?$/i);
  if (!match) return "";
  return `asset:${match[1]}:${match[2]}`;
}

export function createId(prefix: string, time = Date.now()) {
  return `${prefix}-${time}-${Math.random().toString(36).slice(2, 8)}`;
}

function touchGraph(graph: ImageWorkflowGraph, updatedAt: number): ImageWorkflowGraph {
  return { ...graph, updatedAt };
}
