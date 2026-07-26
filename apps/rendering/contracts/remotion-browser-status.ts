export const REMOTION_BROWSER_STATES = [
  "ready",
  "not-installed",
  "update-required",
  "error",
] as const;

export type RemotionBrowserState = typeof REMOTION_BROWSER_STATES[number];

export interface RemotionBrowserStatus {
  state: RemotionBrowserState;
  remotionVersion: string;
  preparedForRemotionVersion?: string;
  message?: string;
}

export const REMOTION_BROWSER_DOWNLOAD_PHASES = [
  "starting",
  "downloading",
  "completed",
  "failed",
] as const;

export type RemotionBrowserDownloadPhase =
  typeof REMOTION_BROWSER_DOWNLOAD_PHASES[number];

export interface RemotionBrowserDownloadProgress {
  phase: RemotionBrowserDownloadPhase;
  ratio: number;
  remotionVersion: string;
  message?: string;
}

export type RemotionBrowserValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function isRemotionBrowserState(
  value: unknown,
): value is RemotionBrowserState {
  return typeof value === "string"
    && (REMOTION_BROWSER_STATES as readonly string[]).includes(value);
}

export function isRemotionBrowserDownloadPhase(
  value: unknown,
): value is RemotionBrowserDownloadPhase {
  return typeof value === "string"
    && (REMOTION_BROWSER_DOWNLOAD_PHASES as readonly string[]).includes(value);
}

export function validateRemotionBrowserStatus(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserStatus> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "浏览器状态必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (!isRemotionBrowserState(value.state)) {
    issues.push({ path: "state", message: "浏览器状态无效" });
  }
  if (!isNonEmptyString(value.remotionVersion)) {
    issues.push({ path: "remotionVersion", message: "Remotion 版本必须是非空字符串" });
  }
  validateOptionalNonEmptyString(
    value.preparedForRemotionVersion,
    "preparedForRemotionVersion",
    issues,
  );
  if (value.message !== undefined && typeof value.message !== "string") {
    issues.push({ path: "message", message: "浏览器状态消息必须是字符串" });
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as RemotionBrowserStatus };
}

export function validateRemotionBrowserDownloadProgress(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserDownloadProgress> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "下载进度必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (!isRemotionBrowserDownloadPhase(value.phase)) {
    issues.push({ path: "phase", message: "下载进度阶段无效" });
  }
  if (!isFiniteRatio(value.ratio)) {
    issues.push({ path: "ratio", message: "下载进度比例必须是 0 到 1 的有限数值" });
  }
  if (!isNonEmptyString(value.remotionVersion)) {
    issues.push({ path: "remotionVersion", message: "Remotion 版本必须是非空字符串" });
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    issues.push({ path: "message", message: "下载进度消息必须是字符串" });
  }
  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    value: value as unknown as RemotionBrowserDownloadProgress,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalNonEmptyString(
  value: unknown,
  path: string,
  issues: Array<{ path: string; message: string }>,
): void {
  if (value !== undefined && !isNonEmptyString(value)) {
    issues.push({ path, message: `${path} 必须是非空字符串` });
  }
}

function isFiniteRatio(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}
