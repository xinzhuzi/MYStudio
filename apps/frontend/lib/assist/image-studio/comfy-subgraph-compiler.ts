// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布子图 → ComfyUI API 格式编译器(09-08 三期收官,流X;纯函数)。
 *
 * 输入=画布节点数组(含 comfy-generic 节点 {classType, widgets 值} + 连线)
 * + 选区;输出=可直接提交 /comfy/execute 的 API 格式 graph:
 * - comfy-generic ↔ comfy-generic 连线 → [源节点, 输出槽] 内部连线
 *   (sourceHandle=输出槽位序号;targetHandle=输入口 key);
 * - 外部提示词(画布提示词节点)→ STRING 口直填文本(正/负极性按出口分);
 * - 外部图(参考图/成图/工作流节点/已出图的效果节点)→ IMAGE 口挂虚拟
 *   LoadImage 上传节点(pendingImages 回填 b64 后由后端上传引擎);
 * - 末端节点(无下游连线)自动补 SaveImage 取回输出图。
 * 大白话报错:环检测/缺 classType/口类型不匹配/悬空类型口/上游图未就绪。
 * 口类型词表经 E 流 comfy-port-colors 同源的类型名约定(IMAGE/STRING/…)。
 */

import type { ComfyApiWorkflow } from "@/lib/assist/image-studio/comfy-workflow-import";
import type { ComfyEffectNodeDescriptor } from "@/lib/assist/image-studio/comfy-effect-catalog";

/** 编译输入的画布节点(仅取编译所需字段;调用方从 graph 投影) */
export interface ComfySubgraphNodeInput {
  id: string;
  type: string;
  title?: string;
  /** comfy-generic 专用 */
  classType?: string;
  descriptor?: ComfyEffectNodeDescriptor;
  widgetValues?: Record<string, number | string | boolean>;
  /** 外部图源(reference.imageUrl / 其余 resultUrl) */
  imageUrl?: string;
  resultUrl?: string;
  /** 外部提示词源 */
  prompt?: string;
  negativePrompt?: string;
}

export interface ComfySubgraphEdgeInput {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ComfySubgraphCompileInput {
  nodes: readonly ComfySubgraphNodeInput[];
  edges: readonly ComfySubgraphEdgeInput[];
  /** 画布选区(comfy-generic 成员;其余类型作为外部注入源) */
  selection: readonly string[];
}

/** 待回填的上传图槽位(运行方按 sourceNodeId 取图转 b64) */
export interface ComfySubgraphPendingImage {
  /** 注入点 `${虚拟LoadImage节点}.image` */
  key: string;
  name: string;
  sourceNodeId: string;
}

/** 末端节点映射(执行收图后按 saveNodeId 对回画布节点) */
export interface ComfySubgraphTerminal {
  /** 自动补的 SaveImage 节点 id(结果 images[].nodeId 与之对应) */
  saveNodeId: string;
  canvasNodeId: string;
  nodeTitle: string;
}

export type ComfySubgraphCompileResult =
  | {
      ok: true;
      graph: ComfyApiWorkflow;
      pendingImages: ComfySubgraphPendingImage[];
      terminals: ComfySubgraphTerminal[];
      nodeCount: number;
    }
  | { ok: false; error: string };

/** 图源节点可提取的图地址(与 comfy-execute 的收集口径同源) */
function imageUrlOf(node: ComfySubgraphNodeInput | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "reference") return node.imageUrl || undefined;
  return node.resultUrl || undefined;
}

function isImageSourceType(type: string): boolean {
  return type === "reference" || type === "generated" || type === "uncloth"
    || type === "comfy-workflow" || type === "comfy-generic";
}

/** 选中节点里的效果节点 = 子图成员 */
function subgraphMembersOf(input: ComfySubgraphCompileInput): ComfySubgraphNodeInput[] {
  const selected = new Set(input.selection);
  return input.nodes.filter(
    (node) => selected.has(node.id) && node.type === "comfy-generic",
  );
}

/** 目标输入口解析:显式 targetHandle → 校验存在;缺省 → 首个 IMAGE 输入口 */
function resolveTargetInputKey(
  node: ComfySubgraphNodeInput,
  targetHandle: string | undefined,
): { ok: true; inputKey: string; portType: string } | { ok: false; error: string } {
  const inputPorts = (node.descriptor?.ports ?? []).filter((port) => port.side === "input");
  if (targetHandle) {
    const port = inputPorts.find((item) => item.id === targetHandle);
    if (!port) {
      return { ok: false, error: `「${node.title ?? node.id}」没有名为 ${targetHandle} 的输入口(节点声明可能已过期,删掉重放试试)` };
    }
    return { ok: true, inputKey: port.id, portType: port.type };
  }
  const imagePort = inputPorts.find((item) => item.type.toUpperCase() === "IMAGE");
  if (imagePort) return { ok: true, inputKey: imagePort.id, portType: imagePort.type };
  const anyPort = inputPorts[0];
  if (anyPort) return { ok: true, inputKey: anyPort.id, portType: anyPort.type };
  return { ok: false, error: `「${node.title ?? node.id}」没有输入口,这根线连不上` };
}

/** 环检测(内部连线 DFS;有环=false) */
function hasCycle(graph: Map<string, string[]>): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (nodeId: string): boolean => {
    const current = state.get(nodeId) ?? 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(nodeId, 1);
    for (const next of graph.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    state.set(nodeId, 2);
    return false;
  };
  for (const nodeId of graph.keys()) {
    if (visit(nodeId)) return true;
  }
  return false;
}

/**
 * 编译主函数(纯函数):选区内 comfy-generic 节点+连线 → API 格式 graph。
 * 口类型严格校验在此执行(声明层宽松的兜底):prompt 源只进 STRING 口、
 * 图源只进 IMAGE 口、类型口(MODEL/…)必须由子图内连线供源。
 */
export function compileComfySubgraph(input: ComfySubgraphCompileInput): ComfySubgraphCompileResult {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const members = subgraphMembersOf(input);
  if (members.length === 0) {
    return { ok: false, error: "选中的节点里没有效果节点——先从「效果节点…」放置,再框选运行子图" };
  }
  const memberIds = new Set(members.map((node) => node.id));

  // 成员前置校验:classType/descriptor 快照齐全
  for (const node of members) {
    if (!node.classType) {
      return { ok: false, error: `「${node.title ?? node.id}」缺少节点类型声明,删掉重放试试` };
    }
    if (!node.descriptor) {
      return { ok: false, error: `「${node.title ?? node.id}」缺少端口声明,删掉重放试试` };
    }
  }

  const graph: ComfyApiWorkflow = {};
  for (const node of members) {
    const inputs: Record<string, unknown> = {};
    for (const widget of node.descriptor?.widgets ?? []) {
      const value = node.widgetValues?.[widget.id] ?? widget.default;
      if (value !== undefined) inputs[widget.id] = value;
    }
    graph[node.id] = { class_type: node.classType!, inputs };
  }

  const pendingImages: ComfySubgraphPendingImage[] = [];
  let uploadSeq = 0;
  let saveSeq = 0;
  const adjacency = new Map<string, string[]>();
  const downstreamOf = new Set<string>();
  const occupiedInputs = new Map<string, Set<string>>();

  const occupyInput = (targetId: string, inputKey: string, sourceLabel: string): string | null => {
    const taken = occupiedInputs.get(targetId) ?? new Set<string>();
    if (taken.has(inputKey)) {
      return `「${nodesById.get(targetId)?.title ?? targetId}」的 ${inputKey} 口已有一根线,一根口只能接一根`;
    }
    taken.add(inputKey);
    occupiedInputs.set(targetId, taken);
    void sourceLabel;
    return null;
  };

  for (const edge of input.edges) {
    if (!memberIds.has(edge.target)) continue;
    const target = nodesById.get(edge.target);
    if (!target) continue;
    const resolved = resolveTargetInputKey(target, edge.targetHandle);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    // ① 内部连线:成员 → 成员([源, 槽])
    if (memberIds.has(edge.source)) {
      const source = nodesById.get(edge.source)!;
      const conflict = occupyInput(edge.target, resolved.inputKey, source.title ?? source.id);
      if (conflict) return { ok: false, error: conflict };
      const slot = Number.parseInt(edge.sourceHandle ?? "0", 10);
      const outputSlot = Number.isInteger(slot) && slot >= 0 ? slot : 0;
      const outputPorts = (source.descriptor?.ports ?? []).filter((port) => port.side === "output");
      if (outputPorts.length === 0) {
        return { ok: false, error: `「${source.title ?? source.id}」没有输出口,不能作为连线来源` };
      }
      graph[edge.target].inputs[resolved.inputKey] = [edge.source, outputSlot];
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      downstreamOf.add(edge.source);
      continue;
    }

    // ② 外部注入:提示词源(STRING 口直填) / 图源(IMAGE 口挂虚拟 LoadImage)
    const source = nodesById.get(edge.source);
    if (!source) continue;
    if (source.type === "prompt") {
      if (resolved.portType.toUpperCase() !== "STRING") {
        return { ok: false, error: `提示词只能连到文本口——「${target.title ?? target.id}」的 ${resolved.inputKey} 口是 ${resolved.portType} 类型` };
      }
      const conflict = occupyInput(edge.target, resolved.inputKey, source.title ?? source.id);
      if (conflict) return { ok: false, error: conflict };
      const text = (edge.sourceHandle === "negative" ? source.negativePrompt : source.prompt)?.trim();
      graph[edge.target].inputs[resolved.inputKey] = text ?? "";
      continue;
    }
    if (isImageSourceType(source.type)) {
      if (resolved.portType.toUpperCase() !== "IMAGE") {
        return { ok: false, error: `图片只能连到图像口——「${target.title ?? target.id}」的 ${resolved.inputKey} 口是 ${resolved.portType} 类型` };
      }
      const conflict = occupyInput(edge.target, resolved.inputKey, source.title ?? source.id);
      if (conflict) return { ok: false, error: conflict };
      const url = imageUrlOf(source);
      if (!url) {
        const hint = source.type === "comfy-workflow"
          ? "先在它卡上点「运行」出图,再运行子图"
          : "先上传/生成,或断开连线";
        return { ok: false, error: `上游「${source.title ?? source.id}」还没有图(${hint})` };
      }
      uploadSeq += 1;
      const uploadNodeId = `__upload_${uploadSeq}`;
      graph[uploadNodeId] = { class_type: "LoadImage", inputs: { image: "__pending__" } };
      graph[edge.target].inputs[resolved.inputKey] = [uploadNodeId, 0];
      pendingImages.push({
        key: `${uploadNodeId}.image`,
        name: `subgraph-${uploadSeq}.png`,
        sourceNodeId: source.id,
      });
      continue;
    }
    return { ok: false, error: `「${source.title ?? source.id}」这种节点不能连进效果子图(只支持提示词与图片源)` };
  }

  // 环检测(大白话)
  if (hasCycle(adjacency)) {
    return { ok: false, error: "子图里有循环连线(转圈了)——断开成一条链再运行" };
  }

  // 类型口悬空校验(MODEL/CLIP/… 等连线口必须已有供源)
  const dangling: string[] = [];
  for (const node of members) {
    for (const port of node.descriptor?.ports ?? []) {
      if (port.side !== "input") continue;
      const value = graph[node.id].inputs[port.id];
      const wired = Array.isArray(value) || typeof value === "string";
      if (!wired && port.type.toUpperCase() !== "IMAGE" && port.type.toUpperCase() !== "STRING") {
        dangling.push(`「${node.title ?? node.id}」的 ${port.id}(${port.type})口没有来源`);
      }
    }
  }
  if (dangling.length > 0) {
    return {
      ok: false,
      error: `${dangling.slice(0, 3).join(";")}${dangling.length > 3 ? " 等" : ""}——这些口需要模型/条件类供源,直放子图暂不支持,请改用工作流节点封装`,
    };
  }

  // 末端补 SaveImage(取回输出图;filename_prefix 携带序号便于对回画布节点)
  const terminals: ComfySubgraphTerminal[] = [];
  for (const node of members) {
    if (downstreamOf.has(node.id)) continue;
    const imageOutput = (node.descriptor?.ports ?? []).find(
      (port) => port.side === "output" && port.type.toUpperCase() === "IMAGE",
    );
    if (!imageOutput) continue;
    saveSeq += 1;
    const saveNodeId = `__save_${saveSeq}`;
    graph[saveNodeId] = {
      class_type: "SaveImage",
      inputs: {
        images: [node.id, Number.parseInt(imageOutput.id, 10) || 0],
        filename_prefix: `mystudio_subgraph/${saveSeq}`,
      },
    };
    terminals.push({ saveNodeId, canvasNodeId: node.id, nodeTitle: node.title ?? node.id });
  }
  if (terminals.length === 0) {
    return { ok: false, error: "子图末端没有图片输出口(选中的效果节点都不产出 IMAGE),无法出图" };
  }

  return { ok: true, graph, pendingImages, terminals, nodeCount: members.length };
}
