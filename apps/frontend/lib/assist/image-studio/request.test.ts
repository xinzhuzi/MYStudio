// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import { buildImageStudioGenerationRequest } from "./request";
import type { ImageWorkflowGraph } from "@/types/studio";

function buildGraph(): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph();
  graph = addPromptImageNode(graph, {
    id: "prompt-1",
    prompt: "  山门远景,晨雾  ",
    negativePrompt: " 模糊 ",
    position: { x: 0, y: 0 },
  });
  graph = addGeneratedImageNode(graph, {
    id: "gen-1",
    prompt: "unused-inline",
    model: "krea2-turbo",
    aspectRatio: "16:9",
    position: { x: 100, y: 0 },
  });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
  return graph;
}

describe("buildImageStudioGenerationRequest", () => {
  it("文生图:无参考连线,提示词取连线提示词节点(含 trim)", () => {
    const request = buildImageStudioGenerationRequest(buildGraph(), "gen-1");
    expect(request.prompt).toBe("山门远景,晨雾");
    expect(request.negativePrompt).toBe("模糊");
    expect(request.referenceImages).toEqual([]);
    expect(request.model).toBe("krea2-turbo");
    expect(request.aspectRatio).toBe("16:9");
  });

  it("图生图:参考图节点按连线顺序收集", () => {
    let graph = buildGraph();
    graph = addReferenceImageNode(graph, {
      id: "ref-1",
      imageUrl: "local-image://upload/a.png",
      position: { x: 0, y: 100 },
    });
    graph = addReferenceImageNode(graph, {
      id: "ref-2",
      imageUrl: "local-image://upload/b.png",
      position: { x: 0, y: 200 },
    });
    graph = connectImageWorkflowNodes(graph, { source: "ref-2", target: "gen-1" });
    graph = connectImageWorkflowNodes(graph, { source: "ref-1", target: "gen-1" });
    const request = buildImageStudioGenerationRequest(graph, "gen-1");
    expect(request.referenceImages).toEqual([
      "local-image://upload/b.png",
      "local-image://upload/a.png",
    ]);
  });

  it("混合参考:参考图节点+上游成图按连线顺序交错收集;无 resultUrl 的上游跳过", () => {
    let graph = buildGraph();
    graph = addReferenceImageNode(graph, {
      id: "ref-1",
      imageUrl: "local-image://upload/a.png",
      position: { x: 0, y: 100 },
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-upstream-a",
      prompt: "上游A",
      position: { x: 0, y: 200 },
    });
    graph = addGeneratedImageNode(graph, {
      id: "gen-upstream-b",
      prompt: "上游B",
      position: { x: 0, y: 300 },
    });
    // 连线顺序:参考图→上游A(无结果,跳过)→上游B(有结果,计入)
    graph = connectImageWorkflowNodes(graph, { source: "ref-1", target: "gen-1" });
    graph = connectImageWorkflowNodes(graph, { source: "gen-upstream-a", target: "gen-1" });
    graph = connectImageWorkflowNodes(graph, { source: "gen-upstream-b", target: "gen-1" });
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "gen-upstream-b"
          ? { ...node, status: "ready", resultUrl: "local-image://ai-image/up-b.png" }
          : node,
      ),
    };
    const request = buildImageStudioGenerationRequest(graph, "gen-1");
    expect(request.referenceImages).toEqual([
      "local-image://upload/a.png",
      "local-image://ai-image/up-b.png",
    ]);
  });

  it("链式图生图:上游成图 resultUrl 计入参考图", () => {
    let graph = buildGraph();
    graph = addGeneratedImageNode(graph, {
      id: "gen-upstream",
      prompt: "上游",
      position: { x: 0, y: 100 },
    });
    graph = connectImageWorkflowNodes(graph, { source: "gen-upstream", target: "gen-1" });
    const first = buildImageStudioGenerationRequest(graph, "gen-1");
    expect(first.referenceImages).toEqual([]);

    const nodes = graph.nodes.map((node) =>
      node.id === "gen-upstream" && node.type === "generated"
        ? { ...node, resultUrl: "local-image://ai-image/up.png" }
        : node,
    );
    const request = buildImageStudioGenerationRequest({ ...graph, nodes }, "gen-1");
    expect(request.referenceImages).toEqual(["local-image://ai-image/up.png"]);
  });

  it("无连线提示词节点时回落成图节点内联提示词", () => {
    const graph = buildGraph();
    const detached = { ...graph, edges: [] };
    const request = buildImageStudioGenerationRequest(detached, "gen-1");
    expect(request.prompt).toBe("unused-inline");
  });

  it("空提示词返回空串(调用方预检拦截)", () => {
    const graph = buildGraph();
    const cleared = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "prompt" || node.type === "generated"
          ? { ...node, prompt: "   " }
          : node,
      ),
    };
    expect(buildImageStudioGenerationRequest(cleared, "gen-1").prompt).toBe("");
  });
});
