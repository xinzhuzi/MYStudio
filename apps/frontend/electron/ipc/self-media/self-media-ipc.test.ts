import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  },
}));

import { registerSelfMediaIpcHandlers } from "./self-media-ipc";
import { SELF_MEDIA_IPC, type SelfMediaCreateTaskReply } from "../../../lib/self-media/ipc-contract";
import { createAitoearnLocalAdapter, createSelfMediaProviderRegistry } from "../../aitoearn/provider-registry";
import { SelfMediaProviderError } from "../../aitoearn/provider-registry";
import { SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS } from "../../../lib/self-media/capabilities";
import type { SelfMediaTask } from "../../../types/self-media";

const SELF_MEDIA_PLATFORMS = SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS;

describe("registerSelfMediaIpcHandlers", () => {
  const taskStorePath = path.join(os.tmpdir(), `mystudio-self-media-${process.pid}.json`);
  const credentialVault = {
    set: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    await fs.rm(taskStorePath, { force: true });
    handlers.clear();
    sent.mockClear();
    vi.clearAllMocks();
    registerSelfMediaIpcHandlers({ credentialVault });
  });

  afterAll(async () => {
    await fs.rm(taskStorePath, { force: true });
  });

  it("exposes disabled providers without claiming a publish capability", async () => {
    const reply = await handlers.get(SELF_MEDIA_IPC.listProviders)?.();
    expect(reply).toEqual({
      success: true,
      value: [
        { id: "aitoearn-local", displayName: "AiToEarn 本地适配器", enabled: false, reason: "本地平台适配器正在迁移" },
      ],
    });
  });

  it("rejects invalid task payloads before any provider request", async () => {
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
      projectId: "project-1",
      providerId: "aitoearn-local",
      draft: { projectId: "other-project" },
    })) as SelfMediaCreateTaskReply | undefined;
    expect(reply).toEqual({ success: false, error: { code: "invalid-task-request", message: "任务项目范围无效" } });
  });

  it("returns invalid-provider when a renderer supplies an unknown provider", async () => {
    const listReply = await handlers.get(SELF_MEDIA_IPC.listAccounts)?.({}, { projectId: "project-1", providerId: "unknown-provider" });
    expect(listReply).toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });

    const createReply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
      projectId: "project-1",
      providerId: "unknown-provider",
      draft: { projectId: "project-1", assets: [], accountIds: [] },
    });
    expect(createReply).toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });
  });

  it("returns invalid-provider for poll and cancel of a task with an unknown provider", async () => {
    const registration = registerSelfMediaIpcHandlers({ credentialVault });
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

    await expect(handlers.get(SELF_MEDIA_IPC.pollTask)?.({}, {
      projectId: "project-1",
      taskId: malformedTask.id,
    })).resolves.toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });
    await expect(handlers.get(SELF_MEDIA_IPC.cancelTask)?.({}, {
      projectId: "project-1",
      taskId: malformedTask.id,
    })).resolves.toEqual({ success: false, error: { code: "invalid-provider", message: "provider 无效" } });

    await registration.dispose();
  });

  it("does not return a malformed task from the successful list reply", async () => {
    const registration = registerSelfMediaIpcHandlers({ credentialVault });
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
    await expect(handlers.get(SELF_MEDIA_IPC.listTasks)?.({}, { projectId: "project-1" }))
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
    registerSelfMediaIpcHandlers({ credentialVault, registry });
    await expect(handlers.get(SELF_MEDIA_IPC.startLogin)?.({}, { projectId: "project-1", providerId: "aitoearn-local", platform: "xhs" }))
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
    registerSelfMediaIpcHandlers({ credentialVault, registry });

    for (const platform of SELF_MEDIA_PLATFORMS) {
      await expect(handlers.get(SELF_MEDIA_IPC.startLogin)?.({}, {
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
    registerSelfMediaIpcHandlers({ credentialVault, registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.listAccounts)?.({}, { projectId: "project-1", providerId: "aitoearn-local" });
    expect(reply).toEqual({ success: true, value: [expect.not.objectContaining({ credential: expect.anything() })] });
  });

  it("does not persist an ignored API-key-like field", async () => {
    const reply = await handlers.get(SELF_MEDIA_IPC.configureProvider)?.({}, {
      providerId: "aitoearn-local",
      apiKey: "secret-value",
    });
    expect(reply).toEqual({ success: true, value: { providerId: "aitoearn-local", configured: true } });
    expect(credentialVault.set).not.toHaveBeenCalled();
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry });
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
    await expect(handlers.get(SELF_MEDIA_IPC.cancelTask)?.({}, { projectId: "project-1", taskId: "task-running" }))
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry, localBridge: {} as never });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault });
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
    registerSelfMediaIpcHandlers({ credentialVault, registry });
    const reply = (await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
      const first = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
      const created = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
          updatedAt: "2026-07-27T00:00:00.000Z",
        },
      });
      expect(created).toMatchObject({ success: true, value: [{ status: "scheduled" }] });
      expect(publish).not.toHaveBeenCalled();
      await first.dispose();

      const second = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
      await handlers.get(SELF_MEDIA_IPC.listTasks)?.({}, { projectId: "project-1" });
      await second.runtimeReady;
      expect(second.tasks.size).toBe(1);
      expect(second.scheduledContexts.size).toBe(1);
      expect([...second.tasks.values()][0]?.status).toBe("scheduled");
      expect(vi.getTimerCount()).toBe(1);
      await vi.runAllTimersAsync();
      await second.runtime.waitForIdle();
      expect([...second.tasks.values()][0]?.status).toBe("success");
      expect(publish).toHaveBeenCalledOnce();
      expect(await handlers.get(SELF_MEDIA_IPC.listTasks)?.({}, { projectId: "project-1" }))
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
    const first = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
    await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
    const second = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
    await handlers.get(SELF_MEDIA_IPC.listAccounts)?.({}, { projectId: "project-1", providerId: "aitoearn-local" });
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, taskStorePath });
    await registration.runtimeReady;
    expect([...registration.tasks.keys()]).toEqual(["task-valid"]);
    await registration.dispose();
    const journal = await fs.readFile(taskStorePath, "utf8");
    expect(journal).not.toContain("must-not-load");
    expect(JSON.parse(journal).tasks).toEqual([validTask]);
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry });
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
    const cancellation = handlers.get(SELF_MEDIA_IPC.cancelTask)?.({}, { projectId: "project-1", taskId: running.id });
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
      const registration = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
    const reply = await handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
    const registration = registerSelfMediaIpcHandlers({ credentialVault, registry, taskStorePath });
    const create = (id: string) => handlers.get(SELF_MEDIA_IPC.createTask)?.({}, {
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
});
