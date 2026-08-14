import {
  type HyperFramesAlphaFormat,
  type HyperFramesOverlayArtifactV1,
  type VideoWorkflowPluginId,
  type VideoWorkflowPluginStatusV1,
  type VideoWorkflowValidationIssue,
  type VideoWorkflowValidationResult,
  type VideoUseChapterArtifactV1,
  type VideoUseChapterRunV1,
  type VideoUseBoundaryIntentV1,
  type VideoUseStoryboardSourcePolicy,
  type VideoWorkflowMode,
  SUPPORTED_ALPHA_FORMATS,
  validateVideoWorkflowPluginStatus,
  validateHyperFramesOverlayArtifact,
  validateVideoUseChapterArtifact,
} from "./video-workflow";

export const VIDEO_WORKFLOW_STATUS_CHANNEL = "video-workflow-plugin-status";
export const VIDEO_WORKFLOW_PREPARE_CHANNEL = "video-workflow-plugin-prepare";
export const VIDEO_WORKFLOW_UPDATE_CHANNEL = "video-workflow-plugin-update";
export const VIDEO_WORKFLOW_REPAIR_CHANNEL = "video-workflow-plugin-repair";
export const VIDEO_WORKFLOW_ROLLBACK_CHANNEL = "video-workflow-plugin-rollback";
export const VIDEO_WORKFLOW_REVIEW_CHANNEL = "video-workflow-review";
export const VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL = "video-workflow-run-chapter";
export const VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL = "video-workflow-apply-chapter";
export const VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL = "video-workflow-read-chapter";

export const VIDEO_WORKFLOW_CHANNELS = [
  VIDEO_WORKFLOW_STATUS_CHANNEL,
  VIDEO_WORKFLOW_PREPARE_CHANNEL,
  VIDEO_WORKFLOW_UPDATE_CHANNEL,
  VIDEO_WORKFLOW_REPAIR_CHANNEL,
  VIDEO_WORKFLOW_ROLLBACK_CHANNEL,
  VIDEO_WORKFLOW_REVIEW_CHANNEL,
  VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL,
] as const;

export type VideoWorkflowChannel = typeof VIDEO_WORKFLOW_CHANNELS[number];

export interface VideoWorkflowPluginActionRequestV1 {
  pluginId: VideoWorkflowPluginId;
}

export interface VideoWorkflowStatusReplyV1 {
  schemaVersion: 1;
  checkedAt: number;
  plugins: VideoWorkflowPluginStatusV1[];
}

export interface VideoWorkflowActionReplyV1 {
  schemaVersion: 1;
  success: boolean;
  checkedAt: number;
  plugins: VideoWorkflowPluginStatusV1[];
  message?: string;
  issues?: VideoWorkflowValidationIssue[];
}

export interface VideoWorkflowReviewRequestV1 {
  projectId: string;
  chapterId: string;
  revision: number;
  reviewer: string;
}

export interface VideoWorkflowReviewReplyV1 {
  schemaVersion: 1;
  success: boolean;
  projectId: string;
  chapterId: string;
  revision: number;
  status: "accepted" | "blocked";
  artifactPath?: string;
  message?: string;
}

/** Renderer-safe chapter input. Runtime paths are owned by the main process. */
export interface VideoWorkflowChapterRunRequestV1 {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  revision: number;
  mode: VideoWorkflowMode;
  /** Defaults to reject; padding is an explicit, auditable derived-input opt-in. */
  derivedInputPolicy?: VideoUseChapterRunV1["derivedInputPolicy"];
  /** Defaults to current-ready; reuse-existing is an explicit operator choice. */
  storyboardSourcePolicy?: VideoUseStoryboardSourcePolicy;
  shots: VideoUseChapterRunV1["shots"];
  /** Optional director-plan boundary intents (transition decisions). Absent
   * keeps legacy behavior: every boundary stays a hard cut. */
  boundaryIntents?: VideoUseBoundaryIntentV1[];
  sourceSha256: string;
  audioSha256: string;
  textSha256: string;
  featureFlags: VideoUseChapterRunV1["featureFlags"];
}

export interface VideoWorkflowChapterRunReplyV1 {
  schemaVersion: 1;
  success: boolean;
  projectId: string;
  chapterId: string;
  revision: number;
  state: "pending" | "ready" | "blocked";
  artifact?: VideoUseChapterArtifactV1;
  artifactPath?: string;
  code?: string;
  message?: string;
}

export interface VideoWorkflowChapterApplyRequestV1 {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  revision: number;
  inputSha256: string;
  width: number;
  height: number;
  fps: number;
  alphaFormat: HyperFramesAlphaFormat;
}

export interface VideoWorkflowChapterApplyReplyV1 {
  schemaVersion: 1;
  success: boolean;
  projectId: string;
  chapterId: string;
  revision: number;
  videoUseArtifact?: VideoUseChapterArtifactV1;
  hyperFramesArtifact?: HyperFramesOverlayArtifactV1;
  videoUseArtifactPath?: string;
  hyperFramesArtifactPath?: string;
  code?: string;
  message?: string;
}

export interface VideoWorkflowChapterReadRequestV1 { schemaVersion: 1; projectId: string; chapterId: string; revision?: number; }
export interface VideoWorkflowChapterReadReplyV1 {
  schemaVersion: 1; projectId: string; chapterId: string; revision?: number;
  videoUseState: "idle" | "pending" | "accepted" | "blocked";
  hyperFramesState: "idle" | "accepted" | "noop" | "blocked";
  inputSha256?: string; message?: string;
}

export function validateVideoWorkflowChapterReadRequest(value: unknown): VideoWorkflowValidationResult<VideoWorkflowChapterReadRequestV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "章节读取请求必须是对象" }] };
  const record = value as Record<string, unknown>; const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  for (const key of ["projectId", "chapterId"] as const) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) issues.push({ path: `$.${key}`, message: "必须是非空字符串" });
  }
  if (record.revision !== undefined && (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision <= 0)) issues.push({ path: "$.revision", message: "必须是正整数" });
  if (Object.keys(record).some((key) => !["schemaVersion", "projectId", "chapterId", "revision"].includes(key))) issues.push({ path: "$", message: "章节读取请求包含未知字段" });
  return issues.length ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterReadRequestV1 };
}
export function validateVideoWorkflowChapterReadReply(value: unknown): VideoWorkflowValidationResult<VideoWorkflowChapterReadReplyV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "章节读取响应必须是对象" }] };
  const record = value as Record<string, unknown>; const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  for (const key of ["projectId", "chapterId"] as const) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) issues.push({ path: `$.${key}`, message: "必须是非空字符串" });
  }
  if (record.revision !== undefined && (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision <= 0)) issues.push({ path: "$.revision", message: "必须是正整数" });
  if (!["idle", "pending", "accepted", "blocked"].includes(String(record.videoUseState))) issues.push({ path: "$.videoUseState", message: "状态无效" });
  if (!["idle", "accepted", "noop", "blocked"].includes(String(record.hyperFramesState))) issues.push({ path: "$.hyperFramesState", message: "状态无效" });
  if (record.inputSha256 !== undefined) validateSha(record.inputSha256, "$.inputSha256", issues);
  if (record.message !== undefined && typeof record.message !== "string") issues.push({ path: "$.message", message: "message 必须是字符串" });
  return issues.length ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterReadReplyV1 };
}

export function validateVideoWorkflowPluginActionRequest(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowPluginActionRequestV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [{ path: "$", message: "插件操作请求必须是对象" }] };
  }
  const pluginId = (value as { pluginId?: unknown }).pluginId;
  if (!["remotion", "video-use", "hyperframes", "seedance-prompt"].includes(String(pluginId))) {
    return { success: false, issues: [{ path: "$.pluginId", message: "插件 ID 无效" }] };
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "pluginId")) {
    return { success: false, issues: [{ path: "$", message: "插件操作请求包含未知字段" }] };
  }
  return { success: true, value: { pluginId: pluginId as VideoWorkflowPluginId } };
}

export function validateVideoWorkflowStatusReply(value: unknown): VideoWorkflowValidationResult<VideoWorkflowStatusReplyV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "状态响应必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  if (typeof record.checkedAt !== "number" || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) issues.push({ path: "$.checkedAt", message: "checkedAt 无效" });
  if (!Array.isArray(record.plugins)) issues.push({ path: "$.plugins", message: "plugins 必须是数组" });
  else record.plugins.forEach((plugin, index) => {
    const validated = validateVideoWorkflowPluginStatus(plugin);
    if (!validated.success) issues.push(...validated.issues.map((entry) => ({ ...entry, path: `$.plugins[${index}]${entry.path.slice(1)}` })));
  });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: value as unknown as VideoWorkflowStatusReplyV1 };
}

export function validateVideoWorkflowActionReply(value: unknown): VideoWorkflowValidationResult<VideoWorkflowActionReplyV1> {
  const base = validateVideoWorkflowStatusReply(value);
  if (!base.success) return base;
  const record = value as Record<string, unknown>;
  if (typeof record.success !== "boolean") return { success: false, issues: [{ path: "$.success", message: "success 必须是 boolean" }] };
  if (record.message !== undefined && typeof record.message !== "string") return { success: false, issues: [{ path: "$.message", message: "message 必须是字符串" }] };
  return { success: true, value: value as unknown as VideoWorkflowActionReplyV1 };
}

export function validateVideoWorkflowReviewRequest(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowReviewRequestV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, issues: [{ path: "$", message: "视频工作流确认请求必须是对象" }] };
  }
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  for (const key of ["projectId", "chapterId", "reviewer"] as const) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) issues.push({ path: `$.${key}`, message: "必须是非空字符串" });
  }
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision <= 0) issues.push({ path: "$.revision", message: "必须是正整数" });
  if (Object.keys(record).some((key) => !["projectId", "chapterId", "revision", "reviewer"].includes(key))) issues.push({ path: "$", message: "确认请求包含未知字段" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowReviewRequestV1 };
}

export function validateVideoWorkflowReviewReply(value: unknown): VideoWorkflowValidationResult<VideoWorkflowReviewReplyV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "视频工作流确认响应必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  if (typeof record.success !== "boolean") issues.push({ path: "$.success", message: "success 必须是 boolean" });
  for (const key of ["projectId", "chapterId"] as const) if (typeof record[key] !== "string" || record[key].length === 0) issues.push({ path: `$.${key}`, message: "必须是非空字符串" });
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision <= 0) issues.push({ path: "$.revision", message: "必须是正整数" });
  if (record.status !== "accepted" && record.status !== "blocked") issues.push({ path: "$.status", message: "status 无效" });
  if (record.artifactPath !== undefined && typeof record.artifactPath !== "string") issues.push({ path: "$.artifactPath", message: "artifactPath 必须是字符串" });
  if (record.message !== undefined && typeof record.message !== "string") issues.push({ path: "$.message", message: "message 必须是字符串" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: value as unknown as VideoWorkflowReviewReplyV1 };
}

function validateSha(value: unknown, path: string, issues: VideoWorkflowValidationIssue[]) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) issues.push({ path, message: "必须是 64 位小写 SHA-256" });
}

function validateChapterIdentity(record: Record<string, unknown>, issues: VideoWorkflowValidationIssue[]) {
  for (const key of ["projectId", "chapterId"] as const) {
    if (typeof record[key] !== "string" || record[key].trim().length === 0) issues.push({ path: `$.${key}`, message: "必须是非空字符串" });
  }
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision <= 0) issues.push({ path: "$.revision", message: "必须是正整数" });
}

export function validateVideoWorkflowChapterRunRequest(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowChapterRunRequestV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "video-use 章节请求必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  validateChapterIdentity(record, issues);
  if (record.mode !== "editable-edl" && record.mode !== "flat-shot-mp4") issues.push({ path: "$.mode", message: "模式无效" });
  if (!Array.isArray(record.shots) || record.shots.length === 0) issues.push({ path: "$.shots", message: "至少需要一个 shot" });
  validateSha(record.sourceSha256, "$.sourceSha256", issues);
  validateSha(record.audioSha256, "$.audioSha256", issues);
  validateSha(record.textSha256, "$.textSha256", issues);
  if (typeof record.featureFlags !== "object" || record.featureFlags === null || Array.isArray(record.featureFlags)) issues.push({ path: "$.featureFlags", message: "featureFlags 必须是对象" });
  else for (const key of ["alignment", "edl", "subtitles", "grade", "preview", "selfEval"] as const) if ((record.featureFlags as Record<string, unknown>)[key] !== true) issues.push({ path: `$.featureFlags.${key}`, message: "首版必须为 true" });
  if (record.derivedInputPolicy !== undefined && record.derivedInputPolicy !== "reject" && record.derivedInputPolicy !== "pad-video-to-audio") {
    issues.push({ path: "$.derivedInputPolicy", message: "derivedInputPolicy 无效" });
  }
  if (record.storyboardSourcePolicy !== undefined && record.storyboardSourcePolicy !== "current-ready" && record.storyboardSourcePolicy !== "reuse-existing") {
    issues.push({ path: "$.storyboardSourcePolicy", message: "storyboardSourcePolicy 无效" });
  }
  if (record.boundaryIntents !== undefined) {
    if (!Array.isArray(record.boundaryIntents)) issues.push({ path: "$.boundaryIntents", message: "boundaryIntents 必须是数组" });
    else {
      const effectIds = new Set(["cut", "fade", "crossfade", "flash", "blackout"]);
      record.boundaryIntents.forEach((intent, index) => {
        const path = `$.boundaryIntents[${index}]`;
        if (typeof intent !== "object" || intent === null || Array.isArray(intent)) {
          issues.push({ path, message: "必须是对象" });
          return;
        }
        const entry = intent as Record<string, unknown>;
        if (typeof entry.fromShotId !== "string" || !entry.fromShotId.trim()) issues.push({ path: `${path}.fromShotId`, message: "必须是非空字符串" });
        if (typeof entry.toShotId !== "string" || !entry.toShotId.trim()) issues.push({ path: `${path}.toShotId`, message: "必须是非空字符串" });
        if (typeof entry.effectId !== "string" || !effectIds.has(entry.effectId)) issues.push({ path: `${path}.effectId`, message: "必须是内置转场类型" });
        if (typeof entry.durationUs !== "number" || !Number.isSafeInteger(entry.durationUs) || entry.durationUs <= 0) issues.push({ path: `${path}.durationUs`, message: "必须是正整数微秒" });
        if (entry.styleWord !== undefined && typeof entry.styleWord !== "string") issues.push({ path: `${path}.styleWord`, message: "必须是字符串" });
        if (entry.moodWord !== undefined && typeof entry.moodWord !== "string") issues.push({ path: `${path}.moodWord`, message: "必须是字符串" });
      });
    }
  }
  const allowed = new Set(["schemaVersion", "projectId", "chapterId", "revision", "mode", "derivedInputPolicy", "storyboardSourcePolicy", "shots", "boundaryIntents", "sourceSha256", "audioSha256", "textSha256", "featureFlags"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) issues.push({ path: "$", message: "video-use 章节请求包含未知字段" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterRunRequestV1 };
}

export function validateVideoWorkflowChapterRunReply(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowChapterRunReplyV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "video-use 章节响应必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  if (typeof record.success !== "boolean") issues.push({ path: "$.success", message: "success 必须是 boolean" });
  validateChapterIdentity(record, issues);
  if (!["pending", "ready", "blocked"].includes(String(record.state))) issues.push({ path: "$.state", message: "state 无效" });
  if (record.artifact !== undefined) {
    const artifact = validateVideoUseChapterArtifact(record.artifact);
    if (!artifact.success) issues.push(...artifact.issues.map((entry) => ({ ...entry, path: `$.artifact${entry.path === "$" ? "" : entry.path.slice(1)}` })));
  }
  for (const key of ["artifactPath", "code", "message"] as const) if (record[key] !== undefined && typeof record[key] !== "string") issues.push({ path: `$.${key}`, message: "必须是字符串" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterRunReplyV1 };
}

export function validateVideoWorkflowChapterApplyRequest(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowChapterApplyRequestV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "视频工作流应用请求必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  validateChapterIdentity(record, issues);
  validateSha(record.inputSha256, "$.inputSha256", issues);
  for (const key of ["width", "height"] as const) if (typeof record[key] !== "number" || !Number.isInteger(record[key]) || record[key] <= 0) issues.push({ path: `$.${key}`, message: "必须是正整数" });
  if (typeof record.fps !== "number" || !Number.isFinite(record.fps) || record.fps <= 0) issues.push({ path: "$.fps", message: "必须是正数" });
  if (!(SUPPORTED_ALPHA_FORMATS as readonly string[]).includes(String(record.alphaFormat))) issues.push({ path: "$.alphaFormat", message: "透明格式无效或暂不支持，必须使用 ProRes 4444 MOV 或 WebM VP9 alpha" });
  const allowed = new Set(["schemaVersion", "projectId", "chapterId", "revision", "inputSha256", "width", "height", "fps", "alphaFormat"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) issues.push({ path: "$", message: "视频工作流应用请求包含未知字段" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterApplyRequestV1 };
}

export function validateVideoWorkflowChapterApplyReply(
  value: unknown,
): VideoWorkflowValidationResult<VideoWorkflowChapterApplyReplyV1> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { success: false, issues: [{ path: "$", message: "视频工作流应用响应必须是对象" }] };
  const record = value as Record<string, unknown>;
  const issues: VideoWorkflowValidationIssue[] = [];
  if (record.schemaVersion !== 1) issues.push({ path: "$.schemaVersion", message: "不支持的 schemaVersion" });
  if (typeof record.success !== "boolean") issues.push({ path: "$.success", message: "success 必须是 boolean" });
  validateChapterIdentity(record, issues);
  for (const [key, validator] of [["videoUseArtifact", validateVideoUseChapterArtifact], ["hyperFramesArtifact", validateHyperFramesOverlayArtifact]] as const) {
    if (record[key] === undefined) continue;
    const parsed = validator(record[key]);
    if (!parsed.success) issues.push(...parsed.issues.map((entry) => ({ ...entry, path: `$.${key}${entry.path === "$" ? "" : entry.path.slice(1)}` })));
  }
  for (const key of ["videoUseArtifactPath", "hyperFramesArtifactPath", "code", "message"] as const) if (record[key] !== undefined && typeof record[key] !== "string") issues.push({ path: `$.${key}`, message: "必须是字符串" });
  return issues.length > 0 ? { success: false, issues } : { success: true, value: record as unknown as VideoWorkflowChapterApplyReplyV1 };
}

export function assertVideoWorkflowIpcRequest<T>(result: VideoWorkflowValidationResult<T>): T {
  if (!result.success) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
  return result.value;
}
