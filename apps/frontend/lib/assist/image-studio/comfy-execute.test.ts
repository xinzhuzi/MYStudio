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
  persistComfyAudio,
  persistComfyImage,
  planComfyWorkflowExecution,
  runComfyExecute,
  runComfyWorkflowNode,
} from "./comfy-execute";
import { useProjectStore } from "@/stores/project/project-store";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { useMediaStore } from "@/stores/media/media-store";

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

  it("音频产物透传:result.audios 与 images 同链原样回传(SaveAudio 输出)", async () => {
    const { fn } = mockFetchSequence([
      { ok: true, status: 200, body: { jobId: "job-bgm" } },
      { ok: true, status: 200, body: { status: "running", step: "running", message: "引擎执行中…" } },
      { ok: true, status: 200, body: { status: "complete", result: { promptId: "p-bgm", images: [], audios: [{ nodeId: "22", filename: "yue2.flac", b64: "QUJD" }] } } },
    ]);
    globalThis.fetch = fn as unknown as typeof fetch;
    const result = await runComfyExecute(
      { graph: { "22": { class_type: "SaveAudio", inputs: {} } }, inputs: { strings: {}, images: [] }, timeoutS: 1200 },
    );
    expect(result.audios?.[0]).toEqual({ nodeId: "22", filename: "yue2.flac", b64: "QUJD" });
  });

  it("options.pollTimeoutMs 生效:超时上限与文案秒数按自定义值(BGM 整曲 1230s)", async () => {
    vi.useFakeTimers();
    try {
      const { fn } = mockFetchSequence([
        { ok: true, status: 200, body: { jobId: "job-long" } },
        { ok: true, status: 200, body: { status: "running", step: "running", message: "引擎执行中…" } },
      ]);
      globalThis.fetch = fn as unknown as typeof fetch;
      const pending = runComfyExecute(
        { graph: { a: { class_type: "X", inputs: {} } }, inputs: { strings: {}, images: [] }, timeoutS: 1200 },
        undefined,
        { pollTimeoutMs: 1_230_000 },
      );
      const rejection = expect(pending).rejects.toThrow("ComfyUI 执行超时(1230 秒)");
      await vi.advanceTimersByTimeAsync(1_230_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("未传 pollTimeoutMs:按默认 330s 上限报超时(动态秒数文案)", async () => {
    vi.useFakeTimers();
    try {
      const { fn } = mockFetchSequence([
        { ok: true, status: 200, body: { jobId: "job-def" } },
        { ok: true, status: 200, body: { status: "running", step: "running", message: "引擎执行中…" } },
      ]);
      globalThis.fetch = fn as unknown as typeof fetch;
      const pending = runComfyExecute({ graph: { a: { class_type: "X", inputs: {} } }, inputs: { strings: {}, images: [] } });
      const rejection = expect(pending).rejects.toThrow("ComfyUI 执行超时(330 秒)");
      await vi.advanceTimersByTimeAsync(330_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("persistComfyImage 项目隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProjectId: "p-image" });
    useMediaStore.setState({ mediaFiles: [] });
  });

  afterEach(() => {
    (window as unknown as { projectFiles?: unknown }).projectFiles = undefined;
  });

  it.each([false, true])("写盘期间切换项目(切回=%s):不挂入媒体库", async (switchBack) => {
    const saveImage = vi.fn(async () => {
      useProjectStore.setState({ activeProjectId: "p-other" });
      if (switchBack) useProjectStore.setState({ activeProjectId: "p-image" });
      return { success: true, url: "project-file://p-image/media/ai-image/one.png" };
    });
    (window as unknown as { projectFiles?: unknown }).projectFiles = { saveImage };
    await expect(persistComfyImage("QUJD", "title")).rejects.toThrow("项目已切换");
    expect(saveToMediaLibrary).not.toHaveBeenCalled();
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p-image" }));
  });

  it("bridge 写盘失败不新增内存预览媒体,保留空地址供消费器重试", async () => {
    (window as unknown as { projectFiles?: unknown }).projectFiles = {
      saveImage: async () => ({ success: false, error: "full" }),
    };
    const saved = await persistComfyImage("QUJD", "title", { source: "comfy-bridge" });
    expect(saved).toMatchObject({ url: null, persisted: false });
    expect(saveToMediaLibrary).not.toHaveBeenCalled();
  });

  it("既有节点调用保持落盘失败时的内存预览", async () => {
    const saved = await persistComfyImage("QUJD", "title");
    expect(saved).toMatchObject({ url: null, persisted: false, mediaId: "media-42" });
    expect(saveToMediaLibrary).toHaveBeenCalledWith("data:image/png;base64,QUJD", "title", "ai-image");
  });

  it("显式项目快照失效:开始写盘前就阻断", async () => {
    const saveImage = vi.fn(async () => ({ success: true, url: "project-file://p-image/media/one.png" }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { saveImage };
    await expect(persistComfyImage("QUJD", "title", { projectId: "p-old" })).rejects.toThrow("项目已切换");
    expect(saveImage).not.toHaveBeenCalled();
  });

  it.each(["data:image/png;base64,QUJD", "project-file://p-other/media/one.png"])(
    "写桥返回非本项目持久地址:不入媒体库 (%s)", async (url) => {
      (window as unknown as { projectFiles?: unknown }).projectFiles = {
        saveImage: async () => ({ success: true, url }),
      };
      const saved = await persistComfyImage("QUJD", "title", { source: "comfy-bridge" });
      expect(saved).toMatchObject({ url: null, persisted: false });
      expect(saveToMediaLibrary).not.toHaveBeenCalled();
    },
  );

  it("bridge 已登记媒体在模块重载后复用,不重复写文件或媒体条目", async () => {
    const url = "project-file://p-image/media/ai-image/2026-08/comfy_bridge_71.png";
    useMediaStore.setState({ mediaFiles: [{ id: "saved-media", name: "canvas", type: "image", source: "ai-image", projectId: "p-image", url }] });
    const saveImage = vi.fn(async () => ({ success: true, url }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { saveImage };
    const originalMediaStore = useMediaStore;
    const originalProjectStore = useProjectStore;
    vi.doMock("@/stores/media/media-store", () => ({ useMediaStore: originalMediaStore }));
    vi.doMock("@/stores/project/project-store", () => ({ useProjectStore: originalProjectStore }));
    vi.resetModules();
    try {
      const reloaded = await import("./comfy-execute");
      const saved = await reloaded.persistComfyImage("QUJD", "title", { source: "comfy-bridge", bridgeItemId: 71 });
      expect(saved).toEqual({ url, mediaId: "saved-media", persisted: true });
      expect(saveImage).not.toHaveBeenCalled();
      expect(saveToMediaLibrary).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/stores/media/media-store");
      vi.doUnmock("@/stores/project/project-store");
      vi.resetModules();
    }
  });

  it("bridge 未登记文件以收件 id 稳定命名,普通节点仍使用原命名", async () => {
    const saveImage = vi.fn(async () => ({ success: true, url: "project-file://p-image/media/ai-image/2026-09/comfy_bridge_72.png" }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { saveImage };
    await persistComfyImage("QUJD", "title", { source: "comfy-bridge", bridgeItemId: 72 });
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({ relativePath: expect.stringMatching(/\/comfy_bridge_72\.png$/) }));
  });
});

// ── 音频落盘(09-20 YuE2 BGM 接线) ───────────────────────────────────

describe("persistComfyAudio(b64 音频写项目)", () => {
  afterEach(() => {
    (window as unknown as { projectFiles?: unknown }).projectFiles = undefined;
  });

  it("无项目身份/无写桥:大白话错误,不落盘", async () => {
    useProjectStore.setState({ activeProjectId: null } as never);
    await expect(persistComfyAudio("QUJD", "yue2.flac", "")).rejects.toThrow("无法写入项目音频");
  });

  it("b64 → media/audio/<月>/ 受管文件:扩展名取引擎文件名,字节解码,回传绝对路径与 url", async () => {
    useProjectStore.setState({ activeProjectId: "p-audio" } as never);
    const writeBinary = vi.fn(async () => ({
      success: true,
      filePath: "/proj/media/audio/2026-09/bgm_yue2_1234.flac",
      url: "project-file://p-audio/media/audio/2026-09/bgm_yue2_1234.flac",
    }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { writeBinary };
    const saved = await persistComfyAudio("QUJD", "yue2-out.flac", "p-audio");
    expect(saved.filePath).toBe("/proj/media/audio/2026-09/bgm_yue2_1234.flac");
    expect(saved.url).toBe("project-file://p-audio/media/audio/2026-09/bgm_yue2_1234.flac");
    expect(writeBinary).toHaveBeenCalledTimes(1);
    const arg = (writeBinary.mock.calls[0] as Array<{ projectId: string; relativePath: string; bytes: ArrayBuffer }>)[0];
    expect(arg.projectId).toBe("p-audio");
    expect(arg.relativePath).toMatch(/^media\/audio\/\d{4}-\d{2}\/bgm_yue2_\d+\.flac$/);
    expect(Array.from(new Uint8Array(arg.bytes))).toEqual([65, 66, 67]);
  });

  it("写失败:桥错误透传大白话(引擎文件名兜底)", async () => {
    useProjectStore.setState({ activeProjectId: "p-audio" } as never);
    (window as unknown as { projectFiles?: unknown }).projectFiles = {
      writeBinary: async () => ({ success: false, error: "磁盘已满" }),
    };
    await expect(persistComfyAudio("QUJD", "yue2.flac", "p-audio")).rejects.toThrow("生成的音频写入项目失败:磁盘已满");
  });

  it("保存目标始终使用发起项目,不跟随生成结束和保存中的活动项目", async () => {
    useProjectStore.setState({ activeProjectId: "p-other" });
    let finish!: (reply: { success: boolean; filePath: string; url: string }) => void;
    const writeBinary = vi.fn(() => new Promise<{ success: boolean; filePath: string; url: string }>((resolve) => { finish = resolve; }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { writeBinary };
    const pending = persistComfyAudio("QUJD", "yue2.flac", "p-audio");
    expect(writeBinary).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p-audio" }));
    useProjectStore.setState({ activeProjectId: "p-third" });
    finish({ success: true, filePath: "/p/audio.flac", url: "project-file://p-audio/media/audio/a.flac" });
    await expect(pending).resolves.toEqual({ filePath: "/p/audio.flac", url: "project-file://p-audio/media/audio/a.flac" });
  });

  it.each([undefined, "", "data:audio/flac;base64,QUJD", "project-file://p-other/media/audio/a.flac", "project-file://p-audio/../a.flac"])(
    "拒绝非发起项目受管 URL: %s", async (url) => {
      useProjectStore.setState({ activeProjectId: "p-audio" });
      (window as unknown as { projectFiles?: unknown }).projectFiles = {
        writeBinary: async () => ({ success: true, filePath: "/p/audio.flac", url }),
      };
      await expect(persistComfyAudio("QUJD", "yue2.flac", "p-audio")).rejects.toThrow("受管音频");
    },
  );
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

  it.each(["workflow", "execute", "roundtrip"])("%s 等待期间切项目:不将生成结果存入新项目", async (stage) => {
    useProjectStore.setState({ activeProjectId: "p-start" });
    const saveImage = vi.fn(async () => ({ success: true, url: "project-file://p-other/media/output.png" }));
    (window as unknown as { projectFiles?: unknown }).projectFiles = { saveImage };
    const { fn } = mockFetchSequence([
      { ok: true, status: 200, body: { jobId: "job-switch" } },
      { ok: true, status: 200, body: { status: "complete", result: { images: [{ b64: "QUJD" }] } } },
    ]);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/comfy/jobs/") && stage !== "workflow") {
        useProjectStore.setState({ activeProjectId: "p-other" });
        if (stage === "roundtrip") useProjectStore.setState({ activeProjectId: "p-start" });
      }
      return fn(input, init);
    });
    await expect(runComfyWorkflowNode(makeGraph([comfyWorkflowNode()], []), "cw-1", {
      fetchWorkflowText: async () => {
        if (stage === "workflow") useProjectStore.setState({ activeProjectId: "p-other" });
        return WORKFLOW_TEXT;
      },
    })).rejects.toThrow("项目已切换");
    expect(saveImage).not.toHaveBeenCalled();
  });
});
