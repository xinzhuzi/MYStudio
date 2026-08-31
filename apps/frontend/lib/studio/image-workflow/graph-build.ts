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
  CharacterReferenceViewType,
  StoryboardItem,
} from "@/types/studio";
import {
  BACKGROUND_PLATE_NEGATIVE_ANCHORS,
  SUBJECT_CUTOUT_NEGATIVE_ANCHORS,
  buildBackgroundPlatePrompt,
  buildSubjectCutoutPrompt,
} from "../layered-generation";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { buildContinuityPrompt } from "../visual-continuity";
import {
  generatedSlotPosition,
  nextStackedPosition,
  promptSlotPosition,
  referenceSlotPosition,
} from "./layout";

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
  continuityOrder?: number;
  continuityVersionId?: string;
  referenceRole?: StoryboardItem["orderedReferenceManifest"] extends (infer T)[] | undefined
    ? T extends { referenceRole?: infer R } ? R : never
    : never;
  identityAnchors?: StoryboardItem["orderedReferenceManifest"] extends (infer T)[] | undefined
    ? T extends { identityAnchors?: infer R } ? R : never
    : never;
  negativePrompt?: StoryboardItem["orderedReferenceManifest"] extends (infer T)[] | undefined
    ? T extends { negativePrompt?: infer R } ? R : never
    : never;
  wardrobeVersion?: string;
  characterViewType?: CharacterReferenceViewType;
  sceneViewpointId?: string;
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
  /** 关键帧序列(M1d):本节点对应的分镜帧 */
  frameId?: string;
  frameMoment?: string;
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
export interface StoryboardImageWorkflowReferenceInput {
  assetId: string;
  assetType: ImageWorkflowAssetTargetType;
  title?: string;
  imageUrl: string;
  evidence?: string;
  order?: number;
  versionId?: string;
  referenceRole?: StoryboardItem["orderedReferenceManifest"] extends (infer T)[] | undefined
    ? T extends { referenceRole?: infer R } ? R : never
    : never;
  identityAnchors?: StoryboardOrderedReferenceMetadata["identityAnchors"];
  negativePrompt?: StoryboardOrderedReferenceMetadata["negativePrompt"];
  wardrobeVersion?: string;
  characterViewType?: CharacterReferenceViewType;
  sceneViewpointId?: string;
}
export type StoryboardOrderedReferenceMetadata = NonNullable<StoryboardItem["orderedReferenceManifest"]>[number];

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
      // 两列+泳道布局:参考图在输入列(提示词之下),成图列右置,
      // 「输入→成图」连线全走中间空泳道,不被卡片遮挡
      position: referenceSlotPosition(0, 1),
    });
  }
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt: context.prompt ?? "",
    aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    position: generatedSlotPosition(0),
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: context.prompt ?? "",
    aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    resolution: useAppSettingsStore.getState().imageGenerationSettings.defaultResolution,
    quality: "standard",
    targetNodeId: generatedNodeId,
    position: promptSlotPosition(0),
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
      position: nextStackedPosition(next.nodes, "reference"),
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
      position: nextStackedPosition(next.nodes, "generated"),
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
        position: nextStackedPosition(next.nodes, "prompt"),
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
        position: nextStackedPosition(next.nodes, "prompt"),
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
  storyboard: Pick<StoryboardItem, "id" | "index" | "prompt" | "continuityState">;
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
  const orderedReferences = [...referenceImages].sort(
    (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
  );
  const continuityPrompt = storyboard.continuityState
    ? buildContinuityPrompt(storyboard.continuityState)
    : "";
  const finalPrompt = [prompt || storyboard.prompt, continuityPrompt]
    .filter(Boolean)
    .join(" ");
  orderedReferences.forEach((reference, index) => {
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
      continuityOrder: reference.order ?? index + 1,
      continuityVersionId: reference.versionId,
      referenceRole: reference.referenceRole,
      identityAnchors: reference.identityAnchors,
      negativePrompt: reference.negativePrompt,
      wardrobeVersion: reference.wardrobeVersion,
      characterViewType: reference.characterViewType,
      sceneViewpointId: reference.sceneViewpointId,
      position: referenceSlotPosition(index, 1),
    });
  });
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `分镜 ${storyboard.index} 成图`,
    prompt: finalPrompt,
    model,
    aspectRatio: aspectRatio ?? useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    resolution,
    position: generatedSlotPosition(0),
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: finalPrompt,
    model,
    aspectRatio: aspectRatio ?? useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    quality: "standard",
    resolution,
    targetNodeId: generatedNodeId,
    position: promptSlotPosition(0),
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
    continuityOrder: input.continuityOrder,
    continuityVersionId: input.continuityVersionId,
    referenceRole: input.referenceRole,
    identityAnchors: input.identityAnchors,
    negativePrompt: input.negativePrompt,
    wardrobeVersion: input.wardrobeVersion,
    characterViewType: input.characterViewType,
    sceneViewpointId: input.sceneViewpointId,
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
    paramsEdited: true,
    aspectRatio: input.aspectRatio ?? imageSettings.defaultAspectRatio,
    quality: input.quality ?? "standard",
    resolution: input.resolution,
    position: input.position,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    frameId: input.frameId,
    frameMoment: input.frameMoment,
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
export function getGeneratedNode(graph: ImageWorkflowGraph, nodeId: string): ImageWorkflowGeneratedNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== "generated") {
    throw new Error("未找到生成节点");
  }
  return node;
}

export function findPromptNodeForGenerated(
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
/**
 * 分层生图节点扩展（08-19 multilayer-composition Child3，parent D1 原生分层）：
 * 在既有分镜图模型上追加两个 generated 节点——
 *   背景板（无人物空镜，只连场景类 reference）+ 人物净底（纯绿幕，只连
 *   角色类 reference——资产圣经身份锚点经 buildReferenceContinuityContract
 *   自动注入，身份一致性不新造）。
 * 产物经色键抠底（layered-generation.matteSolidBackground）后落
 * <projectRoot>/remotion/layers/<chapterId>/<clipId>/，被章节渲染器按约定
 * 发现（Child1 接线）。幂等：同层节点已存在（title 匹配）则原样返回。
 */
export function addStoryboardLayeredNodes(
  graph: ImageWorkflowGraph,
  input: {
    storyboard: Pick<StoryboardItem, "index" | "prompt">;
    /** 角色资产描述（人物净底 prompt 首段；缺省用画面描述兜底）。 */
    characterPrompt?: string;
    createdAt?: number;
  },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const titles = new Set(graph.nodes.map((node) => node.title));
  const backgroundTitle = `分镜 ${input.storyboard.index} 背景板`;
  const subjectTitle = `分镜 ${input.storyboard.index} 人物净底`;
  if (titles.has(backgroundTitle) && titles.has(subjectTitle)) return graph;

  const references = graph.nodes.filter(
    (node): node is ImageWorkflowReferenceNode => node.type === "reference" && Boolean(node.imageUrl),
  );
  const sceneRefs = references.filter((node) => node.source?.assetType !== "character");
  const characterRefs = references.filter((node) => node.source?.assetType === "character");
  const basePrompt = input.storyboard.prompt ?? "";

  // 模型继承:生成请求的 model 解析自相连 prompt 节点(findPromptNodeForGenerated),
  // 空 model=「未配置」会被连续性能力门禁拒(08-20 实测)。优先复用图内既有
  // prompt 节点的模型(同图同源),缺省回落 gpt-image-2(门禁认可的连续性系)。
  const inheritedModel = graph.nodes.find(
    (node): node is ImageWorkflowPromptNode => node.type === "prompt" && Boolean(node.model),
  )?.model ?? "gpt-image-2";
  const addLayeredNode = (
    base: ImageWorkflowGraph,
    title: string,
    idPrefix: "gen-bg" | "gen-subj",
    prompt: string,
    negativePrompt: string,
    references: readonly ImageWorkflowReferenceNode[],
  ) => {
    const generatedNodeId = createId(idPrefix, now);
    const promptNodeId = createId(`${idPrefix}-prompt`, now);
    const imageSettings = useAppSettingsStore.getState().imageGenerationSettings;
    // 两列+泳道:该层成图占成图列下一空位,提示词进输入列下一空位,
    // 克隆参考随后堆输入列——所有连线走中间泳道,不穿卡片。
    const generatedPosition = nextStackedPosition(base.nodes, "generated");
    const promptPosition = nextStackedPosition(base.nodes, "prompt");
    let next = addGeneratedImageNode(base, {
      id: generatedNodeId,
      title,
      prompt,
      negativePrompt,
      model: inheritedModel,
      position: generatedPosition,
      createdAt: now,
    });
    next = addPromptImageNode(next, {
      id: promptNodeId,
      title: `${title} 提示词`,
      prompt,
      negativePrompt,
      model: inheritedModel,
      aspectRatio: imageSettings.defaultAspectRatio,
      resolution: imageSettings.defaultResolution,
      targetNodeId: generatedNodeId,
      position: promptPosition,
      createdAt: now,
    });
    next = connectImageWorkflowNodes(next, { source: promptNodeId, target: generatedNodeId }, now);
    // 参考图克隆+顺序重排(08-20 修):直连原图参考会因子集连线断档
    // (场景参考 order [2,3] 缺 [1])被连续性闸拒「顺序不连续」。克隆为专属
    // 参考节点,continuityOrder 重排 1..k——不动原图连线,资产圣经锚点全保留。
    references.forEach((reference, index) => {
      const cloneId = createId(`${idPrefix}-ref`, now + index + 1);
      next = addReferenceImageNode(next, {
        id: cloneId,
        title: `${reference.title || "参考图"}·分层`,
        imageUrl: reference.imageUrl,
        source: reference.source,
        notes: reference.notes,
        continuityOrder: index + 1,
        continuityVersionId: reference.continuityVersionId,
        referenceRole: reference.referenceRole,
        identityAnchors: reference.identityAnchors,
        negativePrompt: reference.negativePrompt,
        wardrobeVersion: reference.wardrobeVersion,
        characterViewType: reference.characterViewType,
        sceneViewpointId: reference.sceneViewpointId,
        position: nextStackedPosition(next.nodes, "reference"),
        createdAt: now,
      });
      next = connectImageWorkflowNodes(next, { source: cloneId, target: generatedNodeId }, now);
    });
    return next;
  };

  let next = graph;
  if (!titles.has(backgroundTitle)) {
    next = addLayeredNode(
      next,
      backgroundTitle,
      "gen-bg",
      buildBackgroundPlatePrompt(basePrompt),
      BACKGROUND_PLATE_NEGATIVE_ANCHORS.join(", "),
      sceneRefs,
    );
  }
  if (!titles.has(subjectTitle)) {
    next = addLayeredNode(
      next,
      subjectTitle,
      "gen-subj",
      buildSubjectCutoutPrompt(basePrompt, input.characterPrompt ?? basePrompt),
      SUBJECT_CUTOUT_NEGATIVE_ANCHORS.join(", "),
      characterRefs,
    );
  }
  return touchGraph(next, now);
}
