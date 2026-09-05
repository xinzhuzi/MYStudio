import type { StudioSourceIdentity, StudioStaleEvidence, StoryboardState, AgentWorkKey, StudioRunStatus, StoryboardKeyframe, CharacterReferenceViewType, StoryboardOrderedReference } from "./studio";


/**
 * studio 生产与编剧类型——生产轨/视频候选/供应商/编剧深度实体(M1-M7)。types/studio 按域分组拆出,体逐字保留。
 */
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
  /** 项目根相对路径（exports/<chapterId>/scenes/...）。 */
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

export type ImageWorkflowNodeType = "reference" | "prompt" | "generated" | "uncloth" | "sticky" | "group";
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

/**
 * 取材血缘(09-01-canvas-material-extraction):记录节点由画布上哪张图的
 * 哪个区域派生而来(crop/split/mask-inpaint/reverse-prompt)。
 * 全可选——旧数据零迁移;父图更新时由衍生资产时效性体系感知过期。
 */
export interface ImageWorkflowDerivationSource {
  kind: "crop" | "split" | "mask-inpaint" | "reverse-prompt";
  sourceNodeId: string;
  /** 归一化区域 [x,y,w,h](crop/split 格框;mask-inpaint 用涂抹包围盒) */
  region?: { x: number; y: number; width: number; height: number };
  /** split 格位(第 row 行第 col 列,0 起) */
  cell?: { row: number; col: number };
  createdAt: number;
  /**
   * 父图已更新标记(09-03-derived-expiry-chain):源节点落新结果时盖上
   * 该结果的 generatedAt。缺省=未过期;仅提示,不阻断使用。
   */
  staleSince?: number;
}

/**
 * 无衣物改图节点(09-04-krea2-uncloth-node):ComfyUI「Krea2 无衣物」流
 * 的完整封装,两档(09-05 快/精分家):fine=双分割(segformer+fashn)并集+
 * 两遍采样(脱衣+校色)+mkl 色彩对齐+非重绘区像素硬合成;fast=fashn 单
 * 分割+单遍采样(无后处理,约 1/3 耗时)。由下游成图节点触发,结果直通
 * 成图(本节点回显 resultUrl)。
 * 全字段可选+读侧回落工作流默认值(旧画布零迁移);参数默认=工作流现值。
 */
export interface ImageWorkflowUnclothNode extends ImageWorkflowNodeBase {
  type: "uncloth";
  /** 档位(09-05):缺省 fine;fast/fine=masked SDEdit 双档(已封存,见
   * uncloth-defaults.ts UNCLOOTH_ARCHIVED);instruct=Krea2Edit 指令编辑
   * 档(现行,走 ComfyUI 桥 krea2_uncloth_instruct 模板)。 */
  variant?: "fast" | "fine" | "instruct";
  /** 处理结果回显(最终结果落下游成图节点;本字段供卡内预览) */
  resultUrl?: string;
  /** 单文本驱动两遍采样(缺省回落输入提示词节点的文本) */
  prompt?: string;
  // ── KSampler(两遍共用,工作流逐字段对齐) ──
  /** 采样步数(工作流 8) */
  steps?: number;
  /** cfg(工作流 1=无引导) */
  cfg?: number;
  /** sampler 名(工作流 euler) */
  sampler?: string;
  /** scheduler 名(工作流 simple) */
  scheduler?: string;
  /** 遍1 脱衣 denoise(工作流 0.65) */
  denoiseUndress?: number;
  /** 遍1 seed(工作流 3) */
  seedUndress?: number;
  /** 遍2 校色 denoise(工作流 0.3) */
  denoiseColor?: number;
  /** 遍2 seed(工作流 1) */
  seedColor?: number;
  // ── GrowMask(工作流 [expand, inverted]) ──
  /** 遍1 蒙版收缩 px(工作流 -16) */
  growUndress?: number;
  /** 遍1 GrowMask 第二参(工作流 true) */
  growUndressInvert?: boolean;
  /** 遍2 蒙版外扩 px(工作流 +16) */
  growColor?: number;
  /** 遍2 GrowMask 第二参(工作流 true) */
  growColorInvert?: boolean;
  // ── ImageScaleToTotalPixels(工作流 [method, megapixels, division]) ──
  /** 缩放插值(工作流 lanczos) */
  upscaleMethod?: string;
  /** 输入图上限(百万像素,工作流 1) */
  megapixels?: number;
  /** 除数因子(工作流 1) */
  divisionFactor?: number;
  // ── SegformerClothesSetting 17 位(工作流位序:
  // face/hair/hat/sunglass/left_arm/right_arm/left_leg/right_leg/
  // left_shoe/right_shoe/upper_clothes/skirt/pants/dress/belt/bag/scarf) ──
  /** 勾选的部位名列表(ComfyUI 位序名,工作流实勾=左右臂+左右腿+上衣+短裙+裤+连衣裙+腰带) */
  segformerParts?: string[];
  /** fashn parser 部位(逗号分隔,工作流 label=top 主标签+extra 六项) */
  fashnParts?: string;
  /** fashn device(工作流 cpu) */
  fashnDevice?: string;
  /** fashn dtype(工作流 float32) */
  fashnDtype?: string;
  // ── SegformerUltraV3 蒙版细节加工(工作流真参数) ──
  maskDetail?: {
    /** detail_method(工作流 GuidedFilter) */
    detailMethod?: string;
    processDetail?: boolean;
    detailErode?: number;
    detailDilate?: number;
    blackPoint?: number;
    whitePoint?: number;
    maxMegapixels?: number;
  };
  /** LoRA 五槽(工作流 Power Lora Loader 逐槽对齐:V4/Mystic/空/pussy;强度=当前工作流值) */
  loras?: Array<{ enabled?: boolean; strength?: number }>;
  /** 正向 Rebalance 12 权重(工作流当前值) */
  rebalanceWeights?: number[];
}

export interface ImageWorkflowReferenceNode extends ImageWorkflowNodeBase {
  type: "reference";
  imageUrl: string;
  derivedFrom?: ImageWorkflowDerivationSource;
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

/**
 * 批量生成图片组(09-02-batch-image-group):count>1 时产物聚于一个生成节点;
 * resultUrl 恒=主图(组外消费者零改动),imageBatch 为组内明细。
 */
export interface ImageWorkflowImageBatch {
  images: string[];
  primaryIndex: number;
}

export interface ImageWorkflowGeneratedNode extends ImageWorkflowNodeBase {
  type: "generated";
  prompt: string;
  derivedFrom?: ImageWorkflowDerivationSource;
  imageBatch?: ImageWorkflowImageBatch;
  negativePrompt?: string;
  model?: string;
  /**
   * 生成参数权威标记(08-30 功能转移裁定):true=模型/画幅/分辨率以
   * 成图节点自身字段为准;缺省=存量图回落连线提示词节点的旧值。
   * 用户新建图与在成图节点改参数时置 true。
   */
  paramsEdited?: boolean;
  aspectRatio: string;
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
  derivedFrom?: ImageWorkflowDerivationSource;
  negativePrompt?: string;
  model?: string;
  aspectRatio: string;
  resolution?: string;
  targetNodeId?: string;
}

export type ImageWorkflowNode =
  | ImageWorkflowReferenceNode
  | ImageWorkflowPromptNode
  | ImageWorkflowGeneratedNode
  | ImageWorkflowUnclothNode
  | ImageWorkflowStickyNode
  | ImageWorkflowGroupNode;

/** 便利贴节点(09-03 wave3 吸收):画布创作标注,不参与连线域规则 */
export interface ImageWorkflowStickyNode extends ImageWorkflowNodeBase {
  type: "sticky";
  text: string;
  color: "yellow" | "green" | "blue" | "pink" | "gray";
}

/** Group 手画框组(09-03 wave3 吸收):纯视觉容器,成员按 groupId 关联 */
export interface ImageWorkflowGroupNode extends ImageWorkflowNodeBase {
  type: "group";
  /** 组内成员节点 id 集合(移动组时带动;拖入吸附时登记) */
  memberIds: string[];
  label?: string;
}

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
