import { describe, expect, it } from "vitest";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  addUnclothImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "./graph-build";
import {
  connectCreateDirection,
  createConnectedImageNode,
  getCreatableImageNodeTypes,
} from "./connect-create";

function graphWithGenerated() {
  const graph = createImageWorkflowGraph();
  return addGeneratedImageNode(graph, {
    id: "gen-seed",
    title: "种子成图",
    position: { x: 760, y: 0 },
  });
}

describe("getCreatableImageNodeTypes", () => {
  it("downstream 允许成图与无衣物(连线域规则:边指向 generated/uncloth)", () => {
    const options = getCreatableImageNodeTypes("downstream");
    expect(options.map((option) => option.type)).toEqual(["generated", "uncloth-instruct"]);
  });

  it("upstream 提供提示词、参考图与无衣物", () => {
    const options = getCreatableImageNodeTypes("upstream");
    expect(options.map((option) => option.type)).toEqual(["prompt", "reference", "uncloth-instruct"]);
  });

  it("指令档菜单直出文案(09-05 快/精封存,instruct 现行)", () => {
    const downstream = getCreatableImageNodeTypes("downstream");
    expect(downstream.find((option) => option.type === "uncloth-instruct")?.label).toBe("无衣物·指令");
  });

  it("无衣物标签取自通用注册表(09-04 通用化)", () => {
    const downstream = getCreatableImageNodeTypes("downstream");
    expect(downstream.find((option) => option.type === "uncloth")?.label).toBe("无衣物节点");
  });

  it("方向由手柄类型决定", () => {
    expect(connectCreateDirection("source")).toBe("downstream");
    expect(connectCreateDirection("target")).toBe("upstream");
  });
});

describe("createConnectedImageNode", () => {
  it("downstream:创建成图并连入边 source→新节点", () => {
    const graph = graphWithGenerated();
    const fromNode = graph.nodes.find((node) => node.id === "gen-seed")!;
    const result = createConnectedImageNode(graph, {
      fromNodeId: fromNode.id,
      fromHandleType: "source",
      type: "generated",
    });
    expect(result).not.toBeNull();
    const created = result!.graph.nodes.find((node) => node.id === result!.nodeId);
    expect(created?.type).toBe("generated");
    expect(
      result!.graph.edges.some(
        (edge) => edge.source === fromNode.id && edge.target === result!.nodeId,
      ),
    ).toBe(true);
  });

  it("upstream:从成图 target 手柄拖出,创建提示词并连入该成图,且 targetNodeId 配对", () => {
    const graph = graphWithGenerated();
    const generated = graph.nodes.find((node) => node.type === "generated")!;
    const result = createConnectedImageNode(graph, {
      fromNodeId: generated.id,
      fromHandleType: "target",
      type: "prompt",
    });
    expect(result).not.toBeNull();
    const created = result!.graph.nodes.find((node) => node.id === result!.nodeId);
    expect(created?.type).toBe("prompt");
    expect((created as { targetNodeId?: string }).targetNodeId).toBe(generated.id);
    expect(
      result!.graph.edges.some(
        (edge) => edge.source === result!.nodeId && edge.target === generated.id,
      ),
    ).toBe(true);
  });

  it("upstream 的 fromNode 非成图节点时拒绝(连线域规则)", () => {
    const graph = addPromptImageNode(graphWithGenerated(), {
      id: "prompt-seed",
      position: { x: 80, y: 0 },
    });
    const result = createConnectedImageNode(graph, {
      fromNodeId: "prompt-seed",
      fromHandleType: "target",
      type: "reference",
    });
    expect(result).toBeNull();
  });

  it("downstream 不允许非成图类型;fromNodeId 不存在返回 null", () => {
    const graph = graphWithGenerated();
    expect(
      createConnectedImageNode(graph, {
        fromNodeId: "gen-seed",
        fromHandleType: "source",
        type: "prompt" as never,
      }),
    ).toBeNull();
    expect(
      createConnectedImageNode(graph, {
        fromNodeId: "missing",
        fromHandleType: "source",
        type: "generated",
      }),
    ).toBeNull();
  });

  it("新节点落位走布局单源:成图落右列,提示词落左列", () => {
    const graph = graphWithGenerated();
    const generatedResult = createConnectedImageNode(graph, {
      fromNodeId: "gen-seed",
      fromHandleType: "source",
      type: "generated",
    })!;
    const generated = generatedResult.graph.nodes.find(
      (node) => node.id === generatedResult.nodeId,
    )!;
    expect(generated.position.x).toBeGreaterThan(400);

    const genNode = graph.nodes.find((node) => node.type === "generated")!;
    const promptResult = createConnectedImageNode(graph, {
      fromNodeId: genNode.id,
      fromHandleType: "target",
      type: "prompt",
    })!;
    const prompt = promptResult.graph.nodes.find(
      (node) => node.id === promptResult.nodeId,
    )!;
    expect(prompt.position.x).toBeLessThan(200);
  });
});

describe("createConnectedImageNode:无衣物(09-04 通用化)", () => {
  it("downstream:从参考图创建无衣物并连边 参考图→无衣物", () => {
    let graph = graphWithGenerated();
    graph = addReferenceImageNode(graph, {
      id: "ref-seed",
      imageUrl: "project-file://a.png",
      position: { x: 80, y: 0 },
    });
    const result = createConnectedImageNode(graph, {
      fromNodeId: "ref-seed",
      fromHandleType: "source",
      type: "uncloth",
    });
    expect(result).not.toBeNull();
    const created = result!.graph.nodes.find((node) => node.id === result!.nodeId);
    expect(created?.type).toBe("uncloth");
    expect(
      result!.graph.edges.some(
        (edge) => edge.source === "ref-seed" && edge.target === result!.nodeId,
      ),
    ).toBe(true);
  });

  it("upstream:从成图 target 手柄创建无衣物并连边 无衣物→成图", () => {
    const graph = graphWithGenerated();
    const result = createConnectedImageNode(graph, {
      fromNodeId: "gen-seed",
      fromHandleType: "target",
      type: "uncloth",
    });
    expect(result).not.toBeNull();
    expect(
      result!.graph.edges.some(
        (edge) => edge.source === result!.nodeId && edge.target === "gen-seed",
      ),
    ).toBe(true);
  });

  it("upstream:成图已吃一根无衣物链时拒绝(单链规则,防悬空节点)", () => {
    let graph = graphWithGenerated();
    graph = addUnclothImageNode(graph, { id: "unc-1", position: { x: 80, y: 900 } });
    graph = connectImageWorkflowNodes(graph, { source: "unc-1", target: "gen-seed" });
    const result = createConnectedImageNode(graph, {
      fromNodeId: "gen-seed",
      fromHandleType: "target",
      type: "uncloth",
    });
    expect(result).toBeNull();
  });
});
