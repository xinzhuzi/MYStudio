import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callChatAPI } from "./script-parser";
import { normalizeScriptData, normalizeTimeValue } from "./script-data-normalizer";

vi.mock("@/lib/ai/ai-sdk-bridge", () => ({
  getLanguageModel: vi.fn(() => ({})),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(() => {
    throw new Error("force fallback");
  }),
}));

function jsonResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { completion_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  const init = call[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("callChatAPI auto thinking mode", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse("OK"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("auto-enables highest thinking for a reasoning model without any flag", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "glm-4.6",
    });

    const body = lastRequestBody(fetchMock);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("does not add thinking params for a non-reasoning model", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "gpt-4o-mini",
    });

    const body = lastRequestBody(fetchMock);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.enable_thinking).toBeUndefined();
  });

  it("honors an explicit disableThinking override on a reasoning model", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "glm-4.6",
      disableThinking: true,
    });

    const body = lastRequestBody(fetchMock);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("uses reasoning_effort=high for OpenAI o-series", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "o3-mini",
    });

    const body = lastRequestBody(fetchMock);
    expect(body.reasoning_effort).toBe("high");
  });

  it("forces thinking on for an unrecognized model when thinkingEnabled is true", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "house-llm-7b",
      thinkingEnabled: true,
    });

    const body = lastRequestBody(fetchMock);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("forces thinking off for a reasoning model when thinkingEnabled is false", async () => {
    await callChatAPI("sys", "user", {
      apiKey: "sk-test",
      provider: "openai",
      baseUrl: "https://relay.example.com/v1",
      model: "glm-4.6",
      thinkingEnabled: false,
    });

    const body = lastRequestBody(fetchMock);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.enable_thinking).toBeUndefined();
  });
});

describe("script data normalization boundaries", () => {
  it("defaults empty model output to a usable episode", () => {
    const result = normalizeScriptData({}, "中文");
    expect(result.title).toBe("未命名剧本");
    expect(result.episodes).toEqual([{ id: "ep_1", index: 1, title: "第1集", description: undefined, sceneIds: [] }]);
  });

  it("normalizes shot-head scene time and preserves dialogue/action paragraphs", () => {
    const result = normalizeScriptData({
      scenes: [{ id: "scene_1", name: "镜头头", location: "室内", time: "夜间" }],
      storyParagraphs: [{ id: 1, text: "甲：快走！（动作：拔刀）", sceneRefId: "scene_1" }],
    });
    expect(result.scenes[0].time).toBe("night");
    expect(result.storyParagraphs[0].text).toContain("甲：快走");
    expect(result.storyParagraphs[0].text).toContain("动作");
  });

  it("falls back to day for unknown or blank time values", () => {
    expect(normalizeTimeValue("  ")).toBe("day");
    expect(normalizeTimeValue("未知时段")).toBe("day");
  });
});
