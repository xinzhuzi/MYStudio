import type { TtsSpeakerId } from "./tts";
import type { CharacterIdentityAnchors, CharacterNegativePrompt } from "./script";

export type CharacterReferenceViewType = "front" | "side" | "back" | "three-quarter";

export type AgentWorkKey =
  | "eventAnalysis"
  | "storySkeleton"
  | "adaptationStrategy"
  | "scriptDraft"
  | "productionPlan"
  | "directorPlan"
  | "deriveAssets"
  | "generateAssets"
  | "storyboardTable"
  | "storyboardPanel"
  | "storyboardImage"
  | "supervisionReport"
  | "storySkeletonReview"
  | "adaptationStrategyReview"
  | "scriptDraftReview"
  | "entityExtraction"
  | "episodeOutline"
  | "voiceAssign";

export interface NovelEventAnalysis {
  chapterLabel: string;
  characters: string[];
  coreEvent: string;
  mainlineRelation: string;
  informationDensity: string;
  estimatedDurationSec: number;
  emotionTags: string[];
  rawLine: string;
}

export interface NovelChapter {
  id: string;
  index: number;
  volume?: string;
  title: string;
  sourceText: string;
  eventSummary?: string;
  eventState?: string;
  eventTaskState?: "idle" | "running" | "success" | "failed";
  eventAnalysis?: NovelEventAnalysis;
  eventRawOutput?: string;
  eventErrorReason?: string;
  sourceName?: string;
  importedAt: number;
  updatedAt?: number;
}

export interface ProjectEventGraphRecord {
  id: string;
  projectId: string;
  episodeId: string;
  chapterIndex: number;
  chapterTitle: string;
  entities: string[];
  coreEvent: string;
  mainlineRelation: string;
  informationDensity: string;
  estimatedDurationSec: number;
  emotionTags: string[];
  timelineOrder: number;
  retrievalText: string;
  source: "novelEventAnalysis";
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryRecord {
  id: string;
  projectId: string;
  episodeId?: string;
  kind: "event" | "run" | "summary";
  title: string;
  content: string;
  entities: string[];
  timelineOrder?: number;
  sourceRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryQuery {
  projectId: string;
  episodeId?: string;
  chapterIndex?: number;
  entities?: string[];
  purpose?: "script" | "production" | string;
  includePriorEpisodes?: boolean;
  limit?: number;
}

export interface ProjectMemoryContext {
  records: ProjectMemoryRecord[];
  markdown: string;
}

export interface AgentWorkData {
  id: string;
  key: AgentWorkKey;
  episodeId?: string;
  data: string;
  createdAt: number;
  updatedAt: number;
}

export type StoryboardState = "idle" | "queued" | "rendering" | "ready" | "failed";
export type StudioRunStatus = "queued" | "running" | "success" | "failed" | "canceled" | "stale";

export interface StudioStaleEvidence {
  stale?: boolean;
  staleReason?: string;
  staleSince?: number;
  sourceRunId?: string;
  sourceFingerprint?: string;
  outputVersion?: number;
}

export interface StoryboardMediaRef {
  kind: "image" | "video" | "audio";
  path: string;
  contentSha256?: string;
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
}

export interface StoryboardSourceEvidence {
  source: string;
  sourceProjectId?: string | number;
  sourceEpisodeId?: string | number;
  sourceStoryboardId?: string | number;
  sourcePath?: string;
  sourceTable?: string;
  promptHash?: string;
  note?: string;
}

export interface StoryboardOrderedReference {
  order: number;
  assetId: string;
  assetName?: string;
  assetKind?: ImageWorkflowAssetTargetType | "character" | "scene" | "prop";
  imageId?: string | number;
  imagePath?: string;
  referenceImagePaths?: string[];
  referenceImageSha256?: string[];
  referenceViewTypes?: CharacterReferenceViewType[];
  source?: string;
  missing?: boolean;
  versionId?: string;
  referenceRole?: "canonical" | "scene-viewpoint" | "secondary-scene" | "prop-state" | "previous-approved-frame";
  identityAnchors?: CharacterIdentityAnchors;
  negativePrompt?: CharacterNegativePrompt;
  wardrobeVersion?: string;
  sceneViewpointId?: string;
  contentFingerprint?: string;
  approvalFingerprint?: string;
  approved?: boolean;
}

export interface ContinuityAssetApproval {
  status: "pending" | "approved" | "rejected";
  reviewer: "human" | "automated";
  reviewedAt?: number;
  reason?: string;
  evidencePaths: string[];
  contentFingerprint: string;
}

export type HumanContinuityAssetApprovalInput = Omit<
  ContinuityAssetApproval,
  "reviewer" | "contentFingerprint"
> & { reviewedAt?: number };

export interface ContinuityAssetVersion {
  assetId: string;
  versionId: string;
  assetKind: "character" | "scene" | "prop";
  label: string;
  referenceImagePaths: string[];
  referenceImageSha256?: string[];
  reviewEvidencePaths?: string[];
  reviewEvidenceSha256?: string[];
  reviewEvidenceVerifiedAt?: number;
  referenceViewTypes?: CharacterReferenceViewType[];
  identityAnchors?: CharacterIdentityAnchors;
  negativePrompt?: CharacterNegativePrompt;
  wardrobeVersion?: string;
  sceneViewpointId?: string;
  spatialLayout?: string;
  lightingDesign?: string;
  colorPalette?: string;
  validFromStoryboardIndex?: number;
  validToStoryboardIndex?: number;
  missingFields?: string[];
  structurallyComplete: boolean;
  contentFingerprint: string;
  approval?: ContinuityAssetApproval;
  approvalFingerprint?: string;
  approved: boolean;
  source: string;
}

export interface ShotContinuityCharacterState {
  characterId: string;
  versionId: string;
  position: string;
  orientation: string;
  actionIn: string;
  actionOut: string;
}

export interface ShotContinuityState {
  groupId: string;
  previousStoryboardId?: string;
  sceneVersionId: string;
  sceneViewpointId: string;
  lighting: string;
  palette: string;
  actionIn: string;
  actionOut: string;
  characters: ShotContinuityCharacterState[];
  inputFingerprint: string;
}

export interface VisualReviewResult {
  status: "pending" | "approved" | "rejected";
  reasons: string[];
  characterChecks: { characterId: string; passed: boolean; reason?: string }[];
  sceneChecks: { sceneVersionId: string; passed: boolean; reason?: string }[];
  propChecks: { assetId: string; versionId?: string; passed: boolean; reason?: string }[];
  transitionChecks: { previousStoryboardId?: string; passed: boolean; reason?: string }[];
  textWatermarkCheck: { passed: boolean; reason?: string };
  reviewer: "human" | "automated";
  reviewedAt?: number;
  evidencePaths: string[];
  inputFingerprint: string;
}

export type HumanVisualReviewInput = Omit<
  VisualReviewResult,
  "reviewer" | "inputFingerprint"
> & { reviewedAt?: number };

export interface StudioMaterial {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  localPath: string;
  sourceName: string;
  size: number;
  importedAt: number;
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
}

export interface StoryboardItem extends StudioStaleEvidence {
  id: string;
  episodeId: string;
  index: number;
  trackKey: string;
  trackId: string;
  duration: number;
  prompt: string;
  videoDesc: string;
  assetIds: string[];
  mediaRef?: StoryboardMediaRef;
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
  shouldGenerateImage?: boolean;
  sourceEvidence?: StoryboardSourceEvidence;
  orderedReferenceManifest?: StoryboardOrderedReference[];
  continuityState?: ShotContinuityState;
  visualReview?: VisualReviewResult;
  audioRef?: StoryboardMediaRef;
  state: StoryboardState;
  reason?: string;
  /** ToonFlow 一致性字段（对齐统一工作流计划 §3.2）。可选：旧数据/精简流程无需提供 */
  emotion?: string;
  orientation?: string;
  spatialRelation?: string;
  associateAssetsNames?: string[];
  lines?: string;
  speaker?: string;
  speakerId?: TtsSpeakerId;
  line?: string;
  ttsSpokenText?: string;
  durationTarget?: number;
  voiceStyle?: string;
  requiresFixedVoice?: true;
  ttsGenerationId?: string;
  ttsBackend?: string;
  ttsMocked?: boolean;
  ttsWarning?: string;
  voiceProfileId?: string;
  voiceReferenceAudioPath?: string;
  voiceMatch?: "fixed" | "ai-selected";
  sound?: string;
}

export interface ProductionTrack extends StudioStaleEvidence {
  id: string;
  episodeId: string;
  trackKey: string;
  storyboardIds: string[];
  prompt: string;
  duration: number;
  candidateVideoIds: string[];
  selectedVideoId?: string;
  state: StoryboardState;
  reason?: string;
}

export type VideoProvider = "ffmpeg-local" | "model-placeholder";

export interface VideoCandidate extends StudioStaleEvidence {
  id: string;
  trackId: string;
  provider: VideoProvider;
  filePath?: string;
  state: StoryboardState;
  errorReason?: string;
  createdAt: number;
}

export type MediaGenerationTaskKind =
  | "storyboardImage"
  | "derivedAssetImage"
  | "ttsAudio"
  | "modelVideo"
  | "ffmpegTrack"
  | "finalExport";

export type MediaGenerationTaskStatus = "queued" | "running" | "success" | "failed" | "canceled";

export interface MediaGenerationTask {
  id: string;
  kind: MediaGenerationTaskKind;
  status: MediaGenerationTaskStatus;
  targetId: string;
  episodeId?: string;
  provider?: string;
  runId?: string;
  checkpointRef?: string;
  inputFingerprint?: string;
  outputRef?: string;
  outputRefs?: string[];
  errorReason?: string;
  retryOf?: string;
  retryCount?: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export type ModelType = "text" | "image" | "video" | "tts" | "vision";

export interface ModelCapabilities {
  imageReference?: number;
  videoReference?: number;
  audioReference?: number;
  durations?: number[];
  resolutions?: string[];
  modes?: string[];
  [key: string]: unknown;
}

export interface ModelDefinition {
  id: string;
  name: string;
  type: ModelType;
  capabilities: ModelCapabilities;
  defaultParams: Record<string, unknown>;
}

export interface VendorConfig {
  id: string;
  name: string;
  enabled: boolean;
  relayBaseUrl?: string;
  inputValues: Record<string, string>;
  models: ModelDefinition[];
}

export interface ModelBinding {
  key:
    | "scriptAgent"
    | "storySkeletonAgent"
    | "adaptationStrategyAgent"
    | "storyboardImage"
    | "videoTrack"
    | "tts"
    | "universalAi";
  modelId: string;
}

export interface SkillContextPackage {
  title: string;
  taskKey: AgentWorkKey;
  markdown: string;
  modelExecution: "disabled" | "enabled";
  createdAt: number;
}

export type StudioManualKind = "visual" | "director" | "production";

export interface StudioManualPreset {
  id: string;
  kind: StudioManualKind;
  name: string;
  modules: Record<string, string>;
  images: string[];
  builtin: boolean;
  source: "bundled" | "toonflow-runtime" | "stored-copy";
  completenessScore: number;
  moduleCount: number;
  imageCount: number;
  basePresetId?: string;
}

export interface AgentSkillPreset {
  id: string;
  kind: "script" | "production" | "supervision";
  name: string;
  content: string;
  source: "bundled" | "toonflow-runtime";
  updatedAt?: number;
}

export interface StudioWorkflowConfig {
  visualManualId?: string;
  directorManualId?: string;
  episodeCount?: number;
  episodeDurationMin?: number;
  chapterRange?: string;
  platformSpec?: string;
  stylePositioning?: string;
  paywallPolicy?: string;
  autoAnalyzeEventsOnImport?: boolean;
  /** 当前所处的工作流阶段（tab value），随项目保存，下次进入自动恢复 */
  workflowStage?: string;
  projectType?: string;
  novelGenre?: string;
  novelSynopsis?: string;
}

export interface StudioAgentRun {
  id: string;
  key: AgentWorkKey;
  phase: string;
  status: StudioRunStatus;
  inputSummary: string;
  inputFingerprint?: string;
  outputRef?: string;
  outputRefs?: string[];
  errorReason?: string;
  retryOf?: string;
  retryCount?: number;
  checkpointRef?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface TrackRenderInput {
  storyboardId: string;
  sourcePath: string;
  sourceKind: "image" | "video";
  duration: number;
  audioPath?: string;
}

export interface TrackRenderPlan {
  kind: "track-candidate";
  trackId: string;
  duration: number;
  inputs: TrackRenderInput[];
  subtitleText?: string;
  ffmpegProfile: "ken-burns-h264-aac";
}

export interface EpisodeMergePlan {
  kind: "episode-merge";
  inputs: string[];
  ffmpegProfile: "concat-h264-aac";
}

export type ImageWorkflowTargetKind = "free" | "material" | "storyboard" | "asset";
export type ImageWorkflowAssetTargetType = "character" | "scene" | "prop";

export interface ImageWorkflowTarget {
  kind: ImageWorkflowTargetKind;
  id?: string;
  assetType?: ImageWorkflowAssetTargetType;
  parentId?: string;
}

export interface ImageWorkflowOpenContext {
  target: ImageWorkflowTarget;
  title: string;
  prompt?: string;
  sourceImagePath?: string;
  resultImagePath?: string;
  imageWorkflowId?: string;
  sourceStage?: string;
  sourceStageLabel?: string;
  sourceLabel?: string;
}

export interface AssetImageWorkflowContext extends ImageWorkflowOpenContext {
  target: ImageWorkflowTarget & { kind: "asset"; assetType: ImageWorkflowAssetTargetType };
}

export type ImageWorkflowNodeType = "reference" | "prompt" | "generated";
export type ImageWorkflowGenerationStatus = "idle" | "queued" | "generating" | "ready" | "failed";

export interface ImageWorkflowNodePosition {
  x: number;
  y: number;
}

interface ImageWorkflowNodeBase {
  id: string;
  type: ImageWorkflowNodeType;
  title: string;
  position: ImageWorkflowNodePosition;
  createdAt: number;
  updatedAt: number;
}

export interface ImageWorkflowReferenceNode extends ImageWorkflowNodeBase {
  type: "reference";
  imageUrl: string;
  source?: ImageWorkflowTarget;
  notes?: string;
  continuityOrder?: number;
  continuityVersionId?: string;
  referenceRole?: StoryboardOrderedReference["referenceRole"];
  identityAnchors?: StoryboardOrderedReference["identityAnchors"];
  negativePrompt?: StoryboardOrderedReference["negativePrompt"];
  wardrobeVersion?: string;
  characterViewType?: CharacterReferenceViewType;
  sceneViewpointId?: string;
}

export interface ImageWorkflowGeneratedNode extends ImageWorkflowNodeBase {
  type: "generated";
  prompt: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio: string;
  quality: "draft" | "standard" | "hd";
  resolution?: string;
  resultUrl?: string;
  resultMediaId?: string;
  status: ImageWorkflowGenerationStatus;
  errorReason?: string;
  generatedAt?: number;
}

export interface ImageWorkflowPromptNode extends ImageWorkflowNodeBase {
  type: "prompt";
  prompt: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio: string;
  quality: "draft" | "standard" | "hd";
  resolution?: string;
  targetNodeId?: string;
}

export type ImageWorkflowNode = ImageWorkflowReferenceNode | ImageWorkflowPromptNode | ImageWorkflowGeneratedNode;

export interface ImageWorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ImageWorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ImageWorkflowGraph {
  id: string;
  name: string;
  target: ImageWorkflowTarget;
  nodes: ImageWorkflowNode[];
  edges: ImageWorkflowEdge[];
  viewport?: ImageWorkflowViewport;
  createdAt: number;
  updatedAt: number;
}

/** ===== 编剧深度实体（对齐统一工作流计划 M1–M7 / 数据模型规范 §3.12）===== */

export interface StorySkeleton {
  id: string;
  projectId: string;
  coreHook: string;
  protagonistArc: string;
  threeActs: { setup: string; confrontation: string; resolution: string };
  episodePlan: { episodeIndex: number; title: string; summary: string }[];
  payWalls: number[];
}

export interface EntityExtractionResult {
  id: string;
  episodeId: string;
  characters: { characterId: string; name: string; aliases: string[]; note?: string }[];
  scenes: { sceneId: string; name: string; note?: string }[];
  props: { assetId: string; name: string; note?: string }[];
}

export interface ScriptPlan {
  id: string;
  episodeId: string;
  theme: string;
  visualStyle: string;
  narrativeRhythm: string;
  sceneIntents: { sceneId: string; emotion: string; shotIntent: string; spatial: string }[];
  soundDirection: string;
  transitions: string;
  derivedAssetPlan: {
    parentAssetId: string;
    state: string;
    reason: string;
    toonflowAssetsId?: number;
    toonflowDerivedAssetId?: number;
    imageWorkflowId?: string;
  }[];
}

export interface DerivedAsset {
  id: string;
  parentAssetId: string;
  state: string;
  desc: string;
  imageRef: string | null;
}

export interface SeriesBible {
  id: string;
  projectId: string;
  characterLocks: { characterId: string; appearance: string; voiceId: string | null }[];
  sceneLocks: string[];
  visualManualId: string;
  directorManualId: string;
  aspectRatio: string;
  stylePositioning: string;
}

export interface EpisodeOutline {
  id: string;
  episodeId: string;
  beats: { sceneIndex: number; location: string; beat: string; durationSec: number }[];
}
