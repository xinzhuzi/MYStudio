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
// Runtime lifecycle IPC (renderer -> preload -> main)
// ---------------------------------------------------------------------------

export const DEPTH_PROBE_CHANNEL = "depth-runtime-probe";
export const DEPTH_PREPARE_CHANNEL = "depth-runtime-prepare";
export const DEPTH_ROLLBACK_CHANNEL = "depth-runtime-rollback";

export const DEPTH_CHANNELS = [
  DEPTH_PROBE_CHANNEL,
  DEPTH_PREPARE_CHANNEL,
  DEPTH_ROLLBACK_CHANNEL,
] as const;

export type DepthRuntimeState = "ready" | "needs-runtime" | "blocked" | "error";

/** Fixed, fieldless request shape for all canonical lifecycle operations. */
export interface DepthRuntimeLifecycleRequestV1 {
  schemaVersion: typeof DEPTH_SCHEMA_VERSION;
}

export interface DepthRuntimeStatusV1 {
  schemaVersion: typeof DEPTH_SCHEMA_VERSION;
  state: DepthRuntimeState;
  model: DepthModelId;
  modelCacheDir: string;
  modelDownloaded: boolean;
  probe: DepthRuntimeProbeEvidenceV1;
  message?: string;
}

export interface DepthRuntimeProbeEvidenceV1 {
  pythonAvailable: boolean;
  pythonVersion?: string;
  workerProbe: "not-run" | "ready" | "model-not-downloaded" | "blocked";
  workerToolVersion?: string;
  modelWeightSha256?: string;
}

export interface DepthRuntimeActionReplyV1 {
  schemaVersion: typeof DEPTH_SCHEMA_VERSION;
  success: boolean;
  status: DepthRuntimeStatusV1;
  code?: string;
  message?: string;
  issues?: DepthValidationIssue[];
}

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

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  issues: DepthValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) pushIssue(issues, key, "包含未知字段");
  }
}

function validateDepthRuntimeState(
  value: unknown,
  path: string,
  issues: DepthValidationIssue[],
): value is DepthRuntimeState {
  if (value === "ready" || value === "needs-runtime" || value === "blocked" || value === "error") {
    return true;
  }
  pushIssue(issues, path, "状态无效");
  return false;
}

function validateDepthRuntimeProbeEvidence(
  value: unknown,
  issues: DepthValidationIssue[],
): value is DepthRuntimeProbeEvidenceV1 {
  if (!isObject(value)) {
    pushIssue(issues, "probe", "必须是对象");
    return false;
  }
  if (typeof value.pythonAvailable !== "boolean") {
    pushIssue(issues, "probe.pythonAvailable", "必须是 boolean");
  }
  if (value.pythonVersion !== undefined && !isString(value.pythonVersion)) {
    pushIssue(issues, "probe.pythonVersion", "必须是字符串");
  }
  if (value.workerProbe !== "not-run"
    && value.workerProbe !== "ready"
    && value.workerProbe !== "model-not-downloaded"
    && value.workerProbe !== "blocked") {
    pushIssue(issues, "probe.workerProbe", "worker probe 状态无效");
  }
  if (value.workerToolVersion !== undefined && !isString(value.workerToolVersion)) {
    pushIssue(issues, "probe.workerToolVersion", "必须是字符串");
  }
  if (value.modelWeightSha256 !== undefined
    && (!isString(value.modelWeightSha256) || !HEX64.test(value.modelWeightSha256))) {
    pushIssue(issues, "probe.modelWeightSha256", "必须是 64 位小写 SHA-256");
  }
  const allowed = ["pythonAvailable", "pythonVersion", "workerProbe", "workerToolVersion", "modelWeightSha256"];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) pushIssue(issues, `probe.${key}`, "包含未知字段");
  }
  return !issues.some((issue) => issue.path === "probe" || issue.path.startsWith("probe."));
}

export function validateDepthRuntimeLifecycleRequest(
  value: unknown,
): DepthValidationResult<DepthRuntimeLifecycleRequestV1> {
  const issues: DepthValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== DEPTH_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${DEPTH_SCHEMA_VERSION}`);
  }
  rejectUnknownFields(value, ["schemaVersion"], issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as DepthRuntimeLifecycleRequestV1 };
}

export function validateDepthRuntimeStatus(
  value: unknown,
): DepthValidationResult<DepthRuntimeStatusV1> {
  const issues: DepthValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== DEPTH_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${DEPTH_SCHEMA_VERSION}`);
  }
  validateDepthRuntimeState(value.state, "state", issues);
  if (value.model !== "depth-anything-v2-small") pushIssue(issues, "model", "模型无效");
  if (!isString(value.modelCacheDir) || !isAbsolutePath(value.modelCacheDir)) {
    pushIssue(issues, "modelCacheDir", "必须是绝对路径");
  }
  if (typeof value.modelDownloaded !== "boolean") {
    pushIssue(issues, "modelDownloaded", "必须是 boolean");
  }
  validateDepthRuntimeProbeEvidence(value.probe, issues);
  if (value.message !== undefined && !isString(value.message)) {
    pushIssue(issues, "message", "必须是字符串");
  }
  rejectUnknownFields(value, ["schemaVersion", "state", "model", "modelCacheDir", "modelDownloaded", "probe", "message"], issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as DepthRuntimeStatusV1 };
}

export function validateDepthRuntimeActionReply(
  value: unknown,
): DepthValidationResult<DepthRuntimeActionReplyV1> {
  const issues: DepthValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== DEPTH_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${DEPTH_SCHEMA_VERSION}`);
  }
  if (typeof value.success !== "boolean") pushIssue(issues, "success", "必须是 boolean");
  const status = validateDepthRuntimeStatus(value.status);
  if (!status.success) {
    issues.push(...status.issues.map((issue) => ({ ...issue, path: `status.${issue.path}` })));
  }
  if (value.code !== undefined && !isString(value.code)) pushIssue(issues, "code", "必须是字符串");
  if (value.message !== undefined && !isString(value.message)) pushIssue(issues, "message", "必须是字符串");
  if (value.issues !== undefined) {
    if (!Array.isArray(value.issues) || value.issues.some((issue) => !isObject(issue) || !isString(issue.path) || !isString(issue.message) || Object.keys(issue).some((key) => key !== "path" && key !== "message"))) {
      pushIssue(issues, "issues", "必须是验证问题数组");
    }
  }
  rejectUnknownFields(value, ["schemaVersion", "success", "status", "code", "message", "issues"], issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as DepthRuntimeActionReplyV1 };
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
