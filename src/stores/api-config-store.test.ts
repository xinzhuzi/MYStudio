import { beforeEach, describe, expect, it } from "vitest";
import {
  API_AGENT_DEPLOYMENT_DEFAULTS,
  createDefaultAgentDeployments,
  useAPIConfigStore,
  validateProviderAdapterCodeText,
} from "./api-config-store";

describe("useAPIConfigStore unified model configuration", () => {
  beforeEach(() => {
    useAPIConfigStore.setState({
      providers: [
        {
          id: "provider-1",
          platform: "custom",
          name: "OpenAI 兼容中转站",
          baseUrl: "https://relay.example.com/v1",
          apiKey: "sk-test",
          model: ["gpt-4o-mini", "veo-test"],
          capabilities: ["text", "video_generation"],
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
      "scriptAgent",
      "storySkeletonAgent",
      "adaptationStrategyAgent",
      "scriptDraft",
      "videoTrack",
      "tts",
    ]);
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
