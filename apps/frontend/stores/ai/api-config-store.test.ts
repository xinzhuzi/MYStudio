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
import { partializeAPIConfigState } from "./api-config-persistence";
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

  it("merges the upstream catalog into configured models on sync", async () => {
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

    expect(result).toEqual({ success: true, count: 3 });
    expect(useAPIConfigStore.getState().providers[0].model).toEqual(["gpt-image-2", "gpt-5.4", "sora-2"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-image-2"]).toEqual(["image-generation"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-5.4"]).toBeUndefined();
  });

  it("unions catalogs across all configured keys including models only visible to a later key", async () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "provider-1",
        platform: "custom",
        name: "凡人",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-key-text-only, sk-key-with-image",
        model: ["gpt-5.6-terra"],
      }],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      const catalog = authorization.includes("sk-key-with-image")
        ? { data: [{ id: "gpt-image-2" }, { id: "gpt-image-2-4k" }] }
        : { data: [{ id: "gpt-5.6-terra" }, { id: "codex-auto-review" }] };
      return new Response(JSON.stringify(catalog), { status: 200 });
    });

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toEqual({ success: true, count: 4 });
    expect(useAPIConfigStore.getState().providers[0].model).toEqual([
      "gpt-5.6-terra",
      "codex-auto-review",
      "gpt-image-2",
      "gpt-image-2-4k",
    ]);
  });

  it("discovers and imports the full provider catalog when no model is configured", async () => {
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "gpt-image-2", supported_endpoint_types: ["image-generation"] },
        { id: "gpt-5.4" },
      ],
    }), { status: 200 }));

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toEqual({ success: true, count: 2 });
    expect(useAPIConfigStore.getState().providers[0].model).toEqual(["gpt-image-2", "gpt-5.4"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-image-2"]).toEqual(["image-generation"]);
    expect(useAPIConfigStore.getState().modelEndpointTypes["gpt-5.4"]).toBeUndefined();
  });

  it("keeps configured models absent from the catalog while merging new entries", async () => {
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "gpt-image-2" }, { id: "unrelated-model" }],
    }), { status: 200 }));

    const result = await useAPIConfigStore.getState().syncProviderModels("provider-1");

    expect(result).toMatchObject({ success: true, count: 3 });
    expect(useAPIConfigStore.getState().providers[0].model).toEqual(["gpt-image-2", "private-image-model", "unrelated-model"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("private-image-model"));
    warnSpy.mockRestore();
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

// ── 0924 C1 专项(§6.4):safeStorage 加密落盘——CRUD 六操作锚 + 竞态锚 1/2/2b ──
// 前置(计划 §6.4):fake 桥注入(vi.stubGlobal window.secureStorage,返回 Promise
// 模拟 IPC 异步时序);断盘前 vi.waitFor flush;水合驱动用公开 API
// persist.rehydrate();盘锚一律双断言(v2 标记 + 全文不含明文密钥子串 + 解密往返)。
// 只 mock safeStorage 系统调用本身,被测的 store/persist/适配器链路零 mock。
describe("useAPIConfigStore safeStorage persistence (C1)", () => {
  const fakeEncode = (plaintext: string) => Buffer.from(`fake-cipher:${plaintext}`).toString("base64");
  const fakeDecode = (cipher: string) => {
    const text = Buffer.from(cipher, "base64").toString("utf8");
    return text.startsWith("fake-cipher:") ? text.slice("fake-cipher:".length) : null;
  };
  const decryptDisk = (): { state: Record<string, unknown>; version: number } => {
    const raw = localStorage.getItem("opencut-api-config");
    if (!raw) throw new Error("盘上无值");
    const parsed = JSON.parse(raw);
    if (parsed.v === 2) return JSON.parse(fakeDecode(parsed.cipher) as string);
    return parsed;
  };
  const readDiskRaw = () => localStorage.getItem("opencut-api-config");

  interface BridgeControl {
    encryptCalls: string[];
    releaseAvailability: () => void;
    releaseDecrypt: () => void;
  }

  function installFakeBridge(options?: { delayAvailability?: boolean; delayDecrypt?: boolean }): BridgeControl {
    const control: BridgeControl = {
      encryptCalls: [],
      releaseAvailability: () => undefined,
      releaseDecrypt: () => undefined,
    };
    let availabilityGate: () => void = () => undefined;
    let decryptGate: () => void = () => undefined;
    if (options?.delayAvailability) {
      control.releaseAvailability = () => availabilityGate();
    }
    if (options?.delayDecrypt) {
      control.releaseDecrypt = () => decryptGate();
    }
    vi.stubGlobal("window", {
      secureStorage: {
        isEncryptionAvailable: () =>
          options?.delayAvailability
            ? new Promise((resolve) => {
                availabilityGate = () => resolve({ ok: true as const, available: true });
              })
            : Promise.resolve({ ok: true as const, available: true }),
        encrypt: async (plaintext: string) => {
          control.encryptCalls.push(plaintext);
          return { ok: true as const, cipher: fakeEncode(plaintext) };
        },
        decrypt: (cipher: string) => {
          const plaintext = fakeDecode(cipher);
          const reply =
            plaintext === null
              ? { ok: false as const, reason: "error" }
              : { ok: true as const, plaintext };
          if (!options?.delayDecrypt) return Promise.resolve(reply);
          return new Promise((resolve) => {
            decryptGate = () => resolve(reply);
          });
        },
      },
    });
    return control;
  }

  const flushTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    // 等一拍让既有 fire-and-forget setItem 全部落定,再清盘,防跨用例污染(§6.4 前置 3)
    await flushTick();
    localStorage.removeItem("opencut-api-config");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("增:setApiKey 落盘为 v2 密文且不含明文键值;解密往返与内存全量态深相等", async () => {
    installFakeBridge();
    useAPIConfigStore.getState().setApiKey("openai", "sk-c1-增键");
    await vi.waitFor(() => {
      expect(readDiskRaw()).toContain('"v":2');
    });
    const raw = readDiskRaw() as string;
    expect(raw).not.toContain("sk-c1-增键");
    await vi.waitFor(() => {
      // 每拍新鲜解密(最终写落定前可能读到中间写)
      const decrypted = decryptDisk();
      expect(decrypted.state.apiKeys).toMatchObject({ openai: "sk-c1-增键" });
      expect(decrypted.state).toEqual(partializeAPIConfigState(useAPIConfigStore.getState()));
    });
  });

  it("删:clearApiKey 后盘上密文解密不含该键", async () => {
    installFakeBridge();
    useAPIConfigStore.getState().setApiKey("openai", "sk-c1-待删");
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));
    useAPIConfigStore.getState().clearApiKey("openai");
    await vi.waitFor(() => {
      // 断「该键已从盘上消失」(共享 store 内存可能残留其他 describe 的 legacy 键)
      expect(decryptDisk().state.apiKeys).not.toHaveProperty("openai");
    });
    expect(readDiskRaw()).not.toContain("sk-c1-待删");
  });

  it("改:updateProvider 换 key 后往返解密得新 key 且盘上无旧明文", async () => {
    installFakeBridge();
    const added = useAPIConfigStore.getState().addProvider({
      platform: "custom",
      name: "C1 改键供应商",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-c1-旧键",
      model: ["m"],
    });
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));
    useAPIConfigStore.getState().updateProvider({ ...added, apiKey: "sk-c1-新键" });
    await vi.waitFor(() => {
      const state = decryptDisk().state as { providers: Array<{ id: string; apiKey: string }> };
      expect(state.providers.find((provider) => provider.id === added.id)?.apiKey).toBe("sk-c1-新键");
    });
    const raw = readDiskRaw() as string;
    expect(raw).not.toContain("sk-c1-旧键");
    expect(raw).not.toContain("sk-c1-新键");
  });

  it("删:removeProvider 后解密结果无该 provider", async () => {
    installFakeBridge();
    const added = useAPIConfigStore.getState().addProvider({
      platform: "custom",
      name: "C1 删供应商",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-c1-随删",
      model: ["m"],
    });
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));
    useAPIConfigStore.getState().removeProvider(added.id);
    await vi.waitFor(() => {
      const state = decryptDisk().state as { providers: Array<{ id: string }> };
      expect(state.providers.some((provider) => provider.id === added.id)).toBe(false);
    });
    expect(readDiskRaw()).not.toContain("sk-c1-随删");
  });

  it("销毁:clearAllApiKeys 后解密盘值所有 apiKey 为空串", async () => {
    installFakeBridge();
    useAPIConfigStore.getState().setApiKey("openai", "sk-c1-清场");
    const added = useAPIConfigStore.getState().addProvider({
      platform: "custom",
      name: "C1 清场供应商",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-c1-供应商键",
      model: ["m"],
    });
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));
    useAPIConfigStore.getState().clearAllApiKeys();
    await vi.waitFor(() => {
      const state = decryptDisk().state as {
        apiKeys: Record<string, string>;
        providers: Array<{ apiKey: string }>;
      };
      expect(state.apiKeys).toEqual({});
      expect(state.providers.map((provider) => provider.apiKey)).toEqual(
        state.providers.map(() => ""),
      );
    });
    expect(readDiskRaw()).not.toContain("sk-c1-清场");
    expect(readDiskRaw()).not.toContain("sk-c1-供应商键");
    expect(added.id).toBeTruthy();
  });

  // ── 竞态锚(rev3):fresh 模块 + 人为延迟 IPC,覆盖异步水合窗口 ──

  async function importFreshStore() {
    vi.resetModules();
    return await import("./api-config-store");
  }

  it("竞态锚1·稳态 v2 盘:水合窗口内竞态 set 两次,水合 settle 后盘值逐字节不变(门禁丢弃,无任何补写)", async () => {
    const control = installFakeBridge({ delayDecrypt: true });
    const seedState = {
      providers: [
        {
          id: "prov-stable",
          platform: "custom",
          name: "稳态供应商",
          baseUrl: "https://relay.example.com/v1",
          apiKey: "sk-c1-稳态键",
          model: ["m"],
        },
      ],
      apiKeys: { openai: "sk-c1-稳态legacy" },
      concurrency: 3,
    };
    const seed = JSON.stringify({
      v: 2,
      cipher: fakeEncode(JSON.stringify({ state: seedState, version: 18 })),
    });
    localStorage.setItem("opencut-api-config", seed);

    const { useAPIConfigStore: freshStore } = await importFreshStore(); // 水合启动,decrypt 挂起
    // 窗内连续 set() 两次(近空态竞态写)
    freshStore.setState({ concurrency: 40 });
    freshStore.setState({ concurrency: 41 });
    await flushTick();
    expect(readDiskRaw()).toBe(seed); // 门禁期:盘值仍是水合源值
    expect(control.encryptCalls).toEqual([]); // 丢弃发生在 IPC 之前

    control.releaseDecrypt(); // 水合放行(version 匹配 → migrated=false → 无自动回写)
    await vi.waitFor(() => expect(freshStore.persist.hasHydrated()).toBe(true));
    await flushTick(); // 若有任何补写,这里会落盘

    expect(readDiskRaw()).toBe(seed); // 逐字节不变:无 migrate 回写、无钩子补写、无门禁 flush
    expect(control.encryptCalls).toEqual([]); // 全程零加密调用
    expect(freshStore.getState().concurrency).toBe(3); // 水合整体替换赢了竞态写
    expect(freshStore.getState().apiKeys).toEqual({ openai: "sk-c1-稳态legacy" });
  });

  it("竞态锚2·v1 明文盘(v17):窗内竞态 set 不产生中间近空态密文;最终盘值 v2 且解密=迁移后全量 state", async () => {
    const control = installFakeBridge({ delayAvailability: true });
    const seed = JSON.stringify({
      state: {
        providers: [
          {
            id: "prov-legacy",
            platform: "custom",
            name: "存量供应商",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-c1-存量键",
            model: ["m"],
          },
        ],
        apiKeys: { openai: "sk-c1-存量legacy" },
        concurrency: 5,
      },
      version: 17,
    });
    localStorage.setItem("opencut-api-config", seed);

    const { useAPIConfigStore: freshStore } = await importFreshStore(); // 水合启动,is-available 挂起
    freshStore.setState({ concurrency: 50 }); // 窗内竞态写(近空态)
    await flushTick();
    expect(readDiskRaw()).toBe(seed); // 门禁丢弃:无中间态写盘
    expect(control.encryptCalls).toEqual([]);

    control.releaseAvailability(); // 水合放行
    await vi.waitFor(() => expect(freshStore.persist.hasHydrated()).toBe(true));
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));

    const raw = readDiskRaw() as string;
    expect(raw).not.toContain("sk-c1-存量键");
    expect(raw).not.toContain("sk-c1-存量legacy");
    // 每一次加密调用的载荷都含存量数据(直接证明从未出现过近空态密文)
    expect(control.encryptCalls.length).toBeGreaterThanOrEqual(1);
    for (const plaintext of control.encryptCalls) {
      expect(plaintext).toContain("sk-c1-存量键");
    }
    const decrypted = decryptDisk();
    expect(decrypted.version).toBe(18);
    expect(decrypted.state.apiKeys).toEqual({ openai: "sk-c1-存量legacy" });
    await vi.waitFor(() => {
      // 每拍新鲜解密:钩子第二写可能仍在途,轮询直到盘上密文=内存全量态
      expect(decryptDisk().state).toEqual(partializeAPIConfigState(freshStore.getState()));
    });
  });

  it("竞态锚2b·version-18 明文降级盘:断开钩子盘值保持明文不变;接通钩子盘值被覆写为 v2 密文(归因断言)", async () => {
    // Leg A(断开钩子):同适配器+同 version 匹配形态的受控 persist store,无 onRehydrateStorage——
    // version 匹配 → migrate 不触发、middleware 无自动回写 → 无任何写手,盘值保持明文
    installFakeBridge();
    const { create: createToy } = await import("zustand");
    const { persist: persistToy } = await import("zustand/middleware");
    const { createJSONStorage } = await import("zustand/middleware");
    const { createSecureLocalStorage } = await import("@/lib/storage/secure-local-storage");
    const toyKey = "c1-toy-version18-plain";
    const toySeed = JSON.stringify({ state: { marker: 7 }, version: 18 });
    localStorage.setItem(toyKey, toySeed);
    const toyStore = createToy(
      persistToy(
        () => ({ marker: 1 }),
        {
          name: toyKey,
          version: 18,
          storage: createJSONStorage(() => createSecureLocalStorage(toyKey)),
          skipHydration: true,
        },
      ),
    );
    await toyStore.persist.rehydrate();
    await flushTick();
    expect(localStorage.getItem(toyKey)).toBe(toySeed); // 明文原样(归因:无钩子=无写手)
    localStorage.removeItem(toyKey);

    // Leg B(接通钩子):真实 api-config store(钩子在 persist 配置里)——
    // version 18 匹配无 migrate 回写,盘上 v2 只能来自 §4.3 钩子
    const seed = JSON.stringify({
      state: {
        apiKeys: { openai: "sk-c1-降级盘键" },
        concurrency: 6,
      },
      version: 18,
    });
    localStorage.setItem("opencut-api-config", seed);
    const { useAPIConfigStore: freshStore } = await importFreshStore();
    await vi.waitFor(() => expect(freshStore.persist.hasHydrated()).toBe(true));
    await vi.waitFor(() => expect(readDiskRaw()).toContain('"v":2'));
    const raw = readDiskRaw() as string;
    expect(raw).not.toContain("sk-c1-降级盘键");
    await vi.waitFor(() => {
      // 每拍新鲜解密:钩子写可能仍在途
      const decrypted = decryptDisk();
      expect(decrypted.state.apiKeys).toEqual({ openai: "sk-c1-降级盘键" });
      expect(decrypted.state).toEqual(partializeAPIConfigState(freshStore.getState()));
    });
  });
});
