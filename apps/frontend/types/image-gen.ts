// Renderer-facing types for the local image generation runtime.

export type ImageGenSetupStage =
  | "idle"
  | "checking"
  | "starting-server"
  | "ready"
  | "failed";

export interface ImageGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
}

export interface ImageGenRuntimeStatus {
  running: boolean;
  setupStage: ImageGenSetupStage;
  setupMessage: string | undefined;
  models: ImageGenModelRow[];
  activeModel: string;
  downloadStatus: Record<string, "idle" | "downloading" | "complete" | "error">;
  downloadProgress: Record<string, number>;
  downloadError: Record<string, string | undefined>;
}
