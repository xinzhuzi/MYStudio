import type {
  AgentWorkData,
  EntityExtractionResult,
  ImageWorkflowTarget,
  ProductionTrack,
  ScriptPlan,
  StudioWorkflowConfig,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { StudioAssetKind, StudioAssetSummary } from "@/types/studio-assets";
import type { StudioManualCatalog } from "@/lib/studio/manuals";
import type {
  RemotionChapterAudioRole,
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,

} from "@/types/remotion-workspace";

export interface ProductionFlowAssetCard {
  id: string;
  name: string;
  typeLabel: string;
  runtimeType: "role" | "tool" | "scene" | "clip";
  mediaPath?: string;
  note?: string;
  state?: string;
  reason?: string;
  parentAssetId?: string;
  prompt?: string;
  generationState?: "未生成" | "生成中" | "已完成" | "生成失败";
  isDerived: boolean;
  sourceImagePath?: string;
  imageWorkflowId?: string;
  imageWorkflowTarget?: ImageWorkflowTarget;
}

export interface ProductionFlowAssetGroup {
  source: ProductionFlowAssetCard;
  derived: ProductionFlowAssetCard[];
}

export interface ProductionFlowAssetSummary {
  planned: number;
  existing: number;
  linked: number;
  completed: number;
  missingParent: number;
}

export interface ProductionFlowAssetMedia {
  id: string;
  name: string;
  path?: string;
  prompt?: string;
  parentAssetId?: string;
  parentAssetName?: string;
  state?: string;
  reason?: string;
  imageWorkflowId?: string;
  imageWorkflowTarget?: ImageWorkflowTarget;
  toonflowAssetId?: number;
  toonflowParentAssetId?: number;
}

export type ProductionFlowRuntimeAssetKind = Extract<
  StudioAssetKind,
  "role" | "scene" | "tool"
>;

export type ProductionFlowAssetLibraryMatches = Partial<
  Record<
    ProductionFlowRuntimeAssetKind,
    Record<string, StudioAssetSummary | null | undefined>
  >
>;

export interface ProductionFlowModelInput {
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  episodeId?: string;
  remotionQueueJobs?: RemotionRenderJobV1[];
  /** 队列并发槽数(硬件感知);面板标签展示,缺省 1。 */
  remotionQueueConcurrency?: number;
  remotionCurrentShotSlots?: RemotionCurrentSlotV1[];
  remotionQueueLoading?: boolean;
  remotionQueueError?: string;
  chapterSharedAudioRoles?: Array<RemotionChapterAudioRole>;
  workflowConfig?: Pick<StudioWorkflowConfig, "visualManualId" | "directorManualId">;
  manualCatalog?: StudioManualCatalog;
  assetMediaById?: Record<string, ProductionFlowAssetMedia | undefined>;
  fileExists?: (filePath: string) => boolean;
}
