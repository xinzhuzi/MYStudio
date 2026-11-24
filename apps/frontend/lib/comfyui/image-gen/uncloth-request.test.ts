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
// variant 缺省回落遮罩流 fine(resolveUnclothParams 同口径),测试如需稳定
// 版须显式传 "instruct"。
function seedGraph(variant?: "fast" | "fine" | "instruct") {
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
  graph = addUnclothImageNode(graph, { id: "unc1", variant });
  graph = addGeneratedImageNode(graph, { id: "gen1", prompt: "", position: { x: 0, y: 0 } });
  graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "unc1", targetHandle: "image" });
  graph = connectImageWorkflowNodes(graph, { source: "unc1", target: "gen1" });
  return graph;
}

describe("uncloth 口语义终裁(①=正向口,②=负向口)", () => {
  it("正→①+负→②:prompt=正向文本+「画面避免:」负向句", () => {
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
      expect(result.prompt).toContain("她解开衣扣站在窗边");
      expect(result.prompt).toContain("画面避免:多手,变形,文字");
      // system_prompt 回归节点编辑器字段,不再吃②口
      expect(result.params.systemPrompt ?? "").not.toContain("画面避免:");
    }
  });

  it("双参考(09-08):image-b 口的主体图进 params.imageB_b64", () => {
    let graph = seedGraph("instruct");
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" });
    graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "unc1", targetHandle: "image-b" });
    const result = buildUnclothChainRequest(graph, "gen1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.params.imageB_b64).toBe("project-file://a.png");
    }
    // 对照:不连图B 时无该字段
    let singleGraph = seedGraph("instruct");
    singleGraph = connectImageWorkflowNodes(singleGraph, { source: "p1", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" });
    const single = buildUnclothChainRequest(singleGraph, "gen1");
    expect("error" in single).toBe(false);
    if (!("error" in single)) {
      expect(single.params.imageB_b64).toBeUndefined();
    }
  });

  it("双参考×遮罩流互斥(09-09):fine/fast/缺省档挂 image-b 边=阻断指路,不静默丢图B", () => {
    for (const variant of ["fine", "fast", undefined] as const) {
      let graph = seedGraph(variant);
      graph = connectImageWorkflowNodes(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" });
      graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "unc1", targetHandle: "image-b" });
      const result = buildUnclothChainRequest(graph, "gen1");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("仅稳定版");
      }
      // 对照:遮罩档不挂图B 时正常组装
      let maskOnly = seedGraph(variant);
      maskOnly = connectImageWorkflowNodes(maskOnly, { source: "p1", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" });
      const ok = buildUnclothChainRequest(maskOnly, "gen1");
      expect("error" in ok).toBe(false);
    }
  });

  it("存量无 handle 单边:整节点正向为指令,负向不再隐式拼装", () => {
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

describe("塌缩视图(09-09 旁路/中转穿透)", () => {
  it("旁路 uncloth:链检测消失,组装返回错误(调用方回落普通生成)", () => {
    const graph = {
      ...seedGraph(),
      nodes: seedGraph().nodes.map((node) => (node.id === "unc1" ? { ...node, bypassed: true } : node)),
    } as Parameters<typeof buildUnclothChainRequest>[0];
    expect(buildUnclothChainRequest(graph, "gen1")).toMatchObject({ error: "未找到无衣物上游" });
  });

  it("图输入经中转点穿透:参考→中转→uncloth 等价直连", () => {
    let graph = seedGraph();
    // 断开直连,改走中转
    graph = {
      ...graph,
      edges: graph.edges.filter((edge) => !(edge.source === "ref1" && edge.target === "unc1")),
    } as typeof graph;
    graph = addRerouteImageNodeForTest(graph);
    graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "rr1" });
    graph = connectImageWorkflowNodes(graph, { source: "rr1", target: "unc1", targetHandle: "image" });
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "unc1", targetHandle: "prompt-1", sourceHandle: "positive" });
    const result = buildUnclothChainRequest(graph, "gen1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.inputImageUrl).toBe("project-file://a.png");
    }
  });
});

function addRerouteImageNodeForTest(graph: Parameters<typeof buildUnclothChainRequest>[0]) {
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: "rr1", type: "reroute", title: "中转点", position: { x: 200, y: 0 }, createdAt: 1, updatedAt: 1 } as never,
    ],
  } as Parameters<typeof buildUnclothChainRequest>[0];
}
