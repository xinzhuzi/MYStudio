import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { aiManager, resolve } from "./ai-manager";
import type { TextCompletionMessage, TextCompletionResult } from "@/lib/api-manager/text-completion";

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
};

type TextCompletionFn = (payload: TextCompletionPayload) => Promise<TextCompletionResult>;
type TextCompletionStreamFn = (
  payload: TextCompletionPayload,
  onChunk: (delta: string) => void,
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
  it("Agent 绑定解析为 provider/model + 温度/maxTokens", () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "scriptDraft", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const r = resolve({ agent: "scriptDraft" });
    expect(r?.provider.id).toBe("p1");
    expect(r?.model).toBe("m1");
    expect(r?.temperature).toBe(0.7);
    expect(r?.maxTokens).toBe(1234);
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
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>();
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
        error: "未配置可用模型，请到设置的 API 管理绑定对应 Agent 或通用AI",
      });
      expect(textCompletion).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("calls text completion with feature binding defaults", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>().mockResolvedValue({
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
      maxTokens: 32000,
    });
  });

  it("falls back to the universal agent when a feature binding is unresolved", async () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "universalAi", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>().mockResolvedValue({
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
        maxTokens: 1234,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("prefers resolved agent temperature and max tokens over request defaults", async () => {
    useAPIConfigStore.setState({
      agentDeployments: [
        { key: "scriptDraft", name: "", desc: "", modelId: "m1", vendorId: "p1", temperature: 0.7, maxOutputTokens: 1234 },
      ],
    } as never);
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>().mockResolvedValue({
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
      maxTokens: 1234,
    });
  });
});

describe("aiManager.textStream", () => {
  it("uses streaming IPC and forwards chunks", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      [TextCompletionPayload, (delta: string) => void],
      Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("he");
        onChunk("llo");
        return { success: true, text: "hello" };
      });
    setTestWindow({ textCompletionStream });
    const chunks: string[] = [];

    const result = await aiManager.textStream(
      { binding: { feature: "chat" }, messages },
      (delta) => chunks.push(delta),
    );

    expect(result).toEqual({ success: true, text: "hello", error: undefined });
    expect(chunks).toEqual(["he", "llo"]);
    expect(textCompletionStream).toHaveBeenCalledTimes(1);
    expect(textCompletionStream.mock.calls[0]?.[0]).toMatchObject({
      provider: { id: "p1" },
      model: "m1",
      temperature: 0.6,
      maxTokens: 32000,
    });
  });

  it("falls back to text completion and emits the full text once when streaming IPC is missing", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>().mockResolvedValue({
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
      [TextCompletionPayload, (delta: string) => void],
      Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("uni");
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
        maxTokens: 1234,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("preserves streamed chunks when the streaming IPC reports failure", async () => {
    useAPIConfigStore.setState({ featureBindings: { chat: ["p1:m1"] } } as never);
    const textCompletionStream = vi.fn<
      [TextCompletionPayload, (delta: string) => void],
      Promise<TextCompletionResult>
    >()
      .mockImplementation(async (_payload, onChunk) => {
        onChunk("partial-1");
        onChunk("partial-2");
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
    const textCompletion = vi.fn<[TextCompletionPayload], Promise<TextCompletionResult>>().mockResolvedValue({
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
