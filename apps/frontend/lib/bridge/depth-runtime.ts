// Renderer bridge for the depth estimation runtime — returns undefined
// outside Electron so callers degrade gracefully in web mode.

import type {
  DepthDownloadProgress,
  DepthModelStatusRow,
  DepthRuntimeStatus,
} from "@/types/depth";

export interface DepthRuntimeBridge {
  status: () => Promise<DepthRuntimeStatus>;
  setup: () => Promise<DepthRuntimeStatus>;
  refresh: () => Promise<DepthRuntimeStatus>;
  scanModel: () => Promise<{ models: DepthModelStatusRow[] }>;
  downloadModel: () => Promise<{ accepted: boolean; message: string }>;
  downloadProgress: () => Promise<DepthDownloadProgress>;
  setCinematicPreset: (preset: string) => Promise<{ accepted: boolean; message: string }>;
  setCinematicMode: (mode: "auto" | "manual") => Promise<{ accepted: boolean; message: string }>;
  setPresetMap: (map: Record<string, string>) => Promise<{ accepted: boolean; count: number; message: string }>;
  getConfig: () => Promise<{ modelCacheDir: string }>;
  setModelCacheDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteModel: () => Promise<{ success: boolean; error?: string }>;
}

export function getDepthRuntimeBridge(): DepthRuntimeBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { depthRuntime?: DepthRuntimeBridge }).depthRuntime
    : undefined;
}
