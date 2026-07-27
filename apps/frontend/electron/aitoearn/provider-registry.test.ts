import { describe, expect, it, vi } from "vitest";
import type { SelfMediaAccount } from "../../types/self-media";
import { createAitoearnLocalAdapter, createSelfMediaProviderRegistry, type AitoearnLocalPlatformBridge } from "./provider-registry";

const account: SelfMediaAccount = {
  id: "local-account-1",
  providerId: "aitoearn-local",
  platform: "xhs",
  displayName: "小红书 · 测试账号",
  status: "online",
  capabilities: {
    providerId: "aitoearn-local",
    platform: "xhs",
    displayName: "小红书",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: false,
    supportsCancellation: false,
    optionKeys: [],
  },
};

describe("self-media provider registry", () => {
  it("keeps an unported local provider disabled instead of claiming support", () => {
    const registry = createSelfMediaProviderRegistry();
    expect(registry.get("aitoearn-local").summary).toMatchObject({ enabled: false });
    expect(registry.get("aitoearn-local").publishMode).toBe("per-account");
    expect(registry.list()).toHaveLength(1);
  });

  it("does not silently fall back to the disabled local provider", async () => {
    const adapter = createAitoearnLocalAdapter();
    await expect(adapter.listAccounts("project-1")).rejects.toMatchObject({ code: "provider-disabled" });
    expect(adapter.summary.enabled).toBe(false);
  });

  it("routes local account and publish operations through the injected adapter seam", async () => {
    const bridge: AitoearnLocalPlatformBridge = {
      listAccounts: vi.fn(async () => [account]),
      startLogin: vi.fn(async () => ({ started: true })),
      publish: vi.fn(async ({ emitProgress }) => {
        emitProgress(50);
        return { status: "success" as const, resultUrl: "https://example.test/result" };
      }),
      poll: vi.fn(async () => ({ status: "success" as const, progress: 100 })),
      cancel: vi.fn(async () => ({ status: "canceled" as const })),
      dispose: vi.fn(async () => undefined),
    };
    const adapter = createAitoearnLocalAdapter(bridge);
    const registry = createSelfMediaProviderRegistry({ local: adapter });
    expect(registry.list().find((item) => item.id === "aitoearn-local")).toMatchObject({ enabled: true });
    await expect(adapter.listAccounts("project-1")).resolves.toEqual([account]);
    await adapter.dispose();
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });
});
