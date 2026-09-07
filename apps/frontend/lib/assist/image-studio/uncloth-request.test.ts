// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import { buildUnclothChainRequest } from "./uncloth-request";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  addUnclothImageNode,
  connectImageWorkflowNodes,
} from "@/lib/studio/image-workflow/graph-build";

// 09-07 双出口裁定:①口正负双连=口内拼装「画面避免:」句;②口同款
function seedGraph() {
  let graph: Parameters<typeof addUnclothImageNode>[0] = {
    id: "wf",
    name: "wf",
    target: { kind: "free" },
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  };
  graph = addReferenceImageNode(graph, { id: "ref1", imageUrl: "project-file://a.png", position: { x: 0, y: 0 } });
  graph = addPromptImageNode(graph, {
    id: "p1",
    prompt: "她解开衣扣站在窗边",
    negativePrompt: "多手,变形,文字",
    position: { x: 0, y: 0 },
  });
  graph = addUnclothImageNode(graph, { id: "unc1" });
  graph = addGeneratedImageNode(graph, { id: "gen1", prompt: "", position: { x: 0, y: 0 } });
  graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "unc1", targetHandle: "image" });
  graph = connectImageWorkflowNodes(graph, { source: "unc1", target: "gen1" });
  return graph;
}

describe("uncloth 双出口拼装", () => {
  it("①口正负双连:prompt 含正向文本+「画面避免:」负向句", () => {
    let graph = seedGraph();
    graph = connectImageWorkflowNodes(graph, {
      source: "p1",
      target: "unc1",
      targetHandle: "prompt-1",
      sourceHandle: "positive",
    });
    graph = connectImageWorkflowNodes(graph, {
      source: "p1",
      target: "unc1",
      targetHandle: "prompt-1",
      sourceHandle: "negative",
    });
    const result = buildUnclothChainRequest(graph, "gen1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.prompt).toContain("她解开衣扣站在窗边");
      expect(result.prompt).toContain("画面避免:多手,变形,文字");
    }
  });

  it("②口负向拼进一致性描述(system_prompt)", () => {
    let graph = seedGraph();
    graph = connectImageWorkflowNodes(graph, {
      source: "p1",
      target: "unc1",
      targetHandle: "prompt-1",
      sourceHandle: "positive",
    });
    graph = connectImageWorkflowNodes(graph, {
      source: "p1",
      target: "unc1",
      targetHandle: "prompt-2",
      sourceHandle: "negative",
    });
    const result = buildUnclothChainRequest(graph, "gen1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.params.systemPrompt ?? "").toContain("画面避免:");
    }
  });

  it("存量无 handle 单边:整节点语义(正向为指令),行为不变", () => {
    let graph = seedGraph();
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "unc1" });
    const result = buildUnclothChainRequest(graph, "gen1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.prompt).toContain("她解开衣扣站在窗边");
      expect(result.prompt).not.toContain("画面避免:");
    }
  });
});
