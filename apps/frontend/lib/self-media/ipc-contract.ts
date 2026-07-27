import type {
  SelfMediaAccount,
  SelfMediaDraft,
  SelfMediaProviderId,
  SelfMediaProviderSummary,
  SelfMediaTask,
  SelfMediaTaskError,
  SelfMediaTaskStatus,
} from "@/types/self-media";

export const SELF_MEDIA_IPC = {
  listProviders: "self-media:list-providers",
  listAccounts: "self-media:list-accounts",
  listTasks: "self-media:list-tasks",
  configureProvider: "self-media:configure-provider",
  startLogin: "self-media:start-login",
  createTask: "self-media:create-task",
  pollTask: "self-media:poll-task",
  cancelTask: "self-media:cancel-task",
  progress: "self-media:progress",
} as const;

export interface SelfMediaIpcError {
  code: string;
  message: string;
}

export type SelfMediaIpcReply<T> =
  | { success: true; value: T }
  | { success: false; error: SelfMediaIpcError };

export interface SelfMediaListAccountsRequest {
  projectId: string;
  providerId?: SelfMediaProviderId;
}

export interface SelfMediaListTasksRequest {
  projectId: string;
}

export interface SelfMediaConfigureProviderRequest {
  providerId: SelfMediaProviderId;
}

export interface SelfMediaStartLoginRequest {
  projectId: string;
  providerId: SelfMediaProviderId;
  platform: string;
}

export interface SelfMediaCreateTaskRequest {
  projectId: string;
  providerId: SelfMediaProviderId;
  draft: SelfMediaDraft;
  previousTaskId?: string;
}

export interface SelfMediaTaskRequest {
  projectId: string;
  taskId: string;
}

export interface SelfMediaTaskProgressEvent {
  projectId: string;
  taskId: string;
  status: SelfMediaTaskStatus;
  progress: number;
}

export interface SelfMediaTaskResultPayload {
  status?: SelfMediaTaskStatus;
  progress?: number;
  providerTaskId?: string;
  resultUrl?: string;
  error?: SelfMediaTaskError;
}

export type SelfMediaProviderListReply = SelfMediaIpcReply<SelfMediaProviderSummary[]>;
export type SelfMediaAccountListReply = SelfMediaIpcReply<SelfMediaAccount[]>;
export type SelfMediaConfigureProviderReply = SelfMediaIpcReply<{ providerId: SelfMediaProviderId; configured: boolean }>;
export type SelfMediaLoginReply = SelfMediaIpcReply<{ started: boolean }>;
export type SelfMediaCreateTaskReply = SelfMediaIpcReply<SelfMediaTask[]>;
export type SelfMediaTaskListReply = SelfMediaIpcReply<SelfMediaTask[]>;
export type SelfMediaTaskReply = SelfMediaIpcReply<SelfMediaTask>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const TASK_KEYS = new Set([
  "id", "attemptId", "draftId", "previousTaskId", "projectId", "providerId", "accountId",
  "sourceAssetIds", "status", "progress", "scheduledAt", "providerTaskId", "resultUrl",
  "error", "createdAt", "updatedAt",
]);
const TASK_ERROR_KEYS = new Set(["code", "message", "providerId", "retryable"]);
const TASK_RESULT_KEYS = new Set(["status", "progress", "providerTaskId", "resultUrl", "error"]);
const PROGRESS_EVENT_KEYS = new Set(["projectId", "taskId", "status", "progress"]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

const SELF_MEDIA_TASK_STATUSES: readonly SelfMediaTaskStatus[] = [
  "draft",
  "scheduled",
  "running",
  "success",
  "failure",
  "partial",
  "audit",
  "canceled",
  "expired-login",
];

export function isSelfMediaTaskStatus(value: unknown): value is SelfMediaTaskStatus {
  return typeof value === "string" && SELF_MEDIA_TASK_STATUSES.includes(value as SelfMediaTaskStatus);
}

function isProviderId(value: unknown): value is SelfMediaProviderId {
  return value === "aitoearn-local";
}

function isFiniteProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isTaskError(value: unknown): value is SelfMediaTaskError {
  return isRecord(value)
    && hasOnlyKeys(value, TASK_ERROR_KEYS)
    && typeof value.code === "string"
    && typeof value.message === "string"
    && isProviderId(value.providerId)
    && typeof value.retryable === "boolean";
}

export function isSelfMediaTaskRecord(value: unknown): value is SelfMediaTask {
  return isRecord(value)
    && hasOnlyKeys(value, TASK_KEYS)
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.attemptId === "string"
    && value.attemptId.trim().length > 0
    && typeof value.projectId === "string"
    && value.projectId.trim().length > 0
    && isProviderId(value.providerId)
    && typeof value.accountId === "string"
    && value.accountId.trim().length > 0
    && Array.isArray(value.sourceAssetIds)
    && value.sourceAssetIds.every((assetId) => typeof assetId === "string")
    && isSelfMediaTaskStatus(value.status)
    && isFiniteProgress(value.progress)
    && value.progress >= 0
    && value.progress <= 100
    && (value.draftId === undefined || typeof value.draftId === "string")
    && (value.previousTaskId === undefined || typeof value.previousTaskId === "string")
    && (value.scheduledAt === undefined || typeof value.scheduledAt === "string")
    && (value.providerTaskId === undefined || typeof value.providerTaskId === "string")
    && (value.resultUrl === undefined || typeof value.resultUrl === "string")
    && (value.error === undefined || isTaskError(value.error))
    && isValidDateString(value.createdAt)
    && isValidDateString(value.updatedAt);
}

export function decodeSelfMediaTaskRecord(value: unknown): SelfMediaTask {
  if (!isSelfMediaTaskRecord(value)) throw new Error("Invalid self-media task payload");
  const error = value.error as SelfMediaTaskError | undefined;
  return {
    id: value.id as string,
    attemptId: value.attemptId as string,
    draftId: value.draftId as string | undefined,
    previousTaskId: value.previousTaskId as string | undefined,
    projectId: value.projectId as string,
    providerId: value.providerId as SelfMediaProviderId,
    accountId: value.accountId as string,
    sourceAssetIds: [...(value.sourceAssetIds as string[])],
    status: value.status as SelfMediaTaskStatus,
    progress: value.progress as number,
    scheduledAt: value.scheduledAt as string | undefined,
    providerTaskId: value.providerTaskId as string | undefined,
    resultUrl: value.resultUrl as string | undefined,
    error: error
      ? { code: error.code, message: error.message, providerId: error.providerId, retryable: error.retryable }
      : undefined,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
  };
}

export function decodeSelfMediaTaskResult(value: unknown): SelfMediaTaskResultPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, TASK_RESULT_KEYS)) throw new Error("Invalid self-media task result");
  if (value.status !== undefined && !isSelfMediaTaskStatus(value.status)) {
    throw new Error("Invalid self-media task status");
  }
  if (value.progress !== undefined && !isFiniteProgress(value.progress)) {
    throw new Error("Invalid self-media task progress");
  }
  if (value.providerTaskId !== undefined && typeof value.providerTaskId !== "string") {
    throw new Error("Invalid self-media provider task ID");
  }
  if (value.resultUrl !== undefined && typeof value.resultUrl !== "string") {
    throw new Error("Invalid self-media result URL");
  }
  if (value.error !== undefined && !isTaskError(value.error)) {
    throw new Error("Invalid self-media task error");
  }
  return {
    status: value.status as SelfMediaTaskStatus | undefined,
    progress: value.progress as number | undefined,
    providerTaskId: value.providerTaskId as string | undefined,
    resultUrl: value.resultUrl as string | undefined,
    error: value.error as SelfMediaTaskError | undefined,
  };
}

export function decodeSelfMediaIpcReply<T>(value: unknown): SelfMediaIpcReply<T> {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new Error("Invalid self-media IPC reply");
  }
  if (value.success) {
    if (!("value" in value)) throw new Error("Invalid self-media IPC value");
    const payload = value.value;
    if (isRecord(payload) && ("attemptId" in payload || "sourceAssetIds" in payload)) {
      return { success: true, value: decodeSelfMediaTaskRecord(payload) as T };
    }
    if (Array.isArray(payload)) {
      return {
        success: true,
        value: payload.map((item) => (
          isRecord(item) && ("attemptId" in item || "sourceAssetIds" in item)
            ? decodeSelfMediaTaskRecord(item)
            : item
        )) as T,
      };
    }
    return { success: true, value: payload as T };
  }
  const error = value.error;
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") {
    throw new Error("Invalid self-media IPC error");
  }
  return { success: false, error: { code: error.code, message: error.message } };
}

export function decodeSelfMediaProgressEvent(value: unknown): SelfMediaTaskProgressEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, PROGRESS_EVENT_KEYS) ||
    typeof value.projectId !== "string" ||
    value.projectId.trim().length === 0 ||
    typeof value.taskId !== "string" ||
    value.taskId.trim().length === 0 ||
    !isSelfMediaTaskStatus(value.status) ||
    !isFiniteProgress(value.progress)
  ) {
    throw new Error("Invalid self-media progress event");
  }
  return {
    projectId: value.projectId,
    taskId: value.taskId,
    status: value.status as SelfMediaTaskProgressEvent["status"],
    progress: Math.max(0, Math.min(100, value.progress)),
  };
}
