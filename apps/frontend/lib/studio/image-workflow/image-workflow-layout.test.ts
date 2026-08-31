import { describe, expect, it } from "vitest";
import {
  createImageWorkflowGraph,
  generatedSlotPosition,
  IMAGE_WORKFLOW_LAYOUT,
  imageWorkflowHasOverlappingCards,
  nextStackedPosition,
  promptSlotPosition,
  referenceSlotPosition,
  tidyImageWorkflowLayout,
} from "@/lib/studio/image-workflow";
import { createOpenImageWorkflowGraph } from "@/components/panels/studio/image-workflow/image-workflow-graph-utils";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";

/** 两张卡片矩形是否相交(卡片宽高取布局单源估值) */
function overlaps(a: ImageWorkflowNode, b: ImageWorkflowNode) {
  const spec = (node: ImageWorkflowNode) => IMAGE_WORKFLOW_LAYOUT[node.type];
  const [sa, sb] = [spec(a), spec(b)];
  return a.position.x < b.position.x + sb.width
    && b.position.x < a.position.x + sa.width
    && a.position.y < b.position.y + sb.height
    && b.position.y < a.position.y + sa.height;
}

function assertNoOverlap(graph: ImageWorkflowGraph) {
  const nodes = graph.nodes;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      expect(overlaps(nodes[i]!, nodes[j]!), `${nodes[i]!.title} × ${nodes[j]!.title}`).toBe(false);
    }
  }
}

/** 输入列右缘与成图列左缘之间的空泳道宽度 */
const GUTTER =
  IMAGE_WORKFLOW_LAYOUT.generated.x
  - (IMAGE_WORKFLOW_LAYOUT.prompt.x + IMAGE_WORKFLOW_LAYOUT.prompt.width);

describe("image workflow layout single source", () => {
  it("keeps a clear swim lane between input and generated columns", () => {
    expect(GUTTER).toBeGreaterThanOrEqual(120);
    // 输入列内部:提示词区在上、参考区紧随其后,间距不小于卡高
    const prompt0 = promptSlotPosition(0);
    const prompt1 = promptSlotPosition(1);
    expect(prompt0.x).toBe(IMAGE_WORKFLOW_LAYOUT.prompt.x);
    expect(prompt1.y - prompt0.y).toBeGreaterThanOrEqual(IMAGE_WORKFLOW_LAYOUT.prompt.height);
    const ref0 = referenceSlotPosition(0, 1);
    const ref1 = referenceSlotPosition(1, 1);
    expect(ref0.y).toBeGreaterThanOrEqual(prompt0.y + IMAGE_WORKFLOW_LAYOUT.prompt.height);
    expect(ref1.y - ref0.y).toBeGreaterThanOrEqual(IMAGE_WORKFLOW_LAYOUT.reference.height);
    // 成图列自上而下排开
    const gen0 = generatedSlotPosition(0);
    const gen1 = generatedSlotPosition(1);
    expect(gen0.x).toBe(IMAGE_WORKFLOW_LAYOUT.generated.x);
    expect(gen1.y - gen0.y).toBeGreaterThanOrEqual(IMAGE_WORKFLOW_LAYOUT.generated.height);
  });

  it("drops the next manual node below the lowest card of its column", () => {
    const graph = createImageWorkflowGraph({
      nodes: [
        {
          id: "ref-1", type: "reference", title: "参考", imageUrl: "x://a.png",
          source: { kind: "free" }, createdAt: 1, updatedAt: 1,
          position: referenceSlotPosition(3, 1),
        } as ImageWorkflowNode,
      ],
    });
    const nextRef = nextStackedPosition(graph.nodes, "reference");
    expect(nextRef.x).toBe(IMAGE_WORKFLOW_LAYOUT.reference.x);
    expect(nextRef.y).toBeGreaterThanOrEqual(
      referenceSlotPosition(3, 1).y + IMAGE_WORKFLOW_LAYOUT.reference.height,
    );
    // 成图列与输入列互不影响
    const nextGen = nextStackedPosition(graph.nodes, "generated");
    expect(nextGen.x).toBe(IMAGE_WORKFLOW_LAYOUT.generated.x);
    expect(nextGen.y).toBe(IMAGE_WORKFLOW_LAYOUT.generated.baseY);
  });
});

describe("tidyImageWorkflowLayout", () => {
  const buildOverlappingGraph = () => {
    // 复刻 2026-08-29 实证形态:参考列 180 间距层叠 + gen/prompt 两列 x 只差 60
    const node = (partial: Partial<ImageWorkflowNode> & { id: string; type: ImageWorkflowNode["type"] }): ImageWorkflowNode =>
      ({ title: partial.type, createdAt: 1, updatedAt: 1, ...partial }) as ImageWorkflowNode;
    return createImageWorkflowGraph({
      id: "wf-tidy",
      target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        node({ id: "ref-a", type: "reference", title: "金水河码头", imageUrl: "x://a.png", continuityOrder: 2, position: { x: 80, y: 100 } }),
        node({ id: "ref-b", type: "reference", title: "老苦力", imageUrl: "x://b.png", continuityOrder: 1, position: { x: 80, y: 280 } }),
        node({ id: "gen-1", type: "generated", title: "分镜 1 成图", prompt: "p", position: { x: 620, y: 120 }, createdAt: 10 }),
        node({ id: "gen-2", type: "generated", title: "分镜 1 成图 2", prompt: "p", position: { x: 620, y: 400 }, createdAt: 20 }),
        node({ id: "prompt-1", type: "prompt", title: "图片生成", prompt: "p", targetNodeId: "gen-1", position: { x: 560, y: 500 } }),
        node({ id: "prompt-2", type: "prompt", title: "图片生成 2", prompt: "p2", targetNodeId: "gen-1", position: { x: 560, y: 700 } }),
      ],
      edges: [
        { id: "e1", source: "ref-a", target: "gen-1" },
        { id: "e2", source: "ref-b", target: "gen-1" },
        { id: "e3", source: "prompt-1", target: "gen-1" },
        { id: "e4", source: "prompt-2", target: "gen-1" },
      ],
    });
  };

  it("removes every card overlap without touching ids, edges or counts", () => {
    const graph = buildOverlappingGraph();
    const tidied = tidyImageWorkflowLayout(graph);
    assertNoOverlap(tidied);
    expect(tidied.nodes.map((item) => item.id).sort()).toEqual(graph.nodes.map((item) => item.id).sort());
    expect(tidied.edges).toEqual(graph.edges);
    // 输入列:提示词区在上(目标 gen 帧序在前),参考区按 continuityOrder 随后
    const prompt1 = tidied.nodes.find((item) => item.id === "prompt-1")!;
    const prompt2 = tidied.nodes.find((item) => item.id === "prompt-2")!;
    const refB = tidied.nodes.find((item) => item.id === "ref-b")!;
    const refA = tidied.nodes.find((item) => item.id === "ref-a")!;
    expect(prompt1.position.y).toBeLessThan(prompt2.position.y);
    expect(prompt2.position.y).toBeLessThan(refB.position.y);
    expect(refB.position.y).toBeLessThan(refA.position.y);
    // 成图列在右,主成图在前
    const gen1 = tidied.nodes.find((item) => item.id === "gen-1")!;
    const gen2 = tidied.nodes.find((item) => item.id === "gen-2")!;
    expect(gen1.position.x).toBe(IMAGE_WORKFLOW_LAYOUT.generated.x);
    expect(gen1.position.y).toBeLessThan(gen2.position.y);
  });

  it("is idempotent and returns the same graph when already tidy", () => {
    const graph = buildOverlappingGraph();
    const once = tidyImageWorkflowLayout(graph);
    const twice = tidyImageWorkflowLayout(once);
    expect(twice.nodes.map((item) => item.position)).toEqual(once.nodes.map((item) => item.position));
    expect(tidyImageWorkflowLayout(once)).toBe(once);
  });

  it("gates auto-tidy on real overlap, leaving deliberate tidy layouts untouched", () => {
    const graph = buildOverlappingGraph();
    expect(imageWorkflowHasOverlappingCards(graph)).toBe(true);
    expect(imageWorkflowHasOverlappingCards(tidyImageWorkflowLayout(graph))).toBe(false);
    expect(imageWorkflowHasOverlappingCards(createImageWorkflowGraph())).toBe(false);
  });
});

describe("open-context graph initial layout", () => {
  it("never overlaps cards and keeps all inputs left of a clear swim lane", () => {
    const graph = createOpenImageWorkflowGraph(
      {
        target: { kind: "storyboard", id: "sb-layout" },
        title: "分镜 1",
        prompt: "码头苦力推货。",
        sourceImagePath: "project-file://demo/current.png",
        assetReferences: [
          { imageUrl: "project-file://demo/dock.png", title: "金水河码头", assetType: "scene", assetId: "s1" },
          { imageUrl: "project-file://demo/coolie1.png", title: "老苦力", assetType: "character", assetId: "c1" },
          { imageUrl: "project-file://demo/coolie2.png", title: "年轻苦力", assetType: "character", assetId: "c2" },
          { imageUrl: "project-file://demo/tieshan.png", title: "铁山", assetType: "character", assetId: "c3" },
        ],
      },
      "道劫",
    );
    assertNoOverlap(graph);
    // 输入列(提示词+全部参考)在泳道左侧,成图列在右侧:
    // 所有「输入→成图」连线只在泳道里走,结构上不穿过任何卡片
    const generated = graph.nodes.find((node) => node.type === "generated")!;
    for (const node of graph.nodes) {
      if (node.id === generated.id) continue;
      expect(
        node.position.x + IMAGE_WORKFLOW_LAYOUT[node.type].width,
        `${node.title} 应在泳道左侧`,
      ).toBeLessThanOrEqual(generated.position.x);
    }
    expect(generated.position.x).toBe(IMAGE_WORKFLOW_LAYOUT.generated.x);
  });
});
