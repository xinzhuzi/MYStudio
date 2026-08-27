// Copyright (c) 2025 hotflow2024
/** VLM Review runtime — Python env/worker args(沿 upscale-runtime.ts 模式). */

import path from "node:path";

export const VLM_PROFILE_NAME = "vlm-review";
export const VLM_MODEL_FAMILY_DIR = "vlm";

export function buildVlmReviewWorkerArgs(requestPath: string, artifactPath: string): string[] {
  return ["-m", "vlm_review.worker", "--run", "--input", requestPath, "--output", artifactPath];
}

export function buildVlmReviewProbeArgs(): string[] {
  return ["-m", "vlm_review.worker", "--probe"];
}

export function vlmModelCacheDir(storageBasePath: string): string {
  return path.join(storageBasePath, "model", VLM_MODEL_FAMILY_DIR);
}
