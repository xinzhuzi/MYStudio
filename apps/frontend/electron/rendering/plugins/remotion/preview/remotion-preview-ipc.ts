import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import type { TimelineRenderPlan } from "@/types/editing";
import type { CompositionProps } from "../composition/composition-props";
import { validateCompositionProps } from "../composition/composition-props-validation";

export const REMOTION_PREVIEW_CREATE_CHANNEL = "remotion-preview-create";
export const REMOTION_PREVIEW_RELEASE_CHANNEL = "remotion-preview-release";

export interface RemotionPreviewCreateRequest {
  plan: TimelineRenderPlan;
}

export interface RemotionPreviewCreateReply {
  sessionId: string;
  composition: CompositionProps;
}

export interface RemotionPreviewReleaseRequest {
  sessionId: string;
}

export interface RemotionPreviewReleaseReply {
  sessionId: string;
  released: true;
}

export type RemotionPreviewValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function validateRemotionPreviewCreateRequest(
  value: unknown,
): RemotionPreviewValidationResult<RemotionPreviewCreateRequest> {
  if (!isRecordWithOnlyKeys(value, ["plan"])) {
    return failure("$", "Remotion 预览创建请求只允许 plan 字段");
  }
  const plan = validateTimelineRenderPlan(value.plan);
  if (!plan.success) {
    return {
      success: false,
      issues: plan.issues.map((issue) => ({
        path: `plan${issue.path.startsWith("$") ? issue.path.slice(1) : `.${issue.path}`}`,
        message: issue.message,
      })),
    };
  }
  return { success: true, value: { plan: plan.value } };
}

export function validateRemotionPreviewCreateReply(
  value: unknown,
): RemotionPreviewValidationResult<RemotionPreviewCreateReply> {
  if (!isRecordWithOnlyKeys(value, ["sessionId", "composition"])) {
    return failure("$", "Remotion 预览创建结果字段无效");
  }
  if (!isNonEmptyString(value.sessionId)) {
    return failure("sessionId", "Remotion 预览 session ID 必须是非空字符串");
  }
  const composition = validateCompositionProps(value.composition);
  if (!composition.success) {
    return {
      success: false,
      issues: composition.issues.map((issue) => ({
        path: `composition.${issue.path}`,
        message: issue.message,
      })),
    };
  }
  return {
    success: true,
    value: { sessionId: value.sessionId, composition: composition.value },
  };
}

export function validateRemotionPreviewReleaseRequest(
  value: unknown,
): RemotionPreviewValidationResult<RemotionPreviewReleaseRequest> {
  if (!isRecordWithOnlyKeys(value, ["sessionId"]) || !isNonEmptyString(value.sessionId)) {
    return failure("sessionId", "Remotion 预览释放请求需要唯一 session ID");
  }
  return { success: true, value: { sessionId: value.sessionId } };
}

export function validateRemotionPreviewReleaseReply(
  value: unknown,
): RemotionPreviewValidationResult<RemotionPreviewReleaseReply> {
  if (!isRecordWithOnlyKeys(value, ["sessionId", "released"])
    || !isNonEmptyString(value.sessionId)
    || value.released !== true) {
    return failure("$", "Remotion 预览释放结果无效");
  }
  return {
    success: true,
    value: { sessionId: value.sessionId, released: true },
  };
}

function isRecordWithOnlyKeys(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.includes(key))
    && allowedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure<T>(path: string, message: string): RemotionPreviewValidationResult<T> {
  return { success: false, issues: [{ path, message }] };
}
