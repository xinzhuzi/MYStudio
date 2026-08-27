// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { createOpenImageWorkflowGraph, resolveOpenContextGeneratedNodeId } from "@/components/panels/studio/image-workflow/image-workflow-graph-utils";
import { useStudioStore } from "@/stores/studio/studio-store";
import { buildKeyframeId } from "@/lib/studio/keyframes";
import type { ImageWorkflowOpenContext, StoryboardKeyframe } from "@/types/studio";

afterEach(() => {
  cleanup();
  useStudioStore.getState().resetStudioWorkflow();
  vi.restoreAllMocks();
});

function keyframes(withImages: boolean): StoryboardKeyframe[] {
  return [
    { frameId: buildKeyframeId("sb-1", 1), mediaRef: { kind: "image", path: withImages ? "project-file://p/kf1.png" : "" }, inUs: 0, momentDescription: "开场站位:老苦力弯腰拖筐" },
    { frameId: buildKeyframeId("sb-1", 2), mediaRef: { kind: "image", path: withImages ? "project-file://p/kf2.png" : "" }, inUs: 6_000_000, momentDescription: "收尾态:老苦力扛筐前行" },
  ];
}

function context(over: Partial<ImageWorkflowOpenContext> = {}): ImageWorkflowOpenContext {
  return {
    target: { kind: "storyboard", id: "sb-1" },
    title: "分镜 1",
    prompt: "码头拖筐的画面",
    assetReferences: [
      { imageUrl: "file:///assets/scene.png", title: "金水河码头", assetType: "scene" },
      { imageUrl: "file:///assets/role.png", title: "老苦力", assetType: "character" },
    ],
    ...over,
  };
}

describe("M1d 建流多帧克隆", () => {
  it("单帧/无 keyframes:建流行为不变(1 对 gen+prompt)", () => {
    const graph = createOpenImageWorkflowGraph(context(), "道劫");
    const gens = graph.nodes.filter((node) => node.type === "generated");
    const prompts = graph.nodes.filter((node) => node.type === "prompt");
    expect(gens).toHaveLength(1);
    expect(prompts).toHaveLength(1);
    expect(gens[0].title).not.toContain("帧");
  });

  it("双帧:克隆两对节点,frameId/帧时刻段/共享参考/帧间链/回接预挂全就位", () => {
    const graph = createOpenImageWorkflowGraph(
      context({ storyboardKeyframes: keyframes(true) }),
      "道劫",
    );
    const gens = graph.nodes.filter((node) => node.type === "generated");
    const prompts = graph.nodes.filter((node) => node.type === "prompt");
    expect(gens).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    // frameId 与标题
    expect(gens.map((node) => (node as { frameId?: string }).frameId).sort()).toEqual(
      [buildKeyframeId("sb-1", 1), buildKeyframeId("sb-1", 2)].sort(),
    );
    expect(gens.every((node) => node.title.includes("帧"))).toBe(true);
    // 回接帧预挂 resultUrl
    expect(gens.every((node) => node.type === "generated" && node.resultUrl)).toBe(true);
    // 共享参考连到每个帧 gen(2 资产参考 × 2 gen = 4 条 ref→gen 边)
    const refToGen = graph.edges.filter((edge) =>
      gens.some((gen) => gen.id === edge.target)
        && graph.nodes.some((node) => node.id === edge.source && node.type === "reference"),
    );
    expect(refToGen.length).toBe(4);
    // 帧间连贯链 gen(帧1)→gen(帧2)
    const kf1 = gens.find((node) => (node as { frameId?: string }).frameId === buildKeyframeId("sb-1", 1));
    const kf2 = gens.find((node) => (node as { frameId?: string }).frameId === buildKeyframeId("sb-1", 2));
    expect(graph.edges.some((edge) => edge.source === kf1!.id && edge.target === kf2!.id)).toBe(true);
    // prompt 帧时刻段
    const framePrompts = prompts.map((node) => (node as { prompt: string }).prompt);
    expect(framePrompts.some((prompt) => prompt.includes("本帧时刻") && prompt.includes("开场站位"))).toBe(true);
    expect(framePrompts.some((prompt) => prompt.includes("本帧时刻") && prompt.includes("收尾态"))).toBe(true);
    // 每个 prompt 连到自己的 gen
    for (const prompt of prompts) {
      const target = graph.edges.find((edge) => edge.source === prompt.id)?.target;
      expect(gens.some((gen) => gen.id === target)).toBe(true);
    }
  });

  it("G5:多帧流 resolve 优先空帧(待生成),不再被 resultUrl 撞首帧", () => {
    const graph = createOpenImageWorkflowGraph(
      context({ storyboardKeyframes: keyframes(true) }),
      "道劫",
    );
    const resolved = resolveOpenContextGeneratedNodeId(
      graph,
      context({ storyboardKeyframes: keyframes(true) }),
    );
    // 双帧都已预挂 → 无空帧,回退帧1;清空帧2后应指向帧2
    const kf2Id = buildKeyframeId("sb-1", 2);
    const cleared = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "generated" && (node as { frameId?: string }).frameId === kf2Id
          ? { ...node, resultUrl: undefined }
          : node,
      ),
    };
    const resolvedAfterClear = resolveOpenContextGeneratedNodeId(
      cleared,
      context({ storyboardKeyframes: keyframes(true) }),
    );
    const kf2Node = cleared.nodes.find(
      (node) => node.type === "generated" && (node as { frameId?: string }).frameId === kf2Id,
    );
    expect(resolved).toBeTruthy();
    expect(resolvedAfterClear).toBe(kf2Node!.id);
  });
});
