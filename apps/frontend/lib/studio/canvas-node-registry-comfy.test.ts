// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import { isValidImageConnection, isValidImageEdge } from "@/lib/studio/image-workflow/graph-build";
import { getImageWorkflowPortDeclarations } from "@/lib/studio/canvas-node-registry";
import type { ImageWorkflowGraph, ImageWorkflowNode } from "@/types/studio";

/**
 * ComfyUI 生态节点声明接入验证(09-08 流X):canvas-node-registry 只加声明,
 * graph-build-mutations/port-types 引擎零改动自动放行——「声明即接线」的
 * 回归锁(任务验收点:graph-build-mutations 引擎自动放行=零改动,验证之)。
 */

function node(kind: string, id: string, extra: Record<string, unknown> = {}): ImageWorkflowNode {
  return {
    id,
    type: kind as ImageWorkflowNode["type"],
    title: id,
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as ImageWorkflowNode;
}

function graph(nodes: ImageWorkflowNode[], edges: ImageWorkflowGraph["edges"]): ImageWorkflowGraph {
  return { id: "g", name: "g", target: { kind: "free" }, nodes, edges, createdAt: 1, updatedAt: 1 };
}

const COMFY_WORKFLOW = node("comfy-workflow", "cw", {
  workflowId: "wf-1",
  descriptor: { ports: [], widgets: [], classTypesUsed: [], nodeCount: 1 },
  status: "idle",
});
const COMFY_GENERIC = node("comfy-generic", "cg", {
  classType: "ImageBlur",
  descriptor: { ports: [], widgets: [] },
  status: "idle",
});

describe("comfy 节点端口声明(graph-build-mutations 引擎自动放行)", () => {
  it("声明注册:两类型 inputs 进入查表规则集", () => {
    const declarations = getImageWorkflowPortDeclarations();
    expect(declarations.inputsByType["comfy-workflow"]).toBeDefined();
    expect(declarations.inputsByType["comfy-generic"]).toBeDefined();
    // 禁作源名单不含 comfy 类型(可作连线源)
    expect(declarations.bannedSourceTypes).not.toContain("comfy-workflow");
    expect(declarations.bannedSourceTypes).not.toContain("comfy-generic");
  });

  it("工作流节点:提示词/图各一根(容量 1),第二根拒", () => {
    const prompt = node("prompt", "p1", { prompt: "a", aspectRatio: "1:1" });
    const reference = node("reference", "r1", { imageUrl: "local-image://a.png" });
    const g = graph([prompt, reference, COMFY_WORKFLOW], []);
    expect(isValidImageEdge(g, "p1", "cw")).toBe(true);
    expect(isValidImageEdge(g, "r1", "cw")).toBe(true);
    const withPrompt = graph(
      [prompt, reference, COMFY_WORKFLOW],
      [{ id: "e1", source: "p1", target: "cw" }],
    );
    expect(isValidImageEdge(withPrompt, "p1", "cw")).toBe(false); // 同向去重兼通道占用
    const withImage = graph(
      [prompt, reference, COMFY_WORKFLOW],
      [{ id: "e1", source: "r1", target: "cw", targetHandle: "image" }],
    );
    expect(isValidImageEdge(withImage, "p1", "cw")).toBe(true); // 图口占用不影响提示词口
    const anotherRef = node("reference", "r2", { imageUrl: "local-image://b.png" });
    const withImageAndSecondRef = graph(
      [prompt, reference, anotherRef, COMFY_WORKFLOW],
      withImage.edges,
    );
    expect(isValidImageEdge(withImageAndSecondRef, "r2", "cw")).toBe(false); // 图口容量 1
  });

  it("工作流节点:便利贴源拒/连线级 handle 放行(声明层口别)", () => {
    const sticky = node("sticky", "s1", { text: "", color: "yellow" });
    const g = graph([sticky, COMFY_WORKFLOW], []);
    expect(isValidImageEdge(g, "s1", "cw")).toBe(false);
    const prompt = node("prompt", "p1", { prompt: "a", aspectRatio: "1:1" });
    expect(
      isValidImageConnection(graph([prompt, COMFY_WORKFLOW], []), {
        source: "p1",
        target: "cw",
        targetHandle: "prompt",
        sourceHandle: "positive",
      }),
    ).toBe(true);
  });

  it("工作流节点输出可连成图(兜底通道)与效果节点(图通道)", () => {
    const generated = node("generated", "g1", { prompt: "", aspectRatio: "1:1", status: "idle" });
    expect(isValidImageEdge(graph([COMFY_WORKFLOW, generated], []), "cw", "g1")).toBe(true);
    expect(isValidImageEdge(graph([COMFY_WORKFLOW, COMFY_GENERIC], []), "cw", "cg")).toBe(true);
  });

  it("效果节点:图口宽松不限量+提示词口一根;效果节点互相可连", () => {
    const r1 = node("reference", "r1", { imageUrl: "local-image://a.png" });
    const r2 = node("reference", "r2", { imageUrl: "local-image://b.png" });
    const twoRefs = graph(
      [r1, r2, COMFY_GENERIC],
      [{ id: "e1", source: "r1", target: "cg", targetHandle: "image" }],
    );
    expect(isValidImageEdge(twoRefs, "r2", "cg")).toBe(true); // 宽松声明:容量不限
    const cg2 = node("comfy-generic", "cg2", { classType: "ImageSharpen", descriptor: { ports: [], widgets: [] }, status: "idle" });
    expect(isValidImageEdge(graph([COMFY_GENERIC, cg2], []), "cg", "cg2")).toBe(true);
    const prompt = node("prompt", "p1", { prompt: "a", aspectRatio: "1:1" });
    expect(isValidImageEdge(graph([prompt, COMFY_GENERIC], []), "p1", "cg")).toBe(true);
  });
});
