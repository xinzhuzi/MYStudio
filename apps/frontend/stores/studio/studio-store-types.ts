// Studio 工作流 store 的类型契约(状态、动作、store 类型)。2026-11-24 超线文件拆分:从 studio-store.ts 拆出;studio-store.ts 仍是入口,对外导出不变。

import { createImageWorkflowGraph } from "@/lib/studio/image-workflow";
import type {
  StoryboardKeyframe,
  AgentWorkData,
  AgentWorkKey,
  ContinuityAssetVersion,
  EntityExtractionResult,
  EpisodeOutline,
  ImageWorkflowGraph,
  ImageWorkflowTarget,
  HumanVisualReviewInput,
  HumanContinuityAssetApprovalInput,
  MediaGenerationTask,
  MediaGenerationTaskKind,
  NovelChapter,
  ProjectEventGraphRecord,
  ProjectMemoryContext,
  ProjectMemoryQuery,
  ProjectMemoryRecord,
  ProductionTrack,
  ScriptPlan,
  SeriesBible,
  StudioAgentRun,
  StudioWorkflowConfig,
  StoryboardItem,
  StoryboardMediaRef,
  StudioMaterial,
  VideoCandidate,
  StudioSourceIdentity,
  SceneSegmentRecord,
} from "@/types/studio";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";

export interface StudioWorkflowState {
  materials: StudioMaterial[];
  novelChapters: NovelChapter[];
  /** 窗口化 v1：激活章（工作区装载对象）；null/缺省=未窗口化（legacy 全量内存） */
  activeChapterId?: string | null;
  /** A批 R1（10-14-audit4-residuals）：切章装载中标志——ScriptTab 据此禁用生成/审核/可编辑并显示装载中；瞬态位不落盘（persist partialize 剥除，防「杀进程于切章中」水合出恒禁用）。可选字段（同 activeChapterId 先例）：缺省=未在装载，存量全量构造点零涟漪 */
  chapterSwitchLoading?: boolean;
  sourceBible: string;
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  episodeOutlines: EpisodeOutline[];
  storyboards: StoryboardItem[];
  continuityAssetVersions: ContinuityAssetVersion[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  sceneSegments: SceneSegmentRecord[];
  imageWorkflows: ImageWorkflowGraph[];
  agentRuns: StudioAgentRun[];
  mediaTasks: MediaGenerationTask[];
  eventGraph: ProjectEventGraphRecord[];
  projectMemoryRecords: ProjectMemoryRecord[];
  workflowConfig: StudioWorkflowConfig;
}

export interface StudioWorkflowActions {
  addMaterial: (input: { name: string; localPath: string; size: number; importedAt?: number }) => string;
  deleteMaterial: (id: string) => void;
  bindMaterialToStoryboard: (storyboardId: string, materialId: string, h3DurationUs?: number) => void;
  importNovelText: (sourceText: string) => void;
  switchChapter: (chapterId: string) => Promise<void>;
  slimNonActiveChapters: () => boolean;
  appendNovelText: (sourceText: string, sourceName?: string) => void;
  replaceNovelText: (sourceText: string, sourceName?: string) => void;
  updateNovelChapter: (id: string, updates: Partial<NovelChapter>) => void;
  saveSourceBible: (text: string) => void;
  setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>) => void;
  startAgentRun: (input: {
    key: AgentWorkKey;
    phase: string;
    inputSummary: string;
    inputFingerprint?: string;
    checkpointRef?: string;
    retryOf?: string;
  }) => string;
  finishAgentRun: (id: string, output?: { outputRef?: string; outputRefs?: string[]; checkpointRef?: string }) => void;
  failAgentRun: (id: string, errorReason: string, checkpointRef?: string) => void;
  cancelAgentRun: (id: string, errorReason?: string, checkpointRef?: string) => void;
  retryAgentRun: (id: string) => string | null;
  startMediaTask: (input: {
    kind: MediaGenerationTaskKind;
    targetId: string;
    episodeId?: string;
    provider?: string;
    runId?: string;
    checkpointRef?: string;
    inputFingerprint?: string;
    retryOf?: string;
  }) => string;
  finishMediaTask: (id: string, output?: { outputRef?: string; outputRefs?: string[]; checkpointRef?: string }) => void;
  failMediaTask: (id: string, errorReason: string, checkpointRef?: string) => void;
  cancelMediaTask: (id: string, errorReason?: string, checkpointRef?: string) => void;
  retryMediaTask: (id: string) => string | null;
  retryFailedMediaTasks: (kind?: MediaGenerationTaskKind) => string[];
  rebuildProjectMemoryFromChapters: (projectId: string) => void;
  retrieveProjectMemory: (query: ProjectMemoryQuery) => ProjectMemoryContext;
  purgeProjectMemory: (projectId: string) => void;
  saveAgentWorkData: (key: AgentWorkKey, data: string, episodeId?: string, identity?: StudioSourceIdentity) => string;
  saveEntityExtraction: (result: EntityExtractionResult) => void;
  saveScriptPlan: (plan: ScriptPlan) => void;
  saveSeriesBible: (bible: SeriesBible) => void;
  saveEpisodeOutline: (outline: EpisodeOutline) => void;
  addStoryboard: (item?: Partial<StoryboardItem>) => string;
  replaceContinuityAssetVersions: (items: ContinuityAssetVersion[]) => void;
  reviewContinuityAssetVersionHuman: (
    assetId: string,
    versionId: string,
    review: HumanContinuityAssetApprovalInput,
  ) => void;
  replaceStoryboardsForEpisode: (episodeId: string, items: StoryboardItem[]) => void;
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  writeStoryboardAudio: (
    id: string,
    updates: Pick<
      StoryboardItem,
      | "audioRef"
      | "shotAudioBindings"
      | "ttsJob"
      | "ttsGenerationId"
      | "ttsBackend"
      | "ttsMocked"
      | "ttsEmotionCapability"
      | "ttsWarning"
    >,
  ) => void;
  reviewStoryboardHuman: (id: string, review: HumanVisualReviewInput) => void;
  /** 1125 人审硬门:图片级人审唯一写入口(签名同 StoryboardSlice.reviewStoryboardImage)。 */
  reviewStoryboardImage: (
    id: string,
    input: {
      status: "approved" | "rejected";
      singleAppearancePassed: boolean;
      reasons: string[];
      imageBase64: string;
      evidencePath?: string;
    },
  ) => Promise<void>;
  writeStoryboardVlmReview: (id: string, artifact: VlmReviewArtifactV1, evidencePath?: string) => void;
  bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef, h3DurationUs?: number) => void;
  setStoryboardKeyframes: (
    id: string,
    frames: StoryboardKeyframe[],
    reason: "backfill" | "generate" | "upscale" | "plan" | "edit",
  ) => void;
  createImageWorkflow: (input?: Parameters<typeof createImageWorkflowGraph>[0]) => string;
  upsertImageWorkflow: (graph: ImageWorkflowGraph) => void;
  updateImageWorkflow: (id: string, updates: Partial<ImageWorkflowGraph>) => void;
  deleteImageWorkflow: (id: string) => void;
  applyImageWorkflowResultToStoryboard: (storyboardId: string, workflowId: string, nodeId: string) => void;
  applyImageWorkflowResultToAsset: (target: ImageWorkflowTarget, workflowId: string, nodeId: string) => void;
  createStoryboardsFromChapters: () => void;
  rebuildTracks: () => void;
  updateTrack: (id: string, updates: Partial<ProductionTrack>) => void;
  addVideoCandidate: (candidate: Omit<VideoCandidate, "id" | "createdAt"> & { id?: string; createdAt?: number }) => string;
  updateVideoCandidate: (id: string, updates: Partial<VideoCandidate>) => void;
  selectVideoCandidate: (trackId: string, videoId: string) => void;
  deleteVideoCandidate: (id: string) => void;
  registerSceneSegment: (record: SceneSegmentRecord) => void;
  removeSceneSegment: (id: string) => void;
  resetStudioWorkflow: () => void;
}

export type StudioWorkflowStore = StudioWorkflowState & StudioWorkflowActions;
