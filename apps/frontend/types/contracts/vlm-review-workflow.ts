// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/** VLM Review 契约 — 生图后本地视觉一致性审核(Trellis 08-27-vlm-visual-consistency) */

export interface VlmReferenceImageInput {
  path: string;
  role: "scene" | "character" | "prop";
  assetName: string;
  promptHint?: string;
}

export interface VlmReviewRequestV1 {
  schemaVersion: 1;
  projectId: string;
  shotId: string;
  frameId?: string;
  generatedImagePath: string;
  referenceImages: VlmReferenceImageInput[];
  expectedContent: string;
  expectedCharacters: string[];
}

export interface VlmReviewChecks {
  character_ok: boolean;
  costume_ok: boolean;
  scene_ok: boolean;
  prop_ok: boolean;
  text_watermark_ok: boolean;
  noise_clean_ok: boolean;
}

export interface VlmReviewArtifactV1 {
  schemaVersion: 1;
  projectId: string;
  shotId: string;
  status: "accepted" | "rejected" | "blocked";
  model: string;
  checks: Partial<VlmReviewChecks>;
  reasons: string[];
  inferenceMs: number;
  inputSha256: string;
  code?: string;
  message?: string;
  toolVersion?: string;
  generatedAt: number;
  /** R20 盲区可视化(08-28):期望出场但无参考可比对的角色(群演/孩童等无资产
   * 条目者)——VLM 未校验它们,人工终审需重点过目;渲染层附加,非 worker 产物 */
  uncoveredCharacters?: string[];
}

export interface VlmReviewProbeResult {
  status: "ready" | "blocked";
  hardwareProfile?: { platform: string; machine: string; mlxImportable: boolean };
  mlxVlmAvailable: boolean;
  mlxVlmVersion?: string;
  modelDir: string | null;
  code?: string | null;
  message?: string | null;
}

export interface VlmDownloadProgress {
  status: "downloading" | "done" | "error" | "idle";
  percentage?: number;
  downloadedMB?: number;
  totalMB?: number;
  message?: string;
}

export interface VlmReviewRunPayload {
  schemaVersion: 1;
  projectId: string;
  shotId: string;
  frameId?: string;
  generatedImagePath: string;
  referenceImages: Array<{
    path: string;
    role: "scene" | "character" | "prop";
    assetName: string;
    promptHint?: string;
  }>;
  expectedContent: string;
  expectedCharacters: string[];
}

// Window bridge type (exposed via preload)
export interface VlmReviewBridge {
  probe: () => Promise<VlmReviewProbeResult>;
  setup: () => Promise<{ success: boolean; error?: string }>;
  downloadModel: () => Promise<{ success: boolean; error?: string }>;
  getDownloadProgress: () => Promise<VlmDownloadProgress>;
  deleteModel: () => Promise<{ success: boolean; error?: string }>;
  run: (payload: VlmReviewRunPayload) => Promise<VlmReviewArtifactV1>;
}

declare global {
  interface Window {
    vlmReview?: VlmReviewBridge;
  }
}
