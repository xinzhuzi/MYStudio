import path from "node:path";
import type {
  RemotionRenderInput,
  RemotionRenderProgress,
  RemotionRenderWorkerResult,
} from "./remotion-render-worker";

export const REMOTION_RENDER_WORKER_ACTIONS = ["render", "cancel"] as const;
export type RemotionRenderWorkerAction = typeof REMOTION_RENDER_WORKER_ACTIONS[number];

export type RemotionRenderWorkerCommand =
  | {
      schemaVersion: 1;
      requestId: string;
      action: "render";
      input: RemotionRenderInput;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      action: "cancel";
      jobId: string;
    };

export type RemotionRenderWorkerEvent =
  | {
      kind: "progress";
      requestId: string;
      progress: RemotionRenderProgress;
    }
  | {
      kind: "result";
      requestId: string;
      result: RemotionRenderWorkerResult;
    }
  | {
      kind: "error";
      requestId: string;
      message: string;
    };

export type RemotionRenderWorkerValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function validateRemotionRenderWorkerCommand(
  value: unknown,
): RemotionRenderWorkerValidationResult<RemotionRenderWorkerCommand> {
  if (!isRecord(value)) return failure("$", "Remotion render worker 命令必须是对象");
  if (value.schemaVersion !== 1) return failure("schemaVersion", "render worker schemaVersion 必须为 1");
  if (!isNonEmptyString(value.requestId)) return failure("requestId", "render worker requestId 必须是非空字符串");
  if (value.action === "cancel") {
    if (!hasOnlyKeys(value, ["schemaVersion", "requestId", "action", "jobId"])) {
      return failure("$", "render worker cancel 命令包含未知字段");
    }
    if (!isNonEmptyString(value.jobId)) return failure("jobId", "render worker cancel jobId 必须是非空字符串");
    return { success: true, value: value as unknown as RemotionRenderWorkerCommand };
  }
  if (value.action !== "render") return failure("action", "render worker action 无效");
  if (!hasOnlyKeys(value, ["schemaVersion", "requestId", "action", "input"])) {
    return failure("$", "render worker render 命令包含未知字段");
  }
  const input = validateRenderInput(value.input);
  if (!input.success) return input;
  return { success: true, value: { ...value, input: input.value } as RemotionRenderWorkerCommand };
}

export function validateRemotionRenderWorkerEvent(
  value: unknown,
): RemotionRenderWorkerValidationResult<RemotionRenderWorkerEvent> {
  if (!isRecord(value)) return failure("$", "Remotion render worker 事件必须是对象");
  if (!isNonEmptyString(value.requestId)) return failure("requestId", "render worker event requestId 必须是非空字符串");
  if (value.kind === "progress") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "progress"])) return failure("$", "render worker progress 事件包含未知字段");
    const progress = validateProgress(value.progress);
    if (!progress.success) return progress;
    return { success: true, value: value as unknown as RemotionRenderWorkerEvent };
  }
  if (value.kind === "result") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "result"])) return failure("$", "render worker result 事件包含未知字段");
    const result = validateResult(value.result);
    if (!result.success) return result;
    return { success: true, value: value as unknown as RemotionRenderWorkerEvent };
  }
  if (value.kind === "error") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "message"])) return failure("$", "render worker error 事件包含未知字段");
    if (!isNonEmptyString(value.message)) return failure("message", "render worker error message 必须是非空字符串");
    return { success: true, value: value as unknown as RemotionRenderWorkerEvent };
  }
  return failure("kind", "render worker event kind 无效");
}

function validateResult(
  value: unknown,
): RemotionRenderWorkerValidationResult<RemotionRenderWorkerResult> {
  if (!isRecord(value)) return failure("result", "render worker result 必须是对象");
  if (value.success === true) {
    if (!hasOnlyKeys(value, ["success", "jobId", "outputPath", "composition"])) {
      return failure("result", "render worker success result 包含未知字段");
    }
    if (!isNonEmptyString(value.jobId)) return failure("result.jobId", "success result jobId 必须是非空字符串");
    if (!isAbsolutePath(value.outputPath)) return failure("result.outputPath", "success result outputPath 必须是绝对路径");
    if (!isRecord(value.composition)) return failure("result.composition", "success result composition 必须是对象");
    return { success: true, value: value as unknown as RemotionRenderWorkerResult };
  }
  if (value.success === false) {
    if (!hasOnlyKeys(value, ["success", "jobId", "canceled", "error"])) {
      return failure("result", "render worker failure result 包含未知字段");
    }
    if (!isNonEmptyString(value.jobId)) return failure("result.jobId", "failure result jobId 必须是非空字符串");
    if (typeof value.canceled !== "boolean") return failure("result.canceled", "failure result canceled 必须是布尔值");
    if (!isNonEmptyString(value.error)) return failure("result.error", "failure result error 必须是非空字符串");
    return { success: true, value: value as unknown as RemotionRenderWorkerResult };
  }
  return failure("result.success", "render worker result success 必须是布尔值");
}

function validateRenderInput(value: unknown): RemotionRenderWorkerValidationResult<RemotionRenderInput> {
  if (!isRecord(value)) return failure("input", "render worker input 必须是对象");
  for (const field of ["bundlePath", "outputPath", "browserExecutable"] as const) {
    if (!isAbsolutePath(value[field])) return failure(`input.${field}`, `${field} 必须是绝对路径`);
  }
  if (!isNonEmptyString(value.remotionVersion)) return failure("input.remotionVersion", "Remotion 版本必须是非空字符串");
  if (value.binariesDirectory !== undefined && !isAbsolutePath(value.binariesDirectory)) {
    return failure("input.binariesDirectory", "binariesDirectory 必须是绝对路径");
  }
  if (value.target === "shot") {
    if (!hasOnlyKeys(value, ["target", "jobId", "shotPlan", "compositionProps", "compositionId", "bundlePath", "outputPath", "browserExecutable", "remotionVersion", "binariesDirectory"])) {
      return failure("input", "shot render worker input 包含未知字段");
    }
    if (!isNonEmptyString(value.jobId)) return failure("input.jobId", "shot render jobId 必须是非空字符串");
    if (value.compositionId !== "StoryboardShot") return failure("input.compositionId", "shot render 必须使用 StoryboardShot");
    if (!isRecord(value.shotPlan)) return failure("input.shotPlan", "shot render plan 必须是对象");
    if (!isRecord(value.compositionProps)) return failure("input.compositionProps", "shot Composition props 必须是对象");
    return { success: true, value: value as unknown as RemotionRenderInput };
  }
  if (value.target === "chapter") {
    if (!hasOnlyKeys(value, ["target", "jobId", "compositionProps", "compositionId", "bundlePath", "outputPath", "browserExecutable", "remotionVersion", "binariesDirectory"])) {
      return failure("input", "chapter render worker input 包含未知字段");
    }
    if (!isNonEmptyString(value.jobId)) return failure("input.jobId", "chapter render jobId 必须是非空字符串");
    if (value.compositionId !== "ChapterVideo") return failure("input.compositionId", "chapter render 必须使用 ChapterVideo");
    if (!isRecord(value.compositionProps)) return failure("input.compositionProps", "chapter Composition props 必须是对象");
    return { success: true, value: value as unknown as RemotionRenderInput };
  }
  if (!hasOnlyKeys(value, ["plan", "bundlePath", "outputPath", "browserExecutable", "remotionVersion", "mediaUrlByClipId", "binariesDirectory", "compositionId"])) {
    return failure("input", "render worker input 包含未知字段");
  }
  if (!isRecord(value.plan)) return failure("input.plan", "render worker plan 必须是对象");
  if (!isRecord(value.mediaUrlByClipId)) return failure("input.mediaUrlByClipId", "媒体 URL 映射必须是对象");
  if (value.compositionId !== undefined && value.compositionId !== "DaojieTimeline") {
    return failure("input.compositionId", "timeline render 只能使用 legacy timeline composition");
  }
  return { success: true, value: value as unknown as RemotionRenderInput };
}

function validateProgress(value: unknown): RemotionRenderWorkerValidationResult<RemotionRenderProgress> {
  if (!isRecord(value)) return failure("progress", "render worker progress 必须是对象");
  if (!isNonEmptyString(value.jobId)) return failure("progress.jobId", "progress jobId 必须是非空字符串");
  if (!["validating", "preparing", "rendering", "canceled", "failed"].includes(String(value.stage))) {
    return failure("progress.stage", "render worker progress stage 无效");
  }
  if (!isFiniteRatio(value.ratio)) return failure("progress.ratio", "progress ratio 必须是 0 到 1 的有限数值");
  if (value.message !== undefined && typeof value.message !== "string") return failure("progress.message", "progress message 必须是字符串");
  return { success: true, value: value as unknown as RemotionRenderProgress };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbsolutePath(value: unknown): value is string {
  return isNonEmptyString(value) && path.isAbsolute(value);
}

function isFiniteRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function failure<T>(pathValue: string, message: string): RemotionRenderWorkerValidationResult<T> {
  return { success: false, issues: [{ path: pathValue, message }] };
}
