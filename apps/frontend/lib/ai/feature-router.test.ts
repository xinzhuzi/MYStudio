import { afterEach, describe, expect, it, vi } from "vitest";

const callChatAPI = vi.fn().mockResolvedValue("OK");
vi.mock("@/lib/script/script-parser", () => ({
  callChatAPI: (...args: unknown[]) => callChatAPI(...args),
}));

import { callFeatureAPI, type FeatureConfig } from "./feature-router";
import { ApiKeyManager } from "@/lib/api-key-manager";
import { useAPIConfigStore } from "@/stores/api-config-store";

function configOverride(model: string): FeatureConfig {
  return {
    feature: "script_analysis",
    featureName: "剧本分析",
    provider: {
      id: "provider-1",
      platform: "custom",
      name: "Relay",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-test",
      model: [model],
    } as FeatureConfig["provider"],
    apiKey: "sk-test",
    allApiKeys: ["sk-test"],
    keyManager: new ApiKeyManager("sk-test"),
    platform: "custom",
    baseUrl: "https://relay.example.com/v1",
    models: [model],
    model,
  };
}

describe("callFeatureAPI thinking default", () => {
  afterEach(() => {
    callChatAPI.mockClear();
    useAPIConfigStore.setState({ modelThinkingOverrides: {} });
  });

  it("no longer force-disables thinking by default (lets callChatAPI auto-decide)", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    const opts = callChatAPI.mock.calls.at(-1)![2] as { disableThinking?: boolean };
    expect(opts.disableThinking).not.toBe(true);
  });

  it("still honors an explicit disableThinking override", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
      disableThinking: true,
    });

    const opts = callChatAPI.mock.calls.at(-1)![2] as { disableThinking?: boolean };
    expect(opts.disableThinking).toBe(true);
  });

  it("passes the per-model thinking override from the store into callChatAPI", async () => {
    useAPIConfigStore.getState().setModelThinkingOverride("house-llm-7b", true);

    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("house-llm-7b"),
    });

    const opts = callChatAPI.mock.calls.at(-1)![2] as { thinkingEnabled?: boolean };
    expect(opts.thinkingEnabled).toBe(true);
  });

  it("leaves thinkingEnabled undefined when no override is configured", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    const opts = callChatAPI.mock.calls.at(-1)![2] as { thinkingEnabled?: boolean };
    expect(opts.thinkingEnabled).toBeUndefined();
  });
});
