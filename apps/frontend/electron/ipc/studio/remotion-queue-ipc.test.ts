// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  decodeRemotionQueueScopeReply,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";
import { makeCurrentSlot } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";

type Handler = (...args: unknown[]) => unknown;
const electronState = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  removed: [] as string[],
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }>,
}));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => electronState.windows) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => electronState.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => {
      electronState.removed.push(channel);
      electronState.handlers.delete(channel);
    }),
  },
}));

import { registerRemotionQueueIpcHandlers } from "./remotion-queue-ipc";

beforeEach(() => {
  electronState.handlers.clear();
  electronState.removed.length = 0;
  electronState.windows = [];
});

describe("Remotion queue IPC", () => {
  it("validates scope, retry, cancel, and project switch requests", async () => {
    const listener = vi.fn();
    const queue = {
      subscribe: vi.fn((callback: (value: unknown) => void) => {
        listener.mockImplementation(callback);
        return vi.fn();
      }),
      init: vi.fn(async () => undefined),
      getJobs: vi.fn(() => []),
      getConcurrency: vi.fn(() => 3),
      getPersistenceError: vi.fn(() => undefined),
      enqueueShot: vi.fn(async () => ({ accepted: false, reason: "invalid", message: "invalid" })),
      retry: vi.fn(async (jobId: string) => ({ accepted: false, reason: "invalid", message: jobId })),
      cancel: vi.fn((jobId: string) => ({ success: true, jobId, canceled: true })),
      activateProject: vi.fn(async (toProjectId: string) => ({ allowed: true, toProjectId })),
    };
    const registration = registerRemotionQueueIpcHandlers(queue as never, {
      getCurrentShotSlots: vi.fn(async () => []),
    });

    await expect(electronState.handlers.get(REMOTION_QUEUE_GET_CHANNEL)!({}, { projectId: "../bad", chapterId: "chapter-1" }))
      .rejects.toThrow("projectId 无效");
    await expect(electronState.handlers.get(REMOTION_QUEUE_GET_CHANNEL)!({}, { projectId: "project-a", chapterId: "chapter-1" }))
      .resolves.toEqual({ projectId: "project-a", chapterId: "chapter-1", jobs: [], currentShotSlots: [], concurrency: 3 });
    expect(queue.getJobs).toHaveBeenCalledWith({ projectId: "project-a", chapterId: "chapter-1" });

    await expect(electronState.handlers.get(REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL)!({}, { job: {}, plan: {}, extra: true }))
      .rejects.toThrow("queue enqueue shot 请求字段无效");

    await expect(electronState.handlers.get(REMOTION_QUEUE_RETRY_CHANNEL)!({}, { jobId: "job-1" }))
      .resolves.toMatchObject({ accepted: false, reason: "invalid" });
    expect(electronState.handlers.get(REMOTION_QUEUE_CANCEL_CHANNEL)!({}, { jobId: "job-1" }))
      .toEqual({ success: true, jobId: "job-1", canceled: true });
    await expect(electronState.handlers.get(REMOTION_QUEUE_SWITCH_CHANNEL)!({}, { toProjectId: "project-b" }))
      .resolves.toEqual({ allowed: true, toProjectId: "project-b" });

    const send = vi.fn();
    electronState.windows = [{ isDestroyed: () => false, webContents: { send } }];
    listener({ type: "job", projectId: "project-a", chapterId: "chapter-1", jobId: "job-1", status: "running" });
    expect(send).toHaveBeenCalledWith(REMOTION_QUEUE_JOB_EVENT, expect.objectContaining({ jobId: "job-1" }));

    registration.dispose();
    expect(electronState.removed).toEqual(expect.arrayContaining([
      REMOTION_QUEUE_GET_CHANNEL,
      REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
      REMOTION_QUEUE_RETRY_CHANNEL,
      REMOTION_QUEUE_CANCEL_CHANNEL,
      REMOTION_QUEUE_SWITCH_CHANNEL,
    ]));
  });

  it("accepts only current slots scoped to the requested project and chapter", () => {
    const slot = makeCurrentSlot();
    expect(decodeRemotionQueueScopeReply({
      projectId: "project-a",
      chapterId: "chapter-001",
      jobs: [slot.job],
      currentShotSlots: [slot],
    })?.currentShotSlots).toHaveLength(1);
    expect(decodeRemotionQueueScopeReply({
      projectId: "project-a",
      chapterId: "chapter-002",
      jobs: [slot.job],
      currentShotSlots: [slot],
    })).toBeUndefined();
  });

  // 1116 P4 墙一契约钉:remotion-queue-get payload 恰为 {projectId,chapterId} 两键。
  // 07:10 装机一次性「queue scope 请求字段无效」因日志无录 payload 不可诊断——
  // 此处钉死形状边界:恰两键通过,多键/缺键/非对象一律拒,且报错携带实发键名。
  it("rejects remotion-queue-get payloads that are not exactly {projectId, chapterId}", async () => {
    const queue = {
      subscribe: vi.fn(() => vi.fn()),
      init: vi.fn(async () => undefined),
      getJobs: vi.fn(() => []),
      getConcurrency: vi.fn(() => 1),
      getPersistenceError: vi.fn(() => undefined),
    };
    registerRemotionQueueIpcHandlers(queue as never);
    const handler = electronState.handlers.get(REMOTION_QUEUE_GET_CHANNEL)!;

    // 恰两键通过(字符串shorthand与显式键序无关)
    await expect(handler({}, { projectId: "project-a", chapterId: "chapter-1" }))
      .resolves.toMatchObject({ projectId: "project-a", chapterId: "chapter-1", jobs: [] });

    // 多键拒(含疑似从 enqueue-chapter-scenes 串台的多余字段)
    await expect(handler({}, { projectId: "project-a", chapterId: "chapter-1", editingRevision: 3 }))
      .rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, { projectId: "project-a", chapterId: "chapter-1", extra: true }))
      .rejects.toThrow("queue scope 请求字段无效");

    // 缺键拒
    await expect(handler({}, { projectId: "project-a" }))
      .rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, { chapterId: "chapter-1" }))
      .rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, {}))
      .rejects.toThrow("queue scope 请求字段无效");

    // 非对象拒(undefined/null/array/string)
    await expect(handler({}, undefined)).rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, null)).rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, ["project-a", "chapter-1"])).rejects.toThrow("queue scope 请求字段无效");
    await expect(handler({}, "project-a")).rejects.toThrow("queue scope 请求字段无效");

    // 报错可见性:实发形状(键名,不出值)必须出现在错文中——1116 墙一复发时日志自证
    await expect(handler({}, { projectId: "p", chapterId: "c", editingRevision: 3 }))
      .rejects.toThrow("editingRevision");
    await expect(handler({}, undefined))
      .rejects.toThrow("非对象");
  });
});
