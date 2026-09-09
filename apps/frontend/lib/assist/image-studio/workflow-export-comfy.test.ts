// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  exportImageWorkflowToComfy,
  planMigration,
  referencePlaceholder,
  type ComfyWorkflowExportResult,
} from "@/lib/assist/image-studio/workflow-export-comfy";
import daojie41 from "./workflow-export-comfy.fixture-daojie41.json";
import type { ImageWorkflowGraph } from "@/types/studio";

const FIXTURE = daojie41 as unknown as ImageWorkflowGraph;

function syntheticGraph(overrides: Partial<ImageWorkflowGraph> = {}): ImageWorkflowGraph {
  const prompt = { id: "p1", type: "prompt", prompt: "一张水墨山", negativePrompt: "模糊", aspectRatio: "16:9", position: { x: 0, y: 0 } };
  const generated = { id: "g1", type: "generated", prompt: "内嵌兜底", aspectRatio: "16:9", status: "idle", position: { x: 1, y: 1 } };
  const reference = { id: "r1", type: "reference", imageUrl: "asset-file://scene/main.png", position: { x: 2, y: 2 } };
  return {
    id: "wf-syn",
    name: "合成流",
    target: { kind: "storyboard", id: "sb-41" },
    nodes: [prompt, generated, reference],
    edges: [
      { id: "e1", source: "p1", target: "g1" },
      { id: "e2", source: "r1", target: "g1" },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as ImageWorkflowGraph;
}

function apiNodes(result: ComfyWorkflowExportResult): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return result.api as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

describe("planMigration(真实夹具:道劫 · 分镜 41)", () => {
  it("识别 1 提示词+3 参考+1 成图,全部入块无遗落", () => {
    const plan = planMigration(FIXTURE);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]?.prompt?.type).toBe("prompt");
    expect(plan.blocks[0]?.references).toHaveLength(3);
    expect(plan.blocks[0]?.generated.type).toBe("generated");
    expect(plan.skipped).toHaveLength(0);
  });
});

describe("exportImageWorkflowToComfy(合成:单参考 edit_ref)", () => {
  const result = exportImageWorkflowToComfy(syntheticGraph());
  const api = apiNodes(result);

  it("API 格式:ManyingPrompt/Generated 就位,Encode 改接字符串链", () => {
    const promptNode = api["b1_manying_prompt"];
    expect(promptNode?.class_type).toBe("ManyingPrompt");
    expect(promptNode?.inputs.positive).toBe("一张水墨山");
    expect(promptNode?.inputs.negative).toBe("模糊");
    const generated = api["b1_manying_generated"];
    expect(generated?.class_type).toBe("ManyingGenerated");
    expect(generated?.inputs.shot_target).toBe("sb-41");
    // 正/负绑定口都改接 [manying_prompt, 0/1]
    const wired = Object.values(api).filter((node) =>
      JSON.stringify(node.inputs).includes('manying_prompt'));
    expect(wired.length).toBeGreaterThanOrEqual(2);
    // SaveImage 已被移除
    expect(Object.values(api).some((node) => node.class_type === "SaveImage")).toBe(false);
  });

  it("API 格式:单参考裁第二参考链(镜像 python 裁链)", () => {
    expect(api["b1_46"]).toBeUndefined();
    expect(api["b1_52"]).toBeUndefined();
    expect(api["b1_35"]?.inputs.source_image_b).toBeUndefined();
    expect(api["b1_45"]?.inputs.image).toBe(referencePlaceholder(0, "asset-file://scene/main.png"));
  });

  it("API 格式:画幅注入(16:9→1152×640)与 steps", () => {
    expect(api["b1_28"]?.inputs.width).toBe(1152);
    expect(api["b1_28"]?.inputs.height).toBe(640);
    expect(api["b1_30"]?.inputs.steps).toBe(10);
  });

  it("UI 格式:链接完整性(端点均存在)+ ManyingPrompt 双 STRING 链 + 无 SaveImage", () => {
    const ui = result.ui as { nodes: Array<{ id: number; type: string; outputs: Array<{ links: number[] | null }> }>; links: Array<[number, number, number, number, number, string]> };
    const ids = new Set(ui.nodes.map((node) => node.id));
    expect(ui.nodes.some((node) => node.type === "ManyingPrompt")).toBe(true);
    expect(ui.nodes.some((node) => node.type === "ManyingGenerated")).toBe(true);
    expect(ui.nodes.some((node) => node.type === "SaveImage")).toBe(false);
    for (const link of ui.links) {
      expect(ids.has(link[1])).toBe(true);
      expect(ids.has(link[3])).toBe(true);
    }
    const stringLinks = ui.links.filter((link) => link[5] === "STRING");
    expect(stringLinks).toHaveLength(2);
    const promptUi = ui.nodes.find((node) => node.type === "ManyingPrompt");
    expect(promptUi?.outputs).toHaveLength(2);
  });

  it("报告:edit_ref 插件提示与占位名注记在案", () => {
    expect(result.report.notes.some((note) => note.includes("生态插件"))).toBe(true);
    expect(result.report.notes.some((note) => note.includes("manying-ref-1-"))).toBe(true);
    expect(result.report.mapped).toEqual({ prompt: 1, reference: 1, generated: 1 });
  });
});

describe("边界路径", () => {
  it("t2i:无参考走文生图模板(EmptyLatentImage 存在,LoadImage 不存在)", () => {
    const graph = syntheticGraph({ nodes: syntheticGraph().nodes.filter((node) => node.type !== "reference") });
    const api = apiNodes(exportImageWorkflowToComfy(graph));
    expect(api["b1_8"]?.class_type).toBe("EmptyLatentImage");
    expect(Object.values(api).some((node) => node.class_type === "LoadImage")).toBe(false);
  });

  it(">2 参考:截断为 2+报告注记(真实夹具 3 参考)", () => {
    const result = exportImageWorkflowToComfy(FIXTURE);
    expect(result.report.mapped.reference).toBe(2);
    expect(result.report.notes.some((note) => note.includes("截为前 2"))).toBe(true);
    const api = apiNodes(result);
    expect(api["b1_45"]).toBeDefined();
    expect(api["b1_46"]).toBeDefined(); // 双参考链保留
  });

  it("无连线提示词:回落成图节点内嵌 prompt", () => {
    const graph = syntheticGraph({ edges: [{ id: "e2", source: "r1", target: "g1" }] });
    const api = apiNodes(exportImageWorkflowToComfy(graph));
    expect(api["b1_manying_prompt"]?.inputs.positive).toBe("内嵌兜底");
  });

  it("未映射类型(uncloth 等):进 skipped 报告不进图", () => {
    const graph = syntheticGraph();
    (graph.nodes as Array<{ id: string; type: string }>).push({ id: "u1", type: "uncloth" });
    const result = exportImageWorkflowToComfy(graph);
    expect(result.report.skipped).toEqual([{ type: "uncloth", count: 1 }]);
  });
});
