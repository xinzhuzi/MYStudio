import { describe, expect, it } from "vitest";
import {
  THINKING_TEST_MAX_TOKENS,
  buildThinkingParams,
  resolveThinkingEnabled,
  supportsThinking,
} from "./thinking-mode";

describe("supportsThinking (loose matching)", () => {
  it("detects reasoning model families", () => {
    for (const model of [
      "o1",
      "o3-mini",
      "o4-mini",
      "gpt-5",
      "gpt-5-mini",
      "claude-3-7-sonnet",
      "claude-3.7-sonnet",
      "claude-sonnet-4-20250514",
      "claude-opus-4-1",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "glm-4.5",
      "glm-4.6",
      "glm-z1-air",
      "qwen3-235b-a22b",
      "qwq-32b",
      "deepseek-r1",
      "deepseek-reasoner",
      "some-thinking-model",
      "x-reasoner",
      "model-r1",
    ]) {
      expect(supportsThinking(model), model).toBe(true);
    }
  });

  it("returns false for non-reasoning models", () => {
    for (const model of [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "claude-3-5-sonnet",
      "claude-3-haiku",
      "gemini-1.5-pro",
      "gemini-2.0-flash",
      "glm-4-flash",
      "glm-4-air",
      "qwen-max",
      "qwen2.5-72b",
      "deepseek-v3",
      "deepseek-chat",
      "kimi-k2",
    ]) {
      expect(supportsThinking(model), model).toBe(false);
    }
  });
});

describe("buildThinkingParams (highest thinking per protocol)", () => {
  it("returns empty patch for unsupported models", () => {
    expect(buildThinkingParams({ model: "gpt-4o", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({});
  });

  it("uses reasoning_effort=high for OpenAI o-series and gpt-5", () => {
    expect(buildThinkingParams({ model: "o3-mini", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({
      reasoning_effort: "high",
    });
    expect(buildThinkingParams({ model: "gpt-5", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({
      reasoning_effort: "high",
    });
  });

  it("enables Zhipu GLM thinking on the OpenAI-compatible endpoint", () => {
    expect(buildThinkingParams({ model: "glm-4.6", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({
      thinking: { type: "enabled" },
    });
  });

  it("enables Qwen3 thinking via enable_thinking", () => {
    expect(buildThinkingParams({ model: "qwen3-32b", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({
      enable_thinking: true,
    });
  });

  it("adds no params for DeepSeek-R1 (thinking is automatic)", () => {
    expect(buildThinkingParams({ model: "deepseek-r1", protocol: "openai-compatible", maxTokens: 4096 })).toEqual({});
  });

  it("sizes an Anthropic thinking budget below max_tokens", () => {
    expect(buildThinkingParams({ model: "claude-sonnet-4", protocol: "anthropic-compatible", maxTokens: 2048 })).toEqual({
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
    const big = buildThinkingParams({ model: "claude-sonnet-4", protocol: "anthropic-compatible", maxTokens: 8000 });
    expect((big.thinking as { budget_tokens: number }).budget_tokens).toBeLessThan(8000);
    expect((big.thinking as { budget_tokens: number }).budget_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("requests dynamic max thinking budget for Gemini 2.5", () => {
    expect(buildThinkingParams({ model: "gemini-2.5-flash", protocol: "gemini-compatible", maxTokens: 4096 })).toEqual({
      generationConfig: { thinkingConfig: { thinkingBudget: -1 } },
    });
  });

  it("exposes a connection-test max_tokens high enough to survive reasoning", () => {
    expect(THINKING_TEST_MAX_TOKENS).toBeGreaterThanOrEqual(1024);
  });
});

describe("resolveThinkingEnabled (explicit override wins over name guess)", () => {
  it("falls back to name-based detection when no override is given", () => {
    expect(resolveThinkingEnabled("glm-4.6")).toBe(true);
    expect(resolveThinkingEnabled("gpt-4o-mini")).toBe(false);
    expect(resolveThinkingEnabled("glm-4.6", undefined)).toBe(true);
  });

  it("honors an explicit override regardless of the model name", () => {
    // user disables thinking on a model the heuristic thinks is a reasoner
    expect(resolveThinkingEnabled("glm-4.6", false)).toBe(false);
    // user enables thinking on a model the heuristic does not recognize
    expect(resolveThinkingEnabled("my-custom-reasoner-v2", true)).toBe(true);
  });
});

describe("buildThinkingParams explicit enabled override", () => {
  it("emits thinking params for an unrecognized model when enabled is true", () => {
    // name heuristic would say no, but the user marked it as a thinking model
    expect(
      buildThinkingParams({ model: "house-llm-7b", protocol: "openai-compatible", maxTokens: 4096, enabled: true }),
    ).toEqual({ thinking: { type: "enabled" } });
  });

  it("emits no thinking params when enabled is false even for a reasoning model", () => {
    expect(
      buildThinkingParams({ model: "glm-4.6", protocol: "openai-compatible", maxTokens: 4096, enabled: false }),
    ).toEqual({});
  });

  it("keeps OpenAI o-series mapping when enabled override is true", () => {
    expect(
      buildThinkingParams({ model: "o3-mini", protocol: "openai-compatible", maxTokens: 4096, enabled: true }),
    ).toEqual({ reasoning_effort: "high" });
  });
});
