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
import {
  IMAGE_STUDIO_COLUMN_X,
  IMAGE_STUDIO_GENERATED_STEP,
  generatedChainDepth,
  layoutImageStudioGraph,
  nextColumnPosition,
} from "./layout";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";

function nodeById(graph: ImageWorkflowGraph, id: string): ImageWorkflowNode {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node;
}

describe("layoutImageStudioGraph", () => {
  it("三列泳道:参考/提示词/成图各归其列,列内按创建顺序纵向排布", () => {
    let graph = createImageWorkflowGraph();
    graph = addReferenceImageNode(graph, { id: "ref-2", imageUrl: "local-image://upload/b.png", position: { x: 999, y: 999 }, createdAt: 2 });
    graph = addReferenceImageNode(graph, { id: "ref-1", imageUrl: "local-image://upload/a.png", position: { x: 0, y: 0 }, createdAt: 1 });
    graph = addPromptImageNode(graph, { id: "prompt-1", prompt: "p", position: { x: 0, y: 0 }, createdAt: 3 });
    graph = addGeneratedImageNode(graph, { id: "gen-1", prompt: "g", position: { x: 0, y: 0 }, createdAt: 4 });

    const laid = layoutImageStudioGraph(graph);
    expect(nodeById(laid, "ref-1").position).toEqual({ x: IMAGE_STUDIO_COLUMN_X.reference, y: 40 });
    expect(nodeById(laid, "ref-2").position.y).toBeGreaterThan(nodeById(laid, "ref-1").position.y);
    expect(nodeById(laid, "prompt-1").position.x).toBe(IMAGE_STUDIO_COLUMN_X.prompt);
    expect(nodeById(laid, "gen-1").position.x).toBe(IMAGE_STUDIO_COLUMN_X.generated);
  });

  it("成图链代:上游成图→下游成图,下游逐代右移", () => {
    let graph = createImageWorkflowGraph();
    graph = addGeneratedImageNode(graph, { id: "gen-a", prompt: "a", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "gen-b", prompt: "b", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "gen-c", prompt: "c", position: { x: 0, y: 0 } });
    graph = connectImageWorkflowNodes(graph, { source: "gen-a", target: "gen-b" });
    graph = connectImageWorkflowNodes(graph, { source: "gen-b", target: "gen-c" });

    const depths = generatedChainDepth(graph);
    expect(depths.get("gen-a")).toBe(0);
    expect(depths.get("gen-b")).toBe(1);
    expect(depths.get("gen-c")).toBe(2);

    const laid = layoutImageStudioGraph(graph);
    expect(nodeById(laid, "gen-a").position.x).toBe(IMAGE_STUDIO_COLUMN_X.generated);
    expect(nodeById(laid, "gen-b").position.x).toBe(
      IMAGE_STUDIO_COLUMN_X.generated + IMAGE_STUDIO_GENERATED_STEP,
    );
    expect(nodeById(laid, "gen-c").position.x).toBe(
      IMAGE_STUDIO_COLUMN_X.generated + IMAGE_STUDIO_GENERATED_STEP * 2,
    );
  });

  it("成图环边不产生无限深度(防御)", () => {
    let graph = createImageWorkflowGraph();
    graph = addGeneratedImageNode(graph, { id: "gen-a", prompt: "a", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "gen-b", prompt: "b", position: { x: 0, y: 0 } });
    graph = connectImageWorkflowNodes(graph, { source: "gen-a", target: "gen-b" });
    graph = connectImageWorkflowNodes(graph, { source: "gen-b", target: "gen-a" });
    expect(() => generatedChainDepth(graph)).not.toThrow();
    const laid = layoutImageStudioGraph(graph);
    expect(laid.nodes).toHaveLength(2);
  });
});

describe("nextColumnPosition", () => {
  it("空列从起点开始", () => {
    const graph = createImageWorkflowGraph();
    expect(nextColumnPosition(graph, "reference")).toEqual({
      x: IMAGE_STUDIO_COLUMN_X.reference,
      y: 40,
    });
  });

  it("已有节点则排到该列最大 y 之下", () => {
    let graph = createImageWorkflowGraph();
    graph = addReferenceImageNode(graph, { id: "ref-1", imageUrl: "local-image://upload/a.png", position: { x: 80, y: 500 } });
    const next = nextColumnPosition(graph, "reference");
    expect(next.x).toBe(IMAGE_STUDIO_COLUMN_X.reference);
    expect(next.y).toBeGreaterThan(500);
  });
});
