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
  /**
   * 08-27 R1 衍生图过期标记:父资产图已更新,这张衍生图还是按旧版生成的。
   * 无父代锚的存量记录不设此字段(静默)。只提示,不自动删/重生。
   */
  stale?: boolean;
  /** 08-27 R2 预划·分镜零引用:⑦ 清单预划了但当前章分镜一次都没用到。只提示。 */
  unused?: boolean;
}

export interface ProductionFlowAssetGroupUnplanned {
  state: string;
  evidenceShotIds: string[];
}

export interface ProductionFlowAssetGroup {
  source: ProductionFlowAssetCard;
  derived: ProductionFlowAssetCard[];
  /**
   * 08-27 R2 分镜用到·未预划(只读提示):当前章分镜实际用到了该父资产的
   * 这些衍生状态,但 ⑦ 清单没预划、项目内也无变体记录。无动作、无按钮。
   */
  unplanned?: ProductionFlowAssetGroupUnplanned[];
}

export interface ProductionFlowAssetSummary {
  planned: number;
  existing: number;
  linked: number;
  completed: number;
  missingParent: number;
  /** 08-27 R2:预划了但当前章分镜零引用的状态数。 */
  unused: number;
  /** 08-27 R2:分镜用到·未预划的状态数。 */
  unplanned: number;
  /**
   * 08-27 二期 R1:本章预划的剧本指纹与当前剧本正文不一致(预划已过期)。
   * 存量 plan 无 scriptFingerprint 或比对侧未传当前指纹时不设(静默)。只提示。
   */
  planStale?: boolean;
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
  /** 08-27 R1:衍生媒体与父代锚比对后的过期标记(无锚存量不设)。 */
  stale?: boolean;
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
  /**
   * 08-27 二期 R1:当前章剧本正文指纹(scriptPlanSourceFingerprint,由视图模型
   * 用与规划侧同一提取源算出)。传入后 derivation summary 才会比对 planStale;
   * 不传 = 静默(测试/旧调用方兼容)。
   */
  currentScriptFingerprint?: string;
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
