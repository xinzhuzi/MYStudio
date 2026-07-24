import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_AGENT_DEPLOYMENT_GROUPS,
  API_AGENT_DEPLOYMENT_DEFAULTS,
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
  createDefaultFeatureBindings,
  createDefaultLocalTtsProvider,
  createDefaultAgentDeployments,
  getAgentDeploymentModelType,
  useAPIConfigStore,
  validateProviderAdapterCodeText,
} from "./api-config-store";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/constants";

describe("useAPIConfigStore unified model configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useAPIConfigStore.setState({
      providers: [
        {
          id: "provider-1",
          platform: "custom",
          name: "OpenAI 兼容中转站",
          baseUrl: "https://relay.example.com/v1",
          apiKey: "sk-test",
          model: ["gpt-4o-mini", "flux-test", "veo-test", "voice-test"],
          capabilities: ["text", "image_generation", "video_generation"],
        },
      ],
      agentUseMode: "advanced",
      agentDeployments: createDefaultAgentDeployments(),
      providerAdapterCodes: [],
      studioBindingsMigrated: false,
    });
  });

  it("ships Toonflow-style default agent deployment keys", () => {
    expect(API_AGENT_DEPLOYMENT_DEFAULTS.map((item) => item.key)).toEqual([
      "universalAi",
      "eventAnalysisAgent",
      "entityExtraction",
      "episodeOutline",
      "scriptAgent",
      "scriptAgent:decisionAgent",
      "scriptAgent:storySkeletonAgent",
      "scriptAgent:adaptationStrategyAgent",
      "scriptAgent:scriptAgent",
      "scriptAgent:supervisionAgent",
      "productionAgent:decisionAgent",
      "productionAgent:directorPlanAgent",
      "productionAgent:storyboardGenAgent",
      "productionAgent:storyboardPanelAgent",
      "productionAgent:storyboardTableAgent",
      "productionAgent:deriveAssetsAgent",
      "productionAgent:generateAssetsAgent",
      "productionAgent:supervisionAgent",
      "storySkeletonAgent",
      "adaptationStrategyAgent",
      "scriptDraft",
      "storyboardImage",
      "videoTrack",
      "tts",
    ]);
  });

  it("groups Toonflow-style agent deployments by workflow stage", () => {
    expect(API_AGENT_DEPLOYMENT_GROUPS.map((group) => group.label)).toEqual([
      "通用与兜底",
      "小说理解",
      "策划编剧",
      "制作规划",
      "多模态执行",
    ]);
    const groupedKeys = API_AGENT_DEPLOYMENT_GROUPS.flatMap((group) => group.keys);
    const defaultKeys = API_AGENT_DEPLOYMENT_DEFAULTS.map((item) => item.key);
    expect(new Set(groupedKeys)).toEqual(new Set(defaultKeys));
    expect(groupedKeys).toHaveLength(defaultKeys.length);
  });

  it("declares the required model type for each agent deployment", () => {
    expect(getAgentDeploymentModelType("eventAnalysisAgent")).toBe("text");
    expect(getAgentDeploymentModelType("scriptAgent:storySkeletonAgent")).toBe("text");
    expect(getAgentDeploymentModelType("productionAgent:storyboardTableAgent")).toBe("text");
    expect(getAgentDeploymentModelType("storyboardImage")).toBe("image");
    expect(getAgentDeploymentModelType("videoTrack")).toBe("video");
    expect(getAgentDeploymentModelType("tts")).toBe("tts");
  });

  it("resolves task bindings from the unified API provider store", () => {
    useAPIConfigStore.getState().setAgentDeployment({
      key: "scriptAgent",
      modelId: "gpt-4o-mini",
      vendorId: "provider-1",
      temperature: 0.4,
    });

    const resolved = useAPIConfigStore.getState().getResolvedAgentModel("scriptAgent");

    expect(resolved?.provider.id).toBe("provider-1");
    expect(resolved?.model).toBe("gpt-4o-mini");
    expect(resolved?.deployment.temperature).toBe(0.4);
  });

  it("uses universalAi as the simple-mode fallback for workflow agents", () => {
    useAPIConfigStore.getState().setAgentDeployment({
      key: "universalAi",
      modelId: "gpt-4o-mini",
      vendorId: "provider-1",
    });
    useAPIConfigStore.getState().setAgentUseMode("simple");

    const resolved = useAPIConfigStore.getState().getResolvedAgentModel("scriptDraft");

    expect(resolved?.deployment.key).toBe("universalAi");
    expect(resolved?.model).toBe("gpt-4o-mini");
  });

  it("does not use a text universal fallback for multimodal execution agents", () => {
    useAPIConfigStore.getState().setAgentDeployment({
      key: "universalAi",
      modelId: "gpt-4o-mini",
      vendorId: "provider-1",
    });
    useAPIConfigStore.getState().setAgentUseMode("simple");

    expect(useAPIConfigStore.getState().getResolvedAgentModel("storyboardImage")).toBeNull();
    expect(useAPIConfigStore.getState().getResolvedAgentModel("videoTrack")).toBeNull();
    expect(useAPIConfigStore.getState().getResolvedAgentModel("tts")).toBeNull();
  });

  it("ships the TTS agent deployment on the built-in local backend", () => {
    useAPIConfigStore.setState({
      providers: [createDefaultLocalTtsProvider()],
      agentDeployments: createDefaultAgentDeployments(),
      agentUseMode: "advanced",
    });

    const resolved = useAPIConfigStore.getState().getResolvedAgentModel("tts");

    expect(resolved).toMatchObject({
      provider: {
        id: DEFAULT_LOCAL_TTS_PROVIDER_ID,
        baseUrl: LOCAL_TTS_BASE_URL,
      },
      model: DEFAULT_LOCAL_TTS_MODEL,
    });
  });

  it("binds TTS to the built-in local backend by default without requiring an API key", () => {
    useAPIConfigStore.setState({
      providers: [createDefaultLocalTtsProvider()],
      featureBindings: createDefaultFeatureBindings(),
    });

    const ttsProviders = useAPIConfigStore.getState().getProvidersForFeature("tts");

    expect(useAPIConfigStore.getState().getFeatureBindings("tts")).toEqual([
      `${DEFAULT_LOCAL_TTS_PROVIDER_ID}:${DEFAULT_LOCAL_TTS_MODEL}`,
    ]);
    expect(ttsProviders).toEqual([
      {
        provider: expect.objectContaining({
          id: DEFAULT_LOCAL_TTS_PROVIDER_ID,
          platform: "manying-local-tts",
          baseUrl: LOCAL_TTS_BASE_URL,
          apiKey: "",
        }),
        model: DEFAULT_LOCAL_TTS_MODEL,
      },
    ]);
  });

  it("migrates old studio workflow bindings into agentDeployments once", () => {
    const first = useAPIConfigStore.getState().migrateStudioBindings([
      { key: "scriptAgent", modelId: "provider-1:gpt-4o-mini" },
      { key: "videoTrack", modelId: "provider-1:veo-test" },
    ]);
    const second = useAPIConfigStore.getState().migrateStudioBindings([
      { key: "scriptAgent", modelId: "provider-1:gpt-4o-mini" },
    ]);

    expect(first).toEqual({ migrated: true, count: 2 });
    expect(second).toEqual({ migrated: false, count: 0 });
    expect(useAPIConfigStore.getState().getResolvedAgentModel("videoTrack")?.model).toBe("veo-test");
  });

  it("removes provider references from bindings, agent deployments, and adapter code", () => {
    useAPIConfigStore.getState().setFeatureBindings("script_analysis", ["provider-1:gpt-4o-mini"]);
    useAPIConfigStore.getState().setAgentDeployment({
      key: "scriptAgent",
      vendorId: "provider-1",
      modelId: "gpt-4o-mini",
    });
    useAPIConfigStore.getState().upsertProviderAdapterCode("provider-1", `export const adapter = {};
/* mystudio-vendor-json
{
  "vendor": { "id": "provider-1" },
  "models": [{ "modelName": "gpt-4o-mini", "type": "text" }]
}
*/`);

    useAPIConfigStore.getState().removeProvider("provider-1");

    const state = useAPIConfigStore.getState();
    expect(state.providers).toHaveLength(0);
    expect(state.getFeatureBindings("script_analysis")).toEqual([]);
    expect(state.providerAdapterCodes).toHaveLength(0);
    expect(state.agentDeployments.find((item) => item.key === "scriptAgent")).toMatchObject({
      vendorId: undefined,
      modelId: undefined,
    });
  });

  it("validates configured models without importing unrelated upstream catalog entries", async () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "provider-1",
        platform: "custom",
        name: "Image Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      }],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "gpt-image-2", supported_endpoint_types: ["image-generation"] },
        { id: "gpt-5.4" },
        { id: "sora-2" },
      ],
    }), { status: 200 }));

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toEqual({ success: true, count: 1 });
    expect(useAPIConfigStore.getState().providers[0].model).toEqual(["gpt-image-2"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-image-2"]).toEqual(["image-generation"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-5.4"]).toBeUndefined();
  });

  it("refuses model synchronization when no explicit model is configured", async () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "provider-1",
        platform: "custom",
        name: "Image Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: [],
      }],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toMatchObject({ success: false, count: 0 });
    expect(result.error).toContain("请先填写模型");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useAPIConfigStore.getState().providers[0].model).toEqual([]);
  });

  it("reports exact configured models missing from the upstream catalog without mutation", async () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "provider-1",
        platform: "custom",
        name: "Image Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2", "private-image-model"],
      }],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "gpt-image-2" }, { id: "unrelated-model" }],
    }), { status: 200 }));

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toMatchObject({ success: false, count: 0 });
    expect(result.error).toContain("private-image-model");
    expect(useAPIConfigStore.getState().providers[0].model).toEqual(["gpt-image-2", "private-image-model"]);
  });

  it("validates provider adapter code without executing it", () => {
    const valid = validateProviderAdapterCodeText(`export const adapter = {};
/* mystudio-vendor-json
{
  "vendor": { "id": "relay", "name": "Relay", "baseUrl": "https://relay.example.com/v1" },
  "models": [
    { "modelName": "gpt-4o-mini", "type": "text" },
    { "modelName": "veo-test", "type": "video" }
  ]
}
*/`);

    expect(valid.ok).toBe(true);
    expect(valid.models.map((model) => model.modelName)).toEqual(["gpt-4o-mini", "veo-test"]);
  });

  it("reports adapter code shape problems clearly", () => {
    expect(validateProviderAdapterCodeText(`/* mystudio-vendor-json {"models": []} */`)).toMatchObject({
      ok: false,
      reason: "缺少 vendor",
    });

    expect(validateProviderAdapterCodeText(`/* mystudio-vendor-json
{
  "vendor": { "id": "relay" },
  "models": [{ "modelName": "bad-model", "type": "audio" }]
}
*/`)).toMatchObject({
      ok: false,
      reason: "模型类型无效: audio",
    });

    expect(validateProviderAdapterCodeText(`/* mystudio-vendor-json
{
  "vendor": { "id": "relay" },
  "models": [
    { "modelName": "same", "type": "text" },
    { "modelName": "same", "type": "text" }
  ]
}
*/`)).toMatchObject({
      ok: false,
      reason: "模型名称重复: same",
    });
  });
});

describe("per-model thinking-mode overrides", () => {
  beforeEach(() => {
    useAPIConfigStore.setState({ modelThinkingOverrides: {} });
  });

  it("returns undefined when no override is configured", () => {
    expect(useAPIConfigStore.getState().getModelThinkingOverride("glm-4.6")).toBeUndefined();
  });

  it("persists an explicit per-model thinking override", () => {
    useAPIConfigStore.getState().setModelThinkingOverride("glm-4.6", false);
    expect(useAPIConfigStore.getState().getModelThinkingOverride("glm-4.6")).toBe(false);

    useAPIConfigStore.getState().setModelThinkingOverride("house-llm", true);
    expect(useAPIConfigStore.getState().getModelThinkingOverride("house-llm")).toBe(true);
  });

  it("clears an override when set to undefined (reverts to auto-detection)", () => {
    useAPIConfigStore.getState().setModelThinkingOverride("glm-4.6", false);
    useAPIConfigStore.getState().setModelThinkingOverride("glm-4.6", undefined);
    expect(useAPIConfigStore.getState().getModelThinkingOverride("glm-4.6")).toBeUndefined();
  });
});

describe("getAllConfigs API key masking", () => {
  it("prefers the resolved v2 provider key over legacy apiKeys", () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "memefast-v2",
        platform: "memefast",
        name: "MemeFast v2",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "v2-secret-key",
        model: [],
      }],
      apiKeys: { memefast: "legacy-secret-key" },
    });

    const config = useAPIConfigStore.getState().getAllConfigs().find((item) => item.provider === "memefast");

    expect(config).toMatchObject({ configured: true, masked: "v2-secre...-key" });
  });

  it("falls back to legacy apiKeys when no v2 provider is resolved", () => {
    useAPIConfigStore.setState({ providers: [], apiKeys: { memefast: "legacy-secret-key" } });

    const config = useAPIConfigStore.getState().getAllConfigs().find((item) => item.provider === "memefast");

    expect(config).toMatchObject({ configured: true, masked: "legacy-s...-key" });
  });
});
