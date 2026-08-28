import type { TtsEmotionCapability, TtsSpeakerId } from "./tts";
import type { CharacterIdentityAnchors, CharacterNegativePrompt } from "./script";
import type { RemotionShotAudioBindingV2 } from "./remotion-workspace";
import type { SubtitleAuthority } from "./editing";
import type { ShotFxAddonId, ShotFxMotionId } from "../lib/studio/remotion/shot-fx-decisions";
import type { AtmosphereTemplateId } from "../lib/studio/remotion/atmosphere-templates";

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

export interface ShotContinuityCharacterState {
  characterId: string;
  versionId: string;
  position: string;
  orientation: string;
  actionIn: string;
  actionOut: string;
}

/** A per-shot source fact emitted by the storyboard table, before asset versions are resolved. */
export interface StoryboardVisibleCharacterSemantic {
  name: string;
  position: string;
  orientation: string;
  actionIn: string;
  actionOut: string;
}

export interface StoryboardVisiblePropSemantic {
  name: string;
  position: string;
  state: string;
}

/**
 * Explicit source semantics for image generation. `personFree` distinguishes an
 * intentional empty frame from a storyboard row that omitted its cast.
 */
export interface StoryboardShotSemantics {
  sceneViewpointId: string;
  personFree: boolean;
  visibleCharacters: StoryboardVisibleCharacterSemantic[];
  visibleProps: StoryboardVisiblePropSemantic[];
  actionIn: string;
  actionOut: string;
  /** Shot-to-shot transition intent for the boundary AFTER this shot. The
   * storyboard stage is where shot boundaries are born, so this is the
   * authoritative per-boundary intent; "同场景硬切" is a first-class rhythmic
   * choice, not an absence of one. Style words map to built-in effects in
   * lib/studio/editing/transition-policy.ts (single source). */
  transitionToNext?: {
    styleWord: string;
    moodWord?: string;
  };
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
  styleContractVersion?: string;
  styleContractFingerprint?: string;
  promptAuditVersion?: string;
  sourceSemanticsFingerprint?: string;
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
  reviewer: "human" | "automated" | "vlm";
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

export type StoryboardTtsJobStatus =
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "canceled";

export interface StoryboardTtsJobV1 {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  shotId: string;
  shotRevision: number;
  inputFingerprint: string;
  status: StoryboardTtsJobStatus;
  attempt: number;
  generationId?: string;
  retryRequested?: boolean;
  cancelRequested?: boolean;
  emotionCapability?: TtsEmotionCapability;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoryboardItem extends StudioStaleEvidence, StudioSourceIdentity {
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
  /** 关键帧序列(一镜多图)。undefined=单图时代数据,等价 [mediaRef] 单帧;
   *  写入唯一走 setStoryboardKeyframes(首帧镜像 I1 由其保证) */
  keyframes?: StoryboardKeyframe[];
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
  shouldGenerateImage?: boolean;
  sourceEvidence?: StoryboardSourceEvidence;
  orderedReferenceManifest?: StoryboardOrderedReference[];
  continuityState?: ShotContinuityState;
  visualReview?: VisualReviewResult;
  audioRef?: StoryboardMediaRef;
  shotAudioBindings?: RemotionShotAudioBindingV2[];
  ttsJob?: StoryboardTtsJobV1;
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
  ttsEmotionCapability?: TtsEmotionCapability;
  voiceProfileId?: string;
  voiceReferenceAudioPath?: string;
  voiceMatch?: "fixed" | "ai-selected";
  sound?: string;
  shotSemantics?: StoryboardShotSemantics;
  styleContractVersion?: string;
  /** Explicit subtitle ownership for this visual interval. */
  subtitleAuthority?: SubtitleAuthority;
  /**
   * AI 2D 镜头表现选择结果（装饰层：不进 sourceFingerprint、不触发审批门 stale）。
   * 一键成片前由 selectShotFxMotions 刷新；App 章节渲染与 CLI 共享读取。
   * addons 为 AI 显式配置的特效插件（空数组=显式无特效）；缺省=运镜配方默认特效。
   * transitionOut=本镜进入下一镜的转场语义桶（08-19 转场决策层；"cut"=AI 显式
   * 硬切，抑制低优先级兜底）；sfx=本镜字幕句音效类别（08-19 字幕音效）。
   * 两者均闭集校验，非法值按缺省处理。
   * atmosphere=本镜氛围/遮挡层模板（08-19 multilayer Child2；闭集 union，
   * AI 逐镜 0~2 条，投影端实例化进 layerStack）。
   */
  shotFx?: {
    motion: ShotFxMotionId;
    addons?: ShotFxAddonId[];
    grade?: { lutId: string; blend: number };
    atmosphere?: AtmosphereTemplateId[];
    transitionOut?: string;
    sfx?: string;
    /** hy:* registry 模板(每镜至多 1,装饰层;python overlay 槽的逐镜 AI 提示) */
    registryOverlay?: string;
    source: "ai" | "heuristic";
  };
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

/**
 * 按场分段产物（Remotion chapter-scene job 成功后登记）。独立于
 * videoCandidates/productionTracks（那是 ffmpeg 时代的 track 域）：场级分段
 * 是章级 composition 的 frameRange 范围渲染，产物挂章节，不参与轨道选择。
 */
export interface SceneSegmentRecord extends StudioSourceIdentity {
  id: string;
  chapterId: string;
  sceneNo: number;
  sceneName: string;
  storyboardIds: string[];
  /** 闭区间帧范围（与整章 composition 同一布局轴）。 */
  frameRange: [number, number];
  /** 项目 Remotion workspace 相对路径。 */
  outputRelativePath: string;
  /** 绝对路径（渲染域展示/打开）。 */
  outputAbsolutePath: string;
  /** chapter-scene 队列 job ID（chapter-scene:<sha256>）。 */
  jobId: string;
  /** 渲染身份哈希（与 job inputHash 同源，用于失效判断）。 */
  inputHash: string;
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
  /**
   * 旁白音色家族名（音色库资产命名前缀，如「木成」）。缺省=木成。
   * 换家族后下次一键成片自动把旁白重绑到新家族（偏离即视为过期）；
   * 按项目持久化，不同项目可用不同旁白。
   */
  narratorVoiceFamily?: string;
  /**
   * 烧录字幕字体 id（白名单见 lib/studio/remotion/subtitle-fonts.ts）。
   * 缺省 = "ma-shan-zheng"（毛笔楷书）。按项目持久化；一键成片/分镜计划
   * 创建时注入 renderSettings.subtitleFont，存量 editing 工程缺字段时
   * 渲染端同样回落默认字体。
   */
  subtitleFont?: string;
  /**
   * 章节统一色调（08-19 导演定调）：{lutId, blend} 钉死全章 grade，跳过 AI
   * 逐镜选卡；删除字段=回到 AI 自动。lutId 闭集 cn-* 32 张（设置页下拉）。
   * 按项目持久化；一键成片与章节投影创建时注入 renderSettings.chapterGrade。
   */
  chapterGrade?: { lutId: string; blend: number };
  /**
   * 氛围层模式（08-19 multilayer Child2）："ai"=AI 逐镜选层（缺省）；
   * "off"=关闭全章氛围层（人工覆盖最小面，同章节色调入口形态）。
   * 按项目持久化；一键成片/章节投影创建时注入 renderSettings.atmosphereMode。
   */
  atmosphereMode?: "ai" | "off";
  /**
   * 字幕驱动音效（08-19 音效随字幕）：按字幕句语义分类派生 sfx 音轨。
   * 默认 false（克制）；与已停用的转场音效互不相干。按项目持久化，
   * 一键成片/章节投影创建时注入 renderSettings.subtitleSfxEnabled。
   */
  subtitleSfxEnabled?: boolean;
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
  /** 分镜目标的当前内容指纹:用于跳过「同 id 但属于被替换上一代分镜」的旧工作流 */
  storyboardSourceFingerprint?: string;
  /** 分镜台词(成片模板选型的对话信号;仅分镜目标消费) */
  storyboardLines?: string;
  /** 分镜关键帧序列(M1d):>1 帧时建流克隆 N 对帧节点(帧间链);缺省单帧行为不变 */
  storyboardKeyframes?: StoryboardKeyframe[];
  /** 画面可见角色名(shotSemantics.visibleCharacters,M3b/R18):建流时构图模板
   *  按人数自适应改写「只有角色A与B」双人约束;缺省不改写(fail-safe) */
  storyboardVisibleCharacters?: string[];
  /** 当前分镜行的关联资产清单:无指纹工作流的代际校验依据(次优择优内容
   *  对齐——分镜表换代后同 id 镜内容已换,跨代旧流的参考资产不在当前清单) */
  associateAssetsNames?: string[];
  /** 建流时自动挂载的资产参考图(场景在前、角色在后;连续性 order 由建流方重排) */
  assetReferences?: Array<{
    imageUrl: string;
    title: string;
    assetType: ImageWorkflowAssetTargetType;
    assetId?: string;
  }>;
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
  /** 关键帧序列(M1d):本节点对应分镜 keyframes 的哪一帧;单帧镜/资产流缺省 */
  frameId?: string;
  /** 帧时刻描述(规划器产物):建流时拼进本帧 prompt 的帧差异段 */
  frameMoment?: string;
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
  /** 创建时绑定目标的分镜内容指纹(分镜目标);不匹配=属于被替换的上一代分镜,复用判定会跳过 */
  targetSourceFingerprint?: string;
  /** 分镜帧生图装配溯源(建流时命中了哪些手册资产;UI「风格依据」展示源) */
  assemblyTrace?: {
    manualId?: string;
    templateId?: string;
    templateTitle?: string;
    factions?: string[];
    factionTracks?: string[];
    negativeApplied?: boolean;
    styleTokenCount?: number;
    assetReferenceTitles?: string[];
  };
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

export interface EntityExtractionResult extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  characters: {
    characterId: string;
    name: string;
    aliases: string[];
    note?: string;
    /**
     * 角色重要度（配音分层分配用）：protagonist 优先挑最佳片段；
     * npc 允许复用配角音色。缺省按 supporting 处理。
     */
    importance?: "protagonist" | "supporting" | "npc";
  }[];
  scenes: { sceneId: string; name: string; note?: string }[];
  props: { assetId: string; name: string; note?: string }[];
}

export interface ScriptPlan extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  /**
   * 预划剧本指纹锚(08-27 二期 R1):导演规划落库时对「该章剧本正文」盖的戳
   * (scriptPlanSourceFingerprint,不含 manual/user 指令)。剧本再编辑后与当前
   * 值不一致 → 面板提示「预划已过期」。存量 plan 无此字段 = 静默不比对。
   */
  scriptFingerprint?: string;
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

export interface EpisodeOutline extends StudioSourceIdentity {
  id: string;
  episodeId: string;
  beats: { sceneIndex: number; location: string; beat: string; durationSec: number }[];
}
