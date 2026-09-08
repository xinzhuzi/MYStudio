// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment node
// 透明节点塌缩单测(09-09 照 ComfyUI):reroute 单入直通(图线;提示词类
// 直连正负双口不设计中转);bypassed 按口类型穿线;环防御;快路径。

import { describe, expect, it } from "vitest";
import {
  addRerouteImageNode,
  collapseTransparentNodes,
  connectImageWorkflowNodes,
  addGeneratedImageNode,
  addReferenceImageNode,
} from "./graph-build";
import type { ImageWorkflowGraph } from "@/types/studio";

function baseGraph(): ImageWorkflowGraph {
  return { nodes: [], edges: [] } as unknown as ImageWorkflowGraph;
}

describe("collapseTransparentNodes(reroute/bypass 穿透)", () => {
  it("无透明节点:原样返回(零开销快路径)", () => {
    const graph = baseGraph();
    expect(collapseTransparentNodes(graph)).toBe(graph);
  });

  it("reroute 单入直通:参考→reroute→成图 塌缩成 参考→成图", () => {
    let graph = addReferenceImageNode(baseGraph(), { id: "ref1", imageUrl: "local-image://a.png", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 0, y: 0 } });
    graph = addRerouteImageNode(graph, { id: "r1" });
    graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "r1" });
    graph = connectImageWorkflowNodes(graph, { source: "r1", target: "g1" });
    const collapsed = collapseTransparentNodes(graph);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0]).toMatchObject({ source: "ref1", target: "g1" });
    // 原图不动(视觉与画布操作不受影响)
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes).toHaveLength(3);
  });

  it("bypassed 成图节点:图进图出穿线(参考→[bypassed成图]→下游成图)", () => {
    let graph = addReferenceImageNode(baseGraph(), { id: "ref1", imageUrl: "local-image://a.png", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g2", position: { x: 0, y: 0 } });
    graph = connectImageWorkflowNodes(graph, { source: "ref1", target: "g1" });
    graph = connectImageWorkflowNodes(graph, { source: "g1", target: "g2" });
    expect(graph.edges).toHaveLength(2); // 建边成功前提
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === "g1" ? { ...node, bypassed: true } : node)),
    } as ImageWorkflowGraph;
    const collapsed = collapseTransparentNodes(graph);
    expect(collapsed.edges.some((edge) => edge.source === "ref1" && edge.target === "g2")).toBe(true);
    expect(collapsed.edges.some((edge) => edge.source === "g1" || edge.target === "g1")).toBe(false);
  });

  it("空 reroute(无入边):出边断链消失", () => {
    let graph = addGeneratedImageNode(baseGraph(), { id: "g1", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g2", position: { x: 0, y: 0 } });
    graph = addRerouteImageNode(graph, { id: "r1" });
    graph = connectImageWorkflowNodes(graph, { source: "r1", target: "g2" });
    const collapsed = collapseTransparentNodes(graph);
    expect(collapsed.edges).toHaveLength(0);
  });

  it("环防御:reroute 互指不死循环", () => {
    let graph = addRerouteImageNode(baseGraph(), { id: "r1" });
    graph = addRerouteImageNode(graph, { id: "r2" });
    graph = {
      ...graph,
      edges: [
        { id: "e1", source: "r1", target: "r2" },
        { id: "e2", source: "r2", target: "r1" },
      ],
    } as ImageWorkflowGraph;
    expect(() => collapseTransparentNodes(graph)).not.toThrow();
  });
});
