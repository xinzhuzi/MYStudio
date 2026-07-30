// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";

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
      enqueueShot: vi.fn(async () => ({ accepted: false, reason: "invalid", message: "invalid" })),
      retry: vi.fn(async (jobId: string) => ({ accepted: false, reason: "invalid", message: jobId })),
      cancel: vi.fn((jobId: string) => ({ success: true, jobId, canceled: true })),
      activateProject: vi.fn(async (toProjectId: string) => ({ allowed: true, toProjectId })),
    };
    const registration = registerRemotionQueueIpcHandlers(queue as never);

    await expect(electronState.handlers.get(REMOTION_QUEUE_GET_CHANNEL)!({}, { projectId: "../bad", chapterId: "chapter-1" }))
      .rejects.toThrow("projectId 无效");
    await expect(electronState.handlers.get(REMOTION_QUEUE_GET_CHANNEL)!({}, { projectId: "project-a", chapterId: "chapter-1" }))
      .resolves.toEqual({ projectId: "project-a", chapterId: "chapter-1", jobs: [] });
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
});
