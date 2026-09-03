import { BACKGROUND_PLATE_NEGATIVE_ANCHORS, SUBJECT_CUTOUT_NEGATIVE_ANCHORS, buildBackgroundPlatePrompt, buildSubjectCutoutPrompt } from "../layered-generation";
import { addGeneratedImageNode, addReferenceImageNode } from "./graph-build";
import type { AddPromptImageNodeInput } from "./graph-build";
import { nextStackedPosition } from "./layout";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import type { ImageWorkflowEdge, ImageWorkflowGeneratedNode, ImageWorkflowGraph, ImageWorkflowGroupNode, ImageWorkflowNode, ImageWorkflowNodePosition, ImageWorkflowPromptNode, ImageWorkflowReferenceNode, ImageWorkflowStickyNode, StoryboardItem,
  ImageWorkflowUnclothNode,
} from "@/types/studio";

/**
 * 图像工作流图变更族——add/update/remove/connect/set 节点边操作与生成状态。file-size-reduction P3 拆出,体逐字保留。
 */
export function addStickyNoteNode(
  graph: ImageWorkflowGraph,
  input: { id?: string; text?: string; color?: ImageWorkflowStickyNode["color"]; title?: string; position?: ImageWorkflowNodePosition; createdAt?: number },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const node: ImageWorkflowStickyNode = {
    id: input.id ?? createId("sticky", now),
    type: "sticky",
    title: input.title?.trim() || "便利贴",
    text: input.text ?? "",
    color: input.color ?? "yellow",
    position: input.position ?? { x: 80, y: 80 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
}

export function addGroupNode(
  graph: ImageWorkflowGraph,
  input: { id?: string; label?: string; memberIds?: string[]; position?: ImageWorkflowNodePosition; createdAt?: number },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const node: ImageWorkflowGroupNode = {
    id: input.id ?? createId("group", now),
    type: "group",
    title: input.label?.trim() || "分组",
    memberIds: input.memberIds ?? [],
    position: input.position ?? { x: 40, y: 40 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
}

export function addUnclothImageNode(
  graph: ImageWorkflowGraph,
  input: {
    id?: string;
    title?: string;
    prompt?: string;
    position?: ImageWorkflowNodePosition;
    createdAt?: number;
  },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  // 全参数缺省回落工作流现值(读侧 resolveUnclothDefaults 同源);此处只存
  // 用户显式改动,旧画布/新节点零迁移。
  const node: ImageWorkflowUnclothNode = {
    id: input.id ?? createId("uncloth", now),
    type: "uncloth",
    title: input.title?.trim() || "无衣物",
    prompt: input.prompt,
    position: input.position ?? { x: 80, y: 80 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
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
  if (!isValidImageEdge(graph, edge.source, edge.target)) return graph;

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

/**
 * 连线域规则单源谓词(两卡 isValidConnection/handleConnect 共用):
 * 目标必须成图或无衣物 / 非自环 / 同向去重 / 一个成图只吃一根提示词边(09-03
 * 用户裁定:第二根会被装配静默忽略,歧义消灭在源头)。
 * 无衣物节点(09-04):入边=图(reference/generated/uncloth 链式)+一根文本;
 * 出边=只能连成图(结果直通,成图是唯一执行入口)。
 */
export function isValidImageEdge(
  graph: ImageWorkflowGraph,
  source: string,
  target: string,
): boolean {
  if (source === target) return false;
  const sourceNode = graph.nodes.find((node) => node.id === source);
  const targetNode = graph.nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return false;
  if (graph.edges.some((item) => item.source === source && item.target === target)) return false;
  if (sourceNode.type === "sticky" || sourceNode.type === "group") return false;

  // ── 无衣物节点的入边规则 ──
  if (targetNode.type === "uncloth") {
    // 图输入:参考图/上游成图(有结果)/链式上游无衣物
    if (sourceNode.type === "reference" || sourceNode.type === "uncloth") return true;
    if (sourceNode.type === "generated") return true;
    // 文本输入:单根提示词边
    if (sourceNode.type === "prompt") {
      const existingPrompt = graph.edges.some(
        (item) =>
          item.target === target &&
          graph.nodes.find((node) => node.id === item.source)?.type === "prompt",
      );
      return !existingPrompt;
    }
    return false;
  }

  // ── 成图目标(既有规则) ──
  if (targetNode.type !== "generated") return false;
  if (sourceNode.type === "uncloth") {
    // 一个成图只吃一根无衣物链(结果直通,双链语义未定义,歧义消灭在源头)
    const hasUncloth = graph.edges.some(
      (item) =>
        item.target === target &&
        graph.nodes.find((node) => node.id === item.source)?.type === "uncloth",
    );
    if (hasUncloth) return false;
    // 无衣物链与提示词/参考可共存:提示词仍驱动(uncloth.prompt 缺省回落),
    // 静态参考边在 uncloth 链模式下被管线输入取代
    return true;
  }
  if (sourceNode.type === "prompt") {
    // 一个成图只吃一根提示词(09-03):已挂「别的」提示词(边或 targetNodeId
    // 直挂)才拒——自身首根边必须放行(建组流程 prompt 先经 targetNodeId 挂靠)
    const existing = findPromptNodeForGenerated(graph, target);
    if (existing && existing.id !== source) return false;
  }
  return true;
}

/** 该成图节点是否已挂提示词源(targetNodeId 直挂或入边) */
export function hasPromptSource(graph: ImageWorkflowGraph, generatedNodeId: string): boolean {
  return findPromptNodeForGenerated(graph, generatedNodeId) !== undefined;
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
  const updated = updateImageWorkflowNode(
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
  // 衍生资产时效性(09-03-derived-expiry-chain):父图落新结果,
  // 挂其血缘的衍生节点盖 staleSince(生图/超分/回写全经此咽喉)
  return markDerivedFromStale(updated, nodeId, generatedAt);
}

/**
 * 把 derivedFrom.sourceNodeId 指向 sourceNodeId 的节点标记过期
 * (staleSince=父图本次 generatedAt)。不可变;无血缘/已是更新标记的
 * 节点原样保留(引用相等,零扰动)。
 */
export function markDerivedFromStale(
  graph: ImageWorkflowGraph,
  sourceNodeId: string,
  staleSince: number,
): ImageWorkflowGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "reference") return node;
    const derivedFrom = node.derivedFrom;
    if (!derivedFrom || derivedFrom.sourceNodeId !== sourceNodeId) return node;
    if (derivedFrom.staleSince !== undefined && derivedFrom.staleSince >= staleSince) return node;
    changed = true;
    return { ...node, derivedFrom: { ...derivedFrom, staleSince } };
  });
  return changed ? { ...graph, nodes } : graph;
}
/**
 * 节点字段更新 + 参考图换图衍生过期联动(09-03-derived-expiry-chain):
 * 字段更新同 updateImageWorkflowNode;当 reference 节点 imageUrl 实变
 * (画布 URL 直改)时,挂其血缘的衍生节点同步盖 staleSince——父图更新
 * 感知的 reference 侧收口(generated 侧在 setGeneratedImageResult 咽喉)。
 */
export function updateImageWorkflowNodeDerivedAware(
  graph: ImageWorkflowGraph,
  nodeId: string,
  updates: Partial<ImageWorkflowNode>,
  updatedAt = Date.now(),
): ImageWorkflowGraph {
  const updated = updateImageWorkflowNode(graph, nodeId, updates, updatedAt);
  const nextImageUrl = (updates as Partial<ImageWorkflowReferenceNode>).imageUrl;
  if (nextImageUrl === undefined) return updated;
  const before = graph.nodes.find((node) => node.id === nodeId);
  if (!before || before.type !== "reference" || before.imageUrl === nextImageUrl) return updated;
  return markDerivedFromStale(updated, nodeId, updatedAt);
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

export function collapseEquivalentReferenceNodes(
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

export function isSameImageReference(left: string | undefined, right: string | undefined) {
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

export function touchGraph(graph: ImageWorkflowGraph, updatedAt: number): ImageWorkflowGraph {
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
