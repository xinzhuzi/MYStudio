// Renderer-facing types for the local sfx generation runtime (08-19-local-sfx-generation).

/** 与 backend/sfx_gen/worker.py 的钳制保持同参 */
export const SFX_MIN_DURATION_S = 0.5;
export const SFX_MAX_DURATION_S = 5;

export type SfxGenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface SfxGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  enabled?: boolean;
}

export interface SfxGenRuntimeStatus {
  setupStage: SfxGenSetupStage;
  setupMessage: string | undefined;
  models: SfxGenModelRow[];
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  /** 模型实际落盘目录(与本地音乐生成/TTS 共用缓存) */
  modelCacheDir?: string;
}

export interface SfxGenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  seed?: number;
  code?: string;
  message?: string;
}
