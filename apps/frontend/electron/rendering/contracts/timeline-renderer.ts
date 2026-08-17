export const TIMELINE_RENDERER_IDS = ["remotion", "ffmpeg"] as const;

export type TimelineRendererId = typeof TIMELINE_RENDERER_IDS[number];

// shake/glow/grain/chromaticAberration 已转正：合成层 VisualClip 完整实现
// （build-composition-props 消费 plan.effects），编辑预览亦有近似实现。
export const REMOTION_UNSUPPORTED_EFFECT_IDS = [
  "glitch",
  "blur",
] as const;

export type RemotionUnsupportedEffectId =
  typeof REMOTION_UNSUPPORTED_EFFECT_IDS[number];

export const TIMELINE_RENDER_PROGRESS_STAGES = [
  "validating",
  "preparing",
  "rendering",
  "postprocessing",
  "probing",
  "completed",
  "canceled",
  "failed",
] as const;

export type TimelineRenderProgressStage =
  typeof TIMELINE_RENDER_PROGRESS_STAGES[number];

export interface TimelineRenderRequest<TPlan = unknown> {
  schemaVersion: 1;
  requestedRenderer: TimelineRendererId;
  plan: TPlan;
}

export function createTimelineRenderRequest<TPlan>(
  requestedRenderer: TimelineRendererId,
  plan: TPlan,
): TimelineRenderRequest<TPlan> {
  return { schemaVersion: 1, requestedRenderer, plan };
}

export interface RendererFallbackReason<TEffectId extends string = string> {
  code: "unsupported-effects";
  effectIds: TEffectId[];
  message: string;
}

export interface TimelineRendererEvidence<TEffectId extends string = string> {
  requested: TimelineRendererId;
  actual: TimelineRendererId;
  version?: string;
  bundleVersion?: string;
  fallback?: RendererFallbackReason<TEffectId>;
}

export interface TimelineAudioPostProcessEvidence {
  engine: "ffmpeg";
  loudnessLufs: number;
  truePeakDbtp: number;
  logPath: string;
}

export interface TimelineRenderProgress {
  jobId: string;
  stage: TimelineRenderProgressStage;
  ratio: number;
  message?: string;
}

export type RendererContractValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function isTimelineRendererId(value: unknown): value is TimelineRendererId {
  return typeof value === "string"
    && (TIMELINE_RENDERER_IDS as readonly string[]).includes(value);
}

export function isTimelineRenderProgressStage(
  value: unknown,
): value is TimelineRenderProgressStage {
  return typeof value === "string"
    && (TIMELINE_RENDER_PROGRESS_STAGES as readonly string[]).includes(value);
}

export function validateTimelineRenderRequestEnvelope(
  value: unknown,
): RendererContractValidationResult<TimelineRenderRequest<unknown>> {
  const issues: Array<{ path: string; message: string }> = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "渲染请求必须是对象" }] };
  }
  if (value.schemaVersion !== 1) {
    issues.push({ path: "schemaVersion", message: "仅支持渲染请求 schemaVersion=1" });
  }
  if (!isTimelineRendererId(value.requestedRenderer)) {
    issues.push({ path: "requestedRenderer", message: "渲染器必须是 remotion 或 ffmpeg" });
  }
  if (!isRecord(value.plan)) {
    issues.push({ path: "plan", message: "渲染计划必须是对象" });
  }
  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    value: value as unknown as TimelineRenderRequest<unknown>,
  };
}

export function validateTimelineRenderProgress(
  value: unknown,
): RendererContractValidationResult<TimelineRenderProgress> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "渲染进度必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (!isNonEmptyString(value.jobId)) {
    issues.push({ path: "jobId", message: "渲染进度 jobId 必须是非空字符串" });
  }
  if (!isTimelineRenderProgressStage(value.stage)) {
    issues.push({ path: "stage", message: "渲染进度阶段无效" });
  }
  if (!isFiniteRatio(value.ratio)) {
    issues.push({ path: "ratio", message: "渲染进度比例必须是 0 到 1 的有限数值" });
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    issues.push({ path: "message", message: "渲染进度消息必须是字符串" });
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as TimelineRenderProgress };
}

export function validateTimelineRendererEvidence(
  value: unknown,
): RendererContractValidationResult<TimelineRendererEvidence> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "渲染器证据必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (!isTimelineRendererId(value.requested)) {
    issues.push({ path: "requested", message: "请求渲染器必须是 remotion 或 ffmpeg" });
  }
  if (!isTimelineRendererId(value.actual)) {
    issues.push({ path: "actual", message: "实际渲染器必须是 remotion 或 ffmpeg" });
  }
  validateOptionalNonEmptyString(value.version, "version", issues);
  validateOptionalNonEmptyString(value.bundleVersion, "bundleVersion", issues);
  validateFallback(value, issues);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as TimelineRendererEvidence };
}

export function validateTimelineAudioPostProcessEvidence(
  value: unknown,
): RendererContractValidationResult<TimelineAudioPostProcessEvidence> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "音频后处理证据必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (value.engine !== "ffmpeg") {
    issues.push({ path: "engine", message: "音频后处理引擎必须是 ffmpeg" });
  }
  if (!isFiniteNumber(value.loudnessLufs)) {
    issues.push({ path: "loudnessLufs", message: "目标响度必须是有限数值" });
  }
  if (!isFiniteNumber(value.truePeakDbtp)) {
    issues.push({ path: "truePeakDbtp", message: "目标真峰值必须是有限数值" });
  }
  if (!isNonEmptyString(value.logPath)) {
    issues.push({ path: "logPath", message: "音频后处理日志路径必须是非空字符串" });
  }
  if (issues.length > 0) return { success: false, issues };
  return {
    success: true,
    value: value as unknown as TimelineAudioPostProcessEvidence,
  };
}

function validateFallback(
  evidence: Record<string, unknown>,
  issues: Array<{ path: string; message: string }>,
): void {
  if (evidence.fallback === undefined) return;
  if (!isRecord(evidence.fallback)) {
    issues.push({ path: "fallback", message: "渲染器回退原因必须是对象" });
    return;
  }
  if (evidence.fallback.code !== "unsupported-effects") {
    issues.push({ path: "fallback.code", message: "渲染器回退原因代码无效" });
  }
  if (!isNonEmptyStringArray(evidence.fallback.effectIds)) {
    issues.push({ path: "fallback.effectIds", message: "回退效果列表必须包含非空字符串" });
  }
  if (!isNonEmptyString(evidence.fallback.message)) {
    issues.push({ path: "fallback.message", message: "渲染器回退说明必须是非空字符串" });
  }
  if (evidence.requested !== "remotion" || evidence.actual !== "ffmpeg") {
    issues.push({
      path: "fallback",
      message: "兼容性回退必须从 remotion 路由到 ffmpeg",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(isNonEmptyString);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateOptionalNonEmptyString(
  value: unknown,
  path: string,
  issues: Array<{ path: string; message: string }>,
): void {
  if (value !== undefined && !isNonEmptyString(value)) {
    issues.push({ path, message: `${path} 必须是非空字符串` });
  }
}

function isFiniteRatio(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}
