// Client wrappers for the depth estimation runtime IPC. Thin aliases over the
// bridge so components never touch `window` directly.

import { getDepthRuntimeBridge } from "@/lib/bridge/depth-runtime";
import type {
  DepthDownloadProgress,
  DepthModelStatusRow,
  DepthRuntimeStatus,
} from "@/types/depth";
import type {
  DepthRuntimeActionReplyV1,
  DepthRuntimeLifecycleRequestV1,
  DepthRuntimeStatusV1,
} from "@rendering/contracts/depth-workflow";

export function hasDepthRuntime(): boolean {
  return Boolean(getDepthRuntimeBridge());
}

export async function probeDepthRuntimeLifecycle(
  request?: DepthRuntimeLifecycleRequestV1,
): Promise<DepthRuntimeStatusV1> {
  return getDepthRuntimeBridge()!.probe(request);
}

export async function prepareDepthRuntimeLifecycle(
  request?: DepthRuntimeLifecycleRequestV1,
): Promise<DepthRuntimeActionReplyV1> {
  return getDepthRuntimeBridge()!.prepare(request);
}

export async function rollbackDepthRuntimeLifecycle(
  request?: DepthRuntimeLifecycleRequestV1,
): Promise<DepthRuntimeActionReplyV1> {
  return getDepthRuntimeBridge()!.rollback(request);
}

export async function getDepthRuntimeStatus(): Promise<DepthRuntimeStatus> {
  return getDepthRuntimeBridge()!.status();
}

export async function setupDepthRuntime(): Promise<DepthRuntimeStatus> {
  return getDepthRuntimeBridge()!.setup();
}

export async function refreshDepthRuntime(): Promise<DepthRuntimeStatus> {
  return getDepthRuntimeBridge()!.refresh();
}

export async function scanDepthModelInventory(): Promise<DepthModelStatusRow[]> {
  const result = await getDepthRuntimeBridge()!.scanModel();
  return result.models;
}

export async function downloadDepthModel(): Promise<{ accepted: boolean; message: string }> {
  return getDepthRuntimeBridge()!.downloadModel();
}

export async function getDepthDownloadProgress(): Promise<DepthDownloadProgress> {
  return getDepthRuntimeBridge()!.downloadProgress();
}

export async function setDepthCinematicPreset(
  preset: string,
): Promise<{ accepted: boolean; message: string }> {
  return getDepthRuntimeBridge()!.setCinematicPreset(preset);
}

export async function setDepthCinematicMode(
  mode: "auto" | "manual",
): Promise<{ accepted: boolean; message: string }> {
  return getDepthRuntimeBridge()!.setCinematicMode(mode);
}

export async function setDepthCinematicPresetMap(
  map: Record<string, string>,
): Promise<{ accepted: boolean; count: number; message: string }> {
  return getDepthRuntimeBridge()!.setPresetMap(map);
}

export async function getDepthConfig(): Promise<{ modelCacheDir: string }> {
  return getDepthRuntimeBridge()!.getConfig();
}

export async function setDepthModelCacheDir(
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  return getDepthRuntimeBridge()!.setModelCacheDir(dirPath);
}

export async function deleteDepthModel(): Promise<{ success: boolean; error?: string }> {
  return getDepthRuntimeBridge()!.deleteModel();
}
