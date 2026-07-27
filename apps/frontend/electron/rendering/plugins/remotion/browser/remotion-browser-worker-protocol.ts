import path from "node:path";
import {
  type RemotionBrowserDownloadProgress,
  type RemotionBrowserStatus,
  type RemotionBrowserValidationResult,
  validateRemotionBrowserDownloadProgress,
  validateRemotionBrowserStatus,
} from "../../../contracts/remotion-browser-status";

export const REMOTION_BROWSER_WORKER_ACTIONS = ["status", "download"] as const;
export type RemotionBrowserWorkerAction = typeof REMOTION_BROWSER_WORKER_ACTIONS[number];

export interface RemotionBrowserWorkerCommand {
  schemaVersion: 1;
  requestId: string;
  action: RemotionBrowserWorkerAction;
  remotionVersion: string;
}

export type RemotionBrowserWorkerEvent =
  | {
      kind: "progress";
      requestId: string;
      progress: RemotionBrowserDownloadProgress;
    }
  | {
      kind: "result";
      requestId: string;
      status: RemotionBrowserStatus;
      executablePath?: string;
    }
  | {
      kind: "error";
      requestId: string;
      message: string;
    };

const COMMAND_KEYS = ["schemaVersion", "requestId", "action", "remotionVersion"] as const;

export function validateRemotionBrowserWorkerCommand(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserWorkerCommand> {
  if (!isRecord(value)) return failure("$", "浏览器 worker 命令必须是对象");
  if (!hasOnlyKeys(value, COMMAND_KEYS)) return failure("$", "浏览器 worker 命令包含未知字段");
  const issues: Array<{ path: string; message: string }> = [];
  if (value.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "worker schemaVersion 必须为 1" });
  if (!isNonEmptyString(value.requestId)) issues.push({ path: "requestId", message: "worker requestId 必须是非空字符串" });
  if (!isWorkerAction(value.action)) issues.push({ path: "action", message: "worker action 无效" });
  if (!isNonEmptyString(value.remotionVersion)) issues.push({ path: "remotionVersion", message: "worker Remotion 版本必须是非空字符串" });
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as RemotionBrowserWorkerCommand };
}

export function validateRemotionBrowserWorkerEvent(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserWorkerEvent> {
  if (!isRecord(value)) return failure("$", "浏览器 worker 事件必须是对象");
  if (!isNonEmptyString(value.requestId)) return failure("requestId", "worker 事件 requestId 必须是非空字符串");

  if (value.kind === "progress") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "progress"])) return failure("$", "worker progress 事件包含未知字段");
    const progress = validateRemotionBrowserDownloadProgress(value.progress);
    if (!progress.success) return progress;
    return { success: true, value: value as unknown as RemotionBrowserWorkerEvent };
  }

  if (value.kind === "result") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "status", "executablePath"])) return failure("$", "worker result 事件包含未知字段");
    const status = validateRemotionBrowserStatus(value.status);
    if (!status.success) return status;
    if (value.executablePath !== undefined && !isAbsolutePath(value.executablePath)) {
      return failure("executablePath", "worker executablePath 必须是绝对路径");
    }
    if (status.value.state === "ready" && !isAbsolutePath(value.executablePath)) {
      return failure("executablePath", "ready 状态必须包含绝对 executablePath");
    }
    return { success: true, value: value as unknown as RemotionBrowserWorkerEvent };
  }

  if (value.kind === "error") {
    if (!hasOnlyKeys(value, ["kind", "requestId", "message"])) return failure("$", "worker error 事件包含未知字段");
    if (!isNonEmptyString(value.message)) return failure("message", "worker error message 必须是非空字符串");
    return { success: true, value: value as unknown as RemotionBrowserWorkerEvent };
  }

  return failure("kind", "worker 事件 kind 无效");
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

function isWorkerAction(value: unknown): value is RemotionBrowserWorkerAction {
  return typeof value === "string"
    && (REMOTION_BROWSER_WORKER_ACTIONS as readonly string[]).includes(value);
}

function failure<T>(pathValue: string, message: string): RemotionBrowserValidationResult<T> {
  return { success: false, issues: [{ path: pathValue, message }] };
}
