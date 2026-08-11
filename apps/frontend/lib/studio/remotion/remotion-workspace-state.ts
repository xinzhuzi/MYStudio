import type {
  RemotionJobError,
  RemotionRenderJobIdentityV1,
  RemotionRenderJobV1,
  RemotionStageStatus,
} from "@/types/remotion-workspace";
import { createRemotionRenderJobId as createJobId } from "./remotion-job-identity";
import { validateRemotionRenderJob } from "./remotion-render-validation";
import type { RemotionValidationResult } from "./remotion-validation-utils";

export const REMOTION_TERMINAL_STATUSES: ReadonlySet<RemotionStageStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
]);

const REMOTION_TRANSITIONS: Record<RemotionStageStatus, ReadonlySet<RemotionStageStatus>> = {
  pending: new Set(["pending", "blocked", "ready", "stale"]),
  blocked: new Set(["blocked", "ready", "failed", "stale"]),
  ready: new Set(["ready", "queued", "blocked", "stale"]),
  queued: new Set(["queued", "running", "canceled", "stale"]),
  running: new Set(["running", "succeeded", "failed", "canceled", "stale"]),
  succeeded: new Set(["succeeded", "stale"]),
  failed: new Set(["failed", "queued", "blocked", "stale"]),
  canceled: new Set(["canceled", "queued", "blocked", "stale"]),
  stale: new Set(["stale", "blocked", "ready"]),
};

export interface RemotionJobTransition {
  status: RemotionStageStatus;
  at: number;
  progress?: number;
  error?: RemotionJobError;
  outputPath?: string;
  evidencePath?: string;
}

export function canTransitionRemotionStatus(from: RemotionStageStatus, to: RemotionStageStatus): boolean {
  return REMOTION_TRANSITIONS[from].has(to);
}

export async function createRemotionRenderJobId(identity: RemotionRenderJobIdentityV1): Promise<string> {
  return createJobId(identity);
}

export function transitionRemotionRenderJob(
  job: RemotionRenderJobV1,
  transition: RemotionJobTransition,
): RemotionValidationResult<RemotionRenderJobV1> {
  const current = validateRemotionRenderJob(job);
  if (!current.success) return current;
  if (!Number.isSafeInteger(transition.at) || transition.at < 0) {
    return transitionFailure("$.at", "transition.at 必须是非负安全整数");
  }
  if (!canTransitionRemotionStatus(job.status, transition.status)) {
    return transitionFailure(
      "$.status",
      `不允许从 ${job.status} 转换到 ${transition.status}`,
    );
  }
  if (transition.status === job.status) return current;
  const next = stripUndefinedJob(applyTransition(job, transition));
  return validateRemotionRenderJob(next);
}

export function currentRemotionJobFingerprint(job: RemotionRenderJobV1): string {
  return [
    job.projectId,
    job.jobId,
    job.inputHash,
    job.bundleContentHash,
    job.renderSettingsHash,
    job.status,
    String(job.attempt),
  ].join(":");
}

function applyTransition(job: RemotionRenderJobV1, transition: RemotionJobTransition): RemotionRenderJobV1 {
  const next: RemotionRenderJobV1 = { ...job, status: transition.status };
  switch (transition.status) {
    case "queued":
      return {
        ...next,
        attempt: job.attempt + 1,
        progress: 0,
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
        outputPath: undefined,
        evidencePath: undefined,
      };
    case "running":
      return {
        ...next,
        progress: transition.progress ?? 0,
        startedAt: transition.at,
        completedAt: undefined,
        error: undefined,
      };
    case "succeeded":
      return {
        ...next,
        progress: 1,
        completedAt: transition.at,
        error: undefined,
        outputPath: transition.outputPath,
        evidencePath: transition.evidencePath,
      };
    case "failed":
    case "canceled":
      return {
        ...next,
        progress: transition.progress ?? job.progress,
        completedAt: transition.at,
        error: transition.error,
      };
    case "blocked":
      return {
        ...next,
        progress: transition.progress ?? job.progress,
        completedAt: undefined,
        error: transition.error,
      };
    case "stale":
      return {
        ...next,
        progress: 0,
        completedAt: undefined,
        error: transition.error,
      };
    case "ready":
    case "pending":
      return {
        ...next,
        progress: 0,
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
        outputPath: undefined,
        evidencePath: undefined,
      };
  }
}

function transitionFailure(path: string, message: string): RemotionValidationResult<never> {
  return {
    success: false,
    issues: [{ code: "remotion.job.transition", path, message }],
  };
}

function stripUndefinedJob(job: RemotionRenderJobV1): RemotionRenderJobV1 {
  return Object.fromEntries(
    Object.entries(job).filter(([, value]) => value !== undefined),
  ) as unknown as RemotionRenderJobV1;
}
