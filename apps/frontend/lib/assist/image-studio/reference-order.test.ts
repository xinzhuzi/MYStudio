// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { describe, expect, it } from "vitest";
import {
  orderedReferenceSources,
  referenceIndexOf,
} from "./reference-order";
import { buildImageStudioGenerationRequest } from "./request";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * 参考图编号单源(09-03 用户裁定:参考图要有标号,AI 按数组顺序识别)。
 * 铁律:节点显示的编号 === 生图请求数组中该参考图的位置(同源排序)。
 */

let seq = 0;
function ref(id: string, imageUrl: string, x: number, y: number): ImageWorkflowGraph["nodes"][number] {
  return { id, type: "reference", title: `参考图`, imageUrl, position: { x, y } } as never;
}
function edge(source: string, target: string) {
  seq += 1;
  return { id: `e${seq}`, source, target } as never;
}
function graphWithReferences(): ImageWorkflowGraph {
  // 三张参考图故意乱序连边(建边顺序 C→A→B),位置 C 最上、A 中、B 最下
  return {
    id: "g1",
    name: "画布 1",
    nodes: [
      ref("ref-c", "local-image://ai-image/c.png", 100, 0),
      ref("ref-a", "local-image://ai-image/a.png", 100, 300),
      ref("ref-b", "local-image://ai-image/b.png", 100, 600),
      {
        id: "gen-1",
        type: "generated",
        title: "生成图",
        prompt: "人物立绘",
        position: { x: 700, y: 300 },
      } as never,
    ],
    edges: [edge("ref-c", "gen-1"), edge("ref-a", "gen-1"), edge("ref-b", "gen-1")],
  } as never;
}

describe("reference-order(参考图编号单源)", () => {
  it("orderedReferenceSources:位置序(y 主 x 辅),与建边顺序无关", () => {
    const graph = graphWithReferences();
    const ordered = orderedReferenceSources(graph, "gen-1").map((node) => node.id);
    expect(ordered).toEqual(["ref-c", "ref-a", "ref-b"]);
  });

  it("referenceIndexOf:编号 1 起,按位置序编号", () => {
    const graph = graphWithReferences();
    expect(referenceIndexOf(graph, "ref-c")).toBe(1);
    expect(referenceIndexOf(graph, "ref-a")).toBe(2);
    expect(referenceIndexOf(graph, "ref-b")).toBe(3);
  });

  it("同源铁律:生图请求的参考图数组顺序与编号一致(画布最上=第 1 张)", () => {
    const graph = graphWithReferences();
    const request = buildImageStudioGenerationRequest(graph, "gen-1");
    expect(request.referenceImages).toEqual([
      "local-image://ai-image/c.png",
      "local-image://ai-image/a.png",
      "local-image://ai-image/b.png",
    ]);
  });

  it("未连线的参考图节点无编号;空参考图不进请求", () => {
    const graph = {
      ...graphWithReferences(),
      nodes: [
        ...graphWithReferences().nodes,
        ref("ref-free", "local-image://ai-image/free.png", 0, 0),
        ref("ref-empty", "", 50, 50),
      ],
      edges: [...graphWithReferences().edges, edge("ref-empty", "gen-1")],
    } as ImageWorkflowGraph;
    expect(referenceIndexOf(graph as never, "ref-free")).toBeUndefined();
    // 空参考图占编号位(y=50 按位置序为第 2)但不进请求(生成时自动忽略)
    expect(referenceIndexOf(graph as never, "ref-empty")).toBe(2);
    const request = buildImageStudioGenerationRequest(graph, "gen-1");
    expect(request.referenceImages).not.toContain("");
  });
});
