import type { CharacterIdentityAnchors, CharacterNegativePrompt } from "./script";
import { ImageWorkflowAssetTargetType } from "./studio-production-types";


export type CharacterReferenceViewType = "front" | "side" | "back" | "three-quarter";

/** Stable source identity shared by chapter-derived workflow artifacts. */
export interface StudioSourceIdentity {
  sourceId?: string;
  revision?: number;
}

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

export interface NovelEventAnalysis extends StudioSourceIdentity {
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
  sourceId?: string;
  revision?: number;
  index: number;
  volume?: string;
  title: string;
  /** 章节正文。窗口化后非激活章为轻索引项（无 sourceText，切换章节时装载） */
  sourceText?: string;
  eventSummary?: string;
  eventState?: string;
  eventTaskState?: "idle" | "running" | "success" | "failed";
  eventAnalysis?: NovelEventAnalysis;
  eventRawOutput?: string;
  eventErrorReason?: string;
  /** 事件分析提取的人物名未在原著圣经人物表登记的确定性校验警告（不阻断 success）。 */
  eventNameWarnings?: string[];
  sourceName?: string;
  importedAt: number;
  updatedAt?: number;
}

export interface ProjectEventGraphRecord extends StudioSourceIdentity {
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

export interface AgentWorkData extends StudioSourceIdentity {
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

/**
 * 分镜关键帧：长镜(8~15s)一镜 2~4 帧中的一帧。
 * 不变式(校验收敛于 lib/studio/keyframes.ts 与 setStoryboardKeyframes):
 * I1 keyframes[0].mediaRef ≡ StoryboardItem.mediaRef(首帧镜像,双写同源);
 * I2 帧数 1..4,inUs 严格递增且首帧为 0;
 * I3 frameId 镜内唯一(约定 `${storyboardId}-kf-${n}`);
 * I4 帧媒体 path 走受管虚拟协议(禁 data:/blob:/绝对路径)。
 */
export interface StoryboardKeyframe {
  frameId: string;
  mediaRef: StoryboardMediaRef;
  /** 帧入点,相对本镜起点(微秒 µs,与 durationUs 同单位)。首帧恒 0;帧间严格递增;末帧须小于镜时长 */
  inUs: number;
  /** 来源:旧镜回接(携旧镜号,可沿旧审结论)/新生成;缺省视为生成 */
  origin?: { kind: "legacy-shot"; legacyIndex: number } | { kind: "generated" };
  /** 帧时刻描述(帧规划器规则生成,如"开场站位:…"/"收尾态:…");供生图提示词组装帧差异段 */
  momentDescription?: string;
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
  referenceRole?: "canonical" | "scene-viewpoint" | "secondary-scene" | "prop-state" | "previous-approved-frame" | "style-reference";
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
  reviewer: "human" | "automated" | "vlm";
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



export type { HumanVisualReviewInput, ShotContinuityCharacterState, ShotContinuityState, StoryboardItem, StoryboardShotSemantics, StoryboardTtsJobStatus, StoryboardTtsJobV1, StoryboardVisibleCharacterSemantic, StoryboardVisiblePropSemantic, StudioMaterial, VisualReviewResult } from "./studio-storyboard-types";
export type { AgentSkillPreset, AssetImageWorkflowContext, DerivedAsset, EntityExtractionResult, EpisodeMergePlan, EpisodeOutline, ImageWorkflowAssetTargetType, ImageWorkflowDerivationSource, ImageWorkflowEdge, ImageWorkflowGeneratedNode, ImageWorkflowGenerationStatus, ImageWorkflowGraph, ImageWorkflowNode, ImageWorkflowNodePosition, ImageWorkflowNodeType, ImageWorkflowOpenContext, ImageWorkflowPromptNode, ImageWorkflowReferenceNode, ImageWorkflowTarget, ImageWorkflowTargetKind, ImageWorkflowViewport, MediaGenerationTask, MediaGenerationTaskKind, MediaGenerationTaskStatus, ModelBinding, ModelCapabilities, ModelDefinition, ModelType, ProductionTrack, SceneSegmentRecord, ScriptPlan, SeriesBible, SkillContextPackage, StorySkeleton, StudioAgentRun, StudioManualKind, StudioManualPreset, StudioWorkflowConfig, TrackRenderInput, TrackRenderPlan, VendorConfig, VideoCandidate, VideoProvider } from "./studio-production-types";
