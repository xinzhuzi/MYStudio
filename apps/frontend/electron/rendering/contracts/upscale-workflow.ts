// Upscale workflow contracts — mirrors the depth-workflow.ts pattern.
// A upscale sidecar accepts a single static image and produces a native ×2/×4
// super-resolved PNG (pure-torch Real-ESRGAN, no cloud dependency). The
// artifact feeds the storyboard media manifest exactly like a regenerated
// image (path + contentSha256), so no new manifest shape is introduced.

export const UPSCALE_SCHEMA_VERSION = 1 as const;

/** Model identifiers accepted by the upscale worker. */
export type UpscaleModelId =
  | "realesrgan-x4plus-anime-6b"
  | "realesrgan-x4plus"
  | "realesrgan-x2plus"
  | "realesr-animevideov3"
  | "realesr-general-x4v3";

export const DEFAULT_UPSCALE_MODEL_ID: UpscaleModelId = "realesrgan-x4plus-anime-6b";

/** Supported super-resolution models with their metadata. */
export const UPSCALE_MODELS: Record<UpscaleModelId, {
  id: UpscaleModelId;
  label: string;
  license: string;
  sizeMb: number;
  scale: number;
}> = {
  "realesrgan-x4plus-anime-6b": {
    id: "realesrgan-x4plus-anime-6b",
    label: "动漫插画 6B",
    license: "BSD-3-Clause",
    sizeMb: 18,
    scale: 4,
  },
  "realesrgan-x4plus": {
    id: "realesrgan-x4plus",
    label: "通用照片 x4",
    license: "BSD-3-Clause",
    sizeMb: 64,
    scale: 4,
  },
  "realesrgan-x2plus": {
    id: "realesrgan-x2plus",
    label: "通用照片 x2",
    license: "BSD-3-Clause",
    sizeMb: 64,
    scale: 2,
  },
  "realesr-animevideov3": {
    id: "realesr-animevideov3",
    label: "动画帧轻量 x4",
    license: "BSD-3-Clause",
    sizeMb: 3,
    scale: 4,
  },
  "realesr-general-x4v3": {
    id: "realesr-general-x4v3",
    label: "通用轻量 x4",
    license: "BSD-3-Clause",
    sizeMb: 5,
    scale: 4,
  },
};

export type UpscaleArtifactStatus = "accepted" | "blocked";

export interface UpscaleValidationIssue {
  path: string;
  message: string;
}

export type UpscaleValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: UpscaleValidationIssue[] };

// ---------------------------------------------------------------------------
// Runtime lifecycle IPC (renderer -> preload -> main)
// ---------------------------------------------------------------------------

export const UPSCALE_PROBE_CHANNEL = "upscale-runtime-probe";
export const UPSCALE_PREPARE_CHANNEL = "upscale-runtime-prepare";
export const UPSCALE_ROLLBACK_CHANNEL = "upscale-runtime-rollback";

export const UPSCALE_CHANNELS = [
  UPSCALE_PROBE_CHANNEL,
  UPSCALE_PREPARE_CHANNEL,
  UPSCALE_ROLLBACK_CHANNEL,
] as const;

export type UpscaleRuntimeState = "ready" | "needs-runtime" | "blocked" | "error";

/** Fixed, fieldless request shape for all canonical lifecycle operations. */
export interface UpscaleRuntimeLifecycleRequestV1 {
  schemaVersion: typeof UPSCALE_SCHEMA_VERSION;
}

export interface UpscaleRuntimeStatusV1 {
  schemaVersion: typeof UPSCALE_SCHEMA_VERSION;
  state: UpscaleRuntimeState;
  activeModel: UpscaleModelId;
  modelCacheDir: string;
  modelDownloaded: boolean;
  message?: string;
}

export interface UpscaleRuntimeActionReplyV1 {
  schemaVersion: typeof UPSCALE_SCHEMA_VERSION;
  success: boolean;
  status: UpscaleRuntimeStatusV1;
  code?: string;
  message?: string;
  issues?: UpscaleValidationIssue[];
}

// ---------------------------------------------------------------------------
// Run request (written to disk as JSON, passed to the Python worker via --input)
// ---------------------------------------------------------------------------

export interface UpscaleRunRequestV1 {
  schemaVersion: typeof UPSCALE_SCHEMA_VERSION;
  projectId: string;
  /** Optional for non-shot contexts (material library / asset cards). */
  shotId?: string;
  model: UpscaleModelId;
  /** Source image reference: a project-relative path OR a `local-image://`
   *  URL (imported materials). Both are resolved + confined in main. */
  inputImagePath: string;
  /** Output image reference of the same kind as the input — same directory
   *  as the source, `up4x-` prefixed filename. */
  outputImagePath: string;
  /** 轻度去噪预处理器(噪点治理 08-29):超分前先做保线稿双边滤波,
   *  压掉 gpt-image 斑驳噪点再放大。缺省 false(存量行为不变)。 */
  denoise?: boolean;
}

// ---------------------------------------------------------------------------
// Artifact (written by the worker, validated by the controller)
// ---------------------------------------------------------------------------

export interface UpscaleArtifactV1 {
  schemaVersion: typeof UPSCALE_SCHEMA_VERSION;
  projectId: string;
  shotId: string;
  status: UpscaleArtifactStatus;
  model: UpscaleModelId;
  /** Always "super_res" for accepted runs — never a silent interpolation fallback. */
  method: string;
  scale: number;
  /** SHA-256 of the input image file. */
  inputSha256: string;
  /** SHA-256 of the output PNG — feeds storyboard mediaRef.contentSha256. */
  outputSha256: string;
  /** Absolute path to the output PNG. */
  outputPath: string;
  width: number;
  height: number;
  /** Byte size of the output PNG (feeds the material library size column). */
  outputBytes?: number;
  elapsedSeconds?: number;
  toolVersion: string;
  generatedAt: number;
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Validators (handwritten, matching the depth-workflow contract pattern)
// ---------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Platform-agnostic absolute-path check (works in browser + Node). */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Project-relative path check: non-empty, no leading slash, no traversal. */
function isRelativeProjectPath(p: string): boolean {
  if (!p || p.includes("\0") || p.includes("\\")) return false;
  if (isAbsolutePath(p)) return false;
  const segments = p.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** local-image://<category>/<filename> media reference (imported materials). */
function isLocalImageUrl(p: string): boolean {
  const match = p.match(/^local-image:\/\/([^/]+)\/(.+)$/);
  if (!match) return false;
  const segments = [match[1], ...match[2].split("/")];
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isUpscaleMediaPath(p: string): boolean {
  return isRelativeProjectPath(p) || isLocalImageUrl(p);
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
  issues: UpscaleValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  issues: UpscaleValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) pushIssue(issues, key, "包含未知字段");
  }
}

function validateUpscaleRuntimeState(
  value: unknown,
  path: string,
  issues: UpscaleValidationIssue[],
): value is UpscaleRuntimeState {
  if (value === "ready" || value === "needs-runtime" || value === "blocked" || value === "error") {
    return true;
  }
  pushIssue(issues, path, "状态无效");
  return false;
}

export function validateUpscaleRuntimeLifecycleRequest(
  value: unknown,
): UpscaleValidationResult<UpscaleRuntimeLifecycleRequestV1> {
  const issues: UpscaleValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== UPSCALE_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${UPSCALE_SCHEMA_VERSION}`);
  }
  rejectUnknownFields(value, ["schemaVersion"], issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as UpscaleRuntimeLifecycleRequestV1 };
}

export function validateUpscaleRuntimeStatus(
  value: unknown,
): UpscaleValidationResult<UpscaleRuntimeStatusV1> {
  const issues: UpscaleValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== UPSCALE_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${UPSCALE_SCHEMA_VERSION}`);
  }
  validateUpscaleRuntimeState(value.state, "state", issues);
  if (!isString(value.activeModel) || !(value.activeModel in UPSCALE_MODELS)) {
    pushIssue(issues, "activeModel", "模型无效");
  }
  if (!isString(value.modelCacheDir) || !isAbsolutePath(value.modelCacheDir)) {
    pushIssue(issues, "modelCacheDir", "必须是绝对路径");
  }
  if (typeof value.modelDownloaded !== "boolean") {
    pushIssue(issues, "modelDownloaded", "必须是 boolean");
  }
  if (value.message !== undefined && !isString(value.message)) {
    pushIssue(issues, "message", "必须是字符串");
  }
  rejectUnknownFields(value, ["schemaVersion", "state", "activeModel", "modelCacheDir", "modelDownloaded", "message"], issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as UpscaleRuntimeStatusV1 };
}

export function validateUpscaleRuntimeActionReply(
  value: unknown,
): UpscaleValidationResult<UpscaleRuntimeActionReplyV1> {
  const issues: UpscaleValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== UPSCALE_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${UPSCALE_SCHEMA_VERSION}`);
  }
  if (typeof value.success !== "boolean") pushIssue(issues, "success", "必须是 boolean");
  const status = validateUpscaleRuntimeStatus(value.status);
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
    : { success: true, value: value as unknown as UpscaleRuntimeActionReplyV1 };
}

export function validateUpscaleRunRequest(
  value: unknown,
): UpscaleValidationResult<UpscaleRunRequestV1> {
  const issues: UpscaleValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== UPSCALE_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${UPSCALE_SCHEMA_VERSION}`);
  }
  if (!isString(value.projectId) || !SAFE_SEGMENT.test(value.projectId)) {
    pushIssue(issues, "projectId", "必须是安全路径段");
  }
  if (value.shotId !== undefined && (!isString(value.shotId) || !SAFE_SEGMENT.test(value.shotId))) {
    pushIssue(issues, "shotId", "必须是安全路径段");
  }
  if (!isString(value.inputImagePath) || !isUpscaleMediaPath(value.inputImagePath)) {
    pushIssue(issues, "inputImagePath", "必须是项目内相对路径或 local-image 引用");
  }
  if (!isString(value.outputImagePath) || !isUpscaleMediaPath(value.outputImagePath)) {
    pushIssue(issues, "outputImagePath", "必须是项目内相对路径或 local-image 引用");
  }
  if (!isString(value.model) || !(value.model in UPSCALE_MODELS)) {
    pushIssue(issues, "model", `必须是: ${Object.keys(UPSCALE_MODELS).join(", ")}`);
  }
  if (value.denoise !== undefined && typeof value.denoise !== "boolean") {
    pushIssue(issues, "denoise", "必须是布尔值");
  }
  rejectUnknownFields(value, ["schemaVersion", "projectId", "shotId", "model", "inputImagePath", "outputImagePath", "denoise"], issues);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as UpscaleRunRequestV1 };
}

export function validateUpscaleArtifact(
  value: unknown,
): UpscaleValidationResult<UpscaleArtifactV1> {
  const issues: UpscaleValidationIssue[] = [];
  if (!isObject(value)) {
    return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  }
  if (value.schemaVersion !== UPSCALE_SCHEMA_VERSION) {
    pushIssue(issues, "schemaVersion", `必须是 ${UPSCALE_SCHEMA_VERSION}`);
  }
  if (!isString(value.projectId)) pushIssue(issues, "projectId", "必须是字符串");
  if (!isString(value.shotId)) pushIssue(issues, "shotId", "必须是字符串");
  if (value.status !== "accepted" && value.status !== "blocked") {
    pushIssue(issues, "status", "必须是 accepted 或 blocked");
  }
  if (!isString(value.model) || !(value.model in UPSCALE_MODELS)) {
    pushIssue(issues, "model", `必须是: ${Object.keys(UPSCALE_MODELS).join(", ")}`);
  }
  if (!isString(value.method)) pushIssue(issues, "method", "必须是字符串");
  if (!isNumber(value.scale) || value.scale < 0) pushIssue(issues, "scale", "必须是非负数");
  if (!isString(value.inputSha256) || !HEX64.test(value.inputSha256)) {
    pushIssue(issues, "inputSha256", "必须是 64 位十六进制 SHA-256");
  }
  if (!isString(value.outputSha256) || !HEX64.test(value.outputSha256)) {
    pushIssue(issues, "outputSha256", "必须是 64 位十六进制 SHA-256");
  }
  if (!isString(value.outputPath)) pushIssue(issues, "outputPath", "必须是字符串");
  // Blocked artifacts (worker fail-closed) carry zeroed output fields; only
  // accepted runs must describe a real image.
  if (value.status === "accepted") {
    if (value.method !== "super_res") pushIssue(issues, "method", "accepted 必须使用 super_res");
    if (!isNumber(value.scale) || value.scale <= 0) pushIssue(issues, "scale", "accepted 必须是正数");
    if (!isNumber(value.width) || value.width <= 0) pushIssue(issues, "width", "必须是正数");
    if (!isNumber(value.height) || value.height <= 0) pushIssue(issues, "height", "必须是正数");
    if (!isNumber(value.outputBytes) || !Number.isInteger(value.outputBytes) || value.outputBytes <= 0) {
      pushIssue(issues, "outputBytes", "accepted 必须是正整数");
    }
  } else {
    if (!isNumber(value.width) || value.width < 0) pushIssue(issues, "width", "必须是非负数");
    if (!isNumber(value.height) || value.height < 0) pushIssue(issues, "height", "必须是非负数");
  }
  if (value.elapsedSeconds !== undefined && !isNumber(value.elapsedSeconds)) {
    pushIssue(issues, "elapsedSeconds", "必须是数字");
  }
  if (value.outputBytes !== undefined && (!isNumber(value.outputBytes) || value.outputBytes < 0)) {
    pushIssue(issues, "outputBytes", "必须是非负数");
  }
  if (!isString(value.toolVersion)) pushIssue(issues, "toolVersion", "必须是字符串");
  if (!isNumber(value.generatedAt) || value.generatedAt <= 0) {
    pushIssue(issues, "generatedAt", "必须是正数时间戳");
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as UpscaleArtifactV1 };
}

/** Helper: create a blocked artifact for error responses. */
export function blockedUpscaleArtifact(
  request: Partial<UpscaleRunRequestV1>,
  code: string,
  message: string,
  toolVersion: string,
): UpscaleArtifactV1 {
  return {
    schemaVersion: UPSCALE_SCHEMA_VERSION,
    projectId: typeof request.projectId === "string" ? request.projectId : "unknown",
    shotId: typeof request.shotId === "string" ? request.shotId : "unknown",
    status: "blocked",
    model: request.model ?? DEFAULT_UPSCALE_MODEL_ID,
    method: "",
    scale: 0,
    inputSha256: "0".repeat(64),
    outputSha256: "0".repeat(64),
    outputPath: "",
    width: 0,
    height: 0,
    toolVersion,
    generatedAt: Date.now(),
    code,
    message,
  };
}
