import type { AtmosphereTemplateId } from "../lib/studio/remotion/atmosphere-templates";
import type { StudioSourceIdentity, StudioStaleEvidence, StoryboardState, StoryboardMediaRef, StoryboardOrderedReference, StoryboardSourceEvidence, StoryboardKeyframe } from "./studio";
import type { ShotFxAddonId, ShotFxMotionId } from "../lib/studio/remotion/shot-fx-decisions";
import type { SubtitleAuthority } from "./editing";
import type { RemotionShotAudioBindingV2 } from "./remotion-workspace";
import type { TtsEmotionCapability, TtsSpeakerId } from "./tts";

/**
 * studio 分镜与连续性类型——镜头连续性/可见实体语义/资产版本。types/studio 按域分组拆出,体逐字保留。
 */
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

