import {
  type RemotionBrowserDownloadProgress,
  type RemotionBrowserStatus,
  type RemotionBrowserValidationResult,
  validateRemotionBrowserDownloadProgress,
  validateRemotionBrowserStatus,
} from "./remotion-browser-status";

// Design §5: browser runtime IPC surface. Channel names are fixed here so the
// preload bridge (P2) and main-process handler agree on a single source. Every
// public payload is validated before use — the renderer never trusts a raw
// main-process message and the main process never trusts a raw renderer call.

export const REMOTION_RUNTIME_STATUS_CHANNEL = "remotion-runtime-status";
export const REMOTION_RUNTIME_DOWNLOAD_CHANNEL = "remotion-runtime-download";
export const REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT =
  "remotion-runtime-download-progress";

export const REMOTION_RUNTIME_CHANNELS = [
  REMOTION_RUNTIME_STATUS_CHANNEL,
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
] as const;

export type RemotionRuntimeChannel = typeof REMOTION_RUNTIME_CHANNELS[number];

// The download IPC takes no caller-chosen options: the version and source are
// fixed by the main process (official version:null). An empty object keeps the
// invoke signature stable without letting the renderer steer the download.
export type RemotionRuntimeDownloadRequest = Record<never, never>;
export type RemotionRuntimeStatusRequest = Record<never, never>;

export function isRemotionRuntimeChannel(
  value: unknown,
): value is RemotionRuntimeChannel {
  return typeof value === "string"
    && (REMOTION_RUNTIME_CHANNELS as readonly string[]).includes(value);
}

// Renderer -> main: the download request carries no fields. Reject any payload
// that smuggles caller-controlled keys so nothing can override the fixed source.
export function validateRemotionRuntimeDownloadRequest(
  value: unknown,
): RemotionBrowserValidationResult<RemotionRuntimeDownloadRequest> {
  return validateEmptyRequest(value, "下载请求");
}

export function validateRemotionRuntimeStatusRequest(
  value: unknown,
): RemotionBrowserValidationResult<RemotionRuntimeStatusRequest> {
  return validateEmptyRequest(value, "状态请求");
}

function validateEmptyRequest(
  value: unknown,
  label: string,
): RemotionBrowserValidationResult<Record<never, never>> {
  if (value === undefined || value === null) {
    return { success: true, value: {} };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      issues: [{ path: "$", message: `${label}必须是空对象` }],
    };
  }
  if (Object.keys(value).length > 0) {
    return {
      success: false,
      issues: [{ path: "$", message: `${label}不接受任何字段` }],
    };
  }
  return { success: true, value: {} };
}

// main -> renderer: status result. Reuses the status validator so the renderer
// re-checks whatever crosses the IPC boundary.
export function validateRemotionRuntimeStatusReply(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserStatus> {
  return validateRemotionBrowserStatus(value);
}

// main -> renderer: streamed download progress event payload.
export function validateRemotionRuntimeDownloadProgressEvent(
  value: unknown,
): RemotionBrowserValidationResult<RemotionBrowserDownloadProgress> {
  return validateRemotionBrowserDownloadProgress(value);
}
