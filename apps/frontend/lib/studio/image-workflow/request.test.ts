// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  assertImageWorkflowContinuityCapability,
  buildImageWorkflowGenerationRequest,
} from "@/lib/studio/image-workflow/request";
import type { ImageWorkflowGraph, ImageWorkflowGeneratedNode, ImageWorkflowPromptNode } from "@/types/studio";

/** 08-30 功能转移裁定的回归锁:参数权威归成图节点,存量图回落提示词节点。 */

function promptNode(overrides: Partial<ImageWorkflowPromptNode> = {}): ImageWorkflowPromptNode {
  return {
    id: "prompt-1",
    type: "prompt",
    title: "图片生成",
    prompt: "正文",
    aspectRatio: "16:9",
    resolution: "1K",
    model: "gpt-image-2",
    position: { x: 0, y: 0 },
    ...overrides,
  } as ImageWorkflowPromptNode;
}

function generatedNode(overrides: Partial<ImageWorkflowGeneratedNode> = {}): ImageWorkflowGeneratedNode {
  return {
    id: "gen-1",
    type: "generated",
    title: "成图",
    prompt: "正文",
    aspectRatio: "1:1",
    position: { x: 100, y: 0 },
    status: "idle",
    ...overrides,
  } as ImageWorkflowGeneratedNode;
}

function graph(nodes: Array<ImageWorkflowPromptNode | ImageWorkflowGeneratedNode>, linked: boolean): ImageWorkflowGraph {
  const prompt = nodes.find((n) => n.type === "prompt") as ImageWorkflowPromptNode;
  const gen = nodes.find((n) => n.type === "generated") as ImageWorkflowGeneratedNode;
  return {
    id: "wf-1",
    name: "测试工作流",
    target: { kind: "storyboard", id: "sb-1" },
    nodes,
    edges: linked ? [{ id: "e1", source: prompt.id, target: gen.id }] : [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as ImageWorkflowGraph;
}

describe("buildImageWorkflowGenerationRequest 参数权威(功能转移)", () => {
  it("存量图(paramsEdited 缺省):回落连线提示词节点旧值,行为零变化", () => {
    const gen = generatedNode(); // aspect 1:1 / 无 model —— 存量孤值
    const prompt = promptNode(); // 16:9 / gpt-image-2 / 1K
    const request = buildImageWorkflowGenerationRequest(graph([prompt, gen], true), gen.id);
    expect(request.aspectRatio).toBe("16:9");
    expect(request.model).toBe("gpt-image-2");
    expect(request.resolution).toBe("1K");
  });

  it("paramsEdited=true:成图节点自身字段为权威", () => {
    const gen = generatedNode({ paramsEdited: true, aspectRatio: "9:16" });
    const prompt = promptNode();
    const request = buildImageWorkflowGenerationRequest(graph([prompt, gen], true), gen.id);
    expect(request.aspectRatio).toBe("9:16");
  });

  it("paramsEdited 且节点未填 model/resolution:仍回落提示词节点可选值", () => {
    const gen = generatedNode({ paramsEdited: true }); // model/resolution 为空
    const prompt = promptNode();
    const request = buildImageWorkflowGenerationRequest(graph([prompt, gen], true), gen.id);
    expect(request.model).toBe("gpt-image-2");
    expect(request.resolution).toBe("1K");
  });

  it("无连线提示词节点:参数取成图节点自身", () => {
    const gen = generatedNode({ model: "local-qwen", resolution: "2K" });
    const request = buildImageWorkflowGenerationRequest(graph([gen], false), gen.id);
    expect(request.model).toBe("local-qwen");
    expect(request.resolution).toBe("2K");
    expect(request.aspectRatio).toBe("1:1");
    expect(request.prompt).toBe("正文");
  });
});

describe("assertImageWorkflowContinuityCapability 模型白名单", () => {
  const request = (model: string) => ({
    model,
    continuityRequired: true,
    orderedReferenceManifest: [{ order: 1, imageUrl: "data:image/png;base64,ref", versionId: "v1" }],
  });

  it("允许 gpt-image 版本和 ComfyUI 桥精确标识", () => {
    expect(() => assertImageWorkflowContinuityCapability(request("gpt-image-2") as never)).not.toThrow();
    expect(() => assertImageWorkflowContinuityCapability(request("comfyui-bridge") as never)).not.toThrow();
  });

  it("拒绝带恶意后缀的伪造模型标识", () => {
    expect(() => assertImageWorkflowContinuityCapability(request("comfyui-bridge-malicious") as never)).toThrow(
      /未通过多参考图连续性能力门禁/,
    );
    expect(() => assertImageWorkflowContinuityCapability(request("gpt-image-2-malicious") as never)).toThrow(
      /未通过多参考图连续性能力门禁/,
    );
  });
});
