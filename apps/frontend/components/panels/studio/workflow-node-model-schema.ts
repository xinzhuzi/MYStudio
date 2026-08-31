import type {
 
 
  ProductionTrack,
 
 
  StoryboardItem,
 
} from "@/types/studio";
import type {} from "@/types/studio-assets";
import type { TimelineRendererId } from "@rendering/contracts/timeline-renderer";
import type { RemotionBrowserState } from "@rendering/contracts/remotion-browser-status";
import type {
  RemotionCurrentSlotV1,
  RemotionStageStatus,
} from "@/types/remotion-workspace";
import {
  buildStudioFlowData,
} from "@/lib/studio/studio-flow-data";
import {
  type ProductionFlowTableRow,
} from "./storyboard-preview-model";
import {
  buildAssetDerivationModel,
 
 
} from "./workflow-asset-derivation-model";
import type {
 
  ProductionFlowAssetGroup,
 
  ProductionFlowAssetSummary,
  ProductionFlowModelInput,
} from "./workflow-asset-types";

export type {
  ProductionFlowAssetCard,
  ProductionFlowAssetGroup,
  ProductionFlowAssetLibraryMatches,
  ProductionFlowAssetMedia,
  ProductionFlowAssetSummary,
  ProductionFlowModelInput,
  ProductionFlowRuntimeAssetKind,
} from "./workflow-asset-types";

export {
  buildAssetDerivationModel,
  buildAssetLibraryMatchNamesForProductionFlow,
  buildAssetLibraryMediaMapForProductionFlow,
} from "./workflow-asset-derivation-model";

export {
  buildStoryboardRowTitle,
  parseStoryboardPreviewRows,
  splitPreviewList,
} from "./storyboard-preview-model";
export type { ProductionFlowTableRow } from "./storyboard-preview-model";

export const PRODUCTION_FLOW_NODE_IDS = [
  "script",
  "scriptPlan",
  "assets",
  "storyboardTable",
  "storyboard",
  "remotionProduction",
  "workbench",
] as const;

export const DIRECTOR_PLAN_PREVIEW_MAX_LINES = 600;

export type ProductionFlowNodeId =
  | 'script'
  | 'scriptPlan'
  | 'assets'
  | 'storyboardTable'
  | 'storyboard'
  | 'remotionProduction'
  | 'workbench';
export type ProductionFlowStage =
  | "script"
  | "assets"
  | "storyboard"
  | "storyboardPanel"
  | "workbench";
export type ProductionFlowNodeStatus =
  | "empty"
  | "pending"
  | "ready"
  | "warning";

export interface ProductionFlowNodeModel {
  id: ProductionFlowNodeId;
  label: string;
  description: string;
  status: ProductionFlowNodeStatus;
  metrics: string[];
  previewTitle: string;
  previewLines: string[];
  previewKind?:
    | "text"
    | "table"
    | "storyboard-grid"
    | "asset-derivation"
    | "remotion-shots"
    | "workbench-lanes";
  tableRows?: ProductionFlowTableRow[];
  storyboardTiles?: ProductionFlowStoryboardTile[];
  assetGroups?: ProductionFlowAssetGroup[];
  assetSummary?: ProductionFlowAssetSummary;
  workbenchTracks?: ProductionFlowWorkbenchTrack[];
  remotionShots?: ProductionFlowRemotionShot[];
  remotionSummary?: ProductionFlowRemotionSummary;
  /** 队列并发槽数(硬件感知),预览标签展示。 */
  remotionQueueConcurrency?: number;
  finalExportPath?: string;
  rendererSummary?: ProductionFlowRendererSummary;
  skills?: ProductionFlowNodeSkill[];
  skill?: ProductionFlowNodeSkill;
  actions?: ProductionFlowNodeAction[];
  targetStage: ProductionFlowStage;
}

export interface ProductionFlowRendererSummary {
  requested: TimelineRendererId;
  actual?: TimelineRendererId;
  lastRequested?: TimelineRendererId;
  fallbackEffectIds?: string[];
  lastJobId?: string;
  outputPath?: string;
  runtimeStatus?: RemotionBrowserState;
}

export interface ProductionFlowRemotionShot {
  shotId: string;
  index: number;
  title: string;
  mediaPath?: string;
  jobId?: string;
  status: RemotionStageStatus;
  progress: number;
  outputPath?: string;
  evidencePath?: string;
  error?: string;
  revision?: number;
  ttsStatus?: "missing" | "pending" | "ready" | "failed";
  sfxStatus?: "missing" | "ready";
  shotAudioBindingCount?: number;
  ttsInputFingerprint?: string;
  bindingFingerprints?: string[];
  duplicateMixRisk?: boolean;
  chapterSharedAudioReferenced?: boolean;
}

export interface ProductionFlowRemotionSummary {
  total: number;
  succeeded: number;
  running: number;
  queued: number;
  failed: number;
  blocked: number;
  stale: number;
  pending: number;
  chapterReady: boolean;
  loading?: boolean;
  error?: string;
}

export interface ProductionFlowNodeAction {
  id:
    | "generate-director-plan"
    | "rebuild-workbench-tracks"
    | "generate-storyboard-table"
    | "enqueue-remotion-shots";
  label: string;
  targetStage: ProductionFlowStage;
  disabled?: boolean;
  promptPlaceholder?: string;
  showPromptInput?: boolean;
  userInstruction?: string;
  /** 付费云端动作(LLM 生成类)——按钮必须用共享 Button variant="paid"
   *  (2026-08-25 裁定:付费按钮统一金色模板;本地渲染类不标)。 */
  paid?: boolean;
}

export interface ProductionFlowNodeSkill {
  id: string;
  name: string;
  source: string;
  role:
    | "base"
    | "visual-style"
    | "visual-storyboard"
    | "visual-storyboard-table"
    | "visual-video"
    | "director-narrative"
    | "director-storyboard-table"
    | "production-technique";
  summaryLines: string[];
}

export interface ProductionFlowStoryboardTile {
  id: string;
  index: number;
  mediaPath?: string;
  title: string;
  lines?: string;
  state: StoryboardItem["state"];
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
  shouldGenerateImage?: boolean;
  sourceFingerprint?: string;
}

export interface ProductionFlowWorkbenchTrack {
  id: string;
  duration: number;
  state: ProductionTrack["state"];
  storyboardCount: number;
  mediaCount: number;
  videoCount: number;
  selectedVideoPath?: string;
  prompt?: string;
  reason?: string;
}

/** 节点宽度唯一事实源(px);卡片侧 Tailwind 类与测试钉奇偶(P3-8 归一)。 */
export const PRODUCTION_NODE_WIDTH_PX = {
  script: 1040,
  scriptPlan: 680,
  assets: 760,
  storyboardTable: 700,
  storyboard: 640,
  remotionProduction: 760,
  workbench: 760,
} satisfies Record<ProductionFlowNodeId, number>;

export const PRODUCTION_FLOW_EDGES = [
  ["script", "scriptPlan"],
  ["script", "assets"],
  ["scriptPlan", "storyboardTable"],
  ["storyboardTable", "storyboard"],
  ["storyboard", "remotionProduction"],
  ["remotionProduction", "workbench"],
] as const satisfies readonly (readonly [
  ProductionFlowNodeId,
  ProductionFlowNodeId,
])[];


export interface ProductionFlowModel {
  nodes: ProductionFlowNodeModel[];
  edges: typeof PRODUCTION_FLOW_EDGES;
  remotionShotSlots?: RemotionCurrentSlotV1[];
}

export type ProductionFlowBuildContext = {
  input: ProductionFlowModelInput & { rendererSummary?: ProductionFlowRendererSummary };
  chapterStoryboards: StoryboardItem[];
  flowData: ReturnType<typeof buildStudioFlowData>;
  scriptDrafts: ProductionFlowModelInput["agentWorkData"];
  scriptChars: number;
  storyboardTableCount: number;
  assetCounts: { total: number; character: number; scene: number; prop: number };
  assetDerivation: ReturnType<typeof buildAssetDerivationModel>;
  assetMetrics: string[];
  assetPreviewLines: string[];
  storyboardTableRows: ProductionFlowTableRow[];
  visualStoryboardCount: number;
  rendererSummary: ProductionFlowRendererSummary;
  remotionFinalExportReady: boolean;
  storyboardPreview: string[];
  storyboardTiles: ProductionFlowStoryboardTile[];
  workbenchTracks: ProductionFlowWorkbenchTrack[];
  remotionShots: ProductionFlowRemotionShot[];
  remotionSummary: ProductionFlowRemotionSummary;
  /** 队列并发槽数(硬件感知),预览标签展示。 */
  remotionQueueConcurrency?: number;
  directorPlanSkill: ProductionFlowNodeSkill | undefined;
  directorPlanSkills: ProductionFlowNodeSkill[];
  storyboardTableSkills: ProductionFlowNodeSkill[];
  storyboardSkills: ProductionFlowNodeSkill[];
  remotionShotSlots: ProductionFlowModelInput["remotionCurrentShotSlots"];
};

