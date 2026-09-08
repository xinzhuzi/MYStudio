import { BACKGROUND_PLATE_NEGATIVE_ANCHORS, SUBJECT_CUTOUT_NEGATIVE_ANCHORS, buildBackgroundPlatePrompt, buildSubjectCutoutPrompt } from "../layered-generation";
import { addGeneratedImageNode, addReferenceImageNode } from "./graph-build";
import type { AddPromptImageNodeInput } from "./graph-build";
import { buildImageWorkflowPortRuleSet, evaluateImageConnection, evaluateImageEdge, NODE_OUTPUT_KIND, portKindCompatible, type PortTypeKind } from "./port-types";
import { getImageWorkflowPortDeclarations, getCanvasNodeEntry } from "../canvas-node-registry";
import { nextStackedPosition } from "./layout";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import type { ImageWorkflowEdge, ImageWorkflowGeneratedNode, ImageWorkflowGraph, ImageWorkflowGroupNode, ImageWorkflowNode, ImageWorkflowNodePosition, ImageWorkflowPromptNode, ImageWorkflowReferenceNode, ImageWorkflowStickyNode, StoryboardItem,
  ImageWorkflowNsfwNode, ImageWorkflowUnclothNode, ImageWorkflowRerouteNode,
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
    variant?: "fast" | "fine" | "instruct";
    position?: ImageWorkflowNodePosition;
    createdAt?: number;
  },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  // 全参数缺省回落工作流现值(读侧 resolveUnclothDefaults 同源);此处只存
  // 用户显式改动,旧画布/新节点零迁移。variant=09-05 快/精档(缺省精)。
  const node: ImageWorkflowUnclothNode = {
    id: input.id ?? createId("uncloth", now),
    type: "uncloth",
    variant: input.variant,
    title: input.title?.trim()
      || (input.variant === "fast" ? "无衣物·快"
        : input.variant === "instruct" ? "无衣物·指令" : "无衣物"),
    prompt: input.prompt,
    position: input.position ?? { x: 80, y: 80 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
}

export function addNsfwImageNode(
  graph: ImageWorkflowGraph,
  input: {
    id?: string;
    title?: string;
    position?: ImageWorkflowNodePosition;
    createdAt?: number;
  },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  // 一期零参数:固定专业流默认栈(强度调节二期经 loras 四槽透传)
  const node: ImageWorkflowNsfwNode = {
    id: input.id ?? createId("nsfw", now),
    type: "nsfw",
    title: input.title?.trim() || "NSFW破限",
    position: input.position ?? { x: 80, y: 80 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
}

/** Reroute 中转节点工厂(09-09 照 ComfyUI):零业务字段,规则/编译穿透处理 */
export function addRerouteImageNode(
  graph: ImageWorkflowGraph,
  input: {
    id?: string;
    title?: string;
    position?: ImageWorkflowNodePosition;
    createdAt?: number;
  },
): ImageWorkflowGraph {
  const now = input.createdAt ?? Date.now();
  const node: ImageWorkflowRerouteNode = {
    id: input.id ?? createId("reroute", now),
    type: "reroute",
    title: input.title?.trim() || "中转点",
    position: input.position ?? { x: 80, y: 80 },
    createdAt: now,
    updatedAt: now,
  };
  return touchGraph({ ...graph, nodes: [...graph.nodes, node] }, now);
}

export function addPromptImageNode(
  graph: ImageWorkflowGraph,
  input: AddPromptImageNodeInput,
): ImageWorkflowGraph {  const now = input.createdAt ?? Date.now();
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
  // 带 handle 的边(编号口/正负双出口)走连线级单源席位规则;存量无 handle
  // 程序化建边保持节点级 isValidImageEdge,行为零变化
  const valid = edge.sourceHandle || edge.targetHandle
    ? isValidImageConnection(graph, edge)
    : isValidImageEdge(graph, edge.source, edge.target);
  if (!valid) return graph;

  return touchGraph({
    ...graph,
    edges: [
      ...graph.edges,
      {
        // id 唯一性(09-07 双出口):同对节点可有正/负(及①/②口)多边,
        // 裸 source->target 会撞 id——选中/删除按 id 命中会两根一起动;
        // handle 后缀去重,存量无 handle 边零迁移(id 不变)
        id: edge.id ?? `${edge.source}->${edge.target}${edge.targetHandle ? `:${edge.targetHandle}` : ""}${edge.sourceHandle ? `:${edge.sourceHandle}` : ""}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        // 09-07 双出口/编号口:handle 必须落库(此前只存 label,编号口全靠
        // 渲染层回落兜底;正负双出口后回落无法区分极性,必须显式持久化)
        targetHandle: edge.targetHandle,
        sourceHandle: edge.sourceHandle,
      },
    ],
  }, updatedAt);
}

/**
 * 连线域规则单源谓词(两卡 isValidConnection/handleConnect 共用)。
 * 09-08 三期A 声明化:原 ~130 行手写 if-else 退役为「类型兼容+端口容量+
 * 互斥组」查表(port-types.ts 引擎 + canvas-node-registry.ts inputs 声明),
 * 行为零变化——全部存量裁定(09-03 一图一提示词/09-04 无衣物/09-07 nsfw
 * 互斥与编号口)原样翻译成声明,差分对拍见 port-types-parity.test.ts:
 * - 自环拒/不存在节点拒/sticky、group 源拒/同向去重(引擎通用规则)
 * - 目标必须成图/无衣物/NSFW破限(未声明 inputs 的类型不可作目标)
 * - 一个成图只吃一根提示词边(09-03,含 targetNodeId 直挂语义+首根放行)
 * - 无衣物:图输入(reference/generated/uncloth 链式)节点级不限+两根
 *   提示词(①② 编号口,存量无 handle 边上限 2 兼容)
 * - NSFW破限:入=单 prompt;出=单链;与成图直连 prompt 互斥
 */
export function isValidImageEdge(
  graph: ImageWorkflowGraph,
  source: string,
  target: string,
): boolean {
  return evaluateImageEdge(collapseTransparentNodes(graph), source, target, imageEdgeRuleSet);
}

/**
 * 连线级校验单源(09-07 canvas-basic-interactions 根修):React Flow
 * isValidConnection 的唯一后端。09-08 三期A 声明化:在 isValidImageEdge
 * (节点级规则)之上的 handle 口别规则同样翻译成声明查表(席位声明挂在
 * 注册表 inputs 的 seats / outputSeats 上),行为零变化:
 * - uncloth 图口:只吃 reference/generated/uncloth 源,一根封口
 * - uncloth ①② 口:只吃 prompt 源,各口正/负席位(09-07 双出口裁定:
 *   同口「正」边≤1+「负」边≤1,两口可共存=目标侧正负拼装)
 * - prompt 源带 sourceHandle(positive/negative 双出口):同口分席各≤1;
 *   存量无 sourceHandle 边=整节点语义,占「正」席(行为兼容)
 * - 无 handle(存量边/程序化建边):回落 isValidImageEdge 原规则
 */
export function isValidImageConnection(
  graph: ImageWorkflowGraph,
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
): boolean {
  return evaluateImageConnection(collapseTransparentNodes(graph), connection, imageEdgeRuleSet);
}

// ── Reroute 中转 + bypass 旁路(09-09 照 ComfyUI) ─────────────────────
//
// 透明节点(reroute/bypassed)不参与任何规则/解析/编译:所有消费方先经
// collapseTransparentNodes 拿「塌缩视图」——reroute=唯一入边直通全部出边;
// bypassed 业务节点=按端口类型把同类入边接到自己的出边(图进图出/文进文出,
// ComfyUI bypass 同义),同类入边缺失时其出边随之断开。节点本身保留在图里
// (视觉与画布操作不受影响);无透明节点时原样返回(零开销快路径)。

function isTransparentNode(node: ImageWorkflowNode): boolean {
  return node.type === "reroute" || node.bypassed === true;
}

/**
 * 塌缩视图:透明节点的出边改接其(解析后的)入边真源。
 * 环防御=访问链封顶;重复边/自环滤除;透明节点间链式逐级解析。
 */
export function collapseTransparentNodes(graph: ImageWorkflowGraph): ImageWorkflowGraph {
  const transparentIds = new Set(
    graph.nodes.filter(isTransparentNode).map((node) => node.id),
  );
  if (transparentIds.size === 0) return graph;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const resolveSource = (
    sourceId: string,
    sourceHandle: string | null | undefined,
    chain: Set<string>,
  ): { source: string; sourceHandle?: string } | null => {
    if (chain.has(sourceId)) return null;
    chain.add(sourceId);
    const node = nodesById.get(sourceId);
    if (!node || !isTransparentNode(node)) {
      return { source: sourceId, sourceHandle: sourceHandle ?? undefined };
    }
    const inEdges = graph.edges.filter((edge) => edge.target === sourceId);
    if (inEdges.length === 0) return null;
    // reroute 单入直通;bypassed 节点多入边按「与自身输出同类型」挑选
    if (node.type === "reroute") {
      const head = inEdges[0];
      return resolveSource(head.source, head.sourceHandle, chain);
    }
    const wantedKind = outputKindOfNode(node);
    for (const edge of inEdges) {
      const resolved = resolveSource(edge.source, edge.sourceHandle, chain);
      if (resolved && sourceKindMatches(nodesById.get(resolved.source), wantedKind)) {
        return resolved;
      }
    }
    return null;
  };

  const seen = new Set<string>();
  const edges: ImageWorkflowEdge[] = [];
  for (const edge of graph.edges) {
    if (transparentIds.has(edge.target)) continue; // 透明节点自己的入边不出视图
    let next: ImageWorkflowEdge = edge;
    if (transparentIds.has(edge.source)) {
      const resolved = resolveSource(edge.source, edge.sourceHandle, new Set());
      if (!resolved) continue; // 断链(空转/无同类源):出边随之消失
      next = { ...edge, source: resolved.source, sourceHandle: resolved.sourceHandle };
    }
    if (next.source === next.target) continue;
    const key = `${next.source}:${next.sourceHandle ?? ""}->${next.target}:${next.targetHandle ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(next);
  }
  return { ...graph, edges };
}

/** 节点输出资源类型(NODE_OUTPUT_KIND 优先;comfy-workflow/generic/reroute 从
 * 注册表 outputs 兜底——词表未收录它们,直接补词表会牵动既有连线规则) */
function outputKindOfNode(node: ImageWorkflowNode): PortTypeKind | null {
  const kind = NODE_OUTPUT_KIND[node.type];
  if (kind) return kind;
  const outputs = getCanvasNodeEntry("image-workflow", node.type)?.outputs;
  const first = outputs?.[0]?.kind;
  return first === "production-status" ? null : (first ?? null);
}

/** 真源输出是否与旁路节点所需同类(reference/generated 图族互通,按兼容表) */
function sourceKindMatches(source: ImageWorkflowNode | undefined, wanted: PortTypeKind | null): boolean {
  if (!source || !wanted) return false;
  const kind = NODE_OUTPUT_KIND[source.type];
  if (!kind) return false;
  return portKindCompatible(kind, wanted);
}

/**
 * 声明式连线规则集(模块级装配一次):注册表声明(canvas-node-registry
 * inputs/outputSeats/禁作源类型)+ 提示词挂靠解析器(findPromptNodeForGenerated
 * 单源注入,prompt-attach 容量口径不在引擎侧重复实现)。
 */
const imageEdgeRuleSet = buildImageWorkflowPortRuleSet(
  getImageWorkflowPortDeclarations(),
  findPromptNodeForGenerated,
);

/**
 * 提示词极性分流(09-07 双出口裁定):目标输入口的提示词边按 sourceHandle
 * 分为正向/负向两组;存量无 sourceHandle 边=整节点语义,正负文本都取。
 * 口回落(与渲染层同口径):uncloth 目标的无 handle 提示词边按画布纵向序
 * 第 1 根归①口、第 2 根归②口(存量双提示词边语义保持);成图目标不筛口。
 */
export function splitPromptEdgesByPolarity(
  workflowGraph: ImageWorkflowGraph,
  targetNodeId: string,
  targetHandle?: string | null,
  options?: { legacyNegative?: boolean },
): { positive: string[]; negative: string[] } {
  // 塌缩视图:reroute/bypass 穿透后按真源分流(09-09);旁路提示词源不产文
  const graph = collapseTransparentNodes(workflowGraph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const target = nodesById.get(targetNodeId);
  const promptEdges = graph.edges.filter((edge) => {
    if (edge.target !== targetNodeId) return false;
    const source = nodesById.get(edge.source);
    return source?.type === "prompt" && source.bypassed !== true;
  });
  // uncloth 存量无 handle 边按纵向序归口(1→①,2→②)
  const unhandledByOrder = target?.type === "uncloth"
    ? promptEdges
        .filter((edge) => !edge.targetHandle)
        .map((edge) => ({ edge, y: nodesById.get(edge.source)?.position?.y ?? 0 }))
        .sort((a, b) => a.y - b.y)
        .map(({ edge }) => edge)
    : [];
  const effectivePort = (edge: ImageWorkflowEdge): string | null | undefined => {
    if (edge.targetHandle) return edge.targetHandle;
    if (target?.type !== "uncloth") return undefined;
    const idx = unhandledByOrder.indexOf(edge);
    return idx === 0 ? "prompt-1" : idx === 1 ? "prompt-2" : "prompt-1";
  };
  const positive: string[] = [];
  const negative: string[] = [];
  for (const edge of promptEdges) {
    const source = nodesById.get(edge.source);
    if (!source || source.type !== "prompt") continue;
    if (targetHandle && effectivePort(edge) !== targetHandle) continue;
    if (edge.sourceHandle === "negative") {
      if (source.negativePrompt?.trim()) negative.push(source.negativePrompt.trim());
    } else if (edge.sourceHandle === "positive") {
      if (source.prompt?.trim()) positive.push(source.prompt.trim());
    } else {
      // 存量无 sourceHandle(整节点):正向必取;负向按链路旧语义——成图链
      // 旧行为正负都传(legacyNegative 默认 true);uncloth 指令链旧行为
      // 负向被忽略(false),负向须显式连「负」口才拼装(接口明确原则)
      if (source.prompt?.trim()) positive.push(source.prompt.trim());
      if (options?.legacyNegative !== false && source.negativePrompt?.trim()) {
        negative.push(source.negativePrompt.trim());
      }
    }
  }
  return { positive, negative };
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
  // 塌缩视图:reroute/bypass 穿透后按真源找提示词(09-09)
  const collapsed = collapseTransparentNodes(graph);
  const inputNodeIds = collapsed.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => edge.source);
  return collapsed.nodes.find(
    (node): node is ImageWorkflowPromptNode =>
      node.type === "prompt" &&
      !node.bypassed &&
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
