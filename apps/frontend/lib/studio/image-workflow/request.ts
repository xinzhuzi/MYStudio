import type {
  ImageWorkflowGraph,
  ImageWorkflowReferenceNode,
  CharacterReferenceViewType,
} from "@/types/studio";
import { resolveMentionTokens } from "./mention-token";
import {
  findPromptNodeForGenerated,
  getGeneratedNode,
  type StoryboardOrderedReferenceMetadata,
} from "./graph-build";

export interface ImageWorkflowGenerationRequest {
  prompt: string;
  model?: string;
  aspectRatio: string;
  resolution?: string;
  negativePrompt?: string;
  referenceImages: string[];
  orderedReferenceManifest: {
    order: number;
    imageUrl: string;
    versionId?: string;
    referenceRole?: string;
    identityAnchors?: StoryboardOrderedReferenceMetadata["identityAnchors"];
    negativePrompt?: StoryboardOrderedReferenceMetadata["negativePrompt"];
    wardrobeVersion?: string;
    characterViewType?: CharacterReferenceViewType;
    sceneViewpointId?: string;
  }[];
  continuityRequired: boolean;
  previousApprovedFrameIncluded: boolean;
}

export function buildImageWorkflowGenerationRequest(
  graph: ImageWorkflowGraph,
  nodeId: string,
): ImageWorkflowGenerationRequest {
  const node = getGeneratedNode(graph, nodeId);
  const promptNode = findPromptNodeForGenerated(graph, nodeId);
  const promptSource = promptNode ?? node;
  const connectedNodes = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.source));
  const orderedReferenceNodes = connectedNodes
    .filter((candidate): candidate is ImageWorkflowReferenceNode => candidate?.type === "reference" && Boolean(candidate.imageUrl))
    .sort((left, right) => (left.continuityOrder ?? Number.MAX_SAFE_INTEGER) - (right.continuityOrder ?? Number.MAX_SAFE_INTEGER));
  const orderedReferenceManifest: ImageWorkflowGenerationRequest["orderedReferenceManifest"] = connectedNodes
    .flatMap((candidate): ImageWorkflowGenerationRequest["orderedReferenceManifest"] => {
      if (!candidate) return [];
      if (candidate.type === "reference" && candidate.imageUrl) {
        return [{
          order: candidate.continuityOrder ?? Number.MAX_SAFE_INTEGER,
          imageUrl: candidate.imageUrl,
          versionId: candidate.continuityVersionId,
          referenceRole: candidate.referenceRole,
          identityAnchors: candidate.identityAnchors,
          negativePrompt: candidate.negativePrompt,
          wardrobeVersion: candidate.wardrobeVersion,
          characterViewType: candidate.characterViewType,
          sceneViewpointId: candidate.sceneViewpointId,
        }];
      }
      if (candidate.type === "generated" && candidate.resultUrl) {
        return [{
          order: Number.MAX_SAFE_INTEGER,
          imageUrl: candidate.resultUrl,
          referenceRole: "previous-approved-frame" as const,
        }];
      }
      return [];
    })
    .sort((left, right) => left.order - right.order);
  const referenceImages = orderedReferenceManifest.map((reference) => reference.imageUrl);
  const continuityRequired = orderedReferenceManifest.some((reference) => Boolean(reference.versionId));
  const referenceContract = buildReferenceContinuityContract(orderedReferenceNodes);
  // @引用令牌出边界解析(09-02-at-mention-refs):节点存原文,发送才译码
  const basePrompt = resolveMentionTokens(promptSource.prompt.trim(), (nodeId) =>
    graph.nodes.find((candidate) => candidate.id === nodeId),
  ).text;
  const prompt = referenceContract && !basePrompt.includes("【资产圣经】")
    ? `${basePrompt} ${referenceContract}`.trim()
    : basePrompt;
  const negativePrompt = mergeReferenceNegativePrompt(promptSource.negativePrompt, orderedReferenceNodes);

  // 参数权威(08-30 功能转移):成图节点持有优先;存量图未迁移时回落
  // 连线提示词节点的旧值,行为零变化。paramsEdited 见类型注释。
  const paramAuthority = node.paramsEdited ? node : (promptNode ?? node);
  return {
    prompt,
    model: node.model ?? promptSource.model,
    aspectRatio: paramAuthority.aspectRatio,
    resolution: node.resolution ?? promptSource.resolution,
    negativePrompt,
    referenceImages,
    orderedReferenceManifest,
    continuityRequired,
    previousApprovedFrameIncluded: orderedReferenceManifest.some(
      (reference) => reference.referenceRole === "previous-approved-frame",
    ),
  };
}

function buildReferenceContinuityContract(references: ImageWorkflowReferenceNode[]): string {
  const characterGroups = new Map<string, {
    markers: string[];
    title: string;
    views: CharacterReferenceViewType[];
  }>();
  references.forEach((reference, index) => {
    if (reference.source?.kind !== "asset" || reference.source.assetType !== "character") return;
    const key = `${reference.source.id}:${reference.continuityVersionId ?? "base"}`;
    const group = characterGroups.get(key) ?? {
      markers: [],
      title: reference.title,
      views: [],
    };
    group.markers.push(`@图${index + 1}`);
    if (reference.characterViewType) group.views.push(reference.characterViewType);
    characterGroups.set(key, group);
  });
  const multiViewRules = [...characterGroups.values()]
    .filter((group) => group.markers.length > 1 && group.views.length === group.markers.length)
    .map((group) => (
      `${group.markers.join("/")} 为${group.title}同一角色、同一版本的 ${group.views.join("/")} 参考视图，`
      + "不是三个人；该角色在本镜只允许出现一个实例。"
    ));
  const rules = references.flatMap((reference, index) => {
    const marker = `@图${index + 1}`;
    if (reference.source?.assetType === "character") {
      const anchors = reference.identityAnchors;
      const anchorParts = [
        anchors?.faceShape,
        anchors?.jawline,
        anchors?.cheekbones,
        anchors?.eyeShape,
        anchors?.eyeDetails,
        anchors?.noseShape,
        anchors?.lipShape,
        ...(anchors?.uniqueMarks ?? []),
        anchors?.skinTexture,
        anchors?.hairStyle,
        anchors?.hairlineDetails,
      ].filter((value): value is string => Boolean(value?.trim()));
      const colorText = Object.entries(anchors?.colorAnchors ?? {})
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([key, value]) => `${key}:${value}`)
        .join("、");
      if (!anchorParts.length && !colorText && !reference.wardrobeVersion) return [];
      return [`${marker}身份锚点：${anchorParts.join("；")}${colorText ? `；色彩锚点：${colorText}` : ""}${reference.wardrobeVersion ? `；服装版本：${reference.wardrobeVersion}` : ""}${reference.characterViewType ? `；角色视图：${reference.characterViewType}` : ""}`];
    }
    if (reference.source?.assetType === "scene" && reference.sceneViewpointId) {
      return [`${marker}场景圣经：视角：${reference.sceneViewpointId}`];
    }
    return [];
  });
  return [
    multiViewRules.length ? `【多视图身份锁】${multiViewRules.join(" ")}` : "",
    rules.length ? `【资产圣经】${rules.join(" ")}` : "",
  ].filter(Boolean).join(" ");
}

function mergeReferenceNegativePrompt(
  base: string | undefined,
  references: ImageWorkflowReferenceNode[],
): string | undefined {
  const parts = [
    base,
    ...references.flatMap((reference) => [
      ...(reference.negativePrompt?.avoid ?? []),
      ...(reference.negativePrompt?.styleExclusions ?? []),
    ]),
  ].filter((value): value is string => Boolean(value?.trim()));
  return parts.length ? [...new Set(parts)].join(", ") : undefined;
}

export function assertImageWorkflowContinuityCapability(request: ImageWorkflowGenerationRequest) {
  if (!request.continuityRequired) return;
  // 多参考连续性放行:云端 gpt-image + 本地 ComfyUI 桥(仓内白名单工作流,
  // 多参考槽位真正生效,08-31 D4 裁定其余本地引擎维持拒绝并指路)。
  const normalizedModel = request.model?.trim().toLowerCase().replace(/_/g, "-");
  const modelId = normalizedModel?.split(/[/:]/).pop();
  const allowed = modelId === "comfyui-bridge"
    || modelId === "gpt-image"
    || /^gpt-image-\d+(?:\.\d+)?(?:-(?:all|mini))?$/.test(modelId ?? "");
  if (!allowed) {
    throw new Error(`当前图片模型 ${request.model || "未配置"} 未通过多参考图连续性能力门禁（多参考连续性目前支持 gpt-image 云端与 ComfyUI 桥本地引擎）`);
  }
  if (request.orderedReferenceManifest.some((reference, index) => reference.order !== index + 1)) {
    throw new Error("连续性参考图顺序不连续");
  }
}
