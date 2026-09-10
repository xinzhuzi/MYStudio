// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowComfyWorkflowNode, ImageWorkflowGraph } from "@/types/studio";

// saveToMediaLibrary 走媒体库 store(jsdom 全链重);注入位测试直控返回值
vi.mock("@/lib/ai/generation-media", () => ({
  saveToMediaLibrary: vi.fn(() => "media-42"),
}));
vi.mock("@/lib/media/image-storage", () => ({
  readImageAsBase64: vi.fn(async (url: string) => {
    if (url.startsWith("data:")) return url;
    if (url.startsWith("local-image://")) return "data:image/png;base64,TE9DQUw=";
    return null;
  }),
}));

import {
  collectComfyUpstream,
  planComfyWorkflowExecution,
  runComfyExecute,
  runComfyWorkflowNode,
} from "./comfy-execute";
import { useProjectStore } from "@/stores/project/project-store";

// ── 夹具 ────────────────────────────────────────────────────────────

function makeGraph(nodes: ImageWorkflowGraph["nodes"], edges: ImageWorkflowGraph["edges"]): ImageWorkflowGraph {
  return {
    id: "g1",
    name: "画布",
    target: { kind: "free" },
    nodes,
    edges,
    createdAt: 1,
    updatedAt: 1,
  };
}

function baseNode(kind: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: kind,
    title: id,
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as ImageWorkflowGraph["nodes"][number];
}

const WORKFLOW_TEXT = JSON.stringify({
  "6": { class_type: "CLIPTextEncode", inputs: { text: "默认正向", clip: ["4", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "默认负向", clip: ["4", 0] } },
  "10": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
  "11": { class_type: "SaveImage", inputs: { images: ["9", 0] } },
  "12": { class_type: "KSampler", inputs: { seed: 42, steps: 20 } },
});

function comfyWorkflowNode(overrides: Partial<ImageWorkflowComfyWorkflowNode> = {}): ImageWorkflowComfyWorkflowNode {
  return {
    id: "cw-1",
    type: "comfy-workflow",
    title: "K2 专业流",
    workflowId: "wf-9",
    workflowName: "K2 专业流",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    descriptor: {
      ports: [
        { id: "6.text", type: "prompt-text", label: "正向提示词", nodeId: "6", inputKey: "text", polarity: "positive" },
        { id: "7.text", type: "prompt-text", label: "负向提示词", nodeId: "7", inputKey: "text", polarity: "negative" },
        { id: "10.image", type: "image", label: "参考图 1", nodeId: "10", inputKey: "image" },
      ],
      widgets: [
        { id: "12.seed", type: "INT", label: "随机种子", default: 42, nodeId: "12", inputKey: "seed" },
      ],
      classTypesUsed: ["CLIPTextEncode", "LoadImage", "SaveImage", "KSampler"],
      nodeCount: 5,
    },
    status: "idle",
    ...overrides,
  };
}

// ── 上游收集(纯函数) ────────────────────────────────────────────────

describe("collectComfyUpstream(工作流节点上游收集)", () => {
  it("整节点提示词边:正负文本都供(工作流边界口按极性分流)", () => {
    const graph = makeGraph(
      [
        baseNode("prompt", "p1", { prompt: "一只猫", negativePrompt: "低质量" }),
        comfyWorkflowNode(),
      ],
      [{ id: "e1", source: "p1", target: "cw-1", targetHandle: "prompt" }],
    );
    const upstream = collectComfyUpstream(graph, "cw-1");
    expect(upstream.hasPromptSource).toBe(true);
    expect(upstream.positivePrompt).toBe("一只猫");
    expect(upstream.negativePrompt).toBe("低质量");
    expect(upstream.imageUrls).toEqual([]);
  });

  it("负口边只供负向;参考图/成图沿边按序收集;空参考图计 missing", () => {
    const graph = makeGraph(
      [
        baseNode("prompt", "p1", { prompt: "正向", negativePrompt: "负向" }),
        baseNode("reference", "r1", { imageUrl: "local-image://a.png" }),
        baseNode("reference", "r2", { imageUrl: "" }),
        baseNode("generated", "g1", { resultUrl: "local-image://b.png", status: "ready", aspectRatio: "1:1", prompt: "" }),
        comfyWorkflowNode(),
      ],
      [
        { id: "e1", source: "p1", target: "cw-1", targetHandle: "prompt", sourceHandle: "negative" },
        { id: "e2", source: "r1", target: "cw-1", targetHandle: "image" },
        { id: "e3", source: "r2", target: "cw-1", targetHandle: "image" },
        { id: "e4", source: "g1", target: "cw-1", targetHandle: "image" },
      ],
    );
    const upstream = collectComfyUpstream(graph, "cw-1");
    expect(upstream.positivePrompt).toBe("");
    expect(upstream.negativePrompt).toBe("负向");
    // 沿边收集一切就绪图(容量限制在连线规则侧);空参考图单列 missing
    expect(upstream.imageUrls).toEqual(["local-image://a.png", "local-image://b.png"]);
    expect(upstream.missingImageCount).toBe(1);
  });
});

// ── 执行计划(纯函数) ────────────────────────────────────────────────

describe("planComfyWorkflowExecution(执行计划构建)", () => {
  it("注入规划:prompt 口按极性吃上游文本,image 口按序占槽;widget 现值回填", () => {
    const upstream = {
      positivePrompt: "一只猫",
      negativePrompt: "低质量",
      hasPromptSource: true,
      imageUrls: ["local-image://a.png"],
      missingImageCount: 0,
    };
    const plan = planComfyWorkflowExecution(WORKFLOW_TEXT, comfyWorkflowNode({
      widgetValues: { "12.seed": 7 },
    }), upstream);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 图是深拷贝(不改原文 JSON)
    expect(JSON.parse(WORKFLOW_TEXT)["12"].inputs.seed).toBe(42);
    expect(plan.graph["12"].inputs.seed).toBe(7);
    expect(plan.strings).toEqual({ "6.text": "一只猫", "7.text": "低质量" });
    expect(plan.imageSlots).toEqual([
      { key: "10.image", name: "mystudio-image.png", sourceUrl: "local-image://a.png" },
    ]);
  });

  it("上游缺失的口保持工作流原值(默认值不动即可跑)", () => {
    const plan = planComfyWorkflowExecution(WORKFLOW_TEXT, comfyWorkflowNode(), {
      positivePrompt: "",
      negativePrompt: "",
      hasPromptSource: false,
      imageUrls: [],
      missingImageCount: 0,
    });
    expect(plan.ok && plan.strings).toEqual({});
    expect(plan.ok && plan.imageSlots).toEqual([]);
  });

  it("坏 JSON/UI 格式给大白话错误", () => {
    const bad = planComfyWorkflowExecution("不是json", comfyWorkflowNode(), {
      positivePrompt: "", negativePrompt: "", hasPromptSource: false, imageUrls: [], missingImageCount: 0,
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("有效 JSON");
    const uiFormat = planComfyWorkflowExecution(JSON.stringify({ nodes: [], links: [] }), comfyWorkflowNode(), {
      positivePrompt: "", negativePrompt: "", hasPromptSource: false, imageUrls: [], missingImageCount: 0,
    });
    expect(uiFormat.ok).toBe(false);
    expect(!uiFormat.ok && uiFormat.error).toContain("UI 格式");
  });
});

// ── HTTP 通道(job 轮询) ─────────────────────────────────────────────

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn, calls };
}

describe("runComfyExecute(job 提交+轮询)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // 探活门禁直控放行(jsdom 无 imageGenRuntime 桥)
    (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime = {
      status: async () => ({ running: true }),
    };
  });

  it("提交→running→complete 全链:payload 形状+进度回报+图片回传", async () => {
    const { fn, calls } = mockFetchSequence([
      { ok: true, status: 200, body: { jobId: "job-1" } },
      { ok: true, status: 200, body: { status: "running", step: "upload", message: "上传输入图 1/1…" } },
      { ok: true, status: 200, body: { status: "complete", result: { promptId: "p-1", images: [{ nodeId: "11", b64: "QUJD" }] } } },
    ]);
    globalThis.fetch = fn as unknown as typeof fetch;
    const stages: string[] = [];
    const result = await runComfyExecute(
      {
        graph: { "6": { class_type: "CLIPTextEncode", inputs: { text: "猫" } } },
        inputs: { strings: { "6.text": "猫" }, images: [] },
      },
      (progress) => stages.push(progress.stage),
    );
    expect(result.images?.[0]?.b64).toBe("QUJD");
    expect(stages).toEqual(["upload"]);
    expect(calls[0].url).toContain("/comfy/execute");
    expect(JSON.parse(String(calls[0].init?.body)).inputs.strings).toEqual({ "6.text": "猫" });
  });

  it("job 出错:大白话 error 透传", async () => {
    const { fn } = mockFetchSequence([
      { ok: true, status: 200, body: { jobId: "job-2" } },
      { ok: true, status: 200, body: { status: "error", error: "ComfyUI 执行失败: OOM" } },
    ]);
    globalThis.fetch = fn as unknown as typeof fetch;
    await expect(
      runComfyExecute({ graph: { a: { class_type: "X", inputs: {} } }, inputs: { strings: {}, images: [] } }),
    ).rejects.toThrow("OOM");
  });

  it("sidecar 未运行:探活门禁直接大白话(零 fetch)", async () => {
    (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime = {
      status: async () => ({ running: false }),
    };
    const fn = vi.fn();
    globalThis.fetch = fn as unknown as typeof fetch;
    await expect(
      runComfyExecute({ graph: { a: { class_type: "X", inputs: {} } }, inputs: { strings: {}, images: [] } }),
    ).rejects.toThrow("本地生图服务未运行");
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── 工作流节点运行编排(端到端,mock HTTP+落盘桥) ────────────────────

describe("runComfyWorkflowNode(卡上运行编排)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    (window as unknown as { projectFiles?: unknown }).projectFiles = undefined;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime = {
      status: async () => ({ running: true }),
    };
  });

  it("库取原文→注入→执行→落盘(mediaRef 模式):输出 URL/张数/持久化", async () => {
    const { fn } = mockFetchSequence([
      { ok: true, status: 200, body: { jobId: "job-9" } },
      { ok: true, status: 200, body: { status: "complete", result: { promptId: "p-9", images: [{ nodeId: "11", b64: "QUJD" }, { nodeId: "11", b64: "REVG" }] } } },
    ]);
    globalThis.fetch = fn as unknown as typeof fetch;
    (window as unknown as { projectFiles?: unknown }).projectFiles = {
      saveImage: async () => ({ success: true, url: "project-file://p1/media/ai-image/2026-09/comfy_x.png" }),
    };
    useProjectStore.setState({ activeProjectId: "p1" } as never);

    const graph = makeGraph(
      [
        baseNode("prompt", "p1", { prompt: "一只猫", negativePrompt: "低质量" }),
        baseNode("reference", "r1", { imageUrl: "local-image://a.png" }),
        comfyWorkflowNode(),
      ],
      [
        { id: "e1", source: "p1", target: "cw-1", targetHandle: "prompt" },
        { id: "e2", source: "r1", target: "cw-1", targetHandle: "image" },
      ],
    );
    const result = await runComfyWorkflowNode(graph, "cw-1", {
      fetchWorkflowText: async () => WORKFLOW_TEXT,
    });
    expect(result.imageUrl).toBe("project-file://p1/media/ai-image/2026-09/comfy_x.png");
    expect(result.imageCount).toBe(2);
    expect(result.persisted).toBe(true);
    // 提交体:字符串按极性注入+图转 b64 上传(fetch mock 的调用参量为 [input, init] 元组)
    const submitBody = JSON.parse(String((fn as unknown as { mock: { calls: Array<[unknown, RequestInit | undefined]> } }).mock.calls[0]?.[1]?.body));
    expect(submitBody.inputs.strings).toEqual({ "6.text": "一只猫", "7.text": "低质量" });
    expect(submitBody.inputs.images[0].key).toBe("10.image");
    expect(submitBody.inputs.images[0].b64).toBe("TE9DQUw=");
  });

  it("上游空参考图:运行前阻断并指路(不静默降级)", async () => {
    const graph = makeGraph(
      [baseNode("reference", "r1", { imageUrl: "" }), comfyWorkflowNode()],
      [{ id: "e1", source: "r1", target: "cw-1", targetHandle: "image" }],
    );
    await expect(
      runComfyWorkflowNode(graph, "cw-1", { fetchWorkflowText: async () => WORKFLOW_TEXT }),
    ).rejects.toThrow("还没准备好");
  });
});
