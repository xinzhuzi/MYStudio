import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callChatAPI } from "./script-parser";

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
