import type {
  RemotionQueueEnqueueResult,
  RemotionQueueNotification,
  RemotionQueueSwitchResult,
} from "./remotion-render-queue";
import type {
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";
import { validateRemotionCurrentSlotCollection } from "@/lib/studio/remotion/remotion-slot-validation";
import { validateRemotionRenderJob } from "@/lib/studio/remotion/remotion-render-validation";

export const REMOTION_QUEUE_GET_CHANNEL = "remotion-queue-get";
export const REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL = "remotion-queue-enqueue-shot";
export const REMOTION_QUEUE_RETRY_CHANNEL = "remotion-queue-retry";
export const REMOTION_QUEUE_CANCEL_CHANNEL = "remotion-queue-cancel";
export const REMOTION_QUEUE_SWITCH_CHANNEL = "remotion-queue-switch";
export const REMOTION_QUEUE_CHECK_SWITCH_CHANNEL = "remotion-queue-check-switch";
export const REMOTION_QUEUE_JOB_EVENT = "remotion-queue-job";
export const REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL = "remotion-queue-enqueue-chapter-scenes";

export interface RemotionQueueScopeRequest {
  projectId: string;
  chapterId: string;
}

export interface RemotionQueueJobRequest {
  jobId: string;
}

export interface RemotionQueueSwitchRequest {
  toProjectId: string;
}

export interface RemotionQueueScopeReply {
  projectId: string;
  chapterId: string;
  jobs: RemotionRenderJobV1[];
  currentShotSlots: RemotionCurrentSlotV1[];
}

export interface RemotionQueueEnqueueShotRequest {
  job: RemotionRenderJobV1;
  plan: import("@/lib/studio/remotion/shot-plan").RemotionShotPlanV1;
}

/** 按场分段导出入队请求：main 侧复用章级 projection 编译器并做场校验。 */
export interface RemotionQueueEnqueueChapterScenesRequest {
  projectId: string;
  chapterId: string;
  editingRevision: number;
  segments: Array<{
    sceneNo: number;
    sceneName: string;
    storyboardIds: string[];
  }>;
}

export interface RemotionQueueEnqueueChapterScenesReplySegment {
  sceneNo: number;
  jobId: string;
  /** 相对项目 Remotion workspace 的产物路径。 */
  outputRelativePath: string;
  /** 绝对路径（渲染域登记 sceneSegments 用）。 */
  outputAbsolutePath: string;
  /** 闭区间帧范围（与整章 composition 同一布局轴；登记进 sceneSegments）。 */
  frameRange: [number, number];
}

export type RemotionQueueEnqueueChapterScenesReply =
  | { accepted: true; segments: RemotionQueueEnqueueChapterScenesReplySegment[] }
  | { accepted: false; message: string };

export type RemotionQueueRetryReply = RemotionQueueEnqueueResult;
export interface RemotionQueueCancelReply {
  success: boolean;
  jobId: string;
  canceled: boolean;
  error?: string;
}
export type RemotionQueueSwitchReply = RemotionQueueSwitchResult;

export function decodeRemotionQueueScopeReply(value: unknown): RemotionQueueScopeReply | undefined {
  if (!isRecord(value)
    || typeof value.projectId !== "string"
    || typeof value.chapterId !== "string"
    || !Array.isArray(value.jobs)
    || !Array.isArray(value.currentShotSlots)) {
    return undefined;
  }
  const jobs: RemotionRenderJobV1[] = [];
  for (const rawJob of value.jobs) {
    const result = validateRemotionRenderJob(rawJob);
    if (!result.success) return undefined;
    jobs.push(result.value);
  }
  const slotResult = validateRemotionCurrentSlotCollection(value.currentShotSlots);
  if (!slotResult.success) return undefined;
  const currentShotSlots = slotResult.value.filter((slot) =>
    slot.projectId === value.projectId
      && slot.target.kind === "shot"
      && slot.target.chapterId === value.chapterId,
  );
  if (currentShotSlots.length !== slotResult.value.length) return undefined;
  return { projectId: value.projectId, chapterId: value.chapterId, jobs, currentShotSlots };
}

export function decodeRemotionQueueNotification(value: unknown): RemotionQueueNotification | undefined {
  if (!isRecord(value)
    || value.type !== "job"
    || typeof value.projectId !== "string"
    || typeof value.chapterId !== "string"
    || typeof value.jobId !== "string"
    || typeof value.status !== "string") {
    return undefined;
  }
  return value as unknown as RemotionQueueNotification;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
