import type { TimelineTimeUs } from "@/types/editing";

export const VIDEO_WORKFLOW_SCHEMA_VERSION = 1 as const;
export const VIDEO_WORKFLOW_TIME_UNIT = "seconds" as const;
export const VIDEO_WORKFLOW_TIMELINE_TIME_UNIT = "microseconds" as const;

export type VideoWorkflowMode = "editable-edl" | "flat-shot-mp4";
export type VideoWorkflowStage =
  | "preparing"
  | "aligning"
  | "editing"
  | "previewing"
  | "evaluating"
  | "awaiting-review"
  | "applying"
  | "ready"
  | "blocked";

export type VideoWorkflowArtifactStatus = "pending" | "accepted" | "blocked";
export type HyperFramesArtifactStatus = "accepted" | "noop" | "blocked";
export type VideoUseDerivedInputPolicy = "reject" | "pad-video-to-audio";
/** Explicit operator choice for a storyboard whose source row is stale. */
export type VideoUseStoryboardSourcePolicy = "current-ready" | "reuse-existing";

export interface VideoUseDerivedInputEvidenceV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  kind: "padded-video";
  derivation: "ffmpeg-tpad-clone-apad";
  sourcePath: string;
  sourceSha256: string;
  sourceDurationUs: TimelineTimeUs;
  derivedPath: string;
  derivedSha256: string;
  derivedDurationUs: TimelineTimeUs;
  derivedRevision: number;
  createdAt: number;
}

export interface VideoWorkflowValidationIssue {
  path: string;
  message: string;
}

export type VideoWorkflowValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: VideoWorkflowValidationIssue[] };

export interface VideoUseRuntimeManifestV1 {
  profileId: string;
  pythonExecutable: string;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
  packageLockSha256: string;
  markerPath: string;
}

export interface VideoUseFeatureFlagsV1 {
  alignment: true;
  edl: true;
  subtitles: true;
  grade: true;
  preview: true;
  selfEval: true;
}

export interface VideoUseShotInputV1 {
  shotId: string;
  videoPath: string;
  audioPath: string;
  ttsSpokenText: string;
  sourceSha256: string;
  audioSha256: string;
  textSha256: string;
  durationUs: TimelineTimeUs;
  derivedInput?: VideoUseDerivedInputEvidenceV1;
}

export interface VideoUseChapterRunV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  revision: number;
  mode: VideoWorkflowMode;
  derivedInputPolicy?: VideoUseDerivedInputPolicy;
  storyboardSourcePolicy?: VideoUseStoryboardSourcePolicy;
  stage: VideoWorkflowStage;
  timeUnit: typeof VIDEO_WORKFLOW_TIME_UNIT;
  shots: VideoUseShotInputV1[];
  sourceSha256: string;
  audioSha256: string;
  textSha256: string;
  featureFlags: VideoUseFeatureFlagsV1;
  runtime: VideoUseRuntimeManifestV1;
  createdAt: number;
  updatedAt: number;
}

export interface VideoUseWordTimingV1 {
  id: string;
  text: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  confidence: number;
}

export interface VideoUseAlignmentCueV1 {
  cueId: string;
  shotId: string;
  text: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  confidence: number;
  words: VideoUseWordTimingV1[];
}

export interface VideoUseEdlEntryV1 {
  shotId: string;
  sourcePath: string;
  sourceInS: number;
  sourceOutS: number;
  timelineStartS: number;
  durationS: number;
}

export interface VideoUseSubtitleCueV1 {
  cueId: string;
  shotId: string;
  text: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  source: "alignment";
}

export interface VideoUseOverlaySlotV1 {
  slotId: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
}

export interface VideoUseGradeV1 {
  filter: string;
  parameters: Record<string, number | string | boolean>;
}

export interface VideoUsePreviewV1 {
  path: string;
  sha256: string;
  subtitlesBurnedIn: boolean;
  durationS: number;
}

export interface VideoUseSelfEvaluationV1 {
  passed: boolean;
  score: number;
  notes: string[];
  evaluatedAt: number;
}

export interface VideoUseArtifactEvidenceV1 {
  inputSha256: string;
  artifactSha256: string;
  toolVersion: string;
  acceptedAt?: number;
}

export interface VideoUseReviewSidecarV1 {
  projectId: string;
  chapterId: string;
  revision: number;
  artifactSha256: string;
  reviewer: string;
  decision: "accepted";
  timestamp: number;
}

export interface VideoUseChapterArtifactV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  revision: number;
  mode: VideoWorkflowMode;
  storyboardSourcePolicy?: VideoUseStoryboardSourcePolicy;
  stage: Exclude<VideoWorkflowStage, "preparing" | "aligning" | "editing" | "previewing">;
  status: VideoWorkflowArtifactStatus;
  timeUnit: typeof VIDEO_WORKFLOW_TIME_UNIT;
  timelineTimeUnit: typeof VIDEO_WORKFLOW_TIMELINE_TIME_UNIT;
  sourceSha256: string;
  audioSha256: string;
  textSha256: string;
  alignment: VideoUseAlignmentCueV1[];
  edl: VideoUseEdlEntryV1[];
  subtitles: VideoUseSubtitleCueV1[];
  grade: VideoUseGradeV1;
  overlaySlots: VideoUseOverlaySlotV1[];
  preview: VideoUsePreviewV1;
  selfEval: VideoUseSelfEvaluationV1;
  flatShotMp4Path?: string;
  flatShotMp4Sha256?: string;
  evidence: VideoUseArtifactEvidenceV1;
  derivedInputs?: VideoUseDerivedInputEvidenceV1[];
  review?: VideoUseReviewSidecarV1;
}

export type HyperFramesAlphaFormat = "prores-4444-mov" | "webm-vp9-alpha" | "png-sequence";

export interface HyperFramesOverlayWindowV1 {
  slotId: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  templateId: string;
  parameters: Record<string, string | number | boolean>;
}

export interface HyperFramesOverlayRequestV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  revision: number;
  sourceArtifactSha256: string;
  inputSha256: string;
  width: number;
  height: number;
  fps: number;
  alphaFormat: HyperFramesAlphaFormat;
  outputPath: string;
  windows: HyperFramesOverlayWindowV1[];
}

export interface HyperFramesOverlayArtifactV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  revision: number;
  status: HyperFramesArtifactStatus;
  sourceArtifactSha256: string;
  inputSha256: string;
  alphaFormat: HyperFramesAlphaFormat;
  outputPath?: string;
  outputSha256?: string;
  windows: HyperFramesOverlayWindowV1[];
  toolVersion: string;
  generatedAt: number;
}

export type VideoWorkflowPluginId = "remotion" | "video-use" | "hyperframes" | "seedance-prompt";
export type VideoWorkflowPluginRuntimeState =
  | "ready"
  | "needs-runtime"
  | "update-available"
  | "blocked"
  | "error"
  | "deferred";

export interface VideoWorkflowPluginStatusV1 {
  schemaVersion: typeof VIDEO_WORKFLOW_SCHEMA_VERSION;
  pluginId: VideoWorkflowPluginId;
  displayName: string;
  sourceUrl: string;
  sourceCommit: string;
  license: string;
  appVersion: string;
  pluginVersion: string;
  runtimeState: VideoWorkflowPluginRuntimeState;
  runtimePath?: string;
  profilePath?: string;
  dependencies: {
    python?: string;
    node?: string;
    browser?: string;
    ffmpeg?: string;
    ffprobe?: string;
  };
  checkedAt: number;
  runtimeCode?: string;
  message?: string;
}

export interface RemotionChapterGateInputV1 {
  projectId: string;
  chapterId: string;
  revision: number;
  /** The final Remotion job identity. Kept separate from the video-use input. */
  inputSha256: string;
  /** The canonical StoryboardShot/TTS input fingerprint consumed by video-use. */
  videoUseInputSha256?: string;
  videoUseArtifact?: VideoUseChapterArtifactV1;
  hyperFramesArtifact?: HyperFramesOverlayArtifactV1;
}

export interface RemotionChapterGateAcceptedV1 {
  accepted: true;
  mode: VideoWorkflowMode;
  videoUseArtifactSha256: string;
  hyperFramesStatus: Exclude<HyperFramesArtifactStatus, "blocked">;
  /** Present only for a rendered (non-noop) transparent overlay. */
  hyperFramesOutputPath?: string;
  hyperFramesOutputSha256?: string;
  hyperFramesAlphaFormat?: HyperFramesAlphaFormat;
  hyperFramesWindows?: HyperFramesOverlayWindowV1[];
  /** Present only for flat-shot-mp4; Remotion verifies this clean source before rendering. */
  videoUseFlatShotMp4Path?: string;
  videoUseFlatShotMp4Sha256?: string;
  /** Derived editable-EDL inputs and their byte hashes. */
  videoUseDerivedInputs?: VideoUseDerivedInputEvidenceV1[];
}

export interface RemotionChapterGateBlockedV1 {
  accepted: false;
  state: "blocked";
  code:
    | "video-use-missing"
    | "video-use-artifact-invalid"
  | "video-use-not-accepted"
    | "video-use-review-missing"
    | "video-use-review-invalid"
    | "video-use-identity-mismatch"
    | "video-use-input-drift"
    | "hyperframes-missing"
    | "hyperframes-artifact-invalid"
    | "hyperframes-not-accepted"
    | "hyperframes-identity-mismatch"
    | "hyperframes-input-drift";
  message: string;
}

export type RemotionChapterGateResult = RemotionChapterGateAcceptedV1 | RemotionChapterGateBlockedV1;

const VIDEO_WORKFLOW_STAGES: readonly VideoWorkflowStage[] = [
  "preparing", "aligning", "editing", "previewing", "evaluating", "awaiting-review", "applying", "ready", "blocked",
];
const VIDEO_WORKFLOW_MODES: readonly VideoWorkflowMode[] = ["editable-edl", "flat-shot-mp4"];
const ALPHA_FORMATS: readonly HyperFramesAlphaFormat[] = ["prores-4444-mov", "webm-vp9-alpha", "png-sequence"];
export const SUPPORTED_ALPHA_FORMATS: readonly HyperFramesAlphaFormat[] = ["prores-4444-mov", "webm-vp9-alpha"];
const PLUGIN_IDS: readonly VideoWorkflowPluginId[] = ["remotion", "video-use", "hyperframes", "seedance-prompt"];

function issue(path: string, message: string): VideoWorkflowValidationIssue {
  return { path, message };
}

function result<T>(issues: VideoWorkflowValidationIssue[], value: T): VideoWorkflowValidationResult<T> {
  return issues.length > 0 ? { success: false, issues } : { success: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateIdentity(record: Record<string, unknown>, path: string, issues: VideoWorkflowValidationIssue[]) {
  if (typeof record.projectId !== "string" || record.projectId.length === 0) issues.push(issue(`${path}.projectId`, "必须是非空字符串"));
  if (typeof record.chapterId !== "string" || record.chapterId.length === 0) issues.push(issue(`${path}.chapterId`, "必须是非空字符串"));
  if (!isPositiveInteger(record.revision)) issues.push(issue(`${path}.revision`, "必须是正整数"));
}

function validateShot(value: unknown, index: number, issues: VideoWorkflowValidationIssue[]): value is VideoUseShotInputV1 {
  const path = `$.shots[${index}]`;
  if (!isRecord(value)) {
    issues.push(issue(path, "必须是对象"));
    return false;
  }
  for (const key of ["shotId", "videoPath", "audioPath", "ttsSpokenText"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`${path}.${key}`, "必须是非空字符串"));
  }
  for (const key of ["sourceSha256", "audioSha256", "textSha256"] as const) {
    if (!isSha256(value[key])) issues.push(issue(`${path}.${key}`, "必须是 64 位小写 SHA-256"));
  }
  if (!isFiniteNonNegative(value.durationUs) || value.durationUs <= 0) issues.push(issue(`${path}.durationUs`, "必须是正数微秒"));
  if (value.derivedInput !== undefined) validateDerivedInputEvidence(value.derivedInput, `${path}.derivedInput`, issues);
  return true;
}

function validateDerivedInputEvidence(value: unknown, path: string, issues: VideoWorkflowValidationIssue[]): value is VideoUseDerivedInputEvidenceV1 {
  if (!isRecord(value)) {
    issues.push(issue(path, "derivedInput 必须是对象"));
    return false;
  }
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue(`${path}.schemaVersion`, "不支持的 schemaVersion"));
  if (value.kind !== "padded-video") issues.push(issue(`${path}.kind`, "derivedInput.kind 必须为 padded-video"));
  if (value.derivation !== "ffmpeg-tpad-clone-apad") issues.push(issue(`${path}.derivation`, "derivedInput.derivation 无效"));
  for (const key of ["sourcePath", "derivedPath"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`${path}.${key}`, "必须是非空字符串"));
  }
  for (const key of ["sourceSha256", "derivedSha256"] as const) {
    if (!isSha256(value[key])) issues.push(issue(`${path}.${key}`, "必须是 64 位小写 SHA-256"));
  }
  for (const key of ["sourceDurationUs", "derivedDurationUs"] as const) {
    if (!isFiniteNonNegative(value[key]) || value[key] <= 0) issues.push(issue(`${path}.${key}`, "必须是正数微秒"));
  }
  if (!isPositiveInteger(value.derivedRevision)) issues.push(issue(`${path}.derivedRevision`, "必须是正整数"));
  if (!isFiniteNonNegative(value.createdAt) || value.createdAt <= 0) issues.push(issue(`${path}.createdAt`, "必须是正时间戳"));
  return true;
}

function validateRuntime(value: unknown, issues: VideoWorkflowValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue("$.runtime", "必须是对象"));
    return;
  }
  for (const key of ["profileId", "pythonExecutable", "ffmpegExecutable", "ffprobeExecutable", "markerPath"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`$.runtime.${key}`, "必须是非空字符串"));
  }
  if (!isSha256(value.packageLockSha256)) issues.push(issue("$.runtime.packageLockSha256", "必须是 64 位小写 SHA-256"));
}

export function validateVideoUseChapterRun(value: unknown): VideoWorkflowValidationResult<VideoUseChapterRunV1> {
  const issues: VideoWorkflowValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("$", "必须是对象")] };
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "不支持的 schemaVersion"));
  validateIdentity(value, "$", issues);
  if (!VIDEO_WORKFLOW_MODES.includes(value.mode as VideoWorkflowMode)) issues.push(issue("$.mode", "模式必须是 editable-edl 或 flat-shot-mp4"));
  if (value.derivedInputPolicy !== undefined && !["reject", "pad-video-to-audio"].includes(String(value.derivedInputPolicy))) {
    issues.push(issue("$.derivedInputPolicy", "derivedInputPolicy 无效"));
  }
  if (value.storyboardSourcePolicy !== undefined && !["current-ready", "reuse-existing"].includes(String(value.storyboardSourcePolicy))) {
    issues.push(issue("$.storyboardSourcePolicy", "storyboardSourcePolicy 无效"));
  }
  if (!VIDEO_WORKFLOW_STAGES.includes(value.stage as VideoWorkflowStage)) issues.push(issue("$.stage", "阶段无效"));
  if (value.timeUnit !== VIDEO_WORKFLOW_TIME_UNIT) issues.push(issue("$.timeUnit", "video-use 原始 EDL 必须使用 seconds"));
  if (!Array.isArray(value.shots) || value.shots.length === 0) issues.push(issue("$.shots", "至少需要一个 shot"));
  else value.shots.forEach((shot, index) => validateShot(shot, index, issues));
  for (const key of ["sourceSha256", "audioSha256", "textSha256"] as const) {
    if (!isSha256(value[key])) issues.push(issue(`$.${key}`, "必须是 64 位小写 SHA-256"));
  }
  if (!isRecord(value.featureFlags)) issues.push(issue("$.featureFlags", "必须是对象"));
  else for (const key of ["alignment", "edl", "subtitles", "grade", "preview", "selfEval"] as const) if (value.featureFlags[key] !== true) issues.push(issue(`$.featureFlags.${key}`, "首版必须为 true"));
  validateRuntime(value.runtime, issues);
  if (!isFiniteNonNegative(value.createdAt) || !isFiniteNonNegative(value.updatedAt)) issues.push(issue("$.createdAt/updatedAt", "必须是非负时间戳"));
  if (isFiniteNonNegative(value.createdAt) && isFiniteNonNegative(value.updatedAt) && value.updatedAt < value.createdAt) issues.push(issue("$.updatedAt", "不能早于 createdAt"));
  return result(issues, value as unknown as VideoUseChapterRunV1);
}

function validateMonotonicUs(values: Array<{ startUs: unknown; durationUs: unknown }>, path: string, issues: VideoWorkflowValidationIssue[]) {
  let previousEnd = 0;
  values.forEach((entry, index) => {
    if (!isFiniteNonNegative(entry.startUs) || !isFiniteNonNegative(entry.durationUs) || entry.durationUs <= 0) {
      issues.push(issue(`${path}[${index}]`, "startUs/durationUs 必须为有效正时长"));
      return;
    }
    if (entry.startUs < previousEnd) issues.push(issue(`${path}[${index}].startUs`, "时间必须单调且不可重叠"));
    previousEnd = entry.startUs + entry.durationUs;
  });
}

function validateTimedText(value: unknown, path: string, issues: VideoWorkflowValidationIssue[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(issue(path, "必须是对象"));
    return false;
  }
  for (const key of ["cueId", "shotId", "text"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`${path}.${key}`, "必须是非空字符串"));
  }
  if (!isFiniteNonNegative(value.startUs)) issues.push(issue(`${path}.startUs`, "必须是非负微秒"));
  if (!isFiniteNonNegative(value.durationUs) || value.durationUs <= 0) issues.push(issue(`${path}.durationUs`, "必须是正数微秒"));
  return true;
}

function validateOverlayWindow(value: unknown, path: string, issues: VideoWorkflowValidationIssue[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(issue(path, "必须是对象"));
    return false;
  }
  for (const key of ["slotId", "templateId"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`${path}.${key}`, "必须是非空字符串"));
  }
  if (!isFiniteNonNegative(value.startUs)) issues.push(issue(`${path}.startUs`, "必须是非负微秒"));
  if (!isFiniteNonNegative(value.durationUs) || value.durationUs <= 0) issues.push(issue(`${path}.durationUs`, "必须是正数微秒"));
  if (!isRecord(value.parameters)) issues.push(issue(`${path}.parameters`, "必须是对象"));
  return true;
}

function validateEdl(value: unknown, issues: VideoWorkflowValidationIssue[]): value is VideoUseEdlEntryV1[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("$.edl", "至少需要一个 EDL 条目"));
    return false;
  }
  let previousTimelineEnd = 0;
  value.forEach((entry, index) => {
    const path = `$.edl[${index}]`;
    if (!isRecord(entry)) {
      issues.push(issue(path, "必须是对象"));
      return;
    }
    if (typeof entry.shotId !== "string" || entry.shotId.length === 0) issues.push(issue(`${path}.shotId`, "必须是非空字符串"));
    if (typeof entry.sourcePath !== "string" || entry.sourcePath.length === 0) issues.push(issue(`${path}.sourcePath`, "必须是非空字符串"));
    for (const key of ["sourceInS", "sourceOutS", "timelineStartS", "durationS"] as const) if (!isFiniteNonNegative(entry[key])) issues.push(issue(`${path}.${key}`, "必须是非负 seconds"));
    if (isFiniteNonNegative(entry.sourceInS) && isFiniteNonNegative(entry.sourceOutS) && entry.sourceOutS <= entry.sourceInS) issues.push(issue(`${path}.sourceOutS`, "必须大于 sourceInS"));
    if (isFiniteNonNegative(entry.durationS) && entry.durationS <= 0) issues.push(issue(`${path}.durationS`, "必须为正数"));
    if (isFiniteNonNegative(entry.timelineStartS) && isFiniteNonNegative(entry.durationS)) {
      if (entry.timelineStartS < previousTimelineEnd) issues.push(issue(`${path}.timelineStartS`, "timeline 必须单调"));
      previousTimelineEnd = entry.timelineStartS + entry.durationS;
    }
  });
  return true;
}

function validateAlignment(value: unknown, issues: VideoWorkflowValidationIssue[]): value is VideoUseAlignmentCueV1[] {
  if (!Array.isArray(value)) {
    issues.push(issue("$.alignment", "必须是数组"));
    return false;
  }
  value.forEach((cue, index) => {
    const path = `$.alignment[${index}]`;
    if (!isRecord(cue)) {
      issues.push(issue(path, "必须是对象"));
      return;
    }
    for (const key of ["cueId", "shotId", "text"] as const) if (typeof cue[key] !== "string" || cue[key].length === 0) issues.push(issue(`${path}.${key}`, "必须是非空字符串"));
    if (!isFiniteNonNegative(cue.startUs)) issues.push(issue(`${path}.startUs`, "必须是非负微秒"));
    if (!isFiniteNonNegative(cue.durationUs) || cue.durationUs <= 0) issues.push(issue(`${path}.durationUs`, "必须是正数微秒"));
    if (!isFiniteRatio(cue.confidence)) issues.push(issue(`${path}.confidence`, "必须在 0 到 1 之间"));
    if (!Array.isArray(cue.words)) issues.push(issue(`${path}.words`, "必须是数组"));
    else cue.words.forEach((word, wordIndex) => {
      const wordPath = `${path}.words[${wordIndex}]`;
      if (!isRecord(word)) { issues.push(issue(wordPath, "必须是对象")); return; }
      for (const key of ["id", "text"] as const) if (typeof word[key] !== "string" || word[key].length === 0) issues.push(issue(`${wordPath}.${key}`, "必须是非空字符串"));
      if (!isFiniteNonNegative(word.startUs)) issues.push(issue(`${wordPath}.startUs`, "必须是非负微秒"));
      if (!isFiniteNonNegative(word.durationUs) || word.durationUs <= 0) issues.push(issue(`${wordPath}.durationUs`, "必须是正数微秒"));
      if (!isFiniteRatio(word.confidence)) issues.push(issue(`${wordPath}.confidence`, "必须在 0 到 1 之间"));
    });
    if (Array.isArray(cue.words)) validateMonotonicUs(cue.words.filter(isRecord).map((word) => ({ startUs: word.startUs, durationUs: word.durationUs })), `${path}.words`, issues);
  });
  validateMonotonicUs(value.filter(isRecord).map((cue) => ({ startUs: cue.startUs, durationUs: cue.durationUs })), "$.alignment", issues);
  return true;
}

export function validateVideoUseChapterArtifact(value: unknown): VideoWorkflowValidationResult<VideoUseChapterArtifactV1> {
  const issues: VideoWorkflowValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("$", "必须是对象")] };
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "不支持的 schemaVersion"));
  validateIdentity(value, "$", issues);
  if (!VIDEO_WORKFLOW_MODES.includes(value.mode as VideoWorkflowMode)) issues.push(issue("$.mode", "模式无效"));
  if (value.storyboardSourcePolicy !== undefined && !["current-ready", "reuse-existing"].includes(String(value.storyboardSourcePolicy))) {
    issues.push(issue("$.storyboardSourcePolicy", "storyboardSourcePolicy 无效"));
  }
  if (!["evaluating", "awaiting-review", "applying", "ready", "blocked"].includes(String(value.stage))) issues.push(issue("$.stage", "artifact 阶段无效"));
  if (!["pending", "accepted", "blocked"].includes(String(value.status))) issues.push(issue("$.status", "artifact 状态无效"));
  if (value.timeUnit !== VIDEO_WORKFLOW_TIME_UNIT) issues.push(issue("$.timeUnit", "必须是 seconds"));
  if (value.timelineTimeUnit !== VIDEO_WORKFLOW_TIMELINE_TIME_UNIT) issues.push(issue("$.timelineTimeUnit", "必须是 microseconds"));
  for (const key of ["sourceSha256", "audioSha256", "textSha256"] as const) if (!isSha256(value[key])) issues.push(issue(`$.${key}`, "必须是 64 位小写 SHA-256"));
  validateAlignment(value.alignment, issues);
  validateEdl(value.edl, issues);
  if (!Array.isArray(value.subtitles)) issues.push(issue("$.subtitles", "必须是数组"));
  else {
    value.subtitles.forEach((cue, index) => validateTimedText(cue, `$.subtitles[${index}]`, issues));
    validateMonotonicUs(value.subtitles.filter(isRecord).map((cue) => ({ startUs: cue.startUs, durationUs: cue.durationUs })), "$.subtitles", issues);
    value.subtitles.forEach((cue, index) => {
      if (isRecord(cue) && cue.source !== "alignment") issues.push(issue(`$.subtitles[${index}].source`, "source 必须为 alignment"));
    });
  }
  if (!isRecord(value.grade) || typeof value.grade.filter !== "string" || !isRecord(value.grade.parameters)) issues.push(issue("$.grade", "调色结果结构无效"));
  if (!Array.isArray(value.overlaySlots)) issues.push(issue("$.overlaySlots", "必须是数组"));
  else {
    value.overlaySlots.forEach((slot, index) => {
      const path = `$.overlaySlots[${index}]`;
      if (!isRecord(slot)) issues.push(issue(path, "必须是对象"));
      else {
        if (typeof slot.slotId !== "string" || slot.slotId.length === 0) issues.push(issue(`${path}.slotId`, "必须是非空字符串"));
        if (!isFiniteNonNegative(slot.startUs)) issues.push(issue(`${path}.startUs`, "必须是非负微秒"));
        if (!isFiniteNonNegative(slot.durationUs) || slot.durationUs <= 0) issues.push(issue(`${path}.durationUs`, "必须是正数微秒"));
      }
    });
    validateMonotonicUs(value.overlaySlots.filter(isRecord).map((slot) => ({ startUs: slot.startUs, durationUs: slot.durationUs })), "$.overlaySlots", issues);
  }
  if (!isRecord(value.preview) || typeof value.preview.path !== "string" || !isSha256(value.preview.sha256) || typeof value.preview.subtitlesBurnedIn !== "boolean" || !isFiniteNonNegative(value.preview.durationS)) issues.push(issue("$.preview", "preview 结构无效"));
  if (!isRecord(value.selfEval) || typeof value.selfEval.passed !== "boolean" || !isFiniteRatio(value.selfEval.score) || !Array.isArray(value.selfEval.notes) || !isFiniteNonNegative(value.selfEval.evaluatedAt)) issues.push(issue("$.selfEval", "self-eval 结构无效"));
  if (value.mode === "flat-shot-mp4") {
    if (typeof value.flatShotMp4Path !== "string" || value.flatShotMp4Path.length === 0) {
      issues.push(issue("$.flatShotMp4Path", "flat-shot-mp4 模式必须保留 clean MP4 路径"));
    } else {
      if (!/\.mp4$/i.test(value.flatShotMp4Path)) issues.push(issue("$.flatShotMp4Path", "flat-shot-mp4 必须指向 MP4 文件"));
      if (isRecord(value.preview) && value.flatShotMp4Path === value.preview.path) {
        issues.push(issue("$.flatShotMp4Path", "flat-shot-mp4 不得复用带字幕 preview"));
      }
      if (value.flatShotMp4Sha256 !== undefined && !isSha256(value.flatShotMp4Sha256)) {
        issues.push(issue("$.flatShotMp4Sha256", "flatShotMp4Sha256 必须是 64 位小写 SHA-256"));
      }
    }
  } else if (value.flatShotMp4Sha256 !== undefined && !isSha256(value.flatShotMp4Sha256)) {
    issues.push(issue("$.flatShotMp4Sha256", "flatShotMp4Sha256 必须是 64 位小写 SHA-256"));
  }
  if (!isRecord(value.evidence) || !isSha256(value.evidence.inputSha256) || !isSha256(value.evidence.artifactSha256) || typeof value.evidence.toolVersion !== "string") issues.push(issue("$.evidence", "evidence 结构无效"));
  if (value.derivedInputs !== undefined) {
    if (!Array.isArray(value.derivedInputs)) issues.push(issue("$.derivedInputs", "derivedInputs 必须是数组"));
    else value.derivedInputs.forEach((entry, index) => validateDerivedInputEvidence(entry, `$.derivedInputs[${index}]`, issues));
  }
  if (value.status === "accepted" && value.stage !== "ready") issues.push(issue("$.stage", "accepted artifact 必须处于 ready"));
  if (value.status === "accepted") {
    const review = value.review;
    if (!isRecord(review)) issues.push(issue("$.review", "accepted artifact 必须具备 review sidecar"));
    else {
      validateIdentity(review, "$.review", issues);
      if (!isSha256(review.artifactSha256)) issues.push(issue("$.review.artifactSha256", "必须是 64 位小写 SHA-256"));
      if (typeof review.reviewer !== "string" || review.reviewer.length === 0) issues.push(issue("$.review.reviewer", "必须是非空字符串"));
      if (review.decision !== "accepted") issues.push(issue("$.review.decision", "decision 必须为 accepted"));
      if (!isFiniteNonNegative(review.timestamp) || review.timestamp <= 0) issues.push(issue("$.review.timestamp", "必须是正时间戳"));
      const evidence = isRecord(value.evidence) ? value.evidence : undefined;
      if (isSha256(evidence?.artifactSha256) && review.artifactSha256 !== evidence.artifactSha256) issues.push(issue("$.review.artifactSha256", "必须绑定 evidence.artifactSha256"));
    }
  }
  return result(issues, value as unknown as VideoUseChapterArtifactV1);
}

export function validateHyperFramesOverlayRequest(value: unknown): VideoWorkflowValidationResult<HyperFramesOverlayRequestV1> {
  const issues: VideoWorkflowValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("$", "必须是对象")] };
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "不支持的 schemaVersion"));
  validateIdentity(value, "$", issues);
  if (!isSha256(value.sourceArtifactSha256) || !isSha256(value.inputSha256)) issues.push(issue("$.sourceArtifactSha256/inputSha256", "必须是 SHA-256"));
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) issues.push(issue("$.width/height", "必须是正整数"));
  if (typeof value.fps !== "number" || !Number.isFinite(value.fps) || value.fps <= 0) issues.push(issue("$.fps", "必须是正数"));
  if (!ALPHA_FORMATS.includes(value.alphaFormat as HyperFramesAlphaFormat)) issues.push(issue("$.alphaFormat", "透明格式无效"));
  else if (!SUPPORTED_ALPHA_FORMATS.includes(value.alphaFormat as HyperFramesAlphaFormat)) issues.push(issue("$.alphaFormat", "png-sequence 暂不支持，必须使用 ProRes 4444 MOV 或 WebM VP9 alpha"));
  if (typeof value.outputPath !== "string" || value.outputPath.length === 0) issues.push(issue("$.outputPath", "必须是非空字符串"));
  if (!Array.isArray(value.windows)) issues.push(issue("$.windows", "必须是数组"));
  else {
    value.windows.forEach((window, index) => validateOverlayWindow(window, `$.windows[${index}]`, issues));
    validateMonotonicUs(value.windows.filter(isRecord).map((window) => ({ startUs: window.startUs, durationUs: window.durationUs })), "$.windows", issues);
  }
  return result(issues, value as unknown as HyperFramesOverlayRequestV1);
}

export function validateHyperFramesOverlayArtifact(value: unknown): VideoWorkflowValidationResult<HyperFramesOverlayArtifactV1> {
  const issues: VideoWorkflowValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("$", "必须是对象")] };
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "不支持的 schemaVersion"));
  validateIdentity(value, "$", issues);
  if (!(["accepted", "noop", "blocked"] as const).includes(value.status as HyperFramesArtifactStatus)) issues.push(issue("$.status", "状态无效"));
  if (!isSha256(value.sourceArtifactSha256) || !isSha256(value.inputSha256)) issues.push(issue("$.sourceArtifactSha256/inputSha256", "必须是 SHA-256"));
  if (!ALPHA_FORMATS.includes(value.alphaFormat as HyperFramesAlphaFormat)) issues.push(issue("$.alphaFormat", "透明格式无效"));
  else if (!SUPPORTED_ALPHA_FORMATS.includes(value.alphaFormat as HyperFramesAlphaFormat)) issues.push(issue("$.alphaFormat", "png-sequence 暂不支持，不能进入 accepted/no-op artifact"));
  if (!Array.isArray(value.windows)) issues.push(issue("$.windows", "必须是数组"));
  else {
    value.windows.forEach((window, index) => validateOverlayWindow(window, `$.windows[${index}]`, issues));
    validateMonotonicUs(value.windows.filter(isRecord).map((window) => ({ startUs: window.startUs, durationUs: window.durationUs })), "$.windows", issues);
  }
  if (typeof value.toolVersion !== "string" || value.toolVersion.length === 0) issues.push(issue("$.toolVersion", "必须是非空字符串"));
  if (!isFiniteNonNegative(value.generatedAt)) issues.push(issue("$.generatedAt", "必须是非负时间戳"));
  if (value.status === "accepted" && (typeof value.outputPath !== "string" || !isSha256(value.outputSha256))) issues.push(issue("$.outputPath/outputSha256", "accepted overlay 必须有输出和 SHA-256"));
  return result(issues, value as unknown as HyperFramesOverlayArtifactV1);
}

export function validateVideoWorkflowPluginStatus(value: unknown): VideoWorkflowValidationResult<VideoWorkflowPluginStatusV1> {
  const issues: VideoWorkflowValidationIssue[] = [];
  if (!isRecord(value)) return { success: false, issues: [issue("$", "必须是对象")] };
  if (value.schemaVersion !== VIDEO_WORKFLOW_SCHEMA_VERSION) issues.push(issue("$.schemaVersion", "不支持的 schemaVersion"));
  if (!PLUGIN_IDS.includes(value.pluginId as VideoWorkflowPluginId)) issues.push(issue("$.pluginId", "插件 ID 无效"));
  for (const key of ["displayName", "sourceUrl", "sourceCommit", "license", "appVersion", "pluginVersion"] as const) if (typeof value[key] !== "string" || value[key].length === 0) issues.push(issue(`$.${key}`, "必须是非空字符串"));
  if (!["ready", "needs-runtime", "update-available", "blocked", "error", "deferred"].includes(String(value.runtimeState))) issues.push(issue("$.runtimeState", "运行时状态无效"));
  if (!isRecord(value.dependencies)) issues.push(issue("$.dependencies", "必须是对象"));
  if (!isFiniteNonNegative(value.checkedAt)) issues.push(issue("$.checkedAt", "必须是非负时间戳"));
  if (value.runtimeCode !== undefined && (typeof value.runtimeCode !== "string" || value.runtimeCode.length === 0)) {
    issues.push(issue("$.runtimeCode", "必须是非空字符串"));
  }
  return result(issues, value as unknown as VideoWorkflowPluginStatusV1);
}

export function createTimelineEdlEntries(edl: VideoUseEdlEntryV1[]): Array<VideoUseEdlEntryV1 & {
  sourceInUs: TimelineTimeUs;
  sourceOutUs: TimelineTimeUs;
  timelineStartUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
}> {
  return edl.map((entry) => ({
    ...entry,
    sourceInUs: Math.round(entry.sourceInS * 1_000_000),
    sourceOutUs: Math.round(entry.sourceOutS * 1_000_000),
    timelineStartUs: Math.round(entry.timelineStartS * 1_000_000),
    durationUs: Math.round(entry.durationS * 1_000_000),
  }));
}

export function isSubtitleCueOwnedByOverlay(
  cue: VideoUseSubtitleCueV1,
  slots: readonly VideoUseOverlaySlotV1[],
): boolean {
  return slots.some((slot) => cue.shotId === slot.slotId
    || (cue.startUs < slot.startUs + slot.durationUs
      && cue.startUs + cue.durationUs > slot.startUs));
}

export function isVideoWorkflowStage(value: unknown): value is VideoWorkflowStage {
  return VIDEO_WORKFLOW_STAGES.includes(value as VideoWorkflowStage);
}

export function isVideoWorkflowMode(value: unknown): value is VideoWorkflowMode {
  return VIDEO_WORKFLOW_MODES.includes(value as VideoWorkflowMode);
}
