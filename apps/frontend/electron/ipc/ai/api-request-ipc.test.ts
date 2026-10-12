import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

const { sdkStreamTextMock, sdkGenerateTextMock, runTextCompletionRequestMock, runTextCompletionStreamRequestMock } = vi.hoisted(() => ({
  sdkStreamTextMock: vi.fn(),
  sdkGenerateTextMock: vi.fn(),
  runTextCompletionRequestMock: vi.fn(),
  runTextCompletionStreamRequestMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock("../../../lib/ai/ai-sdk-bridge", () => ({
  sdkGenerateText: sdkGenerateTextMock,
  sdkStreamText: sdkStreamTextMock,
}));

vi.mock("../../../lib/ai/text-completion", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runTextCompletionRequest: runTextCompletionRequestMock,
  runTextCompletionStreamRequest: runTextCompletionStreamRequestMock,
}));

import { registerApiRequestIpcHandlers } from "./api-request-ipc";

describe("registerApiRequestIpcHandlers", () => {
  beforeEach(() => {
    sdkStreamTextMock.mockClear();
    sdkGenerateTextMock.mockClear();
    runTextCompletionRequestMock.mockClear();
    runTextCompletionStreamRequestMock.mockClear();
  });

  it("registers the four established API channels and rejects non-HTTP image URLs", async () => {
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
    expect([...handlers.keys()].sort()).toEqual([
      "api-image-request",
      "api-model-test",
      "api-text-completion",
      "api-text-completion-stream",
    ]);
    await expect(handlers.get("api-image-request")?.({}, { url: "file:///tmp/image.png" }))
      .rejects.toThrow("仅支持 http/https 请求地址");
    await expect(handlers.get("api-image-request")?.({}, { url: "not-a-url" }))
      .rejects.toThrow();
  });

  it.each(["", "   "]) (
    "rejects an empty image URL (%j) before making a request",
    async (url) => {
      await expect(handlers.get("api-image-request")?.({}, { url })).rejects.toThrow();
    },
  );

  it.each(["ftp://example.com/image.png", "data:image/png;base64,aW1hZ2U="]) (
    "rejects unsupported image URL protocols (%s)",
    async (url) => {
      await expect(handlers.get("api-image-request")?.({}, { url }))
        .rejects.toThrow("仅支持 http/https 请求地址");
    },
  );

  it("sends AI SDK stream deltas as structured envelopes for the preload callback contract", async () => {
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "sdk-delta" };
      })(),
      finishReason: Promise.resolve("stop"),
      usage: Promise.resolve({ inputTokens: 12, outputTokens: 34 }),
    });
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "provider-1",
        platform: "openai-compatible",
        name: "Provider 1",
        baseUrl: "https://provider.example.com/v1",
        apiKey: "secret",
        model: ["fallback-model"],
      },
      model: "requested-model",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    await expect(handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-1" })).resolves.toEqual({
      success: true,
      text: "sdk-delta",
      stopReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34 },
    });
    expect(send).toHaveBeenCalledWith("api-text-stream:stream-1", { kind: "text", delta: "sdk-delta" });
  });

  it("forwards reasoning-delta parts as thinking envelopes and fills the structured stopReason/usage terminal state", async () => {
    // 1011 thinking 进流锁:glm-5.3 思考期数分钟,reasoning-delta 不上屏=UI 干等;
    // ai@7 fullStream 的 reasoning-delta part 字段名是 text(与 text-delta 同名,非 delta)。
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", id: "rs-1", text: "思考增量A" };
        yield { type: "reasoning-delta", id: "rs-1", text: "思考增量B" };
        yield { type: "text-delta", id: "t-1", text: "正文增量" };
      })(),
      finishReason: Promise.resolve("length"),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 200 }),
    });
    const writeDiagnosticsLog = vi.fn();
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "glm",
        platform: "custom",
        apiProtocol: "anthropic-compatible",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic/",
        apiKey: "secret",
        model: ["glm-5.3"],
      },
      model: "glm-5.3",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const result = await handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-think" });

    // 渲染层收到 text 与 thinking 两种 kind;thinking 不混入终态 text
    expect(send).toHaveBeenCalledWith("api-text-stream:stream-think", { kind: "thinking", delta: "思考增量A" });
    expect(send).toHaveBeenCalledWith("api-text-stream:stream-think", { kind: "thinking", delta: "思考增量B" });
    expect(send).toHaveBeenCalledWith("api-text-stream:stream-think", { kind: "text", delta: "正文增量" });
    expect(result).toEqual({
      success: true,
      text: "正文增量",
      stopReason: "length",
      usage: { inputTokens: 100, outputTokens: 200 },
    });
    // 完成诊断带首思考/首正文计时与终态(1011 结构化终态)
    const entries = writeDiagnosticsLog.mock.calls.map(([entry]) => entry);
    const completed = entries.find((entry) => entry.message === "Text completion stream completed through AI SDK");
    expect(completed).toBeTruthy();
    expect(completed?.context?.stopReason).toBe("length");
    expect(typeof completed?.context?.firstThinkingMs).toBe("number");
    expect(typeof completed?.context?.firstTextMs).toBe("number");
  });

  it("degrades the SDK terminal state to stop when finishReason/usage reject after an error part", async () => {
    // 流中 error part 被记录后仍有正文产出:终态取值要能降级,不得把 IPC 打崩。
    // finishReason/usage 用 getter 惰性 reject——eager 创建的 rejected promise 会在
    // fullStream 消费期间触发 Node unhandledRejection,await 挂上 handler 前就被标记。
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "error", error: new Error("boom mid-stream") };
        yield { type: "text-delta", id: "t-1", text: " salvaged text " };
      })(),
      get finishReason() { return Promise.reject(new Error("no finish reason")); },
      get usage() { return Promise.reject(new Error("no usage")); },
    });
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "provider-1",
        platform: "openai-compatible",
        name: "Provider 1",
        baseUrl: "https://provider.example.com/v1",
        apiKey: "secret",
        model: ["fallback-model"],
      },
      model: "requested-model",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    await expect(handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-deg" })).resolves.toEqual({
      success: true,
      text: " salvaged text ",
      stopReason: "stop",
      usage: undefined,
    });
  });

  it("reports 'aborted' (not success/stop) when an in-stream abort part truncates partial body text", async () => {
    // 1011 复审修锁:ai@7 中止以流内 {type:'abort'} part 收尾不抛错,for-await 正常走完;
    // 此前 abort part 无分支被丢弃+成功路不查中止→截断正文误报 success+stop 被当自然结束保存。
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "text-delta", id: "t-1", text: "部分正文" };
        yield { type: "abort", reason: "client closed" };
      })(),
    });
    const writeDiagnosticsLog = vi.fn();
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "glm",
        platform: "custom",
        apiProtocol: "anthropic-compatible",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic/",
        apiKey: "secret",
        model: ["glm-5.3"],
      },
      model: "glm-5.3",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const result = await handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-abort-foreign" }) as { success?: boolean; stopReason?: string; error?: string };

    // 截断不得当自然结束:success=false + 'aborted' 终态('aborted' 枚举生产点)
    expect(result).toMatchObject({ success: false, stopReason: "aborted" });
    expect(result?.error).toContain("截断");
    // 也不再走 HTTP 回退——正文已上屏,回退一次性会整段重发造成 UI 双份
    expect(runTextCompletionStreamRequestMock).not.toHaveBeenCalled();
    const entries = writeDiagnosticsLog.mock.calls.map(([entry]) => entry);
    const aborted = entries.find((entry) => entry.message === "AI SDK text stream aborted mid-text");
    expect(aborted).toBeTruthy();
    expect(aborted?.context?.stopReason).toBe("aborted");
    expect(aborted?.context?.textLength).toBe("部分正文".length);
  });

  it("reports 'timeout' when the budget abort truncates partial body text mid-stream", async () => {
    // 1011 复审修锁:600s 预算中止打断已有正文——自家 controller 中止→timeout 终态,
    // 同样不得误报 stop、不得回退重发。
    vi.useFakeTimers();
    try {
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
      sdkStreamTextMock.mockResolvedValue({
        fullStream: (async function* () {
          yield { type: "text-delta", id: "t-1", text: "部分正文" };
          await gate; // 悬住等预算中止信号落下,再收 abort part
          yield { type: "abort" };
        })(),
      });
      registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
      const send = vi.fn();
      const payload = {
        provider: {
          id: "glm",
          platform: "custom",
          apiProtocol: "anthropic-compatible",
          name: "GLM",
          baseUrl: "https://open.bigmodel.cn/api/anthropic/",
          apiKey: "secret",
          model: ["glm-5.3"],
        },
        model: "glm-5.3",
        messages: [{ role: "user" as const, content: "hello" }],
        timeoutMs: 50,
      };

      const pending = handlers.get("api-text-completion-stream")?.({
        sender: { isDestroyed: () => false, send },
      }, { payload, streamId: "stream-abort-budget" });
      await vi.advanceTimersByTimeAsync(60); // 50ms 预算到点,主进程 controller.abort 落下
      releaseGate();
      const result = await pending as { success?: boolean; stopReason?: string; error?: string };

      expect(result).toMatchObject({ success: false, stopReason: "timeout" });
      expect(result?.error).toContain("截断");
      expect(runTextCompletionStreamRequestMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards provider apiProtocol to the AI SDK stream and logs error parts before the HTTP fallback", async () => {
    // 10-11 GLM 根因锁：error part 被静默丢弃→「流秒回空」；此处必须落诊断日志并走 HTTP 回退。
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "error", error: new Error("AI_InvalidResponseDataError: Response stream ended without a finish reason") };
      })(),
    });
    runTextCompletionStreamRequestMock.mockResolvedValue({ success: false, error: "http fallback failed" });
    const writeDiagnosticsLog = vi.fn();
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "glm",
        platform: "custom",
        apiProtocol: "anthropic-compatible",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic/",
        apiKey: "secret",
        model: ["glm-5.3"],
      },
      model: "glm-5.3",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const result = await handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-err" });

    expect(result).toMatchObject({ success: false });
    expect(sdkStreamTextMock.mock.calls[0]?.[0]).toMatchObject({
      provider: {
        platform: "custom",
        apiProtocol: "anthropic-compatible",
      },
    });
    const entries = writeDiagnosticsLog.mock.calls.map(([entry]) => entry);
    const errorPart = entries.find((entry) => entry.message === "AI SDK text stream errored part");
    expect(errorPart).toBeTruthy();
    expect(errorPart?.context?.errorMessage).toContain("finish reason");
    expect(errorPart?.context?.streamId).toBe("stream-err");
    expect(entries.some((entry) => entry.message === "AI SDK text stream returned empty, falling back to HTTP")).toBe(true);
    expect(runTextCompletionStreamRequestMock).toHaveBeenCalledTimes(1);
  });

  it("logs AI SDK one-shot completion failures (no-throw) before falling back to HTTP", async () => {
    sdkGenerateTextMock.mockResolvedValue({ success: false, error: "API 请求超时（300s）" });
    runTextCompletionRequestMock.mockResolvedValue({ success: false, error: "http failed" });
    const writeDiagnosticsLog = vi.fn();
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog });
    const payload = {
      provider: {
        id: "glm",
        platform: "custom",
        apiProtocol: "anthropic-compatible",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic/",
        apiKey: "secret",
        model: ["glm-5.3"],
      },
      model: "glm-5.3",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const result = await handlers.get("api-text-completion")?.({}, payload);

    expect(result).toMatchObject({ success: false });
    expect(sdkGenerateTextMock.mock.calls[0]?.[0]).toMatchObject({
      provider: { apiProtocol: "anthropic-compatible" },
    });
    const entries = writeDiagnosticsLog.mock.calls.map(([entry]) => entry);
    const failure = entries.find((entry) => entry.message === "AI SDK text completion failed, falling back to HTTP");
    expect(failure).toBeTruthy();
    expect(failure?.context?.error).toContain("超时");
    expect(runTextCompletionRequestMock).toHaveBeenCalledTimes(1);
  });
});


describe("api-text-completion disableThinking(1013 提取空文本修)", () => {
  const provider = {
    id: "p1",
    platform: "custom",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    apiKey: "sk-test",
    apiProtocol: "anthropic-compatible",
  };

  it("载荷带 disableThinking → sdkGenerateText 收 anthropic thinking:disabled;不带则零注入", async () => {
    registerApiRequestIpcHandlers({ createOperationId: () => "op", writeDiagnosticsLog: vi.fn() });
    sdkGenerateTextMock.mockResolvedValue({ success: true, text: "ok" });

    await handlers.get("api-text-completion")?.(null, {
      provider, model: "glm-5.3", messages: [{ role: "user", content: "x" }], disableThinking: true,
    });
    expect(sdkGenerateTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerOptions: { anthropic: { thinking: { type: "disabled" } } },
      }),
    );

    await handlers.get("api-text-completion")?.(null, {
      provider, model: "glm-5.3", messages: [{ role: "user", content: "x" }],
    });
    expect(sdkGenerateTextMock).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ providerOptions: expect.anything() }),
    );
  });
});
