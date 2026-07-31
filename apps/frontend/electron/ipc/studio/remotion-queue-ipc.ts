import { BrowserWindow, ipcMain } from "electron";
import {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  REMOTION_QUEUE_CHECK_SWITCH_CHANNEL,
  type RemotionQueueJobRequest,
  type RemotionQueueEnqueueShotRequest,
  type RemotionQueueScopeReply,
  type RemotionQueueScopeRequest,
  type RemotionQueueSwitchRequest,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { RemotionRenderQueue, type RemotionQueueNotification } from "@rendering/plugins/remotion/queue/remotion-render-queue";

export {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  REMOTION_QUEUE_CHECK_SWITCH_CHANNEL,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";

export interface RemotionQueueIpcOptions {
  getCurrentShotSlots?: (scope: RemotionQueueScopeRequest) => Promise<RemotionCurrentSlotV1[]>;
}

export function registerRemotionQueueIpcHandlers(
  queue: RemotionRenderQueue,
  options: RemotionQueueIpcOptions = {},
): { dispose: () => void } {
  const unsubscribe = queue.subscribe((notification) => broadcast(notification));
  ipcMain.handle(REMOTION_QUEUE_GET_CHANNEL, async (_event, payload: unknown): Promise<RemotionQueueScopeReply> => {
    const request = parseScope(payload);
    await queue.init();
    const jobs = queue.getJobs(request);
    const currentShotSlots = options.getCurrentShotSlots
      ? await options.getCurrentShotSlots(request)
      : [];
    return {
      projectId: request.projectId,
      chapterId: request.chapterId,
      jobs,
      currentShotSlots,
    };
  });
  ipcMain.handle(REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL, async (_event, payload: unknown) => {
    const request = parseEnqueueShot(payload);
    return queue.enqueueShot({ kind: "shot", job: request.job, plan: request.plan });
  });
  ipcMain.handle(REMOTION_QUEUE_RETRY_CHANNEL, async (_event, payload: unknown) => {
    const request = parseJob(payload);
    return queue.retry(request.jobId);
  });
  ipcMain.handle(REMOTION_QUEUE_CANCEL_CHANNEL, (_event, payload: unknown) => {
    const request = parseJob(payload);
    return queue.cancel(request.jobId);
  });
  ipcMain.handle(REMOTION_QUEUE_SWITCH_CHANNEL, async (_event, payload: unknown) => {
    const request = parseSwitch(payload);
    return queue.activateProject(request.toProjectId);
  });
  ipcMain.handle(REMOTION_QUEUE_CHECK_SWITCH_CHANNEL, async (_event, payload: unknown) => {
    const request = parseSwitch(payload);
    await queue.init();
    return queue.requestProjectSwitch(request.toProjectId);
  });
  return {
    dispose() {
      unsubscribe();
      ipcMain.removeHandler(REMOTION_QUEUE_GET_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_RETRY_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_CANCEL_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_SWITCH_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_CHECK_SWITCH_CHANNEL);
    },
  };
}

function parseScope(value: unknown): RemotionQueueScopeRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "chapterId"])) throw new Error("queue scope 请求字段无效");
  return {
    projectId: parseId(value.projectId, "projectId"),
    chapterId: parseId(value.chapterId, "chapterId"),
  };
}

function parseJob(value: unknown): RemotionQueueJobRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["jobId"])) throw new Error("queue job 请求字段无效");
  return { jobId: parseId(value.jobId, "jobId") };
}

function parseEnqueueShot(value: unknown): RemotionQueueEnqueueShotRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["job", "plan"]) || !isRecord(value.job) || !isRecord(value.plan)) {
    throw new Error("queue enqueue shot 请求字段无效");
  }
  return {
    job: value.job as unknown as RemotionQueueEnqueueShotRequest["job"],
    plan: value.plan as unknown as RemotionQueueEnqueueShotRequest["plan"],
  };
}

function parseSwitch(value: unknown): RemotionQueueSwitchRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["toProjectId"])) throw new Error("queue switch 请求字段无效");
  return { toProjectId: parseId(value.toProjectId, "toProjectId") };
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\\/\0]/.test(value)) throw new Error(`${label} 无效`);
  return value.trim();
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function broadcast(notification: RemotionQueueNotification): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(REMOTION_QUEUE_JOB_EVENT, notification);
  }
}
