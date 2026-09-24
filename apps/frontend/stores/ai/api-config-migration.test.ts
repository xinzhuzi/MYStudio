import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateAPIConfigState } from "./api-config-migration";
import { DEFAULT_LOCAL_TTS_MODEL, DEFAULT_LOCAL_TTS_PROVIDER_ID, DEFAULT_LOCAL_IMAGE_PROVIDER_ID } from "./api-config-provider-helpers";

describe("migrateAPIConfigState", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes ambiguous legacy platform bindings during v8 migration", () => {
    const result = migrateAPIConfigState({
      providers: [
        { id: "one", platform: "openai", name: "One", apiKey: "k", baseUrl: "https://one", model: ["m"] },
        { id: "two", platform: "openai", name: "Two", apiKey: "k", baseUrl: "https://two", model: ["m"] },
      ],
      featureBindings: { script_analysis: ["openai:m"] },
    }, 8);

    expect(result.featureBindings?.script_analysis).toBeNull();
  });

  it("restores the built-in local TTS provider and binding", () => {
    const result = migrateAPIConfigState({ providers: [], featureBindings: {} }, 16);

    expect(result.providers?.some((provider) => provider.id === DEFAULT_LOCAL_TTS_PROVIDER_ID)).toBe(true);
    expect(result.featureBindings?.tts).toEqual([`${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`]);
  });

  it("clears stale model discovery caches during v12 migration", () => {
    const result = migrateAPIConfigState({
      providers: [],
      featureBindings: {},
      modelEndpointTypes: { old: ["images"] },
      modelTypes: { old: "图像" },
      modelTags: { old: ["旧"] },
      modelEnableGroups: { old: ["legacy"] },
      discoveredModelLimits: { old: { maxOutput: 1, discoveredAt: 1 } },
    }, 12);

    expect(result).toMatchObject({
      modelEndpointTypes: {},
      modelTypes: {},
      modelTags: {},
      modelEnableGroups: {},
      discoveredModelLimits: {},
    });
  });

  it("normalizes a primitive persisted payload instead of spreading it", () => {
    expect(() => migrateAPIConfigState("malformed persisted state", 17)).not.toThrow();

    const result = migrateAPIConfigState(null, 17);
    expect(result.featureBindings?.tts).toEqual([
      `${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`,
    ]);
    expect(result.providers?.some((provider) => provider.id === DEFAULT_LOCAL_TTS_PROVIDER_ID)).toBe(true);
  });

  it("drops malformed provider and feature-binding entries during legacy migration", () => {
    const result = migrateAPIConfigState({
      providers: "not-an-array",
      featureBindings: {
        script_analysis: ["openai:m", null, 42],
      },
    }, 8);

    expect(result.providers).toEqual([
      expect.objectContaining({ id: DEFAULT_LOCAL_IMAGE_PROVIDER_ID }),
      expect.objectContaining({ id: DEFAULT_LOCAL_TTS_PROVIDER_ID }),
    ]);
    expect(result.modelEndpointTypes?.["qwen-image-edit-2511"]).toEqual(["image-generation"]);
    expect(result.featureBindings?.script_analysis).toEqual(["openai:m"]);
  });

  // 0924 C1 专项:盘上 version=18(v2 密文水合后的稳态)进来时,链上所有
  // version<=N(N≤17)均不命中,final normalization 照跑,不抛——直接透传。
  it("passes version-18 payloads through without schema migration while still running final normalization", () => {
    const persisted = {
      providers: [
        { id: "p1", platform: "custom", name: "中转站", apiKey: "sk-live", baseUrl: "https://relay", model: ["m"] },
      ],
      apiKeys: { openai: "sk-legacy" },
      featureBindings: {},
      modelThinkingOverrides: { "custom:m": true },
    };
    const result = migrateAPIConfigState(persisted, 18);
    // schema 零改:自定义供应商原样保留(normalization 只会追加默认本地供应商)
    expect(result.providers?.find((provider) => provider.id === "p1")).toEqual(persisted.providers[0]);
    expect(result.apiKeys).toEqual({ openai: "sk-legacy" }); // 明文键表不经 normalization
    expect(result.modelThinkingOverrides).toEqual({ "custom:m": true });
    // final normalization 恒跑:featureBindings 补齐默认键 + 默认本地供应商在位
    expect(result.featureBindings?.tts).toEqual([
      `${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`,
    ]);
    expect(result.providers?.some((provider) => provider.id === DEFAULT_LOCAL_TTS_PROVIDER_ID)).toBe(true);
    expect(() => migrateAPIConfigState(null, 18)).not.toThrow();
  });
});
