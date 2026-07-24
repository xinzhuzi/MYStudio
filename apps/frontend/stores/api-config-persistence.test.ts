import { describe, expect, it } from "vitest";
import type { APIConfigState } from "./api-config-store-types";
import {
  API_CONFIG_PERSIST_VERSION,
  API_CONFIG_STORAGE_KEY,
  partializeAPIConfigState,
} from "./api-config-persistence";

describe("API config persistence contract", () => {
  it("keeps the stable key and version", () => {
    expect(API_CONFIG_STORAGE_KEY).toBe("opencut-api-config");
    expect(API_CONFIG_PERSIST_VERSION).toBe(17);
  });

  it("persists only the established state fields", () => {
    const state = {
      providers: [],
      agentUseMode: "simple",
      agentDeployments: [],
      providerAdapterCodes: [],
      studioBindingsMigrated: false,
      featureBindings: {},
      apiKeys: {},
      concurrency: 1,
      aspectRatio: "16:9",
      orientation: "landscape",
      advancedOptions: {
        enableVisualContinuity: true,
        enableResumeGeneration: true,
        enableContentModeration: true,
        enableAutoModelSwitch: false,
      },
      imageHostProviders: [],
      modelEndpointTypes: {},
      modelTypes: {},
      modelTags: {},
      modelEnableGroups: {},
      discoveredModelLimits: {},
      modelThinkingOverrides: {},
      transientAction: () => undefined,
    } as unknown as APIConfigState & { transientAction: () => void };

    expect(Object.keys(partializeAPIConfigState(state))).toEqual([
      "providers", "agentUseMode", "agentDeployments", "providerAdapterCodes",
      "studioBindingsMigrated", "featureBindings", "apiKeys", "concurrency",
      "aspectRatio", "orientation", "advancedOptions", "imageHostProviders",
      "modelEndpointTypes", "modelTypes", "modelTags", "modelEnableGroups",
      "discoveredModelLimits", "modelThinkingOverrides",
    ]);
  });
});
