import type { StudioSourceIdentity, StudioStaleEvidence, StoryboardState, AgentWorkKey, StudioRunStatus } from "./studio";
export type {
  StorySkeleton,
  EntityExtractionResult,
  ScriptPlan,
  DerivedAsset,
  SeriesBible,
  EpisodeOutline,
} from "./studio-production-script-structure";
export type {
  ImageWorkflowTargetKind,
  ImageWorkflowAssetTargetType,
  ImageWorkflowTarget,
  ImageWorkflowOpenContext,
  AssetImageWorkflowContext,
  ImageWorkflowNodeType,
  ImageWorkflowGenerationStatus,
  ImageWorkflowComfyNodeStatus,
  ImageWorkflowNodePosition,
  ImageWorkflowDerivationSource,
  ImageWorkflowUnclothNode,
  ImageWorkflowReferenceNode,
  ImageWorkflowImageBatch,
  ImageWorkflowGeneratedNode,
  ImageWorkflowPromptNode,
  ImageWorkflowNsfwNode,
  ImageWorkflowComfyPortSnapshot,
  ImageWorkflowComfyWidgetSnapshot,
  ImageWorkflowComfyWorkflowPortSnapshot,
  ImageWorkflowComfyWorkflowWidgetSnapshot,
  ImageWorkflowComfyWorkflowNode,
  ImageWorkflowComfyGenericNode,
  ImageWorkflowNode,
  ImageWorkflowRerouteNode,
  ImageWorkflowStickyNode,
  ImageWorkflowGroupNode,
  ImageWorkflowEdge,
  ImageWorkflowViewport,
  ImageWorkflowGraph,
} from "./studio-production-image-workflow";

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

export type VideoProvider = "ffmpeg-local" | "model-placeholder" | "h3-comfyui";

export interface VideoCandidate extends StudioStaleEvidence {
  id: string;
  trackId: string;
  provider: VideoProvider;
  filePath?: string;
  meta?: Record<string, unknown>;
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

/**
 * 媒体生成任务 kind。scriptAsset(10-11 人肉节点自动化批1)= 剧本资产生成
 * (润色→生图→保存→入库 桥接链,targetId={type}:{name} 资产键,一资产一任务)。
 */
export type MediaGenerationTaskKind =
  | "storyboardImage"
  | "derivedAssetImage"
  | "scriptAsset"
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
   * 分镜提示词构句模式（1120 Toonflow 一期件三 A/B 并轨，atmosphereMode 同款
   * 闭集形态）："canonical"=五项序正典（缺省，默认路径字节级零变化）；
   * "identity-injection"=设计卡全文注入（主体句零身份段＋「参考 N:<身份段全文>」
   * 块，Toonflow §3.4 对应物）。按项目持久化；分镜生图发车时传输层读此开关
   * 选构句。UI 入口=渲染设置页「分镜提示词构句模式」下拉（1126 加，选 canonical 时
   * 落 undefined）；非法值按 canonical 处理。
   */
  storyboardPromptMode?: "canonical" | "identity-injection";
  /**
   * 字幕驱动音效（08-19 音效随字幕）：按字幕句语义分类派生 sfx 音轨。
   * 默认 false（克制）；与已停用的转场音效互不相干。按项目持久化，
   * 一键成片/章节投影创建时注入 renderSettings.subtitleSfxEnabled。
   */
  subtitleSfxEnabled?: boolean;
  /**
   * 章头开篇段（10-10 批D 章级能力）：存在=启用 vsc:brand-ink-open 墨线开篇
   * （wordmark=章头字标/作品名,kicker=可选副标）。wordmark 非空才注入
   * （缺字段=默认关）。按项目持久化；章节投影创建时注入
   * renderSettings.chapterOpening。
   */
  chapterOpening?: { wordmark: string; kicker?: string };
  /**
   * 章尾段（批D）：存在=启用 vsc:grain-dissolve 文字砂化凝聚（tagline=整行
   * 句式,shortMark=凝聚短标,两者须指同一对象）。shortMark/tagline 非空才
   * 注入。按项目持久化；章节投影创建时注入 renderSettings.chapterOutro。
   */
  chapterOutro?: { tagline: string; shortMark: string };
  /**
   * 节拍切点吸附（批D,决议 D5 只做切点吸附）：镜头切点向 BGM 节拍吸附
   * （只经转场重叠通道,硬切不动;BGM 无 beats 恒不激活）。默认 false。
   * 按项目持久化；章节投影创建时注入 renderSettings.beatSnapEnabled。
   */
  beatSnapEnabled?: boolean;
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
