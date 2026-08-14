// Depth estimation workflow contracts — mirrors the video-workflow.ts pattern.
// A depth estimation sidecar accepts a single static image and produces a
// normalized grayscale depth-map PNG. The depth map is later consumed by the
// @remotion/three CinematicVisualClip to drive vertex displacement, parallax,
// and depth-of-field effects.

export const DEPTH_SCHEMA_VERSION = 1 as const;

/** Model identifiers accepted by the depth estimation worker. */
export type DepthModelId = "depth-anything-v2-small";

/** Supported depth estimation models with their metadata. */
export const DEPTH_MODELS: Record<DepthModelId, {
  id: DepthModelId;
  label: string;
  license: string;
  params: string;
}> = {
  "depth-anything-v2-small": {
    id: "depth-anything-v2-small",
    label: "Depth Anything V2 Small",
    license: "Apache-2.0",
    params: "24.8M",
  },
};

export type DepthArtifactStatus = "accepted" | "blocked";

export interface DepthValidationIssue {
  path: string;
  message: string;
}

export type DepthValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: DepthValidationIssue[] };

// ---------------------------------------------------------------------------
// Request (written to disk as JSON, passed to the Python worker via --input)
// ---------------------------------------------------------------------------

export interface DepthEstimationRequestV1 {
  schemaVersion: typeof DEPTH_SCHEMA_VERSION;
  projectId: string;
  shotId: string;
  /** Absolute path to the source image (PNG/JPEG). */
  inputImagePath: string;
  /** Absolute path where the depth-map PNG should be written. */
  outputDepthPath: string;
  model: DepthModelId;
}

// ---------------------------------------------------------------------------
// Artifact (written by the worker, validated by the adapter)
// ---------------------------------------------------------------------------

export interface DepthEstimationArtifactV1 {
  schemaVersion: typeof DEPTH_SCHEMA_VERSION;
  projectId: string;
  shotId: string;
  status: DepthArtifactStatus;
  model: DepthModelId;
  /** SHA-256 of the input image file. */
  inputSha256: string;
  /** SHA-256 of the output depth-map PNG. */
  outputSha256: string;
  /** Absolute path to the depth-map PNG. */
  outputPath: string;
  width: number;
  height: number;
  /** Normalized depth range actually present in the output (0..1). */
  depthRange: { min: number; max: number };
  toolVersion: string;
  generatedAt: number;
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Validators (Zod-style, matching the video-workflow contract pattern)
// ---------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Platform-agnostic absolute-path check (works in browser + Node). */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushIssue(
  issues: DepthValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

export function validateDepthEstimationRequest(
  value: unknown,
): DepthValidationResult<DepthEstimationRequestV1> {
  const issues: DepthValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== DEPTH_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${DEPTH_SCHEMA_VERSION}`);
  }
  if (!isString(value.projectId) || !SAFE_SEGMENT.test(value.projectId)) {
    pushIssue(issues, "projectId", "必须是安全路径段");
  }
  if (!isString(value.shotId) || !SAFE_SEGMENT.test(value.shotId)) {
    pushIssue(issues, "shotId", "必须是安全路径段");
  }
  if (!isString(value.inputImagePath) || !isAbsolutePath(value.inputImagePath)) {
    pushIssue(issues, "inputImagePath", "必须是绝对路径");
  }
  if (!isString(value.outputDepthPath) || !isAbsolutePath(value.outputDepthPath)) {
    pushIssue(issues, "outputDepthPath", "必须是绝对路径");
  }
  if (!isString(value.model) || !(value.model in DEPTH_MODELS)) {
    pushIssue(issues, "model", `必须是: ${Object.keys(DEPTH_MODELS).join(", ")}`);
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as DepthEstimationRequestV1 };
}

export function validateDepthEstimationArtifact(
  value: unknown,
): DepthValidationResult<DepthEstimationArtifactV1> {
  const issues: DepthValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== DEPTH_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${DEPTH_SCHEMA_VERSION}`);
  }
  if (!isString(value.projectId)) pushIssue(issues, "projectId", "必须是字符串");
  if (!isString(value.shotId)) pushIssue(issues, "shotId", "必须是字符串");
  if (value.status !== "accepted" && value.status !== "blocked") {
    pushIssue(issues, "status", "必须是 accepted 或 blocked");
  }
  if (!isString(value.model) || !(value.model in DEPTH_MODELS)) {
    pushIssue(issues, "model", `必须是: ${Object.keys(DEPTH_MODELS).join(", ")}`);
  }
  if (!isString(value.inputSha256) || !HEX64.test(value.inputSha256)) {
    pushIssue(issues, "inputSha256", "必须是 64 位十六进制 SHA-256");
  }
  if (!isString(value.outputSha256) || !HEX64.test(value.outputSha256)) {
    pushIssue(issues, "outputSha256", "必须是 64 位十六进制 SHA-256");
  }
  if (!isString(value.outputPath)) pushIssue(issues, "outputPath", "必须是字符串");
  if (!isNumber(value.width) || value.width <= 0) pushIssue(issues, "width", "必须是正数");
  if (!isNumber(value.height) || value.height <= 0) pushIssue(issues, "height", "必须是正数");
  if (!isObject(value.depthRange)) {
    pushIssue(issues, "depthRange", "必须是对象");
  } else {
    if (!isNumber(value.depthRange.min)) pushIssue(issues, "depthRange.min", "必须是数字");
    if (!isNumber(value.depthRange.max)) pushIssue(issues, "depthRange.max", "必须是数字");
  }
  if (!isString(value.toolVersion)) pushIssue(issues, "toolVersion", "必须是字符串");
  if (!isNumber(value.generatedAt) || value.generatedAt <= 0) {
    pushIssue(issues, "generatedAt", "必须是正数时间戳");
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as DepthEstimationArtifactV1 };
}

/** Helper: create a blocked artifact for error responses. */
export function blockedDepthArtifact(
  request: Partial<DepthEstimationRequestV1>,
  code: string,
  message: string,
  toolVersion: string,
): DepthEstimationArtifactV1 {
  return {
    schemaVersion: DEPTH_SCHEMA_VERSION,
    projectId: typeof request.projectId === "string" ? request.projectId : "unknown",
    shotId: typeof request.shotId === "string" ? request.shotId : "unknown",
    status: "blocked",
    model: request.model ?? "depth-anything-v2-small",
    inputSha256: "0".repeat(64),
    outputSha256: "0".repeat(64),
    outputPath: "",
    width: 0,
    height: 0,
    depthRange: { min: 0, max: 0 },
    toolVersion,
    generatedAt: Date.now(),
    code,
    message,
  };
}
