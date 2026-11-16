import { BrowserWindow, ipcMain } from "electron";
import {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  REMOTION_QUEUE_CHECK_SWITCH_CHANNEL,
  type RemotionQueueJobRequest,
  type RemotionQueueEnqueueShotRequest,
  type RemotionQueueEnqueueChapterScenesReply,
  type RemotionQueueEnqueueChapterScenesRequest,
  type RemotionQueueScopeReply,
  type RemotionQueueScopeRequest,
  type RemotionQueueSwitchRequest,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { RemotionRenderQueue, type RemotionQueueNotification } from "@rendering/plugins/remotion/queue/remotion-render-queue";

export {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  REMOTION_QUEUE_CHECK_SWITCH_CHANNEL,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";

export interface RemotionQueueIpcOptions {
  getCurrentShotSlots?: (scope: RemotionQueueScopeRequest) => Promise<RemotionCurrentSlotV1[]>;
  /** 按场分段导出入队服务（main 侧编译章级 projection 并做场校验后入队）。 */
  enqueueChapterScenes?: (
    request: RemotionQueueEnqueueChapterScenesRequest,
  ) => Promise<RemotionQueueEnqueueChapterScenesReply>;
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
      concurrency: queue.getConcurrency(),
      ...(queue.getPersistenceError() ? { persistenceError: queue.getPersistenceError() } : {}),
    };
  });
  ipcMain.handle(REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL, async (_event, payload: unknown) => {
    const request = parseEnqueueShot(payload);
    return queue.enqueueShot({ kind: "shot", job: request.job, plan: request.plan });
  });
  ipcMain.handle(REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL, async (_event, payload: unknown): Promise<RemotionQueueEnqueueChapterScenesReply> => {
    if (!options.enqueueChapterScenes) {
      return { accepted: false, message: "按场分段导出服务不可用" };
    }
    return options.enqueueChapterScenes(parseEnqueueChapterScenes(payload));
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
      ipcMain.removeHandler(REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_RETRY_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_CANCEL_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_SWITCH_CHANNEL);
      ipcMain.removeHandler(REMOTION_QUEUE_CHECK_SWITCH_CHANNEL);
    },
  };
}

function parseScope(value: unknown): RemotionQueueScopeRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "chapterId"])) {
    // 1116 P4 墙一:07:10 装机一次性报错因文案不含实发形状而不可诊断(诊断日志
    // 无录 payload、装机分片已失)。附实发形状(仅键名不出值),下次复发日志自证。
    throw new Error(`queue scope 请求字段无效: 期望恰为 projectId,chapterId 两键,实际收到 ${describeIpcPayloadShape(value)}`);
  }
  return {
    projectId: parseId(value.projectId, "projectId"),
    chapterId: parseId(value.chapterId, "chapterId"),
  };
}

/** IPC 形状描述(只列键名,永不带值)——排障可见性专用。 */
function describeIpcPayloadShape(value: unknown): string {
  if (!isRecord(value)) return `非对象(${Array.isArray(value) ? "array" : typeof value})`;
  const keys = Object.keys(value);
  return keys.length === 0 ? "空对象" : `键 [${keys.join(",")}]`;
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

function parseEnqueueChapterScenes(value: unknown): RemotionQueueEnqueueChapterScenesRequest {
  if (!isRecord(value) || !Array.isArray(value.segments) || value.segments.length === 0) {
    throw new Error("queue enqueue chapter scenes 请求字段无效");
  }
  const segments: RemotionQueueEnqueueChapterScenesRequest["segments"] = [];
  for (const segment of value.segments) {
    if (!isRecord(segment)
      || !Number.isInteger(segment.sceneNo)
      || Number(segment.sceneNo) < 1
      || typeof segment.sceneName !== "string"
      || !Array.isArray(segment.storyboardIds)
      || segment.storyboardIds.length === 0
      || segment.storyboardIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("queue enqueue chapter scenes segment 字段无效");
    }
    segments.push({
      sceneNo: Number(segment.sceneNo),
      sceneName: segment.sceneName,
      storyboardIds: segment.storyboardIds as string[],
    });
  }
  return {
    projectId: parseId(value.projectId, "projectId"),
    chapterId: parseId(value.chapterId, "chapterId"),
    editingRevision: parseRevision(value.editingRevision),
    segments,
  };
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("editingRevision 无效");
  return Number(value);
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
