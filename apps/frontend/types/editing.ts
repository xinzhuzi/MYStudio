export type TimelineTimeUs = number;

export type EditingTrackKind =
  | "video"
  | "image"
  | "overlay"
  | "text"
  | "voice"
  | "bgm"
  | "sfx"
  | "effect";

export type EditingSourceKind =
  | "storyboardImage"
  | "storyboardVideo"
  | "videoCandidate"
  | "audio"
  | "text"
  | "asset";

export type EditingEffectId =
  | "cut"
  | "fade"
  | "crossfade"
  | "flash"
  | "blackout"
  | "panZoom"
  | "shake"
  | "glitch"
  | "chromaticAberration"
  | "blur"
  | "glow"
  | "grain"
  | "speed";

export type EditingEffectCategory =
  | "transition"
  | "motion"
  | "style"
  | "time";

export type EditingPreviewSupport = "full" | "approximate" | "final-only";

export interface EditingSourceEvidence {
  storyboardId?: string;
  trackId?: string;
  candidateId?: string;
  mediaId?: string;
  sourceRunId?: string;
  sourceFingerprint?: string;
  outputVersion?: number;
}

export interface EditingClipSource {
  kind: EditingSourceKind;
  path?: string;
  text?: string;
  evidence: EditingSourceEvidence;
}

export interface EditingTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export interface EditingAudioEnvelopePoint {
  timeUs: TimelineTimeUs;
  gain: number;
}

export interface EditingAudioDuckingSettings {
  reductionDb: number;
  attackUs: TimelineTimeUs;
  releaseUs: TimelineTimeUs;
}

export interface EditingSubtitleMetadata {
  sourceFormat: "generated" | "srt" | "ass";
  warnings?: string[];
}

export interface EditingClip {
  id: string;
  trackId: string;
  name: string;
  source: EditingClipSource;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  trimStartUs: TimelineTimeUs;
  speed: number;
  volume: number;
  muted: boolean;
  transform?: EditingTransform;
  fadeInUs?: TimelineTimeUs;
  fadeOutUs?: TimelineTimeUs;
  envelope?: EditingAudioEnvelopePoint[];
  subtitle?: EditingSubtitleMetadata;
  stale?: boolean;
  staleReason?: string;
}

export interface EditingTrack {
  id: string;
  kind: EditingTrackKind;
  name: string;
  order: number;
  clipIds: string[];
  muted: boolean;
  locked: boolean;
}

export type EditingEffectParams = Record<string, string | number | boolean>;

export interface EditingTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effectId: Extract<
    EditingEffectId,
    "cut" | "fade" | "crossfade" | "flash" | "blackout"
  >;
  durationUs: TimelineTimeUs;
  params: EditingEffectParams;
}

export interface EditingEffect {
  id: string;
  effectId: EditingEffectId;
  targetClipId?: string;
  targetTrackId?: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  params: EditingEffectParams;
  enabled: boolean;
  proposalId?: string;
}

export type EditingProposalStatus =
  | "pending"
  | "accepted"
  | "disabled"
  | "rejected";

export interface EditingProposal {
  id: string;
  effectId: EditingEffectId;
  targetClipId?: string;
  targetTrackId?: string;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  params: EditingEffectParams;
  reason: string;
  confidence: number;
  sourceEvidence: EditingSourceEvidence;
  status: EditingProposalStatus;
}

export interface EditingRenderSettings {
  width: number;
  height: number;
  fps: number;
  codec: "h264";
  subtitleMode: "burn-in" | "none";
  loudnessLufs: number;
  truePeakDbtp: number;
  audioDucking?: EditingAudioDuckingSettings;
}

export type TimelineRenderSettings = Omit<EditingRenderSettings, "audioDucking"> & {
  audioDucking: EditingAudioDuckingSettings;
};

export interface EditingProjectV1 {
  schemaVersion: 1;
  id: string;
  projectId: string;
  episodeId: string;
  name: string;
  revision: number;
  sourceSnapshotHash: string;
  sourceRunId?: string;
  createdBy: "auto" | "manual";
  manuallyEdited: boolean;
  stale: boolean;
  staleReason?: string;
  renderSettings: EditingRenderSettings;
  tracks: EditingTrack[];
  clips: EditingClip[];
  transitions: EditingTransition[];
  effects: EditingEffect[];
  proposals: EditingProposal[];
  createdAt: number;
  updatedAt: number;
}

export interface EditingEffectParameterDefinition {
  name: string;
  kind: "number" | "boolean" | "enum";
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  values?: readonly string[];
}

export interface EditingEffectDefinition {
  id: EditingEffectId;
  category: EditingEffectCategory;
  preview: EditingPreviewSupport;
  finalRenderer: "ffmpeg";
  parameters: readonly EditingEffectParameterDefinition[];
}

export type AutoEditingStage =
  | "preflight"
  | "preparingMedia"
  | "selectingSources"
  | "arrangingClips"
  | "arrangingAudio"
  | "arrangingSubtitles"
  | "generatingProposals"
  | "previewReady"
  | "rendering"
  | "probing"
  | "completed"
  | "failed";

export type AutoEditingDecisionKind =
  | "source"
  | "duration"
  | "transition"
  | "motion"
  | "audio"
  | "subtitle"
  | "proposal";

export type AutoEditingDecisionValue = string | number | boolean | null;

export interface AutoEditingDecision {
  id: string;
  kind: AutoEditingDecisionKind;
  ruleId: string;
  targetId: string;
  input: Record<string, AutoEditingDecisionValue>;
  output: Record<string, AutoEditingDecisionValue>;
  reason: string;
  sourceEvidence: EditingSourceEvidence;
}

export interface AutoEditingWarning {
  code: string;
  message: string;
  targetId?: string;
  recoverable: boolean;
}

export interface AutoEditingPresetV1 {
  version: 1;
  id: "story-driven-v1";
  imageScaleFrom: 1;
  imageScaleTo: 1.06;
  voiceTailPaddingUs: 200_000;
  maxTransitionUs: 350_000;
  maxTransitionRatio: 0.15;
  bgmDuckingDb: -12;
  bgmDuckingAttackUs: 120_000;
  bgmDuckingReleaseUs: 400_000;
}

export interface AutoEditingRequest {
  projectId: string;
  episodeId: string;
  mode: "draft" | "draft-and-render";
  preset: AutoEditingPresetV1;
  forceNewDraft?: boolean;
}

export interface AutoEditingRun {
  id: string;
  projectId: string;
  episodeId: string;
  sourceSnapshotHash: string;
  presetId: AutoEditingPresetV1["id"];
  stage: AutoEditingStage;
  decisions: AutoEditingDecision[];
  warnings: AutoEditingWarning[];
  editingProjectId?: string;
  renderJobId?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AutoEditingResult {
  run: AutoEditingRun;
  project: EditingProjectV1;
  reusedExistingDraft: boolean;
}

export interface TimelineRenderClip {
  id: string;
  trackId: string;
  trackKind: EditingTrackKind;
  source: EditingClipSource;
  startUs: TimelineTimeUs;
  durationUs: TimelineTimeUs;
  trimStartUs: TimelineTimeUs;
  speed: number;
  volume: number;
  muted: boolean;
  transform?: EditingTransform;
  fadeInUs?: TimelineTimeUs;
  fadeOutUs?: TimelineTimeUs;
  envelope?: EditingAudioEnvelopePoint[];
  subtitle?: EditingSubtitleMetadata;
}

export interface TimelineRenderPlan {
  schemaVersion: 1;
  jobId: string;
  projectId: string;
  episodeId: string;
  editingProjectId: string;
  editingRevision: number;
  sourceSnapshotHash: string;
  editingProjectSnapshot: EditingProjectV1;
  renderSettings: TimelineRenderSettings;
  clips: TimelineRenderClip[];
  transitions: EditingTransition[];
  effects: EditingEffect[];
  createdAt: number;
}

export interface TimelineRenderEvidence {
  jobId: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  duration: number;
  width: number;
  height: number;
  streams: string[];
  snapshotHash: string;
  snapshotPath: string;
  renderPlanPath?: string;
  inputManifestPath?: string;
  filterGraphPath?: string;
  logPath?: string;
  ffprobePath?: string;
}

export interface TimelineRenderRecord {
  projectId: string;
  episodeId: string;
  editingProjectId: string;
  editingRevision: number;
  sourceSnapshotHash: string;
  completedAt: number;
  evidence: TimelineRenderEvidence;
}

export type TimelineRenderProgressStage =
  | "validating"
  | "preparing"
  | "rendering"
  | "probing"
  | "completed"
  | "canceled"
  | "failed";

export interface TimelineRenderProgress {
  jobId: string;
  stage: TimelineRenderProgressStage;
  ratio: number;
  message?: string;
}

export type TimelineRenderResult =
  | { success: true; evidence: TimelineRenderEvidence }
  | { success: false; jobId: string; canceled: boolean; error: string };

export type TimelineRenderCancelResult =
  | { success: true; jobId: string; canceled: boolean }
  | { success: false; jobId: string; canceled: false; error: string };

export interface EditingValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type EditingValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: EditingValidationIssue[] };
