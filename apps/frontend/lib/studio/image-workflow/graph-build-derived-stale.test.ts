import { describe, expect, it } from "vitest";
import type { ImageWorkflowGraph, ImageWorkflowReferenceNode } from "@/types/studio";
import {
  addGeneratedImageNode,
  addReferenceImageNode,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import {
  markDerivedFromStale,
  setGeneratedImageResult,
} from "./graph-build-mutations";

/**
 * 衍生资产过期链(09-03-derived-expiry-chain):父图落新结果时,
 * derivedFrom 挂血缘的衍生节点盖 staleSince;无血缘节点零扰动。
 */

function seededGraph(): ImageWorkflowGraph {
  let graph = createImageWorkflowGraph({ id: "flow-expiry", name: "过期链测试流" });
  graph = addGeneratedImageNode(graph, { id: "gen-parent", title: "父图", prompt: "p", position: { x: 0, y: 0 } });
  // 两个 split 产物 + 一个无关参考图(无血缘)
  for (const [id, cell] of [["ref-1-1", { row: 0, col: 0 }], ["ref-1-2", { row: 0, col: 1 }]] as const) {
    graph = addReferenceImageNode(graph, {
      id,
      title: id,
      imageUrl: "project-file://x.png",
      source: { kind: "material", id: `mat-${id}` },
      position: { x: 360, y: 0 },
    });
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === id && node.type === "reference"
          ? {
              ...node,
              derivedFrom: { kind: "split", sourceNodeId: "gen-parent", cell, createdAt: 1000 },
            }
          : node,
      ),
    };
  }
  graph = addReferenceImageNode(graph, {
    id: "ref-plain",
    title: "无血缘参考图",
    imageUrl: "project-file://plain.png",
    position: { x: 720, y: 0 },
  });
  return graph;
}

function refNode(graph: ImageWorkflowGraph, id: string): ImageWorkflowReferenceNode {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node || node.type !== "reference") throw new Error(`missing reference node ${id}`);
  return node;
}

describe("setGeneratedImageResult 衍生过期标记", () => {
  it("父图落新结果:全部血缘子节点盖 staleSince=generatedAt", () => {
    const graph = seededGraph();
    const next = setGeneratedImageResult(graph, "gen-parent", { imageUrl: "project-file://new.png", generatedAt: 5000 });
    expect(refNode(next, "ref-1-1").derivedFrom?.staleSince).toBe(5000);
    expect(refNode(next, "ref-1-2").derivedFrom?.staleSince).toBe(5000);
  });

  it("无血缘节点零扰动(引用相等),成图自身状态照常就绪", () => {
    const graph = seededGraph();
    const plainBefore = graph.nodes.find((node) => node.id === "ref-plain");
    const next = setGeneratedImageResult(graph, "gen-parent", { imageUrl: "project-file://new.png", generatedAt: 5000 });
    const generated = next.nodes.find((node) => node.id === "gen-parent");
    expect(generated && generated.type === "generated" ? generated.status : "").toBe("ready");
    // 无血缘节点对象原样保留
    expect(next.nodes.find((node) => node.id === "ref-plain")).toBe(plainBefore);
  });

  it("再次生成刷新 staleSince 到新 generatedAt", () => {
    const graph = seededGraph();
    const once = setGeneratedImageResult(graph, "gen-parent", { imageUrl: "a.png", generatedAt: 5000 });
    const twice = setGeneratedImageResult(once, "gen-parent", { imageUrl: "b.png", generatedAt: 9000 });
    expect(refNode(twice, "ref-1-1").derivedFrom?.staleSince).toBe(9000);
  });

  it("首次生成且无血缘子节点:仅成图自身变化", () => {
    let graph = createImageWorkflowGraph({ id: "flow-solo" });
    graph = addGeneratedImageNode(graph, { id: "gen-solo", title: "独立成图", prompt: "p", position: { x: 0, y: 0 } });
    const next = setGeneratedImageResult(graph, "gen-solo", { imageUrl: "solo.png", generatedAt: 1234 });
    expect(next.nodes).toHaveLength(1);
    const solo = next.nodes[0];
    expect(solo.type === "generated" ? solo.resultUrl : "").toBe("solo.png");
  });
});

describe("markDerivedFromStale(纯函数)", () => {
  it("只标记指向该源的血缘;其余节点引用相等", () => {
    const graph = seededGraph();
    const next = markDerivedFromStale(graph, "ref-plain", 777);
    expect(refNode(next, "ref-1-1").derivedFrom?.staleSince).toBeUndefined();
    expect(next.nodes.find((node) => node.id === "ref-1-1")).toBe(graph.nodes.find((node) => node.id === "ref-1-1"));
  });

  it("幂等:已盖更新(或同等)staleSince 时图引用不变", () => {
    const graph = seededGraph();
    const once = markDerivedFromStale(graph, "gen-parent", 5000);
    const twice = markDerivedFromStale(once, "gen-parent", 5000);
    expect(twice).toBe(once);
  });
});
