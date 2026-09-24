import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIConfigState } from "./api-config-store-types";
import {
  API_CONFIG_PERSIST_VERSION,
  API_CONFIG_STORAGE_KEY,
  partializeAPIConfigState,
} from "./api-config-persistence";

describe("API config persistence contract", () => {
  it("keeps the stable key and version", () => {
    expect(API_CONFIG_STORAGE_KEY).toBe("opencut-api-config");
    expect(API_CONFIG_PERSIST_VERSION).toBe(18);
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

// ── 0924 C1 专项:safeStorage 加密落盘(§6.3 迁移无损/降级)──
// 只 mock safeStorage 桥本身(fake 桥返回 Promise 模拟 IPC 异步);被测的
// 适配器与 persist 迁移链零 mock。flush 用公开 API:persist.rehydrate() + vi.waitFor。
describe("API config persistence safeStorage migration (C1)", () => {
  const fakeEncode = (plaintext: string) => Buffer.from(`fake-cipher:${plaintext}`).toString("base64");
  const fakeDecode = (cipher: string) => {
    const text = Buffer.from(cipher, "base64").toString("utf8");
    return text.startsWith("fake-cipher:") ? text.slice("fake-cipher:".length) : null;
  };

  /** 真实形态 v1 明文盘(providers/apiKeys/imageHostProviders 三处密钥落点齐全)。 */
  const seedV1PlaintextDisk = () => {
    const persisted = {
      state: {
        providers: [
          {
            id: "prov-relay",
            platform: "custom",
            name: "中转站",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-明文主键-0924",
            model: ["gpt-test"],
          },
        ],
        apiKeys: { openai: "sk-legacy-键" },
        imageHostProviders: [
          {
            id: "img-host-1",
            platform: "imgbb",
            name: "imgbb",
            baseUrl: "https://api.imgbb.com",
            uploadPath: "/1/upload",
            apiKey: "imgbb-图床键",
            enabled: true,
            apiKeyParam: "key",
          },
        ],
        concurrency: 2,
      },
      version: 17,
    };
    localStorage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(persisted));
    return persisted;
  };

  const installFakeBridge = (options?: { encryptFails?: boolean }) => {
    vi.stubGlobal("window", {
      secureStorage: {
        isEncryptionAvailable: async () => ({ ok: true as const, available: true }),
        encrypt: async (plaintext: string) => {
          if (options?.encryptFails) throw new Error("encrypt 炸了");
          return { ok: true as const, cipher: fakeEncode(plaintext) };
        },
        decrypt: async (cipher: string) => {
          const plaintext = fakeDecode(cipher);
          return plaintext === null
            ? { ok: false as const, reason: "error" }
            : { ok: true as const, plaintext };
        },
      },
    });
  };

  const readDisk = () => localStorage.getItem(API_CONFIG_STORAGE_KEY);

  beforeEach(async () => {
    localStorage.clear();
    // 等一拍让上一用例 fire-and-forget 的 setItem 全部落定再开始本用例
    await new Promise((resolve) => setTimeout(resolve, 0));
    localStorage.removeItem(API_CONFIG_STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("v1 明文首启被覆写为 v2 密文且明文不再存在于盘值;解密往返与内存 state 深相等(迁移无损)", async () => {
    installFakeBridge();
    seedV1PlaintextDisk();
    const { useAPIConfigStore } = await import("./api-config-store");

    await useAPIConfigStore.persist.rehydrate();
    await vi.waitFor(() => {
      expect(readDisk()).toContain('"v":2');
    });

    const raw = readDisk() as string;
    // 双断言:v2 标记 + 全文不含任何明文密钥子串(§6.4 前置 4)
    expect(raw).not.toContain("sk-明文主键-0924");
    expect(raw).not.toContain("sk-legacy-键");
    expect(raw).not.toContain("imgbb-图床键");

    const decrypted = JSON.parse(fakeDecode(JSON.parse(raw).cipher) as string);
    expect(decrypted.version).toBe(API_CONFIG_PERSIST_VERSION);
    // 用户数据无损:三处密钥落点原样到达内存
    expect(decrypted.state.apiKeys).toEqual({ openai: "sk-legacy-键" });
    expect(decrypted.state.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "prov-relay", apiKey: "sk-明文主键-0924" })]),
    );
    expect(decrypted.state.imageHostProviders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "img-host-1", apiKey: "imgbb-图床键" })]),
    );
    // 盘上密文与水合后内存全量态一致(每拍新鲜解密:钩子第二写可能仍在途)
    await vi.waitFor(() => {
      const fresh = JSON.parse(fakeDecode(JSON.parse(readDisk() as string).cipher) as string);
      expect(fresh.state).toEqual(partializeAPIConfigState(useAPIConfigStore.getState()));
    });
  });

  it("加密失败时降级明文直写且当次内容完整(绝不丢当次保存)", async () => {
    installFakeBridge({ encryptFails: true });
    seedV1PlaintextDisk();
    const { useAPIConfigStore } = await import("./api-config-store");

    await useAPIConfigStore.persist.rehydrate();
    await vi.waitFor(() => {
      // 降级写盘落地 = 明文形态(无 v2 标记)且版本已是 18(种盘是 17)
      const parsed = JSON.parse(readDisk() as string);
      expect(parsed.v).toBeUndefined();
      expect(parsed.version).toBe(API_CONFIG_PERSIST_VERSION);
    });

    const decrypted = JSON.parse(readDisk() as string);
    expect(decrypted.version).toBe(API_CONFIG_PERSIST_VERSION);
    // 明文降级写盘的内容 = 水合成功的完整迁移后 state(当次内容不丢)
    expect(decrypted.state.apiKeys).toEqual({ openai: "sk-legacy-键" });
    expect(decrypted.state.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "prov-relay", apiKey: "sk-明文主键-0924" })]),
    );
  });
});
