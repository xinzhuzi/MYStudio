// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import { addGeneratedImageNode, addNsfwImageNode, addPromptImageNode, addReferenceImageNode, addUnclothImageNode, connectImageWorkflowNodes, isValidImageConnection, isValidImageEdge, splitPromptEdgesByPolarity } from "./graph-build";

// 09-07 canvas-basic-interactions 根修:连线级单源校验的口别规则
// (F-ROOT-1:此前两画布手抄 isValidConnection 漏 uncloth 目标,连线全废)
function buildGraph() {
  let graph = connectImageWorkflowNodes(
    addGeneratedImageNode(
      addPromptImageNode(addReferenceImageNode({ id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 }, { id: "ref1", imageUrl: "x://t.png", position: { x: 0, y: 0 } }), {
        id: "p1",
        prompt: "指令",
        position: { x: 0, y: 0 },
      }),
      { id: "gen1", prompt: "", position: { x: 0, y: 0 } },
    ),
    { source: "p1", target: "gen1" },
  );
  graph = addUnclothImageNode(graph, { id: "unc1" });
  return graph;
}

describe("isValidImageConnection(连线级单源)", () => {
  it("提示词可连无衣物①口,①被占后②仍可连,两口封顶后拒", () => {
    const graph = addUnclothImageNode(
      addPromptImageNode({ id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 }, { id: "p1", prompt: "a", position: { x: 0, y: 0 } }),
      { id: "unc1" },
    );
    expect(isValidImageConnection(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1" })).toBe(true);
    const one = connectImageWorkflowNodes(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1" });
    expect(isValidImageConnection(one, { source: "p1", target: "unc1", targetHandle: "prompt-1" })).toBe(false);
    expect(isValidImageConnection(one, { source: "p1", target: "unc1", targetHandle: "prompt-2" })).toBe(true);
  });

  it("图口只吃 reference/generated/uncloth 源且一根封口;提示词连图口拒", () => {
    const graph = buildGraph();
    expect(isValidImageConnection(graph, { source: "ref1", target: "unc1", targetHandle: "image" })).toBe(true);
    expect(isValidImageConnection(graph, { source: "gen1", target: "unc1", targetHandle: "image" })).toBe(true);
    expect(isValidImageConnection(graph, { source: "p1", target: "unc1", targetHandle: "image" })).toBe(false);
    const wired = connectImageWorkflowNodes(graph, { source: "ref1", target: "unc1", targetHandle: "image" });
    expect(isValidImageConnection(wired, { source: "gen1", target: "unc1", targetHandle: "image" })).toBe(false);
  });

  it("①②口只吃提示词源;参考图连①口拒", () => {
    const graph = buildGraph();
    expect(isValidImageConnection(graph, { source: "ref1", target: "unc1", targetHandle: "prompt-1" })).toBe(false);
    expect(isValidImageConnection(graph, { source: "gen1", target: "unc1", targetHandle: "prompt-2" })).toBe(false);
  });

  it("存量无 handle 提示词边回落算①占用(渲染层同款回落口径)", () => {
    const graph = connectImageWorkflowNodes(
      addUnclothImageNode(
        addPromptImageNode({ id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 }, { id: "p1", prompt: "a", position: { x: 0, y: 0 } }),
        { id: "unc1" },
      ),
      { source: "p1", target: "unc1" },
    );
    expect(isValidImageConnection(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1" })).toBe(false);
    expect(isValidImageConnection(graph, { source: "p1", target: "unc1", targetHandle: "prompt-2" })).toBe(true);
  });

  it("无 handle/存量路径回落 isValidImageEdge 原规则", () => {
    const graph = buildGraph();
    expect(isValidImageConnection(graph, { source: "p1", target: "unc1" })).toBe(isValidImageEdge(graph, "p1", "unc1"));
    expect(isValidImageConnection(graph, { source: null, target: "unc1", targetHandle: "image" })).toBe(false);
    expect(isValidImageConnection(graph, { source: "unc1", target: "unc1", targetHandle: "image" })).toBe(false);
  });
});

// 09-07 双出口裁定:提示词节点「正/负」两个出口,同口正负各一根可共存=拼装
describe("isValidImageConnection(双出口席位)", () => {
  it("同口正负各一根放行,同向第二根拒", () => {
    let graph = addGeneratedImageNode(
      addPromptImageNode(
        { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
        { id: "p1", prompt: "a", negativePrompt: "b", position: { x: 0, y: 0 } },
      ),
      { id: "gen1", prompt: "", position: { x: 0, y: 0 } },
    );
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "gen1", sourceHandle: "positive" });
    expect(graph.edges.length).toBe(1);
    // 同节点负向口连同一成图=拼装通道,放行
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "gen1", sourceHandle: "negative" });
    expect(graph.edges.length).toBe(2);
    // id 唯一性(09-07):同对节点正/负多边 id 必须不同,否则按 id 删选会两根一起动
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(2);
    // 校验层:positive 席已占再连 positive=拒;negative 席已占再连 negative=拒
    expect(isValidImageConnection(graph, { source: "p1", target: "gen1", sourceHandle: "positive" })).toBe(false);
    expect(isValidImageConnection(graph, { source: "p1", target: "gen1", sourceHandle: "negative" })).toBe(false);
  });

  it("存量无 handle 边占正席,负向口仍可连(分通道拼装)", () => {
    let graph = addGeneratedImageNode(
      addPromptImageNode(
        { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
        { id: "p1", prompt: "a", position: { x: 0, y: 0 } },
      ),
      { id: "gen1", prompt: "", position: { x: 0, y: 0 } },
    );
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "gen1" });
    expect(isValidImageConnection(graph, { source: "p1", target: "gen1", sourceHandle: "positive" })).toBe(false);
    expect(isValidImageConnection(graph, { source: "p1", target: "gen1", sourceHandle: "negative" })).toBe(true);
  });

  it("nsfw 目标拒负向口(专业流只吃正向)", () => {
    const graph = addNsfwImageNode(
      addPromptImageNode(
        { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
        { id: "p1", prompt: "a", negativePrompt: "b", position: { x: 0, y: 0 } },
      ),
      { id: "nsfw1" },
    );
    expect(isValidImageConnection(graph, { source: "p1", target: "nsfw1", sourceHandle: "positive" })).toBe(true);
    expect(isValidImageConnection(graph, { source: "p1", target: "nsfw1", sourceHandle: "negative" })).toBe(false);
  });
});

describe("splitPromptEdgesByPolarity(极性分流)", () => {
  it("正负边分通道;存量边正负都取", () => {
    let graph = addGeneratedImageNode(
      addPromptImageNode(
        { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
        { id: "p1", prompt: "正向A", negativePrompt: "负向A", position: { x: 0, y: 0 } },
      ),
      { id: "gen1", prompt: "", position: { x: 0, y: 0 } },
    );
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "gen1", sourceHandle: "positive" });
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "gen1", sourceHandle: "negative" });
    const split = splitPromptEdgesByPolarity(graph, "gen1");
    expect(split.positive).toEqual(["正向A"]);
    expect(split.negative).toEqual(["负向A"]);

    // 存量无 handle 边(整节点):正负都取
    let legacy = addGeneratedImageNode(
      addPromptImageNode(
        { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
        { id: "p1", prompt: "L正", negativePrompt: "L负", position: { x: 0, y: 0 } },
      ),
      { id: "gen1", prompt: "", position: { x: 0, y: 0 } },
    );
    legacy = connectImageWorkflowNodes(legacy, { source: "p1", target: "gen1" });
    const legacySplit = splitPromptEdgesByPolarity(legacy, "gen1");
    expect(legacySplit.positive).toEqual(["L正"]);
    expect(legacySplit.negative).toEqual(["L负"]);
  });

  it("uncloth 存量无 handle 双边按纵向序归①②口", () => {
    let graph = addUnclothImageNode(
      addPromptImageNode(
        addPromptImageNode(
          { id: "wf", name: "wf", target: { kind: "free" }, nodes: [], edges: [], createdAt: 1, updatedAt: 1 },
          { id: "pTop", prompt: "指令", position: { x: 0, y: 0 } },
        ),
        { id: "pBottom", prompt: "一致性", position: { x: 0, y: 500 } },
      ),
      { id: "unc1" },
    );
    graph = connectImageWorkflowNodes(graph, { source: "pTop", target: "unc1" });
    graph = connectImageWorkflowNodes(graph, { source: "pBottom", target: "unc1" });
    expect(splitPromptEdgesByPolarity(graph, "unc1", "prompt-1").positive).toEqual(["指令"]);
    expect(splitPromptEdgesByPolarity(graph, "unc1", "prompt-2").positive).toEqual(["一致性"]);
  });
});
