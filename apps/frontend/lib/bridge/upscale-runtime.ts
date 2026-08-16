// Renderer bridge for the image super-resolution runtime — returns undefined
// outside Electron so callers degrade gracefully in web mode.

import type {
  UpscaleDownloadProgress,
  UpscaleModelRow,
  UpscaleRunPayload,
  UpscaleRunResult,
  UpscaleRuntimeStatus,
} from "@/types/upscale";
import type {
  UpscaleRuntimeActionReplyV1,
  UpscaleRuntimeLifecycleRequestV1,
  UpscaleRuntimeStatusV1,
} from "@rendering/contracts/upscale-workflow";

export interface UpscaleRuntimeBridge {
  probe: (request?: UpscaleRuntimeLifecycleRequestV1) => Promise<UpscaleRuntimeStatusV1>;
  prepare: (request?: UpscaleRuntimeLifecycleRequestV1) => Promise<UpscaleRuntimeActionReplyV1>;
  rollback: (request?: UpscaleRuntimeLifecycleRequestV1) => Promise<UpscaleRuntimeActionReplyV1>;
  status: () => Promise<UpscaleRuntimeStatus>;
  setup: () => Promise<UpscaleRuntimeStatus>;
  refresh: () => Promise<UpscaleRuntimeStatus>;
  scanModel: () => Promise<{ models: UpscaleModelRow[] }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  downloadProgress: () => Promise<UpscaleDownloadProgress>;
  setActiveModel: (model: string) => Promise<{ success: boolean; error?: string }>;
  run: (payload: UpscaleRunPayload) => Promise<UpscaleRunResult>;
  getConfig: () => Promise<{ modelCacheDir: string }>;
  setModelCacheDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteModel: (model: string) => Promise<{ success: boolean; error?: string }>;
}

export function getUpscaleRuntimeBridge(): UpscaleRuntimeBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { upscaleRuntime?: UpscaleRuntimeBridge }).upscaleRuntime
    : undefined;
}
