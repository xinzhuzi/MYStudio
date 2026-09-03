import type { AssetImageWorkflowContext, CharacterReferenceViewType, ImageWorkflowAssetTargetType, ImageWorkflowEdge, ImageWorkflowGeneratedNode, ImageWorkflowGraph, ImageWorkflowNode, ImageWorkflowNodePosition, ImageWorkflowReferenceNode, ImageWorkflowTarget, StoryboardItem } from "@/types/studio";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { buildContinuityPrompt } from "../visual-continuity";
import { generatedSlotPosition, nextStackedPosition, promptSlotPosition, referenceSlotPosition } from "./layout";
import { addPromptImageNode, collapseEquivalentReferenceNodes, connectImageWorkflowNodes, createId, findPromptNodeForGenerated, setGeneratedImageResult, updateImageWorkflowNode, isSameImageReference, touchGraph } from "./graph-build-mutations";


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
    position: generatedSlotPosition(0),
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: context.prompt ?? "",
    aspectRatio: useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
    resolution: useAppSettingsStore.getState().imageGenerationSettings.defaultResolution,
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
    resolution,
    position: generatedSlotPosition(0),
  });
  graph = addPromptImageNode(graph, {
    id: createId("prompt"),
    title: "图片生成",
    prompt: finalPrompt,
    model,
    aspectRatio: aspectRatio ?? useAppSettingsStore.getState().imageGenerationSettings.defaultAspectRatio,
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



export { addGroupNode, addPromptImageNode, addStickyNoteNode, addStoryboardLayeredNodes, collapseEquivalentReferenceNodes, connectImageWorkflowNodes, createId, findPromptNodeForGenerated, getGeneratedNode, hasPromptSource, isValidImageEdge, removeImageWorkflowEdge, removeImageWorkflowNode, setGeneratedImageResult, setGeneratedImageStatus, updateImageWorkflowNode, updateImageWorkflowNodePosition } from "./graph-build-mutations";
