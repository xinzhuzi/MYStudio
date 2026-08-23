import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
  createImageWorkflowGraph,
  setGeneratedImageResult,
} from "@/lib/studio/image-workflow";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import {
  EXTENDED_STORYBOARD_STYLE_TOKENS,
  getExtendedStoryboardFactionData,
  getExtendedStoryboardFrameNegative,
  getExtendedStoryboardManualContent,
  withActiveVisualManualStoryboardStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  buildStoryboardFactionColorSection,
  buildStoryboardFramePrompt,
  parseStoryboardFrameTemplates,
  selectStoryboardFrameTemplate,
} from "@/lib/studio/storyboard-frame-prompt";
import type {
  AssetImageWorkflowContext,
  ImageWorkflowGeneratedNode,
  ImageWorkflowGraph,
  ImageWorkflowNode,
  ImageWorkflowOpenContext,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  StoryboardItem,
  StudioMaterial,
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

/**
 * 打开上下文的工作流复用判定:目标一致,且分镜目标要求指纹时必须与工作流盖戳一致。
 * 指纹不匹配=工作流属于「同 id 但已被替换的上一代分镜」(2026-08-22 实证:06-01
 * 旧 43 镜工作流占着新 82 镜 1-43 的 id,旧提示词会生成旧镜头画面)。
 * 上下文未带指纹(资产/素材目标)时退化为纯目标匹配,行为不变。
 */
export function matchesStoryboardOpenContext(
  graph: ImageWorkflowGraph,
  context: ImageWorkflowOpenContext,
) {
  if (!isSameImageWorkflowTarget(graph.target, context.target)) return false;
  const required = context.storyboardSourceFingerprint;
  if (context.target.kind !== "storyboard" || !required) return true;
  return graph.targetSourceFingerprint === required;
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
  if (context.storyboardSourceFingerprint) {
    graph = { ...graph, targetSourceFingerprint: context.storyboardSourceFingerprint };
  }
  // 分镜工作流三件套(ma-gongbi-v1 手册资产,全部 fail-empty):
  // ① 提示词按手册装配顺序结构化(【画面】+【构图】模板要点),再挂视觉手册风格锁
  //    (生成链路幂等不双拼;手册未预热时退化裸描述,行为不变);
  // ② Negative Prompt 预填五类英文负面词;
  // ③ 关联资产参考图自动挂载(场景在前角色在后,order 1..k)。
  const isStoryboard = context.target.kind === "storyboard";
  const frameTemplate = isStoryboard
    ? selectStoryboardFrameTemplate(
        [context.prompt ?? "", context.storyboardLines ?? ""].join("\n"),
        parseStoryboardFrameTemplates(getExtendedStoryboardManualContent()),
      )
    : null;
  // 阵营色彩职责:参考资产按轨道分桶查阵营(场景→scene 轨/角色→person 轨)
  const factionData = getExtendedStoryboardFactionData();
  const sceneRefNames = context.assetReferences?.filter((ref) => ref.assetType === "scene").map((ref) => ref.title);
  const personRefNames = context.assetReferences?.filter((ref) => ref.assetType === "character").map((ref) => ref.title);
  const colorSection = isStoryboard && frameTemplate
    ? buildStoryboardFactionColorSection(
        { sceneNames: sceneRefNames, personNames: personRefNames },
        factionData,
      )
    : "";
  // 装配溯源(UI「风格依据」展示源):命中了哪些手册资产一目了然
  if (isStoryboard) {
    const tracedFactions = [...(personRefNames ?? []), ...(sceneRefNames ?? [])]
      .map((name) => factionData.members[name.trim()])
      .filter((factionName): factionName is string => Boolean(factionName));
    graph = {
      ...graph,
      assemblyTrace: {
        manualId: useStudioStore.getState().workflowConfig.visualManualId,
        templateId: frameTemplate?.id,
        templateTitle: frameTemplate?.title,
        factions: [...new Set(tracedFactions)],
        factionTracks: colorSection
          ? [personRefNames?.length ? "person" : "", sceneRefNames?.length ? "scene" : ""].filter(Boolean)
          : [],
        negativeApplied: Boolean(getExtendedStoryboardFrameNegative()),
        styleTokenCount: frameTemplate ? EXTENDED_STORYBOARD_STYLE_TOKENS.length : 0,
        assetReferenceTitles: context.assetReferences?.map((ref) => ref.title),
      },
    };
  }
  const basePrompt = isStoryboard
    ? buildStoryboardFramePrompt({
        description: context.prompt ?? "",
        lines: context.storyboardLines,
        template: frameTemplate,
        colorSection,
      })
    : (context.prompt ?? "");
  const prompt = isStoryboard
    ? withActiveVisualManualStoryboardStyleTokens(basePrompt)
    : basePrompt;
  const negativePrompt = isStoryboard ? getExtendedStoryboardFrameNegative() : undefined;
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
  const assetReferenceBaseY = referenceImagePath ? 280 : 100;
  context.assetReferences?.forEach((reference, index) => {
    graph = addReferenceImageNode(graph, {
      id: createId("asset-ref", Date.now() + index + 1),
      title: reference.title,
      imageUrl: reference.imageUrl,
      source: { kind: "asset", assetType: reference.assetType, id: reference.assetId },
      continuityOrder: index + 1,
      position: { x: 80, y: assetReferenceBaseY + index * 180 },
    });
  });
  graph = addGeneratedImageNode(graph, {
    id: generatedNodeId,
    title: `${context.title} 成图`,
    prompt,
    position: { x: referenceImagePath ? 620 : 160, y: 120 },
  });
  graph = addPromptImageNode(graph, {
    id: promptNodeId,
    title: "图片生成",
    prompt,
    negativePrompt: negativePrompt || undefined,
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
  graph.nodes
    .filter((node) => node.type === "reference" && node.id.includes("asset-ref"))
    .forEach((node) => {
      graph = connectImageWorkflowNodes(graph, {
        source: node.id,
        target: generatedNodeId,
      });
    });
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

/**
 * 参考面板材料分组(T3):材料库 kind=image 混着「用户上传/导入的设定参考图」与
 * 「工作流成图回流」(generation/upscale 完成后 addMaterial 入库)。判据用
 * createWorkflowFilename 的稳定文件名前缀(产品自写,非启发式):
 * gen-*(成图)/up4x-*(超分成图) → workflow-output;ref-* 与其余 → asset-reference。
 */
export function splitImageMaterialsByOrigin(materials: StudioMaterial[]): {
  assetReferences: StudioMaterial[];
  workflowOutputs: StudioMaterial[];
} {
  const assetReferences: StudioMaterial[] = [];
  const workflowOutputs: StudioMaterial[] = [];
  for (const material of materials) {
    const baseName = material.localPath.split("/").pop() ?? material.localPath;
    if (/^(?:gen|up4x)-/i.test(baseName)) workflowOutputs.push(material);
    else assetReferences.push(material);
  }
  return { assetReferences, workflowOutputs };
}
