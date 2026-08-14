// Renderer-facing types for the local music generation runtime.

export type AudioGenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface AudioGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
}

export interface AudioGenRuntimeStatus {
  setupStage: AudioGenSetupStage;
  setupMessage: string | undefined;
  models: AudioGenModelRow[];
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
}

export interface AudioGenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  code?: string;
  message?: string;
}
