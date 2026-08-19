import type {
  TimelineAudioPostProcessEvidence as TimelineAudioPostProcessEvidenceContract,
  TimelineRenderProgress as TimelineRenderProgressContract,
  TimelineRenderProgressStage as TimelineRenderProgressStageContract,
  TimelineRendererEvidence as TimelineRendererEvidenceContract,
  TimelineRenderRequest as TimelineRenderRequestContract,
} from "@rendering/contracts/timeline-renderer";

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
    | "impact-frame"
    | "ink-bleed"
  | "panZoom"
  | "shake"
  | "glitch"
  | "chromaticAberration"
  | "blur"
  | "glow"
  | "grain"
  | "speed"
  | "grade"
  | "ambient"
  // gl:* 转场收录白名单（08-18-gl-transitions Step C 全量 123;权威=composition/gl-transition-registry.ts,孪生对拍守护)——EditingEffectId 为 Extract 源 union,
  // 转场闭集由此派生进 EditingTransition.effectId。
  | "gl:AdvancedMosaic"
  | "gl:BlockDissolve"
  | "gl:BookFlip"
  | "gl:Bounce"
  | "gl:BowTieHorizontal"
  | "gl:BowTieVertical"
  | "gl:BowTieWithParameter"
  | "gl:Box"
  | "gl:ButterflyWaveScrawler"
  | "gl:CircleCrop"
  | "gl:ColourDistance"
  | "gl:CrazyParametricFun"
  | "gl:CrossZoom"
  | "gl:DefocusBlur"
  | "gl:Directional"
  | "gl:DirectionalScaled"
  | "gl:DoomScreenTransition"
  | "gl:Dreamy"
  | "gl:DreamyZoom"
  | "gl:Drop_Zone_Flicker"
  | "gl:EdgeTransition"
  | "gl:FilmBurn"
  | "gl:Fold"
  | "gl:GlitchDisplace"
  | "gl:GlitchMemories"
  | "gl:GridFlip"
  | "gl:HSVfade"
  | "gl:HorizontalClose"
  | "gl:HorizontalOpen"
  | "gl:InvertedPageCurl"
  | "gl:LeftRight"
  | "gl:LinearBlur"
  | "gl:Mosaic"
  | "gl:Overexposure"
  | "gl:PolkaDotsCurtain"
  | "gl:PuzzleRight"
  | "gl:Radial"
  | "gl:Rectangle"
  | "gl:RectangleCrop"
  | "gl:Revolve_Left"
  | "gl:Rolls"
  | "gl:RotateScaleVanish"
  | "gl:SimpleFlip"
  | "gl:SimpleZoom"
  | "gl:SimpleZoomOut"
  | "gl:Slides"
  | "gl:StarWipe"
  | "gl:StaticFade"
  | "gl:StereoViewer"
  | "gl:StripDatamoshGlitch"
  | "gl:Swirl"
  | "gl:TVStatic"
  | "gl:TilesWave"
  | "gl:TopBottom"
  | "gl:VerticalClose"
  | "gl:VerticalOpen"
  | "gl:WaterDrop"
  | "gl:ZoomInCircles"
  | "gl:ZoomLeftWipe"
  | "gl:ZoomRigthWipe"
  | "gl:angular"
  | "gl:burn"
  | "gl:burn0"
  | "gl:cannabisleaf"
  | "gl:chessboard"
  | "gl:circle"
  | "gl:circleopen"
  | "gl:colorphase"
  | "gl:coord-from-in"
  | "gl:crosshatch"
  | "gl:crosswarp"
  | "gl:cube"
  | "gl:directional-easing"
  | "gl:directionalwarp"
  | "gl:directionalwipe"
  | "gl:dissolve"
  | "gl:doorway"
  | "gl:fade"
  | "gl:fadecolor"
  | "gl:fadegrayscale"
  | "gl:flyeye"
  | "gl:fragment"
  | "gl:heart"
  | "gl:hexagonalize"
  | "gl:kaleidoscope"
  | "gl:luminance_melt"
  | "gl:morph"
  | "gl:mosaic_transition"
  | "gl:multiply_blend"
  | "gl:old_tv_lost_signal"
  | "gl:parametric_glitch"
  | "gl:perlin"
  | "gl:pinwheel"
  | "gl:pixelize"
  | "gl:polar_function"
  | "gl:powerKaleido"
  | "gl:randomNoisex"
  | "gl:randomsquares"
  | "gl:ripple"
  | "gl:rotateTransition"
  | "gl:rotate_scale_fade"
  | "gl:scale-in"
  | "gl:splitSlideInHorizontal"
  | "gl:splitSlideInOutHorizontal"
  | "gl:splitSlideInOutVertical"
  | "gl:splitSlideInVertical"
  | "gl:splitSlideOutHorizontal"
  | "gl:splitSlideOutVertical"
  | "gl:squareswire"
  | "gl:squeeze"
  | "gl:static_wipe"
  | "gl:swap"
  | "gl:tangentMotionBlur"
  | "gl:undulatingBurnOut"
  | "gl:wind"
  | "gl:windowblinds"
  | "gl:windowslice"
  | "gl:wipeDown"
  | "gl:wipeLeft"
  | "gl:wipeRight"
  | "gl:wipeUp"
  | "gl:x_axis_translation"
  | "gl:zoomInOut"
    | "gl:IrisWipe";

export type EditingEffectCategory =
  | "transition"
  | "motion"
  | "style"
  | "time";

export type EditingPreviewSupport = "full" | "approximate" | "final-only";

export type SubtitleAuthorityMode =
  | "clean-remotion"
  | "source-embedded"
  | "hyperframes"
  | "unknown";

export type SubtitleCueOwner = "remotion-text" | "hyperframes-overlay" | "source-media";

export interface SubtitleAuthorityEvidence {
  mode: SubtitleAuthorityMode;
  decision: "human" | "imported-manifest" | "legacy-unknown";
  sourceFingerprint: string;
  evidencePaths: string[];
  evidenceSha256?: Record<string, string>;
  reviewer?: "human" | "automated";
  reviewedAt?: number;
  note?: string;
}

export interface SubtitleAuthority {
  mode: SubtitleAuthorityMode;
  evidence?: SubtitleAuthorityEvidence;
}

export interface EditingSourceEvidence {
  storyboardId?: string;
  cueId?: string;
  trackId?: string;
  candidateId?: string;
  mediaId?: string;
  sourceRunId?: string;
  sourceFingerprint?: string;
  outputVersion?: number;
  remotionJobId?: string;
  remotionEvidenceSha256?: string;
  remotionInputHash?: string;
  remotionBundleContentHash?: string;
  subtitleAuthority?: SubtitleAuthority;
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
    | "cut"
    | "fade"
    | "crossfade"
    | "flash"
    | "blackout"
    | "impact-frame"
    | "ink-bleed"
    | "gl:AdvancedMosaic"
    | "gl:BlockDissolve"
    | "gl:BookFlip"
    | "gl:Bounce"
    | "gl:BowTieHorizontal"
    | "gl:BowTieVertical"
    | "gl:BowTieWithParameter"
    | "gl:Box"
    | "gl:ButterflyWaveScrawler"
    | "gl:CircleCrop"
    | "gl:ColourDistance"
    | "gl:CrazyParametricFun"
    | "gl:CrossZoom"
    | "gl:DefocusBlur"
    | "gl:Directional"
    | "gl:DirectionalScaled"
    | "gl:DoomScreenTransition"
    | "gl:Dreamy"
    | "gl:DreamyZoom"
    | "gl:Drop_Zone_Flicker"
    | "gl:EdgeTransition"
    | "gl:FilmBurn"
    | "gl:Fold"
    | "gl:GlitchDisplace"
    | "gl:GlitchMemories"
    | "gl:GridFlip"
    | "gl:HSVfade"
    | "gl:HorizontalClose"
    | "gl:HorizontalOpen"
    | "gl:InvertedPageCurl"
    | "gl:LeftRight"
    | "gl:LinearBlur"
    | "gl:Mosaic"
    | "gl:Overexposure"
    | "gl:PolkaDotsCurtain"
    | "gl:PuzzleRight"
    | "gl:Radial"
    | "gl:Rectangle"
    | "gl:RectangleCrop"
    | "gl:Revolve_Left"
    | "gl:Rolls"
    | "gl:RotateScaleVanish"
    | "gl:SimpleFlip"
    | "gl:SimpleZoom"
    | "gl:SimpleZoomOut"
    | "gl:Slides"
    | "gl:StarWipe"
    | "gl:StaticFade"
    | "gl:StereoViewer"
    | "gl:StripDatamoshGlitch"
    | "gl:Swirl"
    | "gl:TVStatic"
    | "gl:TilesWave"
    | "gl:TopBottom"
    | "gl:VerticalClose"
    | "gl:VerticalOpen"
    | "gl:WaterDrop"
    | "gl:ZoomInCircles"
    | "gl:ZoomLeftWipe"
    | "gl:ZoomRigthWipe"
    | "gl:angular"
    | "gl:burn"
    | "gl:burn0"
    | "gl:cannabisleaf"
    | "gl:chessboard"
    | "gl:circle"
    | "gl:circleopen"
    | "gl:colorphase"
    | "gl:coord-from-in"
    | "gl:crosshatch"
    | "gl:crosswarp"
    | "gl:cube"
    | "gl:directional-easing"
    | "gl:directionalwarp"
    | "gl:directionalwipe"
    | "gl:dissolve"
    | "gl:doorway"
    | "gl:fade"
    | "gl:fadecolor"
    | "gl:fadegrayscale"
    | "gl:flyeye"
    | "gl:fragment"
    | "gl:heart"
    | "gl:hexagonalize"
    | "gl:kaleidoscope"
    | "gl:luminance_melt"
    | "gl:morph"
    | "gl:mosaic_transition"
    | "gl:multiply_blend"
    | "gl:old_tv_lost_signal"
    | "gl:parametric_glitch"
    | "gl:perlin"
    | "gl:pinwheel"
    | "gl:pixelize"
    | "gl:polar_function"
    | "gl:powerKaleido"
    | "gl:randomNoisex"
    | "gl:randomsquares"
    | "gl:ripple"
    | "gl:rotateTransition"
    | "gl:rotate_scale_fade"
    | "gl:scale-in"
    | "gl:splitSlideInHorizontal"
    | "gl:splitSlideInOutHorizontal"
    | "gl:splitSlideInOutVertical"
    | "gl:splitSlideInVertical"
    | "gl:splitSlideOutHorizontal"
    | "gl:splitSlideOutVertical"
    | "gl:squareswire"
    | "gl:squeeze"
    | "gl:static_wipe"
    | "gl:swap"
    | "gl:tangentMotionBlur"
    | "gl:undulatingBurnOut"
    | "gl:wind"
    | "gl:windowblinds"
    | "gl:windowslice"
    | "gl:wipeDown"
    | "gl:wipeLeft"
    | "gl:wipeRight"
    | "gl:wipeUp"
    | "gl:x_axis_translation"
    | "gl:zoomInOut"
    | "gl:IrisWipe"
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
  /**
   * 烧录字幕字体 id（白名单见 lib/studio/remotion/subtitle-fonts.ts，
   * 值保持字符串跨 JSON 持久化边界）。缺省 = "ma-shan-zheng"（毛笔楷书）。
   */
  subtitleFont?: string;
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

export type TimelineRenderRequest = TimelineRenderRequestContract<TimelineRenderPlan>;

export type TimelineRendererEvidence =
  TimelineRendererEvidenceContract<EditingEffectId>;

export type TimelineAudioPostProcessEvidence =
  TimelineAudioPostProcessEvidenceContract;

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
  renderer?: TimelineRendererEvidence;
  audioPostProcess?: TimelineAudioPostProcessEvidence;
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

export type TimelineRenderProgressStage = TimelineRenderProgressStageContract;

export type TimelineRenderProgress = TimelineRenderProgressContract;

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
