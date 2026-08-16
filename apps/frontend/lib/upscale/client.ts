// Client wrappers for the image super-resolution runtime IPC. Thin aliases
// over the bridge so components never touch `window` directly.

import { getUpscaleRuntimeBridge } from "@/lib/bridge/upscale-runtime";
import type {
  UpscaleArtifact,
  UpscaleDownloadProgress,
  UpscaleModelRow,
  UpscaleRunPayload,
  UpscaleRuntimeStatus,
} from "@/types/upscale";
import type {
  UpscaleRuntimeActionReplyV1,
  UpscaleRuntimeLifecycleRequestV1,
  UpscaleRuntimeStatusV1,
} from "@rendering/contracts/upscale-workflow";

export function hasUpscaleRuntime(): boolean {
  return Boolean(getUpscaleRuntimeBridge());
}

/**
 * Inputs whose long side already reaches this limit are rejected by the
 * worker (input-too-large). UI buttons use it to disable preemptively via
 * <img> naturalWidth — mirrors adapter.MAX_INPUT_LONG_SIDE.
 */
export const UPSCALE_INPUT_MAX_LONG_SIDE = 4096;

export async function probeUpscaleRuntimeLifecycle(
  request?: UpscaleRuntimeLifecycleRequestV1,
): Promise<UpscaleRuntimeStatusV1> {
  return getUpscaleRuntimeBridge()!.probe(request);
}

export async function prepareUpscaleRuntimeLifecycle(
  request?: UpscaleRuntimeLifecycleRequestV1,
): Promise<UpscaleRuntimeActionReplyV1> {
  return getUpscaleRuntimeBridge()!.prepare(request);
}

export async function rollbackUpscaleRuntimeLifecycle(
  request?: UpscaleRuntimeLifecycleRequestV1,
): Promise<UpscaleRuntimeActionReplyV1> {
  return getUpscaleRuntimeBridge()!.rollback(request);
}

export async function getUpscaleRuntimeStatus(): Promise<UpscaleRuntimeStatus> {
  return getUpscaleRuntimeBridge()!.status();
}

export async function setupUpscaleRuntime(): Promise<UpscaleRuntimeStatus> {
  return getUpscaleRuntimeBridge()!.setup();
}

export async function refreshUpscaleRuntime(): Promise<UpscaleRuntimeStatus> {
  return getUpscaleRuntimeBridge()!.refresh();
}

export async function scanUpscaleModelInventory(): Promise<UpscaleModelRow[]> {
  const result = await getUpscaleRuntimeBridge()!.scanModel();
  return result.models;
}

export async function downloadUpscaleModel(
  model: string,
): Promise<{ accepted: boolean; message: string }> {
  return getUpscaleRuntimeBridge()!.downloadModel(model);
}

export async function getUpscaleDownloadProgress(): Promise<UpscaleDownloadProgress> {
  return getUpscaleRuntimeBridge()!.downloadProgress();
}

export async function setUpscaleActiveModel(
  model: string,
): Promise<{ success: boolean; error?: string }> {
  return getUpscaleRuntimeBridge()!.setActiveModel(model);
}

export async function runUpscaleImage(payload: UpscaleRunPayload): Promise<UpscaleArtifact> {
  const result = await getUpscaleRuntimeBridge()!.run(payload);
  return result.artifact;
}

export async function getUpscaleConfig(): Promise<{ modelCacheDir: string }> {
  return getUpscaleRuntimeBridge()!.getConfig();
}

export async function setUpscaleModelCacheDir(
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  return getUpscaleRuntimeBridge()!.setModelCacheDir(dirPath);
}

export async function deleteUpscaleModel(
  model: string,
): Promise<{ success: boolean; error?: string }> {
  return getUpscaleRuntimeBridge()!.deleteModel(model);
}

export type { UpscaleRuntimeActionReplyV1 };
