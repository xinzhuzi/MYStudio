// Typed contract for the local image-generation lifecycle and generated media.

export const IMAGE_GEN_SCHEMA_VERSION = 1 as const;

// 本地生图模型 id —— 旧 sdxl-turbo/flux-schnell 已退役(从未准备过),存量
// 配置由 Python 侧 LEGACY_IMAGE_MODEL_ALIASES 归一到 Qwen(08-28-qwen-image-local-gen)
export type ImageGenModelId = "qwen-image-edit-2511" | "z-image-turbo" | "flux2-klein-9b";

export const IMAGE_GEN_PROBE_CHANNEL = "image-gen-runtime-probe";
export const IMAGE_GEN_PREPARE_CHANNEL = "image-gen-runtime-prepare";
export const IMAGE_GEN_ROLLBACK_CHANNEL = "image-gen-runtime-rollback";

export const IMAGE_GEN_CHANNELS = [
  IMAGE_GEN_PROBE_CHANNEL,
  IMAGE_GEN_PREPARE_CHANNEL,
  IMAGE_GEN_ROLLBACK_CHANNEL,
] as const;

export type ImageGenRuntimeState = "ready" | "needs-runtime" | "blocked" | "error";
export type ImageGenArtifactStatus = "accepted" | "blocked";

export interface ImageGenRuntimeLifecycleRequestV1 {
  schemaVersion: typeof IMAGE_GEN_SCHEMA_VERSION;
}

export interface ImageGenRuntimeStatusV1 {
  schemaVersion: typeof IMAGE_GEN_SCHEMA_VERSION;
  state: ImageGenRuntimeState;
  activeModel: ImageGenModelId;
  modelCacheDir: string;
  modelDownloaded: boolean;
  pythonAvailable?: boolean;
  message?: string;
}

export interface ImageGenRuntimeActionReplyV1 {
  schemaVersion: typeof IMAGE_GEN_SCHEMA_VERSION;
  success: boolean;
  status: ImageGenRuntimeStatusV1;
  code?: string;
  message?: string;
  issues?: ImageGenValidationIssue[];
}

export interface ImageGenRunRequestV1 {
  schemaVersion: typeof IMAGE_GEN_SCHEMA_VERSION;
  projectId: string;
  prompt: string;
  model: ImageGenModelId;
  outputPath: string;
  referenceImagePath?: string;
}

export interface ImageGenArtifactV1 {
  schemaVersion: typeof IMAGE_GEN_SCHEMA_VERSION;
  projectId: string;
  status: ImageGenArtifactStatus;
  model: ImageGenModelId;
  outputPath: string;
  outputSha256: string;
  width: 1920;
  height: 1080;
  mediaRef?: {
    kind: "image";
    path: string;
    contentSha256: string;
  };
  code?: string;
  message?: string;
}

export interface ImageGenValidationIssue {
  path: string;
  message: string;
}

export type ImageGenValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ImageGenValidationIssue[] };

const HEX64 = /^[a-f0-9]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
}

function isModel(value: unknown): value is ImageGenModelId {
  return value === "qwen-image-edit-2511" || value === "z-image-turbo" || value === "flux2-klein-9b";
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  issues: ImageGenValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: key, message: "包含未知字段" });
  }
}

export function validateImageGenRuntimeLifecycleRequest(
  value: unknown,
): ImageGenValidationResult<ImageGenRuntimeLifecycleRequestV1> {
  const issues: ImageGenValidationIssue[] = [];
  if (!isObject(value)) return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  if (value.schemaVersion !== IMAGE_GEN_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: `必须是 ${IMAGE_GEN_SCHEMA_VERSION}` });
  }
  rejectUnknownFields(value, ["schemaVersion"], issues);
  return issues.length
    ? { success: false, issues }
    : { success: true, value: { schemaVersion: IMAGE_GEN_SCHEMA_VERSION } };
}

export function validateImageGenRuntimeStatus(
  value: unknown,
): ImageGenValidationResult<ImageGenRuntimeStatusV1> {
  const issues: ImageGenValidationIssue[] = [];
  if (!isObject(value)) return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  if (value.schemaVersion !== IMAGE_GEN_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: `必须是 ${IMAGE_GEN_SCHEMA_VERSION}` });
  if (value.state !== "ready" && value.state !== "needs-runtime" && value.state !== "blocked" && value.state !== "error") {
    issues.push({ path: "state", message: "状态无效" });
  }
  if (!isModel(value.activeModel)) issues.push({ path: "activeModel", message: "模型无效" });
  if (!isAbsolutePath(value.modelCacheDir)) issues.push({ path: "modelCacheDir", message: "必须是绝对路径" });
  if (typeof value.modelDownloaded !== "boolean") issues.push({ path: "modelDownloaded", message: "必须是 boolean" });
  if (value.pythonAvailable !== undefined && typeof value.pythonAvailable !== "boolean") issues.push({ path: "pythonAvailable", message: "必须是 boolean" });
  if (value.message !== undefined && typeof value.message !== "string") issues.push({ path: "message", message: "必须是字符串" });
  rejectUnknownFields(value, ["schemaVersion", "state", "activeModel", "modelCacheDir", "modelDownloaded", "pythonAvailable", "message"], issues);
  if (issues.length) return { success: false, issues };
  return {
    success: true,
    value: {
      schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
      state: value.state as ImageGenRuntimeState,
      activeModel: value.activeModel as ImageGenModelId,
      modelCacheDir: value.modelCacheDir as string,
      modelDownloaded: value.modelDownloaded as boolean,
      ...(value.pythonAvailable !== undefined ? { pythonAvailable: value.pythonAvailable as boolean } : {}),
      ...(value.message !== undefined ? { message: value.message as string } : {}),
    },
  };
}

export function validateImageGenRuntimeActionReply(
  value: unknown,
): ImageGenValidationResult<ImageGenRuntimeActionReplyV1> {
  const issues: ImageGenValidationIssue[] = [];
  if (!isObject(value)) return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  if (value.schemaVersion !== IMAGE_GEN_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: `必须是 ${IMAGE_GEN_SCHEMA_VERSION}` });
  if (typeof value.success !== "boolean") issues.push({ path: "success", message: "必须是 boolean" });
  const status = validateImageGenRuntimeStatus(value.status);
  if (!status.success) issues.push(...status.issues.map((issue) => ({ ...issue, path: `status.${issue.path}` })));
  if (value.code !== undefined && typeof value.code !== "string") issues.push({ path: "code", message: "必须是字符串" });
  if (value.message !== undefined && typeof value.message !== "string") issues.push({ path: "message", message: "必须是字符串" });
  if (value.issues !== undefined && (!Array.isArray(value.issues) || value.issues.some((issue) => !isObject(issue) || typeof issue.path !== "string" || typeof issue.message !== "string" || Object.keys(issue).some((key) => key !== "path" && key !== "message")))) {
    issues.push({ path: "issues", message: "必须是验证问题数组" });
  }
  rejectUnknownFields(value, ["schemaVersion", "success", "status", "code", "message", "issues"], issues);
  if (issues.length || !status.success) return { success: false, issues };
  return {
    success: true,
    value: {
      schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
      success: value.success as boolean,
      status: status.value,
      ...(value.code !== undefined ? { code: value.code as string } : {}),
      ...(value.message !== undefined ? { message: value.message as string } : {}),
      ...(value.issues !== undefined ? { issues: value.issues as ImageGenValidationIssue[] } : {}),
    },
  };
}

export function validateImageGenArtifact(
  value: unknown,
): ImageGenValidationResult<ImageGenArtifactV1> {
  const issues: ImageGenValidationIssue[] = [];
  if (!isObject(value)) return { success: false, issues: [{ path: "root", message: "必须是对象" }] };
  if (value.schemaVersion !== IMAGE_GEN_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: `必须是 ${IMAGE_GEN_SCHEMA_VERSION}` });
  if (typeof value.projectId !== "string" || !value.projectId.trim()) issues.push({ path: "projectId", message: "必须是非空字符串" });
  if (value.status !== "accepted" && value.status !== "blocked") issues.push({ path: "status", message: "必须是 accepted 或 blocked" });
  if (!isModel(value.model)) issues.push({ path: "model", message: "模型无效" });
  if (!isAbsolutePath(value.outputPath)) issues.push({ path: "outputPath", message: "必须是绝对路径" });
  if (typeof value.outputSha256 !== "string" || !HEX64.test(value.outputSha256)) issues.push({ path: "outputSha256", message: "必须是 SHA-256" });
  if (value.width !== 1920) issues.push({ path: "width", message: "输出宽度必须是 1920" });
  if (value.height !== 1080) issues.push({ path: "height", message: "输出高度必须是 1080" });
  if (value.mediaRef !== undefined) {
    if (!isObject(value.mediaRef) || value.mediaRef.kind !== "image" || !isAbsolutePath(value.mediaRef.path) || typeof value.mediaRef.contentSha256 !== "string" || !HEX64.test(value.mediaRef.contentSha256)) {
      issues.push({ path: "mediaRef", message: "mediaRef 必须包含 image、绝对路径和 SHA-256" });
    }
  }
  if (value.code !== undefined && typeof value.code !== "string") issues.push({ path: "code", message: "必须是字符串" });
  if (value.message !== undefined && typeof value.message !== "string") issues.push({ path: "message", message: "必须是字符串" });
  rejectUnknownFields(value, ["schemaVersion", "projectId", "status", "model", "outputPath", "outputSha256", "width", "height", "mediaRef", "code", "message"], issues);
  if (issues.length) return { success: false, issues };
  return {
    success: true,
    value: {
      schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
      projectId: value.projectId as string,
      status: value.status as ImageGenArtifactStatus,
      model: value.model as ImageGenModelId,
      outputPath: value.outputPath as string,
      outputSha256: value.outputSha256 as string,
      width: 1920,
      height: 1080,
      ...(value.mediaRef !== undefined ? {
        mediaRef: {
          kind: "image" as const,
          path: (value.mediaRef as Record<string, unknown>).path as string,
          contentSha256: (value.mediaRef as Record<string, unknown>).contentSha256 as string,
        },
      } : {}),
      ...(value.code !== undefined ? { code: value.code as string } : {}),
      ...(value.message !== undefined ? { message: value.message as string } : {}),
    },
  };
}
