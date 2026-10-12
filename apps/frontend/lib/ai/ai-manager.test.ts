import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { aiManager, resolve } from "./ai-manager";
import type { TextCompletionMessage, TextCompletionResult } from "@/lib/ai/text-completion";

const provider = {
  id: "p1",
  platform: "openai-compatible",
  name: "P1",
  baseUrl: "https://x/v1",
  apiKey: "k",
  model: ["m1"],
  apiProtocol: "openai-compatible",
};

const messages: TextCompletionMessage[] = [{ role: "user", content: "hello" }];
const globalWithWindow = globalThis as { window?: unknown };
let previousWindow: unknown;

type TextCompletionPayload = {
  provider: { id: string };
  model: string;
  messages: TextCompletionMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
};

type TextCompletionFn = (payload: TextCompletionPayload) => Promise<TextCompletionResult>;
// 1011 thinking 进流:onChunk 扩为 (delta, kind)——text=正文增量,thinking=思考增量
type TextCompletionStreamFn = (
  payload: TextCompletionPayload,
  onChunk: (delta: string, kind: "text" | "thinking") => void,
) => Promise<TextCompletionResult>;

type TestElectronAPI = {
  textCompletion?: TextCompletionFn;
  textCompletionStream?: TextCompletionStreamFn;
};

function setTestWindow(electronAPI?: TestElectronAPI): void {
  globalWithWindow.window = { electronAPI };
}

beforeEach(() => {
  previousWindow = globalWithWindow.window;
  useAPIConfigStore.setState({
    providers: [provider],
    featureBindings: {},
    agentUseMode: "advanced",
    agentDeployments: [],
  } as never);
});

afterEach(() => {
  if (previousWindow === undefined) {
    Reflect.deleteProperty(globalWithWindow, "window");
  } else {
    globalWithWindow.window = previousWindow;
  }
});

describe("aiManager.resolve", () => {
  it("Agent 绑定解析为 provider/model + 温度;部署级 maxOutputTokens 不再回传(1013 烤问:小额默认击穿 64K 单一真源)", () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "scriptDraft", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const r = resolve({ agent: "scriptDraft" });
    expect(r?.provider.id).toBe("p1");
    expect(r?.model).toBe("m1");
    expect(r?.temperature).toBe(0.7);
    expect(r?.maxTokens).toBeUndefined();
  });

  it("Feature 绑定解析 vendorId:model", () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const r = resolve({ feature: "chat" });
    expect(r?.provider.id).toBe("p1");
    expect(r?.model).toBe("m1");
  });

  it("无绑定返回 null", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(resolve({ agent: "scriptDraft" })).toBeNull();
      expect(resolve({ feature: "chat" })).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("通过 aiManager 暴露功能配置查询，避免业务层直接依赖 feature-router", () => {
    useAPIConfigStore.setState({ featureBindings: { character_generation: ["p1:m1"] } } as never);
    const cfg = aiManager.featureConfig("character_generation");
    expect(cfg?.provider.id).toBe("p1");
    expect(cfg?.model).toBe("m1");
  });

  it("剧本面板通过 aiManager 查询功能配置，不直连 feature-router", () => {
    const source = readFileSync(join(process.cwd(), "frontend/components/panels/script/index.tsx"), "utf8");
    expect(source).toContain("@/lib/ai/ai-manager");
    expect(source).not.toMatch(/from\s+["']@\/lib\/ai\/feature-router["']/);
  });

  it("视频生成实现下沉到 lib/ai，aiManager 不静态依赖组件 hook", () => {
    const hookSource = readFileSync(join(process.cwd(), "frontend/components/panels/director/use-video-generation.ts"), "utf8");
    const managerSource = readFileSync(join(process.cwd(), "frontend/lib/ai/ai-manager.ts"), "utf8");
    expect(hookSource).toContain("@/lib/ai/video-generator");
    expect(hookSource).not.toMatch(/from\s+["']@\/lib\/ai\/feature-router["']/);
    expect(managerSource).toContain("@/lib/ai/video-generator");
    expect(managerSource).not.toContain("@/components/panels/director/use-video-generation");
  });
});

describe("aiManager.text", () => {
  it("returns an unsupported-environment error when text completion IPC is missing", async () => {
    setTestWindow({});

    const result = await aiManager.text({ binding: { feature: "chat" }, messages });

    expect(result).toEqual({ success: false, error: "当前环境不支持模型调用" });
  });

  it("returns the unconfigured-model error before calling text completion", async () => {
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setTestWindow({ textCompletion });

    try {
      const result = await aiManager.text({
        binding: { feature: "chat" },
        messages,
        fallbackToUniversal: false,
      });

      expect(result).toEqual({
        success: false,
        error: "未配置可用模型，请到设置的云端AI绑定对应 Agent 或通用AI",
      });
      expect(textCompletion).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("calls text completion with feature binding defaults", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: true,
      text: "ok",
    });
    setTestWindow({ textCompletion });

    const result = await aiManager.text({ binding: { feature: "chat" }, messages });

    expect(result).toEqual({ success: true, text: "ok", error: undefined });
    expect(textCompletion).toHaveBeenCalledTimes(1);
    expect(textCompletion.mock.calls[0]?.[0]).toMatchObject({
      provider: { id: "p1" },
      model: "m1",
      messages,
      temperature: 0.6,
      maxTokens: 65536, // 1013 终裁:最大输出 64K 统一(云端=本地)
    });
  });

  it("falls back to the universal agent when a feature binding is unresolved", async () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "universalAi", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: true,
      text: "fallback",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setTestWindow({ textCompletion });

    try {
      const result = await aiManager.text({ binding: { feature: "chat" }, messages });

      expect(result).toEqual({ success: true, text: "fallback", error: undefined });
      expect(textCompletion.mock.calls[0]?.[0]).toMatchObject({
        provider: { id: "p1" },
        model: "m1",
        temperature: 0.7,
        maxTokens: 65536, // 1013:部署级 1234 不再参战,64K 地板生效
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("prefers resolved agent temperature; max_tokens floors to 64K(部署小额与请求小额都被地板抬升)", async () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "scriptDraft", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: true,
      text: "agent-ok",
    });
    setTestWindow({ textCompletion });

    await aiManager.text({
      binding: { agent: "scriptDraft" },
      messages,
      temperature: 0.2,
      maxTokens: 456,
    });

    expect(textCompletion.mock.calls[0]?.[0]).toMatchObject({
      model: "m1",
      temperature: 0.7,
      maxTokens: 65536, // 1013:部署 1234 与请求 456 均低于地板,抬到 64K
    });
  });

  // 1011 欠账③回归锁:主进程结构化终态不在渲染层门面收窄丢弃——stopReason/usage 必须透传给调用方。
  it("透传主进程结构化终态 stopReason/usage(text 腿)", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: true,
      text: "ok",
      stopReason: "length",
      usage: { inputTokens: 11, outputTokens: 22 },
    });
    setTestWindow({ textCompletion });

    const result = await aiManager.text({ binding: { feature: "chat" }, messages });

    expect(result).toEqual({
      success: true,
      text: "ok",
      error: undefined,
      stopReason: "length",
      usage: { inputTokens: 11, outputTokens: 22 },
    });
  });
});

describe("aiManager.textStream", () => {
  it("uses streaming IPC and forwards chunks", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("he", "text");
        onChunk("llo", "text");
        return { success: true, text: "hello" };
      });
    setTestWindow({ textCompletionStream });
    const chunks: Array<[string, "text" | "thinking"]> = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta, kind) => chunks.push([delta, kind]),
    );

    expect(result).toEqual({ success: true, text: "hello", error: undefined });
    expect(chunks).toEqual([["he", "text"], ["llo", "text"]]);
    expect(textCompletionStream).toHaveBeenCalledTimes(1);
    expect(textCompletionStream.mock.calls[0]?.[0]).toMatchObject({
      provider: { id: "p1" },
      model: "m1",
      temperature: 0.6,
      maxTokens: 65536, // 1013 终裁:最大输出 64K 统一(云端=本地)
    });
  });

  // 1011 欠账③回归锁:流式终态(SDK finishReason/usage 与 HTTP 回退分类)同样透传,不收窄。
  it("透传流式结构化终态 stopReason/usage(textStream 腿)", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >().mockImplementation(async (_payload, onChunk) => {
      onChunk("he", "text");
      return { success: true, text: "he", stopReason: "stop", usage: { inputTokens: 3, outputTokens: 2 } };
    });
    setTestWindow({ textCompletionStream });

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      () => undefined,
    );

    expect(result).toEqual({
      success: true,
      text: "he",
      error: undefined,
      stopReason: "stop",
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });

  it("forwards thinking chunks with their kind without mixing them into text (1011 thinking 进流)", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("思考A", "thinking");
        onChunk("思考B", "thinking");
        onChunk("正文", "text");
        return { success: true, text: "正文" };
      });
    setTestWindow({ textCompletionStream });
    const chunks: Array<[string, "text" | "thinking"]> = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta, kind) => chunks.push([delta, kind]),
    );

    // kind 原样透传:渲染层可分流 thinking 与 text;终态 text 不含思考增量
    expect(chunks).toEqual([["思考A", "thinking"], ["思考B", "thinking"], ["正文", "text"]]);
    expect(result).toEqual({ success: true, text: "正文", error: undefined });
  });

  it("forwards timeoutMs to the streaming IPC payload (B+ 长输出超时兜底)", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >()
      .mockResolvedValue({ success: true, text: "ok" });
    setTestWindow({ textCompletionStream });

    await aiManager.textStream(
      { binding: { feature: "chat" }, messages, timeoutMs: 600_000 },
      () => undefined,
    );

    expect(textCompletionStream.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 600_000 });
  });

  it("falls back to text completion and emits the full text once when streaming IPC is missing", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: true,
      text: "whole",
    });
    setTestWindow({ textCompletion });
    const chunks: string[] = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta) => chunks.push(delta),
    );

    expect(result).toEqual({ success: true, text: "whole", error: undefined });
    expect(chunks).toEqual(["whole"]);
    expect(textCompletion).toHaveBeenCalledTimes(1);
  });

  it("falls back to the universal agent for streaming text when a feature binding is unresolved", async () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "universalAi", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("uni", "text");
        return { success: true, text: "universal" };
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setTestWindow({ textCompletionStream });
    const chunks: string[] = [];

    try {
      const result = await aiManager.textStream(
        { binding: { feature: "chat" }, messages },
        (delta) => chunks.push(delta),
      );

      expect(result).toEqual({ success: true, text: "universal", error: undefined });
      expect(chunks).toEqual(["uni"]);
      expect(textCompletionStream.mock.calls[0]?.[0]).toMatchObject({
        provider: { id: "p1" },
        model: "m1",
        temperature: 0.7,
        maxTokens: 65536, // 1013:64K 地板,部署级 1234 不再参战
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("preserves streamed chunks when the streaming IPC reports failure", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      (payload: TextCompletionPayload, onChunk: (delta: string, kind: "text" | "thinking") => void) => Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("partial-1", "text");
        onChunk("partial-2", "text");
        return { success: false, text: "partial", error: "provider failed" };
      });
    setTestWindow({ textCompletionStream });
    const chunks: string[] = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta) => chunks.push(delta),
    );

    expect(result).toEqual({ success: false, text: "partial", error: "provider failed" });
    expect(chunks).toEqual(["partial-1", "partial-2"]);
  });

  it("does not emit chunks when stream fallback text completion fails", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<(payload: TextCompletionPayload) => Promise<TextCompletionResult>>().mockResolvedValue({
      success: false,
      error: "text failed",
    });
    setTestWindow({ textCompletion });
    const chunks: string[] = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta) => chunks.push(delta),
    );

    expect(result).toEqual({ success: false, text: undefined, error: "text failed" });
    expect(chunks).toEqual([]);
    expect(textCompletion).toHaveBeenCalledTimes(1);
  });
});
