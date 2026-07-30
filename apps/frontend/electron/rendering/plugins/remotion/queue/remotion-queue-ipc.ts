import type {
  RemotionQueueEnqueueResult,
  RemotionQueueNotification,
  RemotionQueueSwitchResult,
} from "./remotion-render-queue";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { validateRemotionRenderJob } from "@/lib/studio/remotion/remotion-render-validation";

export const REMOTION_QUEUE_GET_CHANNEL = "remotion-queue-get";
export const REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL = "remotion-queue-enqueue-shot";
export const REMOTION_QUEUE_RETRY_CHANNEL = "remotion-queue-retry";
export const REMOTION_QUEUE_CANCEL_CHANNEL = "remotion-queue-cancel";
export const REMOTION_QUEUE_SWITCH_CHANNEL = "remotion-queue-switch";
export const REMOTION_QUEUE_CHECK_SWITCH_CHANNEL = "remotion-queue-check-switch";
export const REMOTION_QUEUE_JOB_EVENT = "remotion-queue-job";

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
}

export interface RemotionQueueEnqueueShotRequest {
  job: RemotionRenderJobV1;
  plan: import("@/lib/studio/remotion/shot-plan").RemotionShotPlanV1;
}

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
    || !Array.isArray(value.jobs)) {
    return undefined;
  }
  const jobs: RemotionRenderJobV1[] = [];
  for (const rawJob of value.jobs) {
    const result = validateRemotionRenderJob(rawJob);
    if (!result.success) return undefined;
    jobs.push(result.value);
  }
  return { projectId: value.projectId, chapterId: value.chapterId, jobs };
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
