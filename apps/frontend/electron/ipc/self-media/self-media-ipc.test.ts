import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, sent } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: sent } }]),
    fromWebContents: vi.fn(() => ({ isDestroyed: () => false })),
  },
}));

import { registerSelfMediaIpcHandlers } from "./self-media-ipc";
import { SELF_MEDIA_IPC, type SelfMediaCreateTaskReply, type SelfMediaDailyPublishStatsReply } from "../../../lib/self-media/ipc-contract";
import { createAitoearnLocalAdapter, createSelfMediaProviderRegistry } from "../../aitoearn/provider-registry";
import { SelfMediaProviderError, type SelfMediaProviderTaskResult } from "../../aitoearn/provider-registry";
import { SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS } from "../../../lib/self-media/capabilities";
import { BATCH_PUBLISH_INTERVAL_MS, localDayKey } from "../../../lib/self-media/batch-policy";
import type { SelfMediaDraft, SelfMediaTask } from "../../../types/self-media";

const SELF_MEDIA_PLATFORMS = SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS;

const trustedFrame = { url: "file:///Applications/app.asar/out/renderer/index.html" };
const trustedEvent = { senderFrame: trustedFrame, sender: { mainFrame: trustedFrame } };

describe("registerSelfMediaIpcHandlers", () => {
  const taskStorePath = path.join(os.tmpdir(), `mystudio-self-media-${process.pid}.json`);

  beforeEach(async () => {
    await fs.rm(taskStorePath, { force: true });
    handlers.clear();
    sent.mockClear();
    vi.clearAllMocks();
    registerSelfMediaIpcHandlers({});
  });

  afterAll(async () => {
    await fs.rm(taskStorePath, { force: true });
  });

  it("exposes disabled providers without claiming a publish capability", async () => {
    const reply = await handlers.get(SELF_MEDIA_IPC.listProviders)?.(trustedEvent);
    expect(reply).toEqual({
      success: true,
      value: [
        { id: "aitoearn-local", displayName: "AiToEarn 本地适配器", enabled: false, reason: "本地平台适配器正在迁移" },
      ],
    });
  });

  it("rejects invocations from subframes and non-app renderers", async () => {
    const mainFrame = { url: "file:///Applications/app.asar/out/renderer/index.html" };
    const subframeReply = await handlers.get(SELF_MEDIA_IPC.listTasks)?.(
      { senderFrame: { url: mainFrame.url }, sender: { mainFrame } },
      { projectId: "project-1" },
    );
    expect(subframeReply).toEqual({ success: false, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的自媒体调用" } });

    const externalFrame = { url: "https://evil.example/app" };
    const externalReply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(
      { senderFrame: externalFrame, sender: { mainFrame: externalFrame } },
      { projectId: "project-1", providerId: "aitoearn-local" },
    );
    expect(externalReply).toEqual({ success: false, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的自媒体调用" } });

    const legacyReply = await handlers.get(SELF_MEDIA_IPC.cancelTask)?.({}, { projectId: "project-1", taskId: "task-1" });
    expect(legacyReply).toEqual({ success: false, error: { code: "untrusted-sender", message: "拒绝来自非应用渲染帧的自媒体调用" } });
  });

  it("rejects invalid task payloads before any provider request", async () => {
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: { projectId: "other-project" },
    })) as SelfMediaCreateTaskReply | undefined;
    expect(reply).toEqual({ success: false, error: { code: "invalid-task-request", message: "任务项目范围无效" } });
  });

  it("returns invalid-provider when a renderer supplies an unknown provider", async () => {
    const listReply = await handlers.get(SELF_MEDIA_IPC.listAccounts)?.(trustedEvent, { projectId: "project-1", providerId: "unknown-provider" });
    expect(listReply).toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });

    const createReply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "unknown-provider",
      draft: { projectId: "project-1", assets: [], accountIds: [] },
    });
    expect(createReply).toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });
  });

  it("returns invalid-provider for poll and cancel of a task with an unknown provider", async () => {
    const registration = registerSelfMediaIpcHandlers({});
    const malformedTask = {
      id: "task-unknown-provider",
      attemptId: "attempt-unknown-provider",
      projectId: "project-1",
      providerId: "unknown-provider",
      accountId: "account-1",
      sourceAssetIds: ["asset-1"],
      status: "running",
      progress: 10,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    } as unknown as SelfMediaTask;
    registration.tasks.set(malformedTask.id, malformedTask);

    await expect(handlers.get(SELF_MEDIA_IPC.pollTask)?.(trustedEvent, {
      projectId: "project-1",
      taskId: malformedTask.id,
    })).resolves.toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });
    await expect(handlers.get(SELF_MEDIA_IPC.cancelTask)?.(trustedEvent, {
      projectId: "project-1",
      taskId: malformedTask.id,
    })).resolves.toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });

    await registration.dispose();
  });

  it("does not return a malformed task from the successful list reply", async () => {
    const registration = registerSelfMediaIpcHandlers({});
    registration.tasks.set("task-malformed", {
      id: "task-malformed",
      attemptId: "attempt-malformed",
      projectId: "project-1",
      providerId: "aitoearn-local",
      accountId: "account-1",
      sourceAssetIds: ["asset-1"],
      status: "provider-new-status",
      progress: 10,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    } as never);
    await expect(handlers.get(SELF_MEDIA_IPC.listTasks)?.(trustedEvent, { projectId: "project-1" }))
      .resolves.toEqual({ success: false, error: { code: "invalid-task-response", message: "任务响应无效" } });
    await registration.dispose();
  });

  it("normalizes provider login failures without leaking provider exceptions", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => { throw new SelfMediaProviderError("aitoearn-local", "login-failed", "平台拒绝登录", false); },
        publish: async () => ({ status: "success" }), poll: async () => ({ status: "success" }), cancel: async () => ({ status: "canceled" }),
      }),
    });
    registerSelfMediaIpcHandlers({ registry });
    await expect(handlers.get(SELF_MEDIA_IPC.startLogin)?.(trustedEvent, { projectId: "project-1", providerId: "aitoearn-local", platform: "xhs" }))
      .resolves.toEqual({ success: false, error: { code: "login-failed", message: "平台拒绝登录" } });
  });

  it("accepts login requests for all 14 registered platforms", async () => {
    const startLogin = vi.fn(async () => ({ started: true }));
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin,
        publish: async () => ({ status: "success" }),
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    registerSelfMediaIpcHandlers({ registry });

    for (const platform of SELF_MEDIA_PLATFORMS) {
      await expect(handlers.get(SELF_MEDIA_IPC.startLogin)?.(trustedEvent, {
        projectId: "project-1",
        providerId: "aitoearn-local",
        platform,
      })).resolves.toEqual({ success: true, value: { started: true } });
    }
    expect(startLogin).toHaveBeenCalledTimes(SELF_MEDIA_PLATFORMS.length);
  });

  it("blocks an explicitly unsupported platform before task creation", async () => {
    const publish = vi.fn(async () => ({ status: "success" as const }));
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish,
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-unsupported-platform",
        projectId: "project-1",
        contentType: "image-text",
        title: "不应发布",
        description: "",
        topics: [],
        assets: [{ assetId: "image-1", projectId: "project-1", kind: "image", approvedUrl: "project-file://project-1/image.png" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: { platform: "youtube" },
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    expect(reply).toEqual({ success: false, error: { code: "invalid-draft", message: "contentType：YouTube 不支持当前内容类型" } });
    expect(publish).not.toHaveBeenCalled();
    expect(registration.tasks.size).toBe(0);
    await registration.dispose();
  });

  it("returns account summaries without credential fields", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [{ id: "a", providerId: "aitoearn-local", platform: "xhs", displayName: "账号", status: "online", capabilities: { providerId: "aitoearn-local", platform: "xhs", displayName: "小红书", supportsVideo: true, supportsImageText: true, supportsScheduling: false, supportsCancellation: false, optionKeys: [] } }],
        startLogin: async () => ({ started: true }), publish: async () => ({ status: "success" }), poll: async () => ({ status: "success" }), cancel: async () => ({ status: "canceled" }),
      }),
    });
    registerSelfMediaIpcHandlers({ registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.listAccounts)?.(trustedEvent, { projectId: "project-1", providerId: "aitoearn-local" });
    expect(reply).toEqual({ success: true, value: [expect.not.objectContaining({ credential: expect.anything() })] });
  });

  it("does not persist an ignored API-key-like field", async () => {
    const reply = await handlers.get(SELF_MEDIA_IPC.configureProvider)?.(trustedEvent, {
      providerId: "aitoearn-local",
      apiKey: "secret-value",
    });
    expect(reply).toEqual({ success: true, value: { providerId: "aitoearn-local", configured: true } });
  });

  it("rejects a retry that does not reference a failed task in the same project", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "success" }),
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      previousTaskId: "missing-task",
      draft: {
        id: "draft-retry",
        projectId: "project-1",
        contentType: "video",
        title: "重试",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    expect(reply).toEqual({ success: false, error: { code: "invalid-previous-task", message: "重试来源任务不存在、项目/provider 不匹配，或任务尚未进入可重试状态" } });
    await registration.dispose();
  });

  it("does not convert an unsupported cancel into a failure task", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "running" }),
        poll: async () => ({ status: "running" }),
        cancel: async () => { throw new SelfMediaProviderError("aitoearn-local", "cancel-not-supported", "不支持取消", false); },
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry });
    registration.tasks.set("task-running", {
      id: "task-running",
      attemptId: "attempt-running",
      projectId: "project-1",
      providerId: "aitoearn-local",
      accountId: "account-a",
      sourceAssetIds: ["video-1"],
      status: "running",
      progress: 20,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    await expect(handlers.get(SELF_MEDIA_IPC.cancelTask)?.(trustedEvent, { projectId: "project-1", taskId: "task-running" }))
      .resolves.toEqual({ success: false, error: { code: "cancel-not-supported", message: "不支持取消" } });
    expect(registration.tasks.get("task-running")?.status).toBe("running");
    await registration.dispose();
  });

  it("requires a main-process asset resolver when the local bridge is enabled", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async ({ resolveAsset }) => { await resolveAsset("video-1"); return { status: "success" }; },
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry, localBridge: {} as never });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-resolver",
        projectId: "project-1",
        contentType: "video",
        title: "解析器",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "https://example.test/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    expect(reply).toMatchObject({ success: true, value: [{ status: "failure", error: { code: "asset-resolver-unavailable" } }] });
    await registration.dispose();
  });

  it("fans out normalized progress events to renderer windows", () => {
    const registration = registerSelfMediaIpcHandlers({});
    registration.emitProgress({
      projectId: "project-1",
      taskId: "task-1",
      status: "running",
      progress: 35,
    });
    expect(sent).toHaveBeenCalledWith(SELF_MEDIA_IPC.progress, {
      projectId: "project-1",
      taskId: "task-1",
      status: "running",
      progress: 35,
    });
    sent.mockClear();
    registration.emitProgress({
      projectId: "project-1",
      taskId: "task-1",
      status: "provider-new-status" as never,
      progress: 35,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("creates one auditable task per selected account through an enabled adapter", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "success", resultUrl: "https://example.test/result" }),
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    registerSelfMediaIpcHandlers({ registry });
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-1",
        projectId: "project-1",
        contentType: "video",
        title: "测试发布",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a", "account-b"],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    })) as SelfMediaCreateTaskReply | undefined;
    expect(reply).toMatchObject({ success: true });
    if (reply && reply.success) {
      expect(reply.value).toHaveLength(2);
      expect(reply.value.map((task) => task.status)).toEqual(["success", "success"]);
      expect(reply.value.map((task) => task.accountId)).toEqual(["account-a", "account-b"]);
    }
  });

  it("carries the draft productId onto created tasks so product-filtered history matches", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "success" }),
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    registerSelfMediaIpcHandlers({ registry });
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-with-product",
        projectId: "project-1",
        contentType: "video",
        title: "带产品发布",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: {},
        productId: "product-1",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    })) as SelfMediaCreateTaskReply | undefined;
    expect(reply).toMatchObject({ success: true });
    if (reply && reply.success) {
      expect(reply.value.map((task) => task.productId)).toEqual(["product-1"]);
    }
  });

  it("persists and recovers a local scheduled publish without publishing before its due time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-27T00:00:00.000Z");
    try {
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const registry = createSelfMediaProviderRegistry({
        local: createAitoearnLocalAdapter({
          listAccounts: async () => [],
          startLogin: async () => ({ started: true }),
          publish,
          poll: async () => ({ status: "success" }),
          cancel: async () => ({ status: "canceled" }),
        }),
      });
      const first = registerSelfMediaIpcHandlers({ registry, taskStorePath });
      const created = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
        projectId: "project-1",
        providerId: "aitoearn-local",
        draft: {
          id: "draft-scheduled",
          projectId: "project-1",
          contentType: "video",
          title: "定时发布",
          description: "",
          topics: [],
          assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
          accountIds: ["account-a"],
          visibility: "public",
          platformOptions: { platform: "xhs" },
          scheduledAt: "2026-07-27T00:00:01.000Z",
          productId: "product-1",
          updatedAt: "2026-07-27T00:00:00.000Z",
        },
      });
      expect(created).toMatchObject({ success: true, value: [{ status: "scheduled" }] });
      expect(publish).not.toHaveBeenCalled();
      await first.dispose();

      const second = registerSelfMediaIpcHandlers({ registry, taskStorePath });
      await handlers.get(SELF_MEDIA_IPC.listTasks)?.(trustedEvent, { projectId: "project-1" });
      await second.runtimeReady;
      expect(second.tasks.size).toBe(1);
      expect(second.scheduledContexts.size).toBe(1);
      expect([...second.tasks.values()][0]?.productId).toBe("product-1");
      expect([...second.scheduledContexts.values()][0]?.productId).toBe("product-1");
      expect([...second.tasks.values()][0]?.status).toBe("scheduled");
      expect(vi.getTimerCount()).toBe(1);
      await vi.runAllTimersAsync();
      await second.runtime.waitForIdle();
      expect([...second.tasks.values()][0]?.status).toBe("success");
      expect(publish).toHaveBeenCalledOnce();
      expect(await handlers.get(SELF_MEDIA_IPC.listTasks)?.(trustedEvent, { projectId: "project-1" }))
        .toMatchObject({ success: true, value: [{ status: "success" }] });
      await second.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rehydrates the task journal without storing credentials", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "running", providerTaskId: "provider-1" }),
        poll: async () => ({ status: "running", progress: 30 }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const first = registerSelfMediaIpcHandlers({ registry, taskStorePath });
    await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-1",
        projectId: "project-1",
        contentType: "video",
        title: "持久化测试",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    await first.dispose();
    const second = registerSelfMediaIpcHandlers({ registry, taskStorePath });
    await handlers.get(SELF_MEDIA_IPC.listAccounts)?.(trustedEvent, { projectId: "project-1", providerId: "aitoearn-local" });
    expect(second.tasks.size).toBe(1);
    expect(await fs.readFile(taskStorePath, "utf8")).not.toContain("secret-value");
    await second.dispose();
  });

  it("ignores malformed journal records and rewrites only projected tasks", async () => {
    const validTask: SelfMediaTask = {
      id: "task-valid",
      attemptId: "attempt-valid",
      projectId: "project-1",
      providerId: "aitoearn-local",
      accountId: "account-a",
      sourceAssetIds: ["video-1"],
      status: "success",
      progress: 100,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:01:00.000Z",
    };
    await fs.writeFile(taskStorePath, JSON.stringify({
      schemaVersion: 1,
      tasks: [validTask, { ...validTask, id: "task-secret", apiKey: "must-not-load" }],
      scheduledContexts: [],
    }));
    const registration = registerSelfMediaIpcHandlers({ taskStorePath });
    await registration.runtimeReady;
    expect([...registration.tasks.keys()]).toEqual(["task-valid"]);
    await registration.dispose();
    const journal = await fs.readFile(taskStorePath, "utf8");
    expect(journal).not.toContain("must-not-load");
    expect(JSON.parse(journal).tasks).toEqual([validTask]);
  });

  it("rejects duplicated account ids before creating tasks", async () => {
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: { projectId: "project-1", accountIds: ["account-1", "account-1"] },
    });
    expect(reply).toMatchObject({ success: false, error: { code: "invalid-draft" } });
    expect((reply as { error: { message: string } }).error.message).toContain("账号不能重复选择");
  });

  it("fails closed on a corrupt task journal instead of overwriting it", async () => {
    const corruptPath = path.join(os.tmpdir(), `mystudio-self-media-corrupt-${process.pid}.json`);
    const publish = vi.fn(async () => ({ status: "success" as const }));
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish,
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    try {
      const corrupt = "{not-json";
      await fs.writeFile(corruptPath, corrupt);
      const registration = registerSelfMediaIpcHandlers({ registry, taskStorePath: corruptPath });
      await registration.runtimeReady;

      await expect(handlers.get(SELF_MEDIA_IPC.listTasks)?.(trustedEvent, { projectId: "project-1" }))
        .resolves.toMatchObject({ success: false, error: { code: "task-journal-corrupted" } });
      await expect(handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
        projectId: "project-1",
        providerId: "aitoearn-local",
        draft: { projectId: "project-1" },
      })).resolves.toMatchObject({ success: false, error: { code: "task-journal-corrupted" } });
      await expect(handlers.get(SELF_MEDIA_IPC.pollTask)?.(trustedEvent, { projectId: "project-1", taskId: "task-1" }))
        .resolves.toMatchObject({ success: false, error: { code: "task-journal-corrupted" } });
      await expect(handlers.get(SELF_MEDIA_IPC.cancelTask)?.(trustedEvent, { projectId: "project-1", taskId: "task-1" }))
        .resolves.toMatchObject({ success: false, error: { code: "task-journal-corrupted" } });
      expect(publish).not.toHaveBeenCalled();

      await registration.dispose();
      expect(await fs.readFile(corruptPath, "utf8")).toBe(corrupt);

      const shaped = JSON.stringify({ schemaVersion: 1 });
      await fs.writeFile(corruptPath, shaped);
      const second = registerSelfMediaIpcHandlers({ taskStorePath: corruptPath });
      await second.runtimeReady;
      await expect(handlers.get(SELF_MEDIA_IPC.listTasks)?.(trustedEvent, { projectId: "project-1" }))
        .resolves.toMatchObject({ success: false, error: { code: "task-journal-corrupted" } });
      await second.dispose();
      expect(await fs.readFile(corruptPath, "utf8")).toBe(shaped);
    } finally {
      await fs.rm(corruptPath, { force: true });
    }
  });

  it("does not let a late provider cancellation overwrite a terminal task", async () => {
    let resolveCancel!: (result: { status: "canceled" }) => void;
    let markCancelStarted!: () => void;
    const cancelStarted = new Promise<void>((resolve) => { markCancelStarted = resolve; });
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "running" }),
        poll: async () => ({ status: "running" }),
        cancel: () => new Promise<{ status: "canceled" }>((resolve) => {
          resolveCancel = resolve;
          markCancelStarted();
        }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry });
    const running: SelfMediaTask = {
      id: "task-running",
      attemptId: "attempt-running",
      projectId: "project-1",
      providerId: "aitoearn-local",
      accountId: "account-a",
      sourceAssetIds: ["video-1"],
      status: "running",
      progress: 20,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:01:00.000Z",
    };
    registration.tasks.set(running.id, running);
    const cancellation = handlers.get(SELF_MEDIA_IPC.cancelTask)?.(trustedEvent, { projectId: "project-1", taskId: running.id });
    await cancelStarted;
    const succeeded = { ...running, status: "success" as const, progress: 100, updatedAt: "2026-07-27T00:02:00.000Z" };
    registration.tasks.set(running.id, succeeded);
    resolveCancel({ status: "canceled" });
    await expect(cancellation).resolves.toEqual({ success: true, value: succeeded });
    expect(registration.tasks.get(running.id)).toEqual(succeeded);
    await registration.dispose();
  });

  it("converts an unknown provider task status into a failed task", async () => {
    const publish = vi.fn(async () => ({ status: "provider-new-status" as never }));
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish,
        poll: async () => ({ status: "running" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-invalid-provider-result",
        projectId: "project-1",
        contentType: "video",
        title: "状态校验",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    });
    expect(reply).toMatchObject({ success: true, value: [{ status: "failure", error: { code: "provider-request-failed" } }] });
    expect(publish).toHaveBeenCalledOnce();
    await registration.dispose();
  });

  it("rejects an invalid scheduled journal date without scheduling immediate work", async () => {
    vi.useFakeTimers();
    try {
      await fs.writeFile(taskStorePath, JSON.stringify({
        schemaVersion: 1,
        tasks: [{
          id: "task-invalid-date",
          attemptId: "attempt-invalid-date",
          draftId: "draft-invalid-date",
          projectId: "project-1",
          providerId: "aitoearn-local",
          accountId: "account-a",
          sourceAssetIds: ["video-1"],
          status: "scheduled",
          progress: 0,
          scheduledAt: "not-a-date",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }],
        scheduledContexts: [],
      }));
      const publish = vi.fn(async () => ({ status: "success" as const }));
      const registry = createSelfMediaProviderRegistry({
        local: createAitoearnLocalAdapter({
          listAccounts: async () => [],
          startLogin: async () => ({ started: true }),
          publish,
          poll: async () => ({ status: "running" }),
          cancel: async () => ({ status: "canceled" }),
        }),
      });
      const registration = registerSelfMediaIpcHandlers({ registry, taskStorePath });
      await registration.runtimeReady;
      await registration.runtime.waitForIdle();
      expect(vi.getTimerCount()).toBe(0);
      expect(publish).not.toHaveBeenCalled();
      expect(registration.tasks.get("task-invalid-date")).toMatchObject({ status: "failure", error: { code: "invalid-scheduled-time" } });
      await registration.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses credential-like fields in a scheduled draft before journal persistence", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: vi.fn(async () => ({ status: "success" as const })),
        poll: async () => ({ status: "running" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry, taskStorePath });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id: "draft-secret-scheduled",
        projectId: "project-1",
        contentType: "video",
        title: "凭据字段",
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: ["account-a"],
        visibility: "public",
        platformOptions: { platform: "xhs", apiKey: "secret-api-key" },
        scheduledAt: "2099-01-01T00:00:00.000Z",
        futureOptions: { authorization: "secret-authorization" },
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    });
    expect(reply).toEqual({ success: false, error: { code: "invalid-draft", message: "草稿：草稿不能包含凭据字段" } });
    expect(await fs.readFile(taskStorePath, "utf8").catch(() => "")).not.toContain("secret-api-key");
    await registration.dispose();
  });

  it("serializes concurrent task journal writes into valid JSON", async () => {
    const registry = createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: async () => ({ status: "success" as const }),
        poll: async () => ({ status: "running" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
    const registration = registerSelfMediaIpcHandlers({ registry, taskStorePath });
    const create = (id: string) => handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: {
        id,
        projectId: "project-1",
        contentType: "video",
        title: id,
        description: "",
        topics: [],
        assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
        accountIds: [id],
        visibility: "public",
        platformOptions: {},
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    });
    await Promise.all([create("draft-concurrent-a"), create("draft-concurrent-b")]);
    await registration.dispose();
    const journal = JSON.parse(await fs.readFile(taskStorePath, "utf8")) as { tasks: SelfMediaTask[] };
    expect(journal.tasks).toHaveLength(2);
    expect(journal.tasks.every((task) => task.status === "success")).toBe(true);
  });

  // ─── L6(1125 二轮收尾): 批量闸门、级联、每日统计、诊断日志 ──────────────────

  function batchDraftDraft(overrides: {
    id: string;
    batchRole: SelfMediaDraft["batchRole"];
    scheduledAt: string;
    accountId?: string;
    batchId?: string;
    platform?: string;
  }): SelfMediaDraft {
    const accountId = overrides.accountId ?? "account-a";
    return {
      id: overrides.id,
      projectId: "project-1",
      contentType: "video",
      title: `批量-${overrides.id}`,
      description: "",
      topics: [],
      assets: [{ assetId: "video-1", projectId: "project-1", kind: "video", approvedUrl: "project-file://project-1/video.mp4" }],
      accountIds: [accountId],
      visibility: "public",
      platformOptions: { platform: overrides.platform ?? "xhs" },
      scheduledAt: overrides.scheduledAt,
      batchId: overrides.batchId ?? "batch-1",
      batchRole: overrides.batchRole,
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
  }

  async function createBatchTask(_registration: unknown, draft: SelfMediaDraft): Promise<SelfMediaTask[]> {
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.(trustedEvent, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft,
    })) as SelfMediaCreateTaskReply | undefined;
    if (!reply || !reply.success) throw new Error(`batch createTask failed: ${JSON.stringify(reply)}`);
    return reply.value;
  }

  function successRegistry(publish: (context: unknown) => Promise<SelfMediaProviderTaskResult>): ReturnType<typeof createSelfMediaProviderRegistry> {
    return createSelfMediaProviderRegistry({
      local: createAitoearnLocalAdapter({
        listAccounts: async () => [],
        startLogin: async () => ({ started: true }),
        publish: (context) => publish(context),
        poll: async () => ({ status: "success" }),
        cancel: async () => ({ status: "canceled" }),
      }),
    });
  }

  describe("L6 批量闸门与级联", () => {
    const T0 = Date.parse("2026-07-27T00:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps members waiting while the verification has no terminal verdict, then spaces releases by the interval", async () => {
      const publishTimes: number[] = [];
      const publish = vi.fn(async () => {
        publishTimes.push(Date.now());
        return { status: "success" as const, progress: 100 };
      });
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish) });
      await createBatchTask(registration, batchDraftDraft({ id: "draft-verify", batchRole: "verification", accountId: "account-a", scheduledAt: new Date(T0 + 1_000).toISOString() }));
      await createBatchTask(registration, batchDraftDraft({ id: "draft-member", batchRole: "member", accountId: "account-b", scheduledAt: new Date(T0 + 2_000).toISOString() }));
      const verifyTask = [...registration.tasks.values()].find((task) => task.batchRole === "verification")!;
      const memberTask = [...registration.tasks.values()].find((task) => task.batchRole === "member")!;

      await vi.advanceTimersByTimeAsync(1_000);
      await registration.runtime.waitForIdle();
      // 首发验证已放出;成员到点(2s)但验证刚出结果,间隔检查顺延
      expect(publish).toHaveBeenCalledTimes(1);
      expect(registration.tasks.get(verifyTask.id)?.status).toBe("success");
      expect(registration.tasks.get(memberTask.id)?.status).toBe("scheduled");

      // 顺延到满 5 分钟间隔才真正发布
      await vi.advanceTimersByTimeAsync(BATCH_PUBLISH_INTERVAL_MS);
      await registration.runtime.waitForIdle();
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publishTimes[1] - publishTimes[0]).toBeGreaterThanOrEqual(BATCH_PUBLISH_INTERVAL_MS);
      expect(registration.tasks.get(memberTask.id)?.status).toBe("success");
      await registration.dispose();
    });

    it("cascades remaining members to failure with zero extra publishes when the verification fails", async () => {
      const publish = vi.fn(async () => ({ status: "failure" as const, error: { code: "provider-request-failed", message: "上传失败", providerId: "aitoearn-local" as const, retryable: false } }));
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish) });
      await createBatchTask(registration, batchDraftDraft({ id: "draft-verify-f", batchRole: "verification", accountId: "account-a", scheduledAt: new Date(T0 + 1_000).toISOString() }));
      const memberTask = (await createBatchTask(registration, batchDraftDraft({ id: "draft-member-f", batchRole: "member", accountId: "account-b", scheduledAt: new Date(T0 + 2_000).toISOString() })))[0];

      await vi.advanceTimersByTimeAsync(BATCH_PUBLISH_INTERVAL_MS * 2);
      await registration.runtime.waitForIdle();
      expect(publish).toHaveBeenCalledTimes(1); // 只有首发验证外发了一次
      expect(registration.tasks.get(memberTask.id)).toMatchObject({
        status: "failure",
        error: { code: "batch-verification-failed", message: "首发验证未通过，本条未发布", retryable: false },
      });
      await registration.dispose();
    });

    it("cascades when a scheduled verification is canceled from the tasks tab", async () => {
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish) });
      const [verifyTask] = await createBatchTask(registration, batchDraftDraft({ id: "draft-verify-c", batchRole: "verification", accountId: "account-a", scheduledAt: new Date(T0 + 60_000).toISOString() }));
      const [memberTask] = await createBatchTask(registration, batchDraftDraft({ id: "draft-member-c", batchRole: "member", accountId: "account-b", scheduledAt: new Date(T0 + 120_000).toISOString() }));

      const reply = await handlers.get(SELF_MEDIA_IPC.cancelTask)?.(trustedEvent, { projectId: "project-1", taskId: verifyTask.id });
      expect(reply).toMatchObject({ success: true, value: { status: "canceled" } });
      expect(registration.tasks.get(memberTask.id)).toMatchObject({
        status: "failure",
        error: { code: "batch-verification-failed", message: "首发验证已取消，本条未发布" },
      });
      await vi.runAllTimersAsync();
      expect(publish).not.toHaveBeenCalled();
      await registration.dispose();
    });

    it("fails a member created after the cascade and returns the failed task in the receipt", async () => {
      const publish = vi.fn(async () => ({ status: "failure" as const, error: { code: "provider-request-failed", message: "上传失败", providerId: "aitoearn-local" as const, retryable: false } }));
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish) });
      const [verifyTask] = await createBatchTask(registration, batchDraftDraft({ id: "draft-verify-x", batchRole: "verification", accountId: "account-a", scheduledAt: new Date(T0 + 1_000).toISOString() }));
      await vi.advanceTimersByTimeAsync(1_000);
      await registration.runtime.waitForIdle();
      expect(registration.tasks.get(verifyTask.id)?.status).toBe("failure");

      // 级联之后才建出的成员:建单即置败,回执带回失败态
      const [memberTask] = await createBatchTask(registration, batchDraftDraft({ id: "draft-member-x", batchRole: "member", accountId: "account-b", scheduledAt: new Date(T0 + 90_000).toISOString() }));
      expect(memberTask.status).toBe("failure");
      expect(memberTask.error).toMatchObject({ code: "batch-verification-failed" });
      expect(publish).toHaveBeenCalledTimes(1);
      await registration.dispose();
    });

    it("reports daily publish stats from the ledger, counting today's due queued tasks", async () => {
      const registration = registerSelfMediaIpcHandlers({});
      await registration.runtimeReady;
      const today = localDayKey(new Date());
      const laterToday = new Date(); laterToday.setHours(23, 30, 0, 0);
      const nowIso = new Date().toISOString();
      registration.tasks.set("t-success", { id: "t-success", attemptId: "a1", projectId: "project-1", providerId: "aitoearn-local", accountId: "account-a", sourceAssetIds: ["v"], status: "success", progress: 100, createdAt: nowIso, updatedAt: nowIso });
      registration.tasks.set("t-queued-today", { id: "t-queued-today", attemptId: "a2", projectId: "project-1", providerId: "aitoearn-local", accountId: "account-a", sourceAssetIds: ["v"], status: "scheduled", progress: 0, batchId: "batch-1", batchRole: "queued", scheduledAt: laterToday.toISOString(), createdAt: nowIso, updatedAt: nowIso });
      registration.tasks.set("t-queued-tomorrow", { id: "t-queued-tomorrow", attemptId: "a3", projectId: "project-1", providerId: "aitoearn-local", accountId: "account-a", sourceAssetIds: ["v"], status: "scheduled", progress: 0, batchId: "batch-1", batchRole: "queued", scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: nowIso, updatedAt: nowIso });
      registration.tasks.set("t-failure", { id: "t-failure", attemptId: "a4", projectId: "project-1", providerId: "aitoearn-local", accountId: "account-a", sourceAssetIds: ["v"], status: "failure", progress: 100, createdAt: nowIso, updatedAt: nowIso });

      const reply = (await handlers.get(SELF_MEDIA_IPC.dailyPublishStats)?.(trustedEvent)) as SelfMediaDailyPublishStatsReply | undefined;
      expect(reply).toEqual({ success: true, value: { date: today, limit: 3, counts: { "account-a": 2 } } });
      await registration.dispose();
    });

    it("writes one diagnostic log entry when a batch task starts publishing", async () => {
      const entries: Array<{ category: string; operationId?: string; message: string; context?: Record<string, unknown> }> = [];
      const writeDiagnostic = vi.fn((entry: { category: string; operationId?: string; message: string; context?: Record<string, unknown> }) => {
        entries.push(entry);
      });
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish), writeDiagnostic: writeDiagnostic as never });
      await createBatchTask(registration, batchDraftDraft({ id: "draft-verify-log", batchRole: "verification", accountId: "account-a", platform: "twitter", scheduledAt: new Date(T0 + 1_000).toISOString() }));
      await vi.advanceTimersByTimeAsync(1_000);
      await registration.runtime.waitForIdle();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        category: "runtime",
        operationId: expect.stringContaining("self-media-task"),
        message: "self-media batch task started",
      });
      expect(entries[0].context).toMatchObject({ batchId: "batch-1", batchRole: "verification", platform: "twitter", scheduledAt: new Date(T0 + 1_000).toISOString() });
      expect(typeof entries[0].context?.releasedAt).toBe("number");

      // 不带 batchId 的普通定时任务开始发布不写这条日志
      entries.length = 0;
      await createBatchTask(registration, { ...batchDraftDraft({ id: "draft-plain", batchRole: "member", accountId: "account-c", scheduledAt: new Date(T0 + 120_000).toISOString() }), batchId: undefined });
      await vi.advanceTimersByTimeAsync(120_000);
      await registration.runtime.waitForIdle();
      expect(publish).toHaveBeenCalledTimes(2);
      expect(entries).toHaveLength(0);
      await registration.dispose();
    });

    it("paces a member released right before a restart using the conservative fallback", async () => {
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const first = registerSelfMediaIpcHandlers({ registry: successRegistry(publish), taskStorePath });
      await createBatchTask(first, batchDraftDraft({ id: "draft-verify-r", batchRole: "verification", accountId: "account-a", scheduledAt: new Date(T0 + 1_000).toISOString() }));
      await createBatchTask(first, batchDraftDraft({ id: "draft-member-r1", batchRole: "member", accountId: "account-b", scheduledAt: new Date(T0 + 2_000).toISOString() }));
      // 首发验证放行(成员被顺延),然后重启
      await vi.advanceTimersByTimeAsync(1_000);
      await first.runtime.waitForIdle();
      const memberAtRestart = [...first.tasks.values()].find((task) => task.batchRole === "member")!;
      expect(first.tasks.get(memberAtRestart.id)?.status).toBe("scheduled");
      await first.dispose();

      // 重启:闸门两张表为空,兜底看首发验证(同批非 scheduled 任务)的 updatedAt
      const second = registerSelfMediaIpcHandlers({ registry: successRegistry(publish), taskStorePath });
      await second.runtimeReady;
      const memberTask = second.tasks.get(memberAtRestart.id)!;
      expect(memberTask.status).toBe("scheduled");
      // 原定时刻已过,recover() 立即触发,但兜底要求距上次放行满 5 分钟
      await vi.advanceTimersByTimeAsync(2_000);
      await second.runtime.waitForIdle();
      expect(second.tasks.get(memberTask.id)?.status).toBe("scheduled");
      expect(publish).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(BATCH_PUBLISH_INTERVAL_MS);
      await second.runtime.waitForIdle();
      expect(second.tasks.get(memberTask.id)?.status).toBe("success");
      expect(publish).toHaveBeenCalledTimes(2);
      await second.dispose();
    });

    it("paces two same-account queued batches to the next day without firing them in the same second", async () => {
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const registration = registerSelfMediaIpcHandlers({ registry: successRegistry(publish) });
      const nextDay = new Date(T0 + 86_400_000); nextDay.setHours(8, 5, 0, 0);
      await createBatchTask(registration, batchDraftDraft({ id: "draft-queue-1", batchRole: "queued", batchId: "batch-q1", accountId: "account-a", scheduledAt: nextDay.toISOString() }));
      await createBatchTask(registration, batchDraftDraft({ id: "draft-queue-2", batchRole: "queued", batchId: "batch-q2", accountId: "account-a", scheduledAt: nextDay.toISOString() }));
      expect(publish).not.toHaveBeenCalled();

      // 到点:第一条放行,第二条被按账号的间隔检查顺延 5 分钟
      // (nextDay 是本地 08:05,不等于 T0+24h;推到时刻后 1 秒确保定时已触发)
      await vi.advanceTimersByTimeAsync(nextDay.getTime() - T0 + 1_000);
      await registration.runtime.waitForIdle();
      expect(publish).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(BATCH_PUBLISH_INTERVAL_MS);
      await registration.runtime.waitForIdle();
      expect(publish).toHaveBeenCalledTimes(2);
      await registration.dispose();
    });

    it("round-trips the batch fields and platform through the journal", async () => {
      const publish = vi.fn(async () => ({ status: "success" as const, progress: 100 }));
      const first = registerSelfMediaIpcHandlers({ registry: successRegistry(publish), taskStorePath });
      await createBatchTask(first, batchDraftDraft({ id: "draft-rt", batchRole: "queued", batchId: "batch-rt", accountId: "account-a", scheduledAt: new Date(T0 + 86_400_000).toISOString() }));
      await first.dispose();

      const second = registerSelfMediaIpcHandlers({ registry: successRegistry(publish), taskStorePath });
      await second.runtimeReady;
      const task = [...second.tasks.values()][0];
      expect(task).toMatchObject({ batchId: "batch-rt", batchRole: "queued", platform: "xhs" });
      await second.dispose();
    });

    it("loads legacy journal records that predate the batch fields", async () => {
      await fs.writeFile(taskStorePath, JSON.stringify({
        schemaVersion: 1,
        tasks: [{
          id: "task-legacy",
          attemptId: "attempt-legacy",
          projectId: "project-1",
          providerId: "aitoearn-local",
          accountId: "account-a",
          sourceAssetIds: ["video-1"],
          status: "success",
          progress: 100,
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:01:00.000Z",
        }],
        scheduledContexts: [],
      }));
      const registration = registerSelfMediaIpcHandlers({ taskStorePath });
      await registration.runtimeReady;
      const task = registration.tasks.get("task-legacy");
      expect(task).toMatchObject({ status: "success", batchId: undefined, batchRole: undefined, platform: undefined });
      await registration.dispose();
    });

    it("drops a journal record whose platform is not a registered platform", async () => {
      await fs.writeFile(taskStorePath, JSON.stringify({
        schemaVersion: 1,
        tasks: [{
          id: "task-bad-platform",
          attemptId: "attempt-bad-platform",
          projectId: "project-1",
          providerId: "aitoearn-local",
          accountId: "account-a",
          sourceAssetIds: ["video-1"],
          status: "success",
          progress: 100,
          platform: "not-a-platform",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:01:00.000Z",
        }],
        scheduledContexts: [],
      }));
      const registration = registerSelfMediaIpcHandlers({ taskStorePath });
      await registration.runtimeReady;
      expect(registration.tasks.size).toBe(0);
      await registration.dispose();
    });
  });
});
