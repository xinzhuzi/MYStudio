import { afterEach, describe, expect, it, vi } from "vitest";

const sdkGenerateText = vi.fn().mockResolvedValue({ success: true, text: "OK" });
const callChatAPI = vi.fn().mockResolvedValue("FALLBACK_OK");
vi.mock("@/lib/ai/ai-sdk-bridge", () => ({
  sdkGenerateText: (...args: unknown[]) => sdkGenerateText(...args),
  getLanguageModel: vi.fn(),
}));
vi.mock("@/lib/script/script-parser", () => ({
  callChatAPI: (...args: unknown[]) => callChatAPI(...args),
}));

import {
  callFeatureAPI,
  getFeatureConfig,
  getFeatureNotConfiguredMessage,
  resetFeatureRoundRobin,
  type FeatureConfig,
} from "./feature-router";
import { ApiKeyManager } from "@/lib/api-key-manager";
import {
  createDefaultFeatureBindings,
  useAPIConfigStore,
  type IProvider,
} from "@/stores/api-config-store";

type SdkGenerateTextInput = {
  provider: {
    baseUrl: string;
    apiKey: string;
    platform: string;
    name: string;
  };
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

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

function provider(id: string, model: string, platform = "custom"): IProvider {
  return {
    id,
    platform,
    name: id,
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: "sk-test",
    model: [model],
  };
}

function resetAPIConfigStore(): void {
  resetFeatureRoundRobin();
  useAPIConfigStore.setState({
    providers: [],
    featureBindings: createDefaultFeatureBindings(),
    modelThinkingOverrides: {},
  });
}

describe("callFeatureAPI thinking default", () => {
  afterEach(() => {
    callChatAPI.mockClear();
    sdkGenerateText.mockClear();
    resetAPIConfigStore();
  });

  it("no longer force-disables thinking by default (lets callChatAPI auto-decide)", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as { providerOptions?: Record<string, unknown> };
    expect(opts.providerOptions).toEqual({
      openaiCompatible: { thinking: { type: "enabled" } },
      "openai-compatible": { thinking: { type: "enabled" } },
    });
    expect(callChatAPI).not.toHaveBeenCalled();
  });

  it("still honors an explicit disableThinking override", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
      disableThinking: true,
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as { providerOptions?: Record<string, unknown> };
    expect(opts.providerOptions).toEqual({
      openaiCompatible: { thinking: { type: "disabled" } },
      "openai-compatible": { thinking: { type: "disabled" } },
    });
  });

  it("passes the per-model thinking override from the store into callChatAPI", async () => {
    useAPIConfigStore.getState().setModelThinkingOverride("house-llm-7b", true);

    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("house-llm-7b"),
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as { providerOptions?: Record<string, unknown> };
    expect(opts.providerOptions).toEqual({
      openaiCompatible: { thinking: { type: "enabled" } },
      "openai-compatible": { thinking: { type: "enabled" } },
    });
  });

  it("leaves thinkingEnabled undefined when no override is configured", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as { providerOptions?: Record<string, unknown> };
    expect(opts.providerOptions).toEqual({
      openaiCompatible: { thinking: { type: "enabled" } },
      "openai-compatible": { thinking: { type: "enabled" } },
    });
  });
});

describe("feature router configuration selection", () => {
  afterEach(() => {
    callChatAPI.mockClear();
    sdkGenerateText.mockClear();
    resetAPIConfigStore();
  });

  it("falls back prop generation through scene generation to character generation", () => {
    useAPIConfigStore.setState({
      providers: [provider("characters", "character-model")],
      featureBindings: {
        ...createDefaultFeatureBindings(),
        character_generation: ["characters:character-model"],
        scene_generation: null,
        prop_generation: null,
      },
    });

    const config = getFeatureConfig("prop_generation");

    expect(config).toMatchObject({
      feature: "prop_generation",
      featureName: "道具生成",
      platform: "custom",
      model: "character-model",
    });
    expect(config?.provider.id).toBe("characters");
  });

  it("round-robins multiple bindings and supports feature-scoped reset", () => {
    useAPIConfigStore.setState({
      providers: [provider("provider-1", "model-1"), provider("provider-2", "model-2")],
      featureBindings: {
        ...createDefaultFeatureBindings(),
        chat: ["provider-1:model-1", "provider-2:model-2"],
      },
    });

    expect(getFeatureConfig("chat")?.model).toBe("model-1");
    expect(getFeatureConfig("chat")?.model).toBe("model-2");
    expect(getFeatureConfig("chat")?.model).toBe("model-1");

    resetFeatureRoundRobin("chat");

    expect(getFeatureConfig("chat")?.model).toBe("model-1");
  });

  it("falls back to the default memefast provider when chat has no explicit binding", () => {
    useAPIConfigStore.setState({
      providers: [provider("memefast-provider", "fallback-model", "memefast")],
      featureBindings: {
        ...createDefaultFeatureBindings(),
        chat: null,
      },
    });

    const config = getFeatureConfig("chat");

    expect(config).toMatchObject({
      feature: "chat",
      featureName: "通用对话",
      platform: "memefast",
      model: "fallback-model",
    });
    expect(config?.provider.id).toBe("memefast-provider");
  });

  it("uses the image-understanding default model on the memefast fallback path", () => {
    useAPIConfigStore.setState({
      providers: [provider("memefast-provider", "provider-model", "memefast")],
      featureBindings: {
        ...createDefaultFeatureBindings(),
        image_understanding: null,
      },
    });

    const config = getFeatureConfig("image_understanding");

    expect(config).toMatchObject({
      feature: "image_understanding",
      featureName: "图片理解",
      platform: "memefast",
      model: "gemini-3.1-pro-preview",
      models: ["provider-model"],
    });
  });

  it("returns the localized unconfigured message for chat", () => {
    expect(getFeatureNotConfiguredMessage("chat")).toBe("请先在设置中为「通用对话」功能绑定 API 供应商");
  });
});

describe("callFeatureAPI configuration validation", () => {
  afterEach(() => {
    callChatAPI.mockClear();
    sdkGenerateText.mockClear();
    resetAPIConfigStore();
  });

  it("rejects an empty base URL before calling any API", async () => {
    await expect(
      callFeatureAPI("script_analysis", "sys", "user", {
        configOverride: {
          ...configOverride("glm-4.6"),
          baseUrl: "///",
        },
      }),
    ).rejects.toThrow("请先在设置中配置 Base URL");

    expect(sdkGenerateText).not.toHaveBeenCalled();
    expect(callChatAPI).not.toHaveBeenCalled();
  });

  it("rejects a missing model before calling any API", async () => {
    await expect(
      callFeatureAPI("script_analysis", "sys", "user", {
        configOverride: {
          ...configOverride(""),
          models: [],
          model: "",
        },
      }),
    ).rejects.toThrow("请先在设置中配置模型");

    expect(sdkGenerateText).not.toHaveBeenCalled();
    expect(callChatAPI).not.toHaveBeenCalled();
  });

  it("rejects an unbound feature with the localized feature name", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(callFeatureAPI("script_analysis", "sys", "user")).rejects.toThrow(
      "请先在设置中为「剧本分析」功能绑定 API 供应商",
    );

    expect(warnSpy).toHaveBeenCalledWith("[FeatureRouter] No provider bound for feature: script_analysis");
    expect(sdkGenerateText).not.toHaveBeenCalled();
    expect(callChatAPI).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("trims the base URL and lets modelOverride win in the SDK request", async () => {
    await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: {
        ...configOverride("base-model"),
        baseUrl: "https://relay.example.com/v1///",
      },
      modelOverride: "override-model",
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as SdkGenerateTextInput;
    expect(opts.provider.baseUrl).toBe("https://relay.example.com/v1");
    expect(opts.model).toBe("override-model");
    expect(opts.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
    expect(callChatAPI).not.toHaveBeenCalled();
  });

  it("falls back to callChatAPI when the SDK returns an empty result", async () => {
    sdkGenerateText.mockResolvedValueOnce({ success: false, text: "" });

    const result = await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    expect(result).toBe("FALLBACK_OK");
    expect(callChatAPI).toHaveBeenCalledWith(
      "sys",
      "user",
      expect.objectContaining({
        apiKey: "sk-test",
        provider: "openai",
        baseUrl: "https://relay.example.com/v1",
        model: "glm-4.6",
      }),
    );
  });

  it("falls back to callChatAPI when the SDK throws", async () => {
    sdkGenerateText.mockRejectedValueOnce(new Error("sdk failed"));

    const result = await callFeatureAPI("script_analysis", "sys", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    expect(result).toBe("FALLBACK_OK");
    expect(callChatAPI).toHaveBeenCalledTimes(1);
  });

  it("omits an empty system prompt from SDK messages", async () => {
    await callFeatureAPI("script_analysis", "", "user", {
      configOverride: configOverride("glm-4.6"),
    });

    const opts = sdkGenerateText.mock.calls.at(-1)![0] as SdkGenerateTextInput;
    expect(opts.messages).toEqual([{ role: "user", content: "user" }]);
    expect(callChatAPI).not.toHaveBeenCalled();
  });
});
