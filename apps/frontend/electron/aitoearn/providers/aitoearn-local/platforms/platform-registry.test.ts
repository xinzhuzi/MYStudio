import { describe, expect, it, vi } from "vitest";
import {
  SELF_MEDIA_CAPABILITY_MANIFEST,
  SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS,
} from "@/lib/self-media/capabilities";
import {
  PLATFORM_MANIFESTS,
  PLATFORM_IDS,
  PlatformAdapterError,
  createPlatformAdapterRegistry,
  type PlatformAdapterTransport,
} from ".";

const expectedPlatforms = [
  ["tiktok", "TikTok", "official-oauth"],
  ["douyin", "抖音", "vendor-electron-session"],
  ["xhs", "小红书", "vendor-electron-session"],
  ["wxSph", "视频号", "vendor-electron-session"],
  ["KWAI", "快手", "vendor-electron-session"],
  ["youtube", "YouTube", "official-oauth"],
  ["bilibili", "B站", "official-oauth"],
  ["twitter", "X（Twitter）", "official-oauth"],
  ["wxGzh", "微信公众号", "official-api-credentials"],
  ["facebook", "Facebook", "official-oauth"],
  ["instagram", "Instagram", "official-oauth"],
  ["threads", "Threads", "official-oauth"],
  ["pinterest", "Pinterest", "official-oauth"],
  ["linkedin", "LinkedIn", "official-oauth"],
] as const;

describe("aitoearn-local platform packages", () => {
  it("registers the exact 14 upstream platform IDs and display names", () => {
    expect(PLATFORM_IDS).toEqual(expectedPlatforms.map(([id]) => id));
    expect(SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS).toEqual(PLATFORM_IDS);
    expect(Object.keys(SELF_MEDIA_CAPABILITY_MANIFEST)).toEqual([...PLATFORM_IDS]);
    expect(Object.keys(PLATFORM_MANIFESTS)).toEqual(expectedPlatforms.map(([id]) => id));
    expect(Object.values(PLATFORM_MANIFESTS).map(({ id, displayName, authStrategy }) => [id, displayName, authStrategy])).toEqual(expectedPlatforms);
    expect(Object.values(PLATFORM_MANIFESTS).every(({ providerId }) => providerId === "aitoearn-local")).toBe(true);
  });

  it("preserves vendor-backed routing and content declarations for the four existing platforms", () => {
    expect(PLATFORM_MANIFESTS.douyin.capabilities.contentTypes).toEqual(["video", "image-text"]);
    expect(PLATFORM_MANIFESTS.douyin.capabilityRouting.imageTextPublish).toBe("vendor-electron");
    expect(PLATFORM_MANIFESTS.xhs.capabilities.contentTypes).toEqual(["video", "image-text"]);
    expect(PLATFORM_MANIFESTS.xhs.capabilityRouting.imageTextPublish).toBe("vendor-electron");
    expect(PLATFORM_MANIFESTS.wxSph.capabilities.contentTypes).toEqual(["video"]);
    expect(PLATFORM_MANIFESTS.wxSph.capabilityRouting.imageTextPublish).toBe("unavailable");
    expect(PLATFORM_MANIFESTS.KWAI.capabilities.contentTypes).toEqual(["video"]);
    expect(PLATFORM_MANIFESTS.KWAI.capabilityRouting.imageTextPublish).toBe("unavailable");
    expect(PLATFORM_MANIFESTS.douyin.capabilityRouting.videoPublish).toBe("vendor-electron");
    expect(PLATFORM_MANIFESTS.xhs.capabilityRouting.videoPublish).toBe("vendor-electron");
    expect(PLATFORM_MANIFESTS.wxSph.capabilityRouting.videoPublish).toBe("vendor-electron");
    expect(PLATFORM_MANIFESTS.KWAI.capabilityRouting.videoPublish).toBe("vendor-electron");
  });

  it("keeps renderer-facing names aligned with every platform package", () => {
    for (const platformId of PLATFORM_IDS) {
      const platformManifest = PLATFORM_MANIFESTS[platformId];
      const rendererCapability = SELF_MEDIA_CAPABILITY_MANIFEST[platformId];
      expect(rendererCapability.displayName).toBe(platformManifest.displayName);
    }
  });

  it("exposes every package through the registry without inventing a transport", async () => {
    const registry = createPlatformAdapterRegistry();

    expect(registry.list().map(({ id }) => id)).toEqual([...PLATFORM_IDS]);
    for (const platformId of PLATFORM_IDS) {
      const adapter = registry.get(platformId);
      expect(adapter?.manifest.id).toBe(platformId);
      await expect(adapter?.publish({ accountId: "account-1", contentType: "video", assets: [{ assetId: "asset-1", kind: "video", url: "project-file://asset-1" }] })).rejects.toMatchObject({
        platformId,
        operation: "publish",
        code: "transport-unavailable",
      });
    }
  });

  it("fails authentication, account listing, polling, and cancellation explicitly without transport", async () => {
    const registry = createPlatformAdapterRegistry();
    const adapter = registry.get("linkedin");
    expect(adapter).toBeDefined();

    await expect(adapter?.authenticate()).rejects.toMatchObject({ code: "transport-unavailable", operation: "authenticate" });
    await expect(adapter?.listAccounts()).rejects.toMatchObject({ code: "transport-unavailable", operation: "listAccounts" });
    await expect(adapter?.poll({ accountId: "account-1", taskId: "task-1" })).rejects.toMatchObject({ code: "transport-unavailable", operation: "poll" });
    await expect(adapter?.cancel({ accountId: "account-1", taskId: "task-1" })).rejects.toMatchObject({ code: "transport-unavailable", operation: "cancel" });
  });

  it("projects allowlisted account and task fields under every owning platform", () => {
    const registry = createPlatformAdapterRegistry();

    for (const platformId of PLATFORM_IDS) {
      const adapter = registry.get(platformId);
      expect(adapter).toBeDefined();
      expect(adapter?.projectAccount({
        accountId: "account-1",
        displayName: "Platform account",
        status: "online",
        avatarUrl: "https://example.test/avatar.png",
      })).toEqual({
        platformId,
        accountId: "account-1",
        displayName: "Platform account",
        status: "online",
        avatarUrl: "https://example.test/avatar.png",
      });
      expect(adapter?.projectTask({
        taskId: "task-1",
        status: "failure",
        progress: 40,
        providerTaskId: "provider-task-1",
        resultUrl: "https://example.test/result",
        error: { code: "transport-failed", message: "transport failed", retryable: true },
      })).toEqual({
        platformId,
        taskId: "task-1",
        status: "failure",
        progress: 40,
        providerTaskId: "provider-task-1",
        resultUrl: "https://example.test/result",
        error: { code: "transport-failed", message: "transport failed", retryable: true },
      });
    }
  });

  it("uses an injected transport only through the adapter package boundary", async () => {
    const transport: PlatformAdapterTransport = {
      authenticate: vi.fn(async () => ({ authenticated: true })),
      listAccounts: vi.fn(async () => [{ accountId: "account-1", displayName: "YouTube account", status: "online" as const }]),
      publish: vi.fn(async () => ({ taskId: "task-1", status: "running" as const, progress: 25 })),
      poll: vi.fn(async () => ({ taskId: "task-1", status: "success" as const, progress: 100, resultUrl: "https://example.test/video" })),
      cancel: vi.fn(async () => ({ taskId: "task-1", status: "canceled" as const, progress: 25 })),
    };
    const adapter = createPlatformAdapterRegistry({ youtube: transport }).get("youtube");
    expect(adapter).toBeDefined();

    await expect(adapter?.authenticate()).resolves.toEqual({ authenticated: true });
    await expect(adapter?.listAccounts()).resolves.toEqual([{
      platformId: "youtube",
      accountId: "account-1",
      displayName: "YouTube account",
      status: "online",
    }]);
    const publishRequest = { accountId: "account-1", contentType: "video" as const, assets: [{ assetId: "asset-1", kind: "video" as const, url: "project-file://asset-1" }] };
    await expect(adapter?.publish(publishRequest)).resolves.toEqual({
      platformId: "youtube",
      taskId: "task-1",
      status: "running",
      progress: 25,
    });
    await expect(adapter?.poll({ accountId: "account-1", taskId: "task-1" })).resolves.toMatchObject({ platformId: "youtube", status: "success", progress: 100 });
    await expect(adapter?.cancel({ accountId: "account-1", taskId: "task-1" })).resolves.toMatchObject({ platformId: "youtube", status: "canceled" });
    expect(transport.publish).toHaveBeenCalledWith(publishRequest);
  });

  it("uses a typed error for missing transport", async () => {
    const adapter = createPlatformAdapterRegistry().get("facebook");
    await expect(adapter?.publish({ accountId: "account-1", contentType: "video", assets: [] })).rejects.toBeInstanceOf(PlatformAdapterError);
  });
});
