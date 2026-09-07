// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addNsfwImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { findNsfwUpstream, findPromptViaNsfw, isNsfwProModel } from "./nsfw-request";
import type { ImageWorkflowGraph } from "@/types/studio";

function buildNsfwGraph(): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph();
  graph = addPromptImageNode(graph, {
    id: "prompt-1",
    prompt: "破限链提示词",
    position: { x: 0, y: 0 },
  });
  graph = addNsfwImageNode(graph, { id: "nsfw-1", position: { x: 100, y: 0 } });
  graph = addGeneratedImageNode(graph, {
    id: "gen-1",
    prompt: "inline",
    model: "krea2-turbo",
    aspectRatio: "1:1",
    position: { x: 300, y: 0 },
  });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "nsfw-1" });
  graph = connectImageWorkflowNodes(graph, { source: "nsfw-1", target: "gen-1" });
  return graph;
}

describe("isNsfwProModel(引擎守卫白名单)", () => {
  it("Krea2 与 ComfyUI桥 消费 use_lora", () => {
    expect(isNsfwProModel("krea2-turbo")).toBe(true);
    expect(isNsfwProModel("comfyui-bridge")).toBe(true);
  });

  it("其余本地引擎与云端模型拒绝(undefined 亦拒)", () => {
    expect(isNsfwProModel("flux2-klein-9b")).toBe(false);
    expect(isNsfwProModel("z-image-turbo")).toBe(false);
    expect(isNsfwProModel("qwen-image-edit-2511")).toBe(false);
    expect(isNsfwProModel("gpt-image-2")).toBe(false);
    expect(isNsfwProModel(undefined)).toBe(false);
  });
});

describe("findNsfwUpstream(成图的 nsfw 链检测)", () => {
  it("成图上游挂 nsfw 节点时返回该节点", () => {
    const nsfw = findNsfwUpstream(buildNsfwGraph(), "gen-1");
    expect(nsfw?.id).toBe("nsfw-1");
    expect(nsfw?.type).toBe("nsfw");
  });

  it("无 nsfw 链返回 undefined(存量画布零迁移:行为与现状一致)", () => {
    let graph = createImageWorkflowGraph();
    graph = addPromptImageNode(graph, { id: "prompt-1", prompt: "p", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "gen-1", prompt: "inline", aspectRatio: "1:1", position: { x: 1, y: 0 } });
    graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
    expect(findNsfwUpstream(graph, "gen-1")).toBeUndefined();
  });
});

describe("findPromptViaNsfw(经破限节点的提示词通道)", () => {
  it("返回 nsfw 上游的提示词节点", () => {
    const prompt = findPromptViaNsfw(buildNsfwGraph(), "nsfw-1");
    expect(prompt?.id).toBe("prompt-1");
    expect(prompt?.prompt).toBe("破限链提示词");
  });

  it("破限节点未连提示词时返回 undefined(调用方回落+指路)", () => {
    let graph = createImageWorkflowGraph();
    graph = addNsfwImageNode(graph, { id: "nsfw-1", position: { x: 0, y: 0 } });
    expect(findPromptViaNsfw(graph, "nsfw-1")).toBeUndefined();
  });
});

describe("连线域规则(nsfw 链互斥,经 isValidImageEdge 单源)", () => {
  it("nsfw 只吃一根提示词边;成图已有直连提示词时拒 nsfw 链(通道二选一)", () => {
    let graph = buildNsfwGraph();
    // 第二根提示词→nsfw 被拒(单提示词)
    graph = addPromptImageNode(graph, { id: "prompt-2", prompt: "第二根", position: { x: 0, y: 100 } });
    graph = connectImageWorkflowNodes(graph, { source: "prompt-2", target: "nsfw-1" });
    expect(graph.nodes.some((node) => node.id === "prompt-2")).toBe(true);
    expect(graph.edges.some((edge) => edge.source === "prompt-2" && edge.target === "nsfw-1")).toBe(false);

    // 成图已有 nsfw 链时直连提示词被拒(互斥)
    graph = connectImageWorkflowNodes(graph, { source: "prompt-2", target: "gen-1" });
    expect(graph.edges.some((edge) => edge.source === "prompt-2" && edge.target === "gen-1")).toBe(false);
  });

  it("参考图仍可直连成图(nsfw 链与参考共存,专业流 SDEdit 图生图)", () => {
    let graph = buildNsfwGraph();
    graph = addReferenceImageNode(graph, { id: "ref-1", imageUrl: "local-image://a.png", position: { x: 0, y: 50 } });
    graph = connectImageWorkflowNodes(graph, { source: "ref-1", target: "gen-1" });
    expect(graph.edges.some((edge) => edge.source === "ref-1" && edge.target === "gen-1")).toBe(true);
  });
});
