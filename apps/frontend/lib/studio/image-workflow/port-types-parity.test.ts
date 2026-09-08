// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 差分对拍验收(09-08 三期A 端口类型系统,行为零变化核心):
 * 本文件保留重构前 isValidImageEdge/isValidImageConnection 手写实现的
 * 逐字副本(Legacy 版,仅内部递归改名),与新的声明式查表实现在
 * 「枚举小图空间(节点类型×多实例+边组合全排列子集)」与「固定种子 fuzz」
 * 两个维度逐例比对,任何分歧即失败。旧实现副本仅供对拍,禁止修改。
 */

import { describe, expect, it } from "vitest";
import { findPromptNodeForGenerated, isValidImageConnection, isValidImageEdge } from "./graph-build";
import { getImageWorkflowPortDeclarations } from "../canvas-node-registry";
import type { ImageWorkflowEdge, ImageWorkflowGraph, ImageWorkflowNode, ImageWorkflowNodeType } from "@/types/studio";

// ────────── 旧实现副本(重构前逐字拷贝;内部对 isValidImageEdge 的回落调用改指向 Legacy 版) ──────────

function isValidImageEdgeLegacy(
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
    if (sourceNode.type === "reference" || sourceNode.type === "uncloth") return true;
    if (sourceNode.type === "generated") return true;
    if (sourceNode.type === "prompt") {
      const promptEdges = graph.edges.filter(
        (item) =>
          item.target === target &&
          graph.nodes.find((node) => node.id === item.source)?.type === "prompt",
      );
      return promptEdges.length < 2;
    }
    return false;
  }

  // ── NSFW破限节点的入边规则 ──
  if (targetNode.type === "nsfw") {
    if (sourceNode.type !== "prompt") return false;
    const hasPrompt = graph.edges.some(
      (item) =>
        item.target === target &&
        graph.nodes.find((node) => node.id === item.source)?.type === "prompt",
    );
    return !hasPrompt;
  }

  // ── 成图目标(既有规则) ──
  if (targetNode.type !== "generated") return false;
  if (sourceNode.type === "uncloth") {
    const hasUncloth = graph.edges.some(
      (item) =>
        item.target === target &&
        graph.nodes.find((node) => node.id === item.source)?.type === "uncloth",
    );
    if (hasUncloth) return false;
    return true;
  }
  if (sourceNode.type === "nsfw") {
    const hasNsfw = graph.edges.some(
      (item) =>
        item.target === target &&
        graph.nodes.find((node) => node.id === item.source)?.type === "nsfw",
    );
    if (hasNsfw) return false;
    if (findPromptNodeForGenerated(graph, target)) return false;
    return true;
  }
  if (sourceNode.type === "prompt") {
    const existing = findPromptNodeForGenerated(graph, target);
    if (existing && existing.id !== source) return false;
    const hasNsfwChain = graph.edges.some(
      (item) =>
        item.target === target &&
        graph.nodes.find((node) => node.id === item.source)?.type === "nsfw",
    );
    if (hasNsfwChain) return false;
  }
  return true;
}

function isValidImageConnectionLegacy(
  graph: ImageWorkflowGraph,
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.target === connection.source) return false;
  const targetNode = graph.nodes.find((node) => node.id === connection.target);
  const sourceNode = graph.nodes.find((node) => node.id === connection.source);
  const nodeType = (id: string) => graph.nodes.find((node) => node.id === id)?.type;

  if (targetNode?.type === "uncloth" && connection.targetHandle) {
    if (connection.targetHandle === "image") {
      if (sourceNode?.type !== "reference" && sourceNode?.type !== "generated" && sourceNode?.type !== "uncloth") {
        return false;
      }
      return !graph.edges.some(
        (item) =>
          item.target === connection.target &&
          (item.targetHandle === "image" || (!item.targetHandle && nodeType(item.source) !== "prompt")),
      );
    }
    if (connection.targetHandle === "prompt-1" || connection.targetHandle === "prompt-2") {
      if (sourceNode?.type !== "prompt") return false;
      const wantedPolarity = connection.targetHandle === "prompt-1" ? "positive" : "negative";
      if (connection.sourceHandle && connection.sourceHandle !== wantedPolarity) return false;
      return !graph.edges.some(
        (item) =>
          item.target === connection.target &&
          (item.targetHandle === connection.targetHandle ||
            (!item.targetHandle && connection.targetHandle === "prompt-1" && nodeType(item.source) === "prompt")),
      );
    }
    return false;
  }

  if (sourceNode?.type === "prompt" && connection.sourceHandle) {
    if (connection.sourceHandle !== "positive" && connection.sourceHandle !== "negative") return false;
    const samePort = graph.edges.filter(
      (item) =>
        item.target === connection.target &&
        (item.targetHandle ?? (nodeType(item.source) === "prompt" ? "prompt-1" : undefined)) ===
          (connection.targetHandle ?? "prompt-1"),
    );
    if (targetNode?.type === "nsfw" && connection.sourceHandle === "negative") return false;
    const polarityTaken = (polarity: "positive" | "negative") =>
      samePort.some((item) => (item.sourceHandle ?? "positive") === polarity);
    return !polarityTaken(connection.sourceHandle);
  }

  if (targetNode?.type !== "uncloth" || !connection.targetHandle) {
    return isValidImageEdgeLegacy(graph, connection.source, connection.target);
  }
  return false;
}

// ────────── 对拍脚手架(原始注入:绕过 connectImageWorkflowNodes 校验,直接构造任意边集) ──────────

/** 故意越出 ImageWorkflowNodeType 枚举的伪造类型:验证未知类型路径两侧一致(旧规则成图尾态放行) */
const ROGUE_TYPE = "future-widget" as unknown as ImageWorkflowNodeType;

type RawEdgeSpec = Omit<ImageWorkflowEdge, "id">;

function buildNode(id: string, type: ImageWorkflowNodeType, targetNodeId?: string): ImageWorkflowNode {
  const base = { id, type, title: id, position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 };
  switch (type) {
    case "reference":
      return { ...base, type: "reference", imageUrl: "x://t.png" };
    case "prompt":
      return { ...base, type: "prompt", prompt: "p", negativePrompt: undefined, aspectRatio: "1:1", targetNodeId };
    case "generated":
      return { ...base, type: "generated", prompt: "", aspectRatio: "1:1", status: "idle" as ImageWorkflowGeneratedStatus };
    case "uncloth":
      return { ...base, type: "uncloth" };
    case "nsfw":
      return { ...base, type: "nsfw" };
    case "sticky":
      return { ...base, type: "sticky", text: "", color: "yellow" as const };
    case "group":
      return { ...base, type: "group", memberIds: [] };
    default:
      // 伪造类型(对拍专用):TS 侧经 ROGUE_TYPE 双重断言进来,运行时字面量
      return { ...base, type } as ImageWorkflowNode;
  }
}

type ImageWorkflowGeneratedStatus = ImageWorkflowNode extends infer T
  ? T extends { type: "generated"; status: infer S } ? S : never
  : never;

function buildGraph(nodes: ImageWorkflowNode[], edges: readonly RawEdgeSpec[]): ImageWorkflowGraph {
  return {
    id: "wf",
    name: "wf",
    target: { kind: "free" },
    nodes,
    edges: edges.map((edge, index) => ({ ...edge, id: `e${index}` })),
    createdAt: 1,
    updatedAt: 1,
  };
}

function dumpGraph(graph: ImageWorkflowGraph): string {
  const nodes = graph.nodes.map((node) => `${node.id}:${node.type}${node.type === "prompt" && node.targetNodeId ? `→${node.targetNodeId}` : ""}`);
  const edges = graph.edges.map((edge) => `${edge.source}-[${edge.sourceHandle ?? ""}|${edge.targetHandle ?? ""}]->${edge.target}`);
  return `nodes=[${nodes.join(", ")}] edges=[${edges.join(", ")}]`;
}

interface DiffRecord {
  case: string;
  detail: string;
}

const diffs: DiffRecord[] = [];
let edgeChecks = 0;
let connectionChecks = 0;

function compareEdge(graph: ImageWorkflowGraph, source: string, target: string): void {
  edgeChecks += 1;
  const legacy = isValidImageEdgeLegacy(graph, source, target);
  const next = isValidImageEdge(graph, source, target);
  if (legacy !== next && diffs.length < 20) {
    diffs.push({
      case: "isValidImageEdge",
      detail: `${dumpGraph(graph)} | edge ${source}->${target} legacy=${legacy} next=${next}`,
    });
  }
}

function compareConnection(
  graph: ImageWorkflowGraph,
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
): void {
  connectionChecks += 1;
  const legacy = isValidImageConnectionLegacy(graph, connection);
  const next = isValidImageConnection(graph, connection);
  if (legacy !== next && diffs.length < 20) {
    diffs.push({
      case: "isValidImageConnection",
      detail: `${dumpGraph(graph)} | conn ${connection.source}-[${connection.sourceHandle ?? ""}|${connection.targetHandle ?? ""}]->${connection.target} legacy=${legacy} next=${next}`,
    });
  }
}

// ────────── 枚举小图空间:固定节点名册 + 边全集子集全排列 ──────────

// 名册:七种类型全覆盖×关键类型双实例 + 伪造类型;p2 挂 targetNodeId=gen1
// (直挂语义进枚举);ghost=不存在节点 id。
const ROSTER: ImageWorkflowNode[] = [
  buildNode("ref1", "reference"),
  buildNode("ref2", "reference"),
  buildNode("p1", "prompt"),
  buildNode("p2", "prompt", "gen1"),
  buildNode("gen1", "generated"),
  buildNode("gen2", "generated"),
  buildNode("unc1", "uncloth"),
  buildNode("unc2", "uncloth"),
  buildNode("nsfw1", "nsfw"),
  buildNode("sticky1", "sticky"),
  buildNode("group1", "group"),
  buildNode("rogue1", ROGUE_TYPE),
];
const IDS = [...ROSTER.map((node) => node.id), "ghost"];

// 边全集(语义热点:成图四通道/无衣物三口/nsfw 单口/直挂互斥/席位回落)
const EDGE_UNIVERSE: readonly RawEdgeSpec[] = [
  { source: "p1", target: "gen1" },
  { source: "p2", target: "gen1", sourceHandle: "positive" },
  { source: "nsfw1", target: "gen1" },
  { source: "unc1", target: "gen1" },
  { source: "ref1", target: "gen1" },
  { source: "p1", target: "unc1" },
  { source: "ref1", target: "unc1", targetHandle: "image" },
  { source: "p2", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" },
  { source: "p2", target: "unc1", targetHandle: "prompt-2", sourceHandle: "negative" },
  { source: "p1", target: "nsfw1" },
  { source: "gen2", target: "gen1" },
];

// 连线级枚举维度:全部源(含 ghost/rogue/sticky)× 三个声明目标 + ghost 目标 × handle 全组合(含伪 handle)
const CONN_SOURCES = IDS;
const CONN_TARGETS = ["gen1", "unc1", "unc2", "nsfw1", "ghost"];
const SOURCE_HANDLES: readonly (string | undefined)[] = [undefined, "positive", "negative", "junk-out"];
const TARGET_HANDLES: readonly (string | undefined)[] = [undefined, "image", "prompt-1", "prompt-2", "junk-in"];

let enumStates = 0;

describe("端口类型系统差分对拍(枚举小图空间)", () => {
  it("边全集 2^11 子集 × 全源对/全 handle 组合:新旧谓词逐例一致", () => {
    for (let mask = 0; mask < 1 << EDGE_UNIVERSE.length; mask += 1) {
      const edges = EDGE_UNIVERSE.filter((_, index) => mask & (1 << index));
      const graph = buildGraph(ROSTER, edges);
      enumStates += 1;
      // 节点级谓词:全部有序对(含自环/ghost/rogue)
      for (const source of IDS) {
        for (const target of IDS) {
          compareEdge(graph, source, target);
        }
      }
      // 连线级谓词:声明目标×handle 全组合 + 空值哨兵
      for (const source of CONN_SOURCES) {
        for (const target of CONN_TARGETS) {
          for (const sourceHandle of SOURCE_HANDLES) {
            for (const targetHandle of TARGET_HANDLES) {
              compareConnection(graph, { source, target, sourceHandle, targetHandle });
            }
          }
        }
      }
      compareConnection(graph, { source: null, target: "gen1" });
      compareConnection(graph, { source: "p1", target: null });
      compareConnection(graph, { source: "p1", target: "p1", sourceHandle: "positive", targetHandle: "prompt-1" });
    }
    expect(diffs).toEqual([]);
    // 计数下限(证明覆盖量,非空转)
    expect(enumStates).toBe(2048);
    expect(edgeChecks).toBeGreaterThan(300_000);
    expect(connectionChecks).toBeGreaterThan(1_000_000);
  }, 240_000);
});

// ────────── 固定种子 fuzz:随机图(含伪造类型/ghost 边/随机直挂) ──────────

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_TYPES: readonly ImageWorkflowNodeType[] = [
  "reference",
  "prompt",
  "generated",
  "uncloth",
  "nsfw",
  "sticky",
  "group",
  ROGUE_TYPE,
];
const FUZZ_NODE_HANDLES: readonly (string | undefined)[] = [undefined, "image", "prompt-1", "prompt-2", "bogus"];
const FUZZ_SOURCE_HANDLES: readonly (string | undefined)[] = [undefined, "positive", "negative", "bogus"];

describe("端口类型系统差分对拍(固定种子 fuzz)", () => {
  it("2400 例随机图 × 全源对 + 随机连线组合:新旧谓词逐例一致", () => {
    const rng = mulberry32(20260908);
    const pick = <T,>(items: readonly T[]): T => {
      const chosen = items[Math.floor(rng() * items.length)];
      return chosen as T;
    };
    const FUZZ_CASES = 2400;
    let fuzzChecks = 0;
    for (let round = 0; round < FUZZ_CASES; round += 1) {
      const nodeCount = 1 + Math.floor(rng() * 6);
      const nodes: ImageWorkflowNode[] = [];
      for (let i = 0; i < nodeCount; i += 1) {
        const type = pick(FUZZ_TYPES);
        const targetNodeId = type === "prompt" && rng() < 0.4
          ? `n${Math.floor(rng() * nodeCount)}`
          : undefined;
        nodes.push(buildNode(`n${i}`, type, targetNodeId));
      }
      const nodeIds = nodes.map((node) => node.id);
      const withGhosts = [...nodeIds, "ghostSrc", "ghostDst"];
      const edgeCount = Math.floor(rng() * 7);
      const edges: RawEdgeSpec[] = [];
      for (let i = 0; i < edgeCount; i += 1) {
        edges.push({
          source: rng() < 0.15 ? "ghostSrc" : pick(nodeIds),
          target: rng() < 0.15 ? "ghostDst" : pick(nodeIds),
          ...(rng() < 0.4 ? { targetHandle: pick(FUZZ_NODE_HANDLES) } : {}),
          ...(rng() < 0.4 ? { sourceHandle: pick(FUZZ_SOURCE_HANDLES) } : {}),
        });
      }
      const graph = buildGraph(nodes, edges);
      // 节点级:全有序对(含自环/ghost)
      for (const source of withGhosts) {
        for (const target of withGhosts) {
          compareEdge(graph, source, target);
          fuzzChecks += 1;
        }
      }
      // 连线级:每例 40 随机组合 + 8 个固定热点组合
      for (let i = 0; i < 40; i += 1) {
        const source = rng() < 0.05 ? null : pick(withGhosts);
        const target = rng() < 0.05 ? null : pick(withGhosts);
        compareConnection(graph, { source, target, sourceHandle: pick(FUZZ_SOURCE_HANDLES), targetHandle: pick(FUZZ_NODE_HANDLES) });
        fuzzChecks += 1;
      }
      const hotPairs: readonly (readonly [string, string])[] = [
        ["n0", "n0"],
        ["ghostSrc", "ghostDst"],
      ];
      for (const [a, b] of hotPairs) {
        for (const targetHandle of ["image", "prompt-1", "prompt-2", undefined] as const) {
          compareConnection(graph, { source: a, target: b, sourceHandle: "positive", targetHandle });
          fuzzChecks += 1;
        }
      }
    }
    expect(diffs).toEqual([]);
    expect(fuzzChecks).toBeGreaterThan(100_000);
  }, 240_000);
});

// ────────── 声明表形态自检(数据面锚点,防止声明被误删/误改) ──────────

describe("端口类型系统声明表(注册表 inputs/outputSeats)", () => {
  it("成图/无衣物/NSFW破限声明输入通道;reference/prompt 不可作目标", () => {
    const { inputsByType, outputSeatsByType, bannedSourceTypes } = getImageWorkflowPortDeclarations();
    expect(Object.keys(inputsByType).sort()).toEqual(["generated", "nsfw", "uncloth"]);
    expect(bannedSourceTypes).toEqual(["sticky", "group"]);
    // 成图五通道+兜底;提示词/nsfw 链互斥成对
    const generated = inputsByType["generated"] ?? [];
    expect(generated.map((channel) => channel.id)).toEqual([
      "prompt",
      "reference",
      "uncloth-chain",
      "nsfw-chain",
      "image-chain",
      "passthrough",
    ]);
    expect(generated.find((channel) => channel.id === "prompt")?.mutexWith).toEqual(["nsfw-chain"]);
    expect(generated.find((channel) => channel.id === "nsfw-chain")?.mutexWith).toEqual(["prompt"]);
    // 无衣物三口:图口/①正向席/②负向席;节点级提示词合计 2
    const uncloth = inputsByType["uncloth"] ?? [];
    expect((uncloth.find((channel) => channel.id === "image")?.seats ?? []).map((seat) => seat.handleId)).toEqual(["image"]);
    const unclothPrompt = uncloth.find((channel) => channel.id === "prompt");
    expect(unclothPrompt?.capacity).toBe(2);
    expect((unclothPrompt?.seats ?? []).map((seat) => [seat.handleId, seat.polarity])).toEqual([
      ["prompt-1", "positive"],
      ["prompt-2", "negative"],
    ]);
    // NSFW破限单通道容量 1
    expect(inputsByType["nsfw"]?.map((channel) => [channel.id, channel.capacity])).toEqual([["prompt", 1]]);
    // prompt 双出口席位:负向对 nsfw 目标拉黑
    const promptOutputs = outputSeatsByType["prompt"];
    expect(promptOutputs?.seats.map((seat) => [seat.handleId, seat.bannedTargetTypes])).toEqual([
      ["positive", undefined],
      ["negative", ["nsfw"]],
    ]);
  });
});
