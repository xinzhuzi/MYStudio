import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  },
  xhsLogin: vi.fn(),
}));

vi.mock("electron", () => ({ safeStorage: mocks.safeStorage }));
vi.mock("@aitoearn/xhs", () => ({
  xiaohongshuService: {
    loginOrView: mocks.xhsLogin,
    getUserInfo: vi.fn(async () => ({})),
    publishImageWorkApi: vi.fn(),
    publishVideoWorkApi: vi.fn(),
  },
}));
vi.mock("@aitoearn/douyin", () => ({
  douyinService: {
    loginOrView: vi.fn(),
    checkLoginStatus: vi.fn(),
    publishImageWorkApi: vi.fn(),
    publishVideoWorkApi: vi.fn(),
  },
}));
vi.mock("@aitoearn/wx", () => ({
  shipinhaoService: {
    loginOrView: vi.fn(),
    checkLoginStatus: vi.fn(),
    publishVideoWorkApi: vi.fn(),
  },
}));
vi.mock("@aitoearn/kwai", () => ({
  kwaiPub: {
    login: vi.fn(),
    getAccountInfo: vi.fn(),
    pubVideo: vi.fn(),
  },
}));
vi.mock("./compatibility/login-window", () => ({
  withDestroyedWindowDevToolsGuard: <T>(operation: () => Promise<T>) => operation(),
  withLoginWindowCloseCancellation: <T>(operation: () => Promise<T>) => operation(),
}));

import type { SelfMediaProviderPublishContext } from "../../provider-registry";
import { SelfMediaProviderError } from "../../provider-registry";
import { createLocalAccountVault } from "../../local-account-vault";
import type { PlatformAdapterTransport } from "./platforms";
import { PlatformAdapterError } from "./platforms";
import { createAitoearnLocalPlatformBridge } from "./platform-bridge";

function createOfficialTransport(): PlatformAdapterTransport {
  return {
    authenticate: vi.fn(async () => ({ authenticated: true })),
    listAccounts: vi.fn(async () => [{ accountId: "twitter-account", displayName: "X 账号", status: "online" as const }]),
    publish: vi.fn(async () => ({ taskId: "bridge-task", providerTaskId: "provider-task", status: "running" as const, progress: 25 })),
    poll: vi.fn(async () => ({ taskId: "provider-task", status: "success" as const, progress: 100, resultUrl: "https://x.example.test/post/1" })),
    cancel: vi.fn(async () => ({ taskId: "provider-task", status: "canceled" as const, progress: 100 })),
  };
}

function createPublishContext(): SelfMediaProviderPublishContext {
  return {
    projectId: "project-1",
    draft: {
      id: "draft-1",
      projectId: "project-1",
      contentType: "image-text",
      title: "标题",
      description: "描述",
      topics: ["漫剧"],
      assets: [{ assetId: "image-1", projectId: "project-1", kind: "image" }],
      accountIds: ["twitter-account"],
      visibility: "public",
      platformOptions: { platform: "twitter" },
      updatedAt: "2026-07-27T00:00:00.000Z",
    },
    task: {
      id: "task-1",
      attemptId: "attempt-1",
      projectId: "project-1",
      providerId: "aitoearn-local",
      accountId: "twitter-account",
      sourceAssetIds: ["image-1"],
      status: "running",
      progress: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    },
    resolveAsset: vi.fn(async (assetId) => ({ assetId, kind: "image" as const, url: "https://assets.example.test/image.png" })),
    emitProgress: vi.fn(),
  };
}

describe("AiToEarn local platform bridge", () => {
  const root = path.join(os.tmpdir(), `mystudio-platform-bridge-${process.pid}`);

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    mocks.xhsLogin.mockResolvedValue({
      success: true,
      data: { cookie: JSON.stringify([{ name: "sid", value: "session-secret" }]) },
    });
  });

  it("routes official login, account, publish, poll, and cancel operations through the configured transport", async () => {
    const transport = createOfficialTransport();
    const vault = createLocalAccountVault(root);
    await vault.upsert({
      id: "twitter-account",
      platform: "twitter",
      providerAccountId: "provider-user-1",
      displayName: "X 账号",
      credential: { kind: "oauth", accessToken: "access-token" },
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    const bridge = createAitoearnLocalPlatformBridge({
      userDataPath: root,
      platformTransports: { twitter: transport },
    });

    await expect(bridge.startLogin("project-1", "twitter")).resolves.toEqual({ started: true });
    await expect(bridge.listAccounts("project-1")).resolves.toEqual([
      expect.objectContaining({ id: "twitter-account", platform: "twitter", status: "online" }),
    ]);

    const context = createPublishContext();
    await expect(bridge.publish(context)).resolves.toMatchObject({
      status: "running",
      progress: 25,
      providerTaskId: "provider-task",
    });
    expect(transport.publish).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "twitter-account",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.example.test/image.png" }],
    }));

    const task = { ...context.task, providerTaskId: "provider-task" };
    await expect(bridge.poll(task)).resolves.toMatchObject({ status: "success", progress: 100 });
    await expect(bridge.cancel(task)).resolves.toMatchObject({ status: "canceled", progress: 100 });
    expect(transport.poll).toHaveBeenCalledWith({ accountId: "twitter-account", taskId: "provider-task" });
    expect(transport.cancel).toHaveBeenCalledWith({ accountId: "twitter-account", taskId: "provider-task" });
  });

  it("normalizes an unavailable official transport without exposing adapter errors", async () => {
    const transport: PlatformAdapterTransport = {
      ...createOfficialTransport(),
      publish: vi.fn(async () => {
        throw new PlatformAdapterError("twitter", "publish", "transport-unavailable", "X 发布通道不可用");
      }),
    };
    await createLocalAccountVault(root).upsert({
      id: "twitter-account",
      platform: "twitter",
      providerAccountId: "provider-user-1",
      displayName: "X 账号",
      credential: { kind: "oauth", accessToken: "access-token" },
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    const bridge = createAitoearnLocalPlatformBridge({ userDataPath: root, platformTransports: { twitter: transport } });

    await expect(bridge.publish(createPublishContext())).rejects.toEqual(expect.objectContaining({
      name: "SelfMediaProviderError",
      code: "platform-transport-unavailable",
      message: "X 发布通道不可用",
    } satisfies Partial<SelfMediaProviderError>));
  });

  it("serializes sensitive vendor calls and redacts primitive log strings", async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;
    mocks.xhsLogin.mockImplementation(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      console.log("session-secret");
      console.info("info-secret");
      console.debug("debug-secret");
      console.trace("trace-secret");
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeCalls -= 1;
      return { success: true, data: { cookie: JSON.stringify([{ name: "sid", value: "session-secret" }]) } };
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const consoleTrace = vi.spyOn(console, "trace").mockImplementation(() => undefined);
    try {
      const bridge = createAitoearnLocalPlatformBridge({ userDataPath: root });
      await Promise.all([
        bridge.startLogin("project-1", "xhs"),
        bridge.startLogin("project-1", "xhs"),
      ]);
      expect(maxActiveCalls).toBe(1);
      expect(consoleLog).toHaveBeenCalledWith("[redacted]");
      expect(consoleLog).not.toHaveBeenCalledWith("session-secret");
      expect(consoleInfo).toHaveBeenCalledWith("[redacted]");
      expect(consoleDebug).toHaveBeenCalledWith("[redacted]");
      expect(consoleTrace).toHaveBeenCalledWith("[redacted]");
    } finally {
      consoleLog.mockRestore();
      consoleInfo.mockRestore();
      consoleDebug.mockRestore();
      consoleTrace.mockRestore();
    }
  });

  it("reuses a stable local account id when the vendor login omits user information", async () => {
    const bridge = createAitoearnLocalPlatformBridge({ userDataPath: root });
    await bridge.startLogin("project-1", "xhs");
    mocks.xhsLogin.mockResolvedValue({
      success: true,
      data: { cookie: JSON.stringify([{ name: "sid", value: "rotated-session-secret" }]) },
    });
    await bridge.startLogin("project-1", "xhs");

    const accounts = await createLocalAccountVault(root).list();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toMatch(/^aitoearn-local:xhs:/);
  });

  it("returns a typed failure when safeStorage cannot save a local login", async () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    const bridge = createAitoearnLocalPlatformBridge({ userDataPath: root });

    await expect(bridge.startLogin("project-1", "xhs")).rejects.toEqual(expect.objectContaining({
      name: "SelfMediaProviderError",
      code: "credential-unavailable",
      retryable: false,
    } satisfies Partial<SelfMediaProviderError>));
  });

  it("fails closed when polling has no account or a vendor platform has no poll transport", async () => {
    const bridge = createAitoearnLocalPlatformBridge({ userDataPath: root });
    const task = createPublishContext().task;
    await expect(bridge.poll(task)).rejects.toEqual(expect.objectContaining({
      code: "account-not-found",
    } satisfies Partial<SelfMediaProviderError>));

    await createLocalAccountVault(root).upsert({
      id: task.accountId,
      platform: "xhs",
      displayName: "小红书账号",
      credential: { cookies: [{ name: "sid", value: "session-secret" }] },
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    await expect(bridge.poll(task)).rejects.toEqual(expect.objectContaining({
      code: "poll-not-supported",
    } satisfies Partial<SelfMediaProviderError>));
  });
});
