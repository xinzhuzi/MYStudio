// Renderer-facing types for the local image super-resolution runtime.

export type UpscaleSetupStage =
  | "idle"
  | "checking"
  | "preparing-profile"
  | "ready"
  | "failed";

export interface UpscaleModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  file: string;
  scale: number;
  cacheDir: string | null;
}

export interface UpscaleRuntimeStatus {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message: string | undefined;
  setupStage: UpscaleSetupStage;
  setupProgress: number | undefined;
  setupMessage: string | undefined;
  activeModel: string;
  modelDownloaded: boolean;
  modelSizeMb: number | null;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  downloadingModel: string | undefined;
  modelCacheDir: string;
}

export interface UpscaleArtifact {
  schemaVersion: number;
  projectId: string;
  shotId: string;
  status: "accepted" | "blocked";
  model: string;
  method: string;
  scale: number;
  inputSha256: string;
  outputSha256: string;
  outputPath: string;
  width: number;
  height: number;
  outputBytes?: number;
  elapsedSeconds?: number;
  toolVersion: string;
  generatedAt: number;
  code?: string;
  message?: string;
}

export interface UpscaleRunResult {
  artifact: UpscaleArtifact;
}

export interface UpscaleDownloadProgress {
  status: "idle" | "downloading" | "complete" | "error";
  progress: number;
  current: number;
  total: number;
  error?: string;
}

export interface UpscaleRunPayload {
  schemaVersion: number;
  projectId: string;
  shotId?: string;
  model: string;
  /** Project-relative source image path (resolved + confined in main). */
  inputImagePath: string;
  /** Project-relative output path — same directory as the input. */
  outputImagePath: string;
  /** 轻度去噪预处理(超分前, 噪点治理 08-29);缺省 false。 */
  denoise?: boolean;
}
