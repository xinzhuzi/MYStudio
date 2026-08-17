// Renderer-facing types for the depth estimation runtime — mirrors the
// main-process DepthRuntimeStatus shape in
// electron/rendering/plugins/depth/depth-runtime-controller.ts.

import type { DepthRuntimeProbeEvidenceV1 } from "@rendering/contracts/depth-workflow";

export type DepthSetupStage =
  | "idle"
  | "checking"
  | "preparing-profile"
  | "ready"
  | "failed";

export interface DepthRuntimeStatus {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message?: string;
  setupStage: DepthSetupStage;
  setupProgress: number | undefined;
  setupMessage: string | undefined;
  /** True when the depth model weights are present in the HF cache. */
  modelDownloaded: boolean;
  modelSizeMb: number | null;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  /** Currently selected cinematic camera preset (manual-mode value). */
  cinematicPreset: string;
  /** "auto" = AI 按剧本逐镜选择；"manual" = 全局 cinematicPreset。 */
  cinematicPresetMode: "auto" | "manual";
  /** Number of per-shot preset entries from the latest AI analysis. */
  cinematicPresetCount: number;
  /** User-configured model cache directory (default <userData>/DeepModel). */
  modelCacheDir: string;
  probeEvidence: DepthRuntimeProbeEvidenceV1;
}

export interface DepthModelStatusRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  cacheDir: string | null;
  repoCacheDir?: string | null;
}

export interface DepthDownloadProgress {
  status: "idle" | "downloading" | "complete" | "error";
  progress: number;
  current: number;
  total: number;
  error?: string;
}
