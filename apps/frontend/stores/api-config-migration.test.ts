import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateAPIConfigState } from "./api-config-migration";
import { DEFAULT_LOCAL_TTS_MODEL, DEFAULT_LOCAL_TTS_PROVIDER_ID } from "./api-config-provider-helpers";

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
});
