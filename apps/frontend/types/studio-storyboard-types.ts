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
  /** 景别(如 远景/全景/中景/近景/特写)。来源=分镜表「景别」列,非出镜语义 JSON;
   * H3 单镜视频组装器与生图【构图】段共同消费(09-14 上游产线 H3 对齐)。 */
  shotSize?: string;
  /** 运镜(中文原词,如 推/拉/摇/跟/环绕)。来源=分镜表「运镜」列;
   * H3 组装器经 mapH3CameraMove 映射到官方运镜词表。 */
  cameraMove?: string;
}

/** §一①世界位置锚(0928 跨镜连续性规范 §七P2):逐人物「地标+相对关系」的
 *  显式记载,补世界位置只随场景资产走、人物侧无记载的缺口(§二双写规则的世界侧写)。 */
export interface ShotContinuityWorldAnchor {
  characterId: string;
  /** 场景地标名(视觉锚点,如 紫檀书案/西窗/门/楼梯)。 */
  landmark: string;
  /** 人物相对该地标的关系句(如 立于紫檀书案南侧,背朝西窗)。 */
  relation: string;
}

/** §一⑧首尾帧参考在场性三态(§七P2):有图=present/待补=pending/缺失=missing,
 *  让「待补」成为可查询状态而非散落人工记忆。 */
export type ShotFrameReferencePresence = "present" | "pending" | "missing";

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
  /** 以下三组为 0928 跨镜连续性规范 §七P2 加法式可选字段(向后兼容:旧数据
   *  缺省,审计零影响)。合法值不入内容指纹、不打回既有批准——指纹剔除决策
   *  见 lib/studio/visual-continuity.ts visualContinuityFingerprint 处注释;
   *  非法值由 storyboardContinuityStateIssues 守卫式机检(枚举/格式合法性)。 */
  /** §一①世界位置:逐人物「地标+相对关系」锚点;存在即须非空且逐条良构。 */
  worldAnchor?: ShotContinuityWorldAnchor[];
  /** §一⑦台词进度:分段编号,§五格式 S{镜号}-D{台词序}{段序}(如 S07-D2a;
   *  与 A7a 台词容量链同源,编号三处对账归 §七P4)。 */
  dialogueCueId?: string;
  /** §一⑦台词进度:本镜完整台词文字——这一镜嘴上将出现的每个字,非剧情梗概(§五)。 */
  dialogueText?: string;
  /** §一⑧首尾帧参考在场性:首帧/尾帧各自是否有实际可用图片。 */
  frameReferencePresence?: {
    first: ShotFrameReferencePresence;
    last: ShotFrameReferencePresence;
  };
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

/**
 * 分镜图片级人审记录(1125 用户令「分镜图必须人审」):与 visualReview(严格
 * 连续性契约)分轨——本记录只回答「这张图人看过且通过」,是全章节出视频硬门
 * 的判据;无记录=待审(派生,不落 pending 行)。contentSha256 绑定批准时刻的
 * 图片字节:发车前重算对账,路径不变内容被换照样拦。
 */
export interface StoryboardImageReview {
  status: "approved" | "rejected";
  reviewedAt: number;
  /** 驳回必填原因;通过可为空数组。 */
  reasons: string[];
  /** 具名角色各只出现一次(重复人物门):必勾才能通过。 */
  singleAppearancePassed: boolean;
  /** 批准/驳回时图片字节 SHA-256(64 hex),由专用 action 计算落库。 */
  contentSha256: string;
  evidencePath?: string;
}

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

export interface StoryboardSpeechUtterance {
  speaker: string;
  speakerId: TtsSpeakerId;
  text: string;
}

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
  /** Ordered real segment jobs; completed segments are fetched again, never resubmitted. */
  segments?: { inputFingerprint: string; status: StoryboardTtsJobStatus; attempt: number; generationId?: string; backend?: string; emotionCapability?: TtsEmotionCapability; warning?: string }[];
  retryRequested?: boolean;
  cancelRequested?: boolean;
  emotionCapability?: TtsEmotionCapability;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 镜级资产绑定行(1120 Toonflow 绑定契约,三路共用禁改):资产行稳定 id
 * (提取批次实体 id 口径)+冗余名(展示与失效判断兜底——重新提取可能换 id,
 * 发车校验 id+name 双核)。slot=1 起参考序号,排序=参考图顺序。
 */
export interface StoryboardAssetBinding {
  assetId: string;
  name: string;
  kind: "scene" | "character" | "prop";
  slot: number;
}

export interface StoryboardItem extends StudioStaleEvidence, StudioSourceIdentity {
  id: string;
  episodeId: string;
  index: number;
  trackKey: string;
  trackId: string;
  /**
   * 来源剧本条目指纹(10-13-audit4-downstream D5,裁定⑤):分镜表产出时记所据
   * scriptDraft 条目的 id+updatedAt(与 G3 reviewTarget 同一形态,零存储桶新增)。
   * chapter-pipeline-stale 的分镜层过期判定据此软标「剧本已改,分镜基于旧剧本」;
   * 存量条目无此字段 = 回落现行为(不标过期)。
   */
  sourceScript?: { entryId: string; updatedAt: number };
  duration: number;
  prompt: string;
  videoDesc: string;
  /** 1117 第十刀:人工正典主体句覆盖(用户令「写提示词在另外会话做」)——
   * 非空=传输层逐字采用(跳过生成器,仍过引擎 1017 门),分片持久=可审计
   * 可回放;空/缺=走生成器默认路。 */
  promptOverride?: string;
  /** 1117 第十刀:最近一次实发传输主体句全文落库(每次成功发火回写;
   * 排查/人眼对账的真源快照)。 */
  lastTransportPrompt?: string;
  assetIds: string[];
  mediaRef?: StoryboardMediaRef;
  /** 仅 video 镜有意义；缺省为 tts-stack（配音主导）。 */
  audioMix?: "h3-baked" | "tts-stack" | "mixed";
  /** H3 落片经 ffprobe 实测的时长，单位微秒。 */
  h3DurationUs?: number;
  /** 10-11 音频分工 R3c:H3 派发时该镜的音频政策(回写侧落值;缺省 ambient,
   *  旧数据零迁移)。供 mediaRef 分支语义/未来混音分档与诊断;adapter 放音
   *  判据不依赖它(provider+mediaRef kind 判定)。 */
  h3AudioPolicy?: "full" | "ambient";
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
  /** 图片级人审记录(1125 硬门真源);缺省=待审。仅经 reviewStoryboardImage 写入。 */
  imageReview?: StoryboardImageReview;
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
  speechUtterances?: StoryboardSpeechUtterance[];
  speechSpeakerFallback?: "narrator";
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
  /**
   * 1117 C2 剧情锚定(B1 主修):分镜表「场景」列落库(toStoryboardItems 映射
   * row.scene)。LLM 表每行场景列有值而落库丢弃=场景链断的根因——正典装配
   * 五级序场景解析第㊁级消费。additive:存量行无此字段=undefined 零迁移;
   * 不进 sourceFingerprint(防全量 stale)。
   */
  sceneName?: string;
  /**
   * 1117 C2 剧情锚定(B2 主修):场头时辰(源自剧本场头「金水塾馆 夜/内」,
   * parseSceneHeading 扩捕「｜时辰:夜·内」)。五源序时辰解析第一源消费。
   * additive:存量行无此字段=undefined 零迁移;不进 sourceFingerprint。
   */
  timeOfDay?: string;
  /**
   * 1117 C2(类型补账):分镜表「引用资产ID」列的 scene_/char_ 前缀 id 全量
   * (存量分片在档而类型漏记——storyboard-preview-model/studio-flow-data 各自
   * 本地补型实证)。五级序场景解析第㊠级(id 精确命中)消费;不进
   * sourceFingerprint。展示域既有读取零改。
   */
  associateAssetsIds?: string[];
  /**
   * 1120 Toonflow 绑定契约(11-20-toonflow-binding-phase1 件一):镜级资产
   * 绑定行——该镜全部命中资产行按 场景→角色→道具 与行序落档(slot=参考图
   * 顺序)。写路=runStoryboardAssetBinding 绑定成功时全量收集;读路=缺席
   * (旧章)时消费方从 associateAssetsNames+资产行推导,零迁移不改盘。
   * additive:存量行无此字段=undefined;不进 sourceFingerprint(白名单式
   * 哈希不含它,防全量 stale)。
   */
  assetBindings?: StoryboardAssetBinding[];
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
    /**
     * vsc 配方参数预留字段(10-10 批B,决议 D4):键域=vsc-recipes.ts 各配方
     * params 声明。首批不接 AI 不接 UI 也不校验——配方参数烧死卡片默认值,
     * 本字段仅预留用户级微调位(读写两侧首批均不消费,接线路后续批)。
     */
    motionParams?: Record<string, number | string>;
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
