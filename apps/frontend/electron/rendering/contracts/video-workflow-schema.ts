import type { EditingTransition, SubtitleAuthority, TimelineTimeUs } from "@/types/editing";

/**
 * 视频工作流契约 schema——37 个类型/接口与版本·时间单位·模板白名单常量。file-size-reduction P2 拆出,体逐字保留。
 */

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
  /** 生成图绝对路径（可选）：overlay 装饰槽内容感知定位（亮度质心）用。 */
  imagePath?: string;
  /** hy:* registry 模板（可选，每镜至多 1）：AI shot-fx 决策的逐镜 overlay 提示；
   * python 决策层校验存在性与依赖就绪后采用，非法/未就绪回落 mood 路由。 */
  overlayTemplateId?: string;
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
  /** Director-plan boundary intents; the Python decision layer clamps and
   * emits them as EDL transitionToNext records. Absent keeps hard cuts. */
  boundaryIntents?: VideoUseBoundaryIntentV1[];
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

/** Transition decision attached to an EDL boundary (this shot → the next one).
 * Emitted by the video-use decision layer from director-plan boundary intents;
 * consumed by the editing projection into EditingProject.transitions. */
export interface VideoUseTransitionToNextV1 {
  // 08-18-gl-transitions Step C：转场闭集与 EditingTransition 同源（基础5+gl:白名单123）。
  // Python 侧 EDL 校验用同一白名单（adapter.py _TRANSITION_EFFECT_IDS，孪生对拍守护）。
  effectId: EditingTransition["effectId"];
  durationUs: TimelineTimeUs;
  /** Provenance style word from the director plan ⑥ section (水墨晕染/剑痕/…). */
  styleWord?: string;
}

export interface VideoUseEdlEntryV1 {
  shotId: string;
  sourcePath: string;
  sourceInS: number;
  sourceOutS: number;
  timelineStartS: number;
  durationS: number;
  /** Optional; absent on legacy artifacts (hard-cut boundary). */
  transitionToNext?: VideoUseTransitionToNextV1;
}

/** Director-plan boundary intent feeding the video-use decision layer. */
export interface VideoUseBoundaryIntentV1 {
  fromShotId: string;
  toShotId: string;
  effectId: VideoUseTransitionToNextV1["effectId"];
  durationUs: TimelineTimeUs;
  styleWord?: string;
  moodWord?: string;
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
  /** Stable subtitle identity when this overlay owns a subtitle cue. */
  cueId: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  /** Optional non-text HyperFrames decision; absent keeps legacy subtitle slots compatible. */
  templateId?: string;
  parameters?: Record<string, string | number | boolean>;
  moodWord?: string;
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
  /** Explicit subtitle ownership; absent legacy artifacts normalize to unknown and block formal render. */
  subtitleAuthority?: SubtitleAuthority;
}

export type HyperFramesAlphaFormat = "prores-4444-mov" | "webm-vp9-alpha" | "png-sequence";

export interface HyperFramesOverlayWindowV1 {
  slotId: string;
  /** Stable subtitle identity; decorative overlays use a non-cue overlay identity. */
  cueId: string;
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
  /** 渲染时因依赖缺失被降级丢弃的 registry 模板(08-22 可见性;空=无降级) */
  degradedTemplateIds?: string[];
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
  /** 共享工具链可执行文件路径(设置页 FFmpeg 块展示);版本串在 dependencies.ffmpeg/ffprobe */
  ffmpegPath?: string;
  ffprobePath?: string;
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

