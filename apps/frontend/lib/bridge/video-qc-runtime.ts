// 渲染端 → 主进程 video-qc 运行时桥(preload contextBridge 的类型化包装)。

export interface VideoQcRuntimeStatusPayload {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message?: string;
  setupStage: "idle" | "checking" | "ready" | "failed";
  modelReady: boolean;
  modelCode?: string;
  modelMessage?: string;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  modelCacheDir: string;
}

export interface VideoQcDownloadProgressPayload {
  status: "idle" | "downloading" | "complete" | "error";
  progress: number;
  current: number;
  total: number;
  error?: string;
}

interface VideoQcRuntimeBridge {
  probe: () => Promise<VideoQcRuntimeStatusPayload>;
  status: () => Promise<VideoQcRuntimeStatusPayload>;
  setup: () => Promise<VideoQcRuntimeStatusPayload>;
  refresh: () => Promise<VideoQcRuntimeStatusPayload>;
  scanModel: () => Promise<{ models: unknown[]; cacheDir: string }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  downloadProgress: () => Promise<VideoQcDownloadProgressPayload>;
  getConfig: () => Promise<{ modelCacheDir: string }>;
  setModelCacheDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  deleteModel: (model: string) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    videoQcRuntime?: VideoQcRuntimeBridge;
  }
}

export function getVideoQcRuntimeBridge(): VideoQcRuntimeBridge | undefined {
  return typeof window !== "undefined" ? window.videoQcRuntime : undefined;
}
