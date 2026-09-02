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
import type { ImageWorkflowGeneratedNode } from "@/types/studio";
import { buildNodeClearPlan } from "./clear-node";

function buildGraphWithGenerated(overrides: Partial<ImageWorkflowGeneratedNode> = {}) {
  let graph = createImageWorkflowGraph();
  graph = addPromptImageNode(graph, { id: "prompt-1", prompt: "山门晨雾", position: { x: 0, y: 0 } });
  graph = addGeneratedImageNode(graph, { id: "gen-1", position: { x: 400, y: 0 } });
  graph = connectImageWorkflowNodes(graph, { source: "prompt-1", target: "gen-1" });
  graph = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "gen-1"
        ? {
            ...node,
            status: "ready",
            resultUrl: "local-image://ai-image/a.png",
            resultMediaId: "m1",
            ...overrides,
          } as ImageWorkflowGeneratedNode
        : node,
    ),
  };
  return graph;
}

describe("buildNodeClearPlan 清空内容", () => {
  it("成图节点:清提示词/反向词/结果/批量组,状态复位", () => {
    const graph = buildGraphWithGenerated({
      negativePrompt: "模糊",
      imageBatch: { images: ["local-image://ai-image/a.png", "local-image://ai-image/b.png"], primaryIndex: 0 },
    });
    const plan = buildNodeClearPlan(graph, "gen-1");
    expect(plan.busy).toBe(false);
    if (plan.busy) return;
    const generated = plan.targets.find((t) => t.nodeId === "gen-1");
    expect(generated?.updates).toMatchObject({
      prompt: "",
      negativePrompt: "",
      resultUrl: undefined,
      resultMediaId: undefined,
      imageBatch: undefined,
      status: "idle",
      errorReason: undefined,
    });
  });

  it("连线提示词节点:一并清其正文(卡内文本框所见即所清)", () => {
    const plan = buildNodeClearPlan(buildGraphWithGenerated(), "gen-1");
    expect(plan.busy).toBe(false);
    if (plan.busy) return;
    const promptTarget = plan.targets.find((t) => t.nodeId === "prompt-1");
    expect(promptTarget?.updates).toMatchObject({ prompt: "", negativePrompt: "" });
  });

  it("生成中:busy,不产生清理目标", () => {
    const plan = buildNodeClearPlan(buildGraphWithGenerated({ status: "generating" }), "gen-1");
    expect(plan).toEqual({ busy: true });
    const queued = buildNodeClearPlan(buildGraphWithGenerated({ status: "queued" }), "gen-1");
    expect(queued).toEqual({ busy: true });
  });

  it("提示词节点:只清正文/反向词;参考图节点:只清图", () => {
    let graph = createImageWorkflowGraph();
    graph = addPromptImageNode(graph, { id: "prompt-1", prompt: "正文", position: { x: 0, y: 0 } });
    graph = addReferenceImageNode(graph, { id: "ref-1", imageUrl: "local-image://ai-image/r.png", position: { x: 0, y: 300 } });
    const promptPlan = buildNodeClearPlan(graph, "prompt-1");
    expect(promptPlan.busy).toBe(false);
    if (promptPlan.busy) return;
    expect(promptPlan.targets).toEqual([
      { nodeId: "prompt-1", updates: expect.objectContaining({ prompt: "" }) },
    ]);
    const refPlan = buildNodeClearPlan(graph, "ref-1");
    expect(refPlan.busy).toBe(false);
    if (refPlan.busy) return;
    expect(refPlan.targets).toEqual([
      { nodeId: "ref-1", updates: expect.objectContaining({ imageUrl: "" }) },
    ]);
  });

  it("未知节点:空目标不抛错", () => {
    const plan = buildNodeClearPlan(createImageWorkflowGraph(), "nope");
    expect(plan).toEqual({ busy: false, targets: [] });
  });
});
