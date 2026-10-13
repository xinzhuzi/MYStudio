import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenAICompatibleMock, createAnthropicMock, createOpenAIMock, createGoogleGenerativeAIMock } = vi.hoisted(() => ({
  createOpenAICompatibleMock: vi.fn(() => ({ chatModel: vi.fn() })),
  createAnthropicMock: vi.fn(() => vi.fn()),
  createOpenAIMock: vi.fn(() => ({ chat: vi.fn() })),
  createGoogleGenerativeAIMock: vi.fn(() => vi.fn()),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: createOpenAICompatibleMock }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: createGoogleGenerativeAIMock }));
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: vi.fn(() => vi.fn()) }));
vi.mock("vercel-minimax-ai-provider", () => ({ createMinimax: vi.fn(() => vi.fn()) }));
vi.mock("ai", () => ({ generateImage: vi.fn(), generateText: vi.fn(), streamText: vi.fn() }));

import { createProviderInstance, firstUsableApiKey, normalizeAnthropicSdkBaseUrl, normalizeGeminiSdkBaseUrl, splitSystemMessages } from "./ai-sdk-bridge";

describe("createProviderInstance anthropic routing", () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
    createAnthropicMock.mockClear();
    createOpenAIMock.mockClear();
  });

  it("routes custom platform + anthropic-compatible apiProtocol to the Anthropic SDK with a /v1-normalized baseURL", () => {
    // 10-11 装机实配同款：platform="custom" + apiProtocol="anthropic-compatible" +
    // bigmodel anthropic 口（带尾斜杠、无 /v1）——此前落 createOpenAICompatible 打错协议口。
    createProviderInstance({
      platform: "custom",
      apiProtocol: "anthropic-compatible",
      baseUrl: "https://open.bigmodel.cn/api/anthropic/",
      apiKey: "k1,k2",
      name: "GLM",
    });

    expect(createAnthropicMock).toHaveBeenCalledTimes(1);
    expect(createAnthropicMock).toHaveBeenCalledWith({
      baseURL: "https://open.bigmodel.cn/api/anthropic/v1",
      apiKey: "k1",
    });
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it("keeps custom platform on the OpenAI-compatible SDK when apiProtocol is absent", () => {
    createProviderInstance({
      platform: "custom",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "k",
      name: "Relay",
    });

    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    // 既有行为：custom/default 分支以 platform 作 provider 实例名，不随 name 参数变。
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: "custom",
      baseURL: "https://relay.example.com/v1",
      apiKey: "k",
    });
    expect(createAnthropicMock).not.toHaveBeenCalled();
  });

  it("normalizes anthropic-platform providers without apiProtocol as well", () => {
    createProviderInstance({
      platform: "anthropic-compatible",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKey: "k",
    });

    expect(createAnthropicMock).toHaveBeenCalledWith({
      baseURL: "https://open.bigmodel.cn/api/anthropic/v1",
      apiKey: "k",
    });
  });

  it("does not double-append /v1 to an already-versioned anthropic baseURL", () => {
    createProviderInstance({
      platform: "custom",
      apiProtocol: "anthropic-compatible",
      baseUrl: "https://open.bigmodel.cn/api/anthropic/v1/",
      apiKey: "k",
    });

    expect(createAnthropicMock).toHaveBeenCalledWith({
      baseURL: "https://open.bigmodel.cn/api/anthropic/v1",
      apiKey: "k",
    });
  });

  it("leaves an empty anthropic baseURL to the SDK default", () => {
    createProviderInstance({
      platform: "anthropic-compatible",
      baseUrl: "",
      apiKey: "k",
    });

    expect(createAnthropicMock).toHaveBeenCalledWith({
      baseURL: undefined,
      apiKey: "k",
    });
  });

  it("takes the first usable key from a multi-key string before handing it to the SDK", () => {
    expect(firstUsableApiKey("k1, k2\nk3")).toBe("k1");
    expect(firstUsableApiKey(undefined)).toBeUndefined();
  });

  it("1013:全角分隔符串取首把 key——整串进 Bearer 会炸 Headers 非 ISO-8859-1(装机 gpt-image 主通道根因)", () => {
    expect(firstUsableApiKey("k1，k2")).toBe("k1");
    expect(firstUsableApiKey("k1、k2；k3")).toBe("k1");
    expect(firstUsableApiKey("k1，")).toBe("k1");
  });
});

// 1011 复审补(欠账②):gemini-compatible 协议路由防线——此前 apiProtocol 声明
// gemini-compatible 仍落 createOpenAICompatible 打错协议口,现与 anthropic 防线同款修。
describe("createProviderInstance gemini routing", () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
    createGoogleGenerativeAIMock.mockClear();
  });

  it("routes custom platform + gemini-compatible apiProtocol to the Google SDK with a /v1beta-normalized baseURL", () => {
    createProviderInstance({
      platform: "custom",
      apiProtocol: "gemini-compatible",
      baseUrl: "https://gemini-relay.example.com/",
      apiKey: "gk1",
      name: "Gemini 中转",
    });

    expect(createGoogleGenerativeAIMock).toHaveBeenCalledTimes(1);
    expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith({
      baseURL: "https://gemini-relay.example.com/v1beta",
      apiKey: "gk1",
    });
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it("keeps an already-versioned gemini baseURL intact and defaults an empty one to the SDK official prefix", () => {
    createProviderInstance({
      platform: "gemini-compatible",
      baseUrl: "https://gemini-relay.example.com/v1beta/",
      apiKey: "k",
    });
    expect(createGoogleGenerativeAIMock).toHaveBeenLastCalledWith({
      baseURL: "https://gemini-relay.example.com/v1beta",
      apiKey: "k",
    });

    // 空 baseUrl 交给 SDK 官方默认前缀,不再把空串传进裸拼接
    createProviderInstance({ platform: "gemini-compatible", baseUrl: "", apiKey: "k" });
    expect(createGoogleGenerativeAIMock).toHaveBeenLastCalledWith({ baseURL: undefined, apiKey: "k" });
  });
});

describe("normalizeGeminiSdkBaseUrl", () => {
  it("appends /v1beta only when no version segment is present (SDK does bare concatenation)", () => {
    expect(normalizeGeminiSdkBaseUrl("https://gemini-relay.example.com/")).toBe(
      "https://gemini-relay.example.com/v1beta",
    );
    expect(normalizeGeminiSdkBaseUrl("https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("keeps /v1, /v1beta and /v1alpha tails intact (no double append)", () => {
    expect(normalizeGeminiSdkBaseUrl("https://relay.example.com/gemini/v1beta")).toBe(
      "https://relay.example.com/gemini/v1beta",
    );
    expect(normalizeGeminiSdkBaseUrl("https://relay.example.com/v1alpha")).toBe(
      "https://relay.example.com/v1alpha",
    );
    expect(normalizeGeminiSdkBaseUrl("https://relay.example.com/v1")).toBe("https://relay.example.com/v1");
  });

  it("returns an empty string unchanged so callers can fall back to the SDK default prefix", () => {
    expect(normalizeGeminiSdkBaseUrl("")).toBe("");
  });
});

describe("normalizeAnthropicSdkBaseUrl", () => {
  it("strips trailing slashes and appends /v1 when no version segment is present", () => {
    expect(normalizeAnthropicSdkBaseUrl("https://open.bigmodel.cn/api/anthropic/")).toBe(
      "https://open.bigmodel.cn/api/anthropic/v1",
    );
  });

  it("keeps official Anthropic and already-versioned bases intact (no double /v1)", () => {
    expect(normalizeAnthropicSdkBaseUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1");
    expect(normalizeAnthropicSdkBaseUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
    expect(normalizeAnthropicSdkBaseUrl("https://proxy.example.com/anthropic/v2")).toBe(
      "https://proxy.example.com/anthropic/v2",
    );
  });

  it("returns an empty string unchanged so callers can fall back to the SDK default", () => {
    expect(normalizeAnthropicSdkBaseUrl("")).toBe("");
  });
});

describe("splitSystemMessages", () => {
  it("hoists system messages into a single top-level string (ai@7 rejects system role in messages)", () => {
    const result = splitSystemMessages([
      { role: "system", content: "first system" },
      { role: "user", content: "hello" },
      { role: "system", content: "second system" },
      { role: "assistant", content: "hi" },
    ]);
    expect(result.system).toBe("first system\n\nsecond system");
    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("omits system entirely when no system messages present", () => {
    const result = splitSystemMessages([{ role: "user", content: "hello" }]);
    expect(result.system).toBeUndefined();
    expect(result.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("drops empty system messages instead of emitting an empty system string", () => {
    const result = splitSystemMessages([
      { role: "system", content: "" },
      { role: "user", content: "hello" },
    ]);
    expect(result.system).toBeUndefined();
    expect(result.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
