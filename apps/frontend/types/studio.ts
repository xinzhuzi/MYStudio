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
  | "entityExtraction"
  | "episodeOutline"
  | "voiceAssign"
  | "scriptFinal";

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

export interface AgentWorkData {
  id: string;
  key: AgentWorkKey;
  episodeId?: string;
  data: string;
  createdAt: number;
  updatedAt: number;
}

export type StoryboardState = "idle" | "queued" | "rendering" | "ready" | "failed";

export interface StoryboardMediaRef {
  kind: "image" | "video" | "audio";
  path: string;
}

export interface StudioMaterial {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  localPath: string;
  sourceName: string;
  size: number;
  importedAt: number;
}

export interface StoryboardItem {
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
  state: StoryboardState;
  reason?: string;
  /** ToonFlow 一致性字段（对齐统一工作流计划 §3.2）。可选：旧数据/精简流程无需提供 */
  emotion?: string;
  orientation?: string;
  spatialRelation?: string;
  associateAssetsNames?: string[];
}

export interface ProductionTrack {
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

export interface VideoCandidate {
  id: string;
  trackId: string;
  provider: VideoProvider;
  filePath?: string;
  state: StoryboardState;
  errorReason?: string;
  createdAt: number;
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
  status: "queued" | "running" | "success" | "failed";
  inputSummary: string;
  outputRef?: string;
  errorReason?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface TrackRenderInput {
  storyboardId: string;
  sourcePath: string;
  sourceKind: "image" | "video";
  duration: number;
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
  characters: { characterId: string; name: string; aliases: string[] }[];
  scenes: { sceneId: string; name: string }[];
  props: { assetId: string; name: string }[];
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
  derivedAssetPlan: { parentAssetId: string; state: string; reason: string }[];
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
