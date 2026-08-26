import type {
 
 
  ProductionTrack,
 
  StudioManualPreset,
 
  StoryboardItem,
 
} from "@/types/studio";
import type {} from "@/types/studio-assets";
import type { TimelineRendererId } from "@rendering/contracts/timeline-renderer";
import type { RemotionBrowserState } from "@rendering/contracts/remotion-browser-status";
import type {
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
  RemotionStageStatus,
} from "@/types/remotion-workspace";
import {
  buildStudioFlowData,
} from "@/lib/studio/studio-flow-data";
import {
  type StudioManualCatalog,
  getAgentSkillPreset,
  getStudioManualPreset,
} from "@/lib/studio/manuals";
import {
  parseStoryboardPreviewRows,
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

const DIRECTOR_PLAN_PREVIEW_MAX_LINES = 600;

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

type ProductionFlowBuildContext = {
  input: ProductionFlowModelInput & { rendererSummary?: ProductionFlowRendererSummary };
  chapterStoryboards: ReturnType<typeof buildProductionFlowModel> extends never ? never : StoryboardItem[];
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

export function buildProductionFlowModel(
  input: ProductionFlowModelInput & { rendererSummary?: ProductionFlowRendererSummary },
): ProductionFlowModel {
  const chapterStoryboards = input.episodeId
    ? input.storyboards.filter((storyboard) => storyboard.episodeId === input.episodeId)
    : input.storyboards;
  const remotionShotSlots = (input.remotionCurrentShotSlots ?? []).filter(
    (slot) => slot.target.kind === "shot"
      && (!input.episodeId || slot.target.chapterId === input.episodeId),
  );
  const flowData = buildStudioFlowData({
    ...input,
    storyboards: chapterStoryboards,
  });
  const scriptDrafts = input.agentWorkData.filter(
    (item) => item.key === "scriptDraft" && item.data.trim(),
  );
  const storyboardTableCount = input.agentWorkData.filter(
    (item) => item.key === "storyboardTable" && item.data.trim(),
  ).length;
  const assetCounts = flowData.assets.reduce(
    (counts, asset) => {
      counts.total += 1;
      counts[asset.type] += 1;
      return counts;
    },
    { total: 0, character: 0, scene: 0, prop: 0 },
  );
  const assetDerivation = buildAssetDerivationModel(
    flowData.assets,
    input.scriptPlans,
    input.assetMediaById,
  );
  const assetMetrics = assetCounts.total
    ? [
        `${assetCounts.total} 个资产`,
        `${assetCounts.character} 角色`,
        `${assetCounts.scene} 场景`,
        `${assetCounts.prop} 道具`,
        ...(assetDerivation.summary.planned || assetDerivation.summary.existing
          ? [
              `衍生图 ${assetDerivation.summary.completed}/${assetDerivation.summary.linked} 已完成`,
            ]
          : []),
        ...(assetDerivation.summary.missingParent
          ? [`缺父资产 ${assetDerivation.summary.missingParent}`]
          : []),
      ]
    : ["待提取资产"];
  const assetPreviewLines = assetDerivation.groups.slice(0, 18).flatMap((group) => [
    `${group.source.typeLabel} · ${group.source.name}${group.source.note ? ` · ${group.source.note}` : ""}`,
    ...group.derived.map((item) => `衍生 · ${item.name}${item.reason ? ` · ${item.reason}` : ""}`),
  ]);
  const rendererSummary = normalizeRemotionRendererSummary(input.rendererSummary);
  const remotionShots = buildRemotionShots(chapterStoryboards, input, remotionShotSlots);
  const ctx: ProductionFlowBuildContext = {
    input,
    chapterStoryboards,
    flowData,
    scriptDrafts,
    scriptChars: flowData.script.length,
    storyboardTableCount,
    assetCounts,
    assetDerivation,
    assetMetrics,
    assetPreviewLines,
    storyboardTableRows: parseStoryboardPreviewRows(flowData.storyboardTable),
    visualStoryboardCount: flowData.storyboard.filter((item) => item.mediaPath).length,
    rendererSummary,
    remotionFinalExportReady: rendererSummary.actual === "remotion"
      && Boolean(rendererSummary.outputPath),
    storyboardPreview: flowData.storyboard.slice(0, 4).map((item) =>
      [
        `#${item.id}`,
        `${item.duration}s`,
        item.videoDesc || item.prompt || item.lines || "未填写分镜内容",
      ].join(" · "),
    ),
    storyboardTiles: buildStoryboardTiles(chapterStoryboards),
    workbenchTracks: flowData.workbench.tracks
      .slice(0, 8)
      .map<ProductionFlowWorkbenchTrack>((track) => ({
        id: track.id,
        duration: track.duration,
        state: track.state,
        storyboardCount: track.storyboardIds.length,
        mediaCount: track.medias.length,
        videoCount: track.videoList.length,
        selectedVideoPath: track.selectedVideoPath,
        prompt: track.prompt,
        reason: track.reason,
      })),
    remotionShots,
    remotionQueueConcurrency: input.remotionQueueConcurrency ?? 1,
    remotionSummary: summarizeRemotionShots(
      remotionShots,
      input.remotionQueueLoading,
      input.remotionQueueError,
    ),
    directorPlanSkill: buildNodeSkill("production_execution_director_plan"),
    directorPlanSkills: buildDirectorPlanSkills(input.workflowConfig, input.manualCatalog),
    storyboardTableSkills: buildStoryboardTableSkills(input.workflowConfig, input.manualCatalog),
    storyboardSkills: buildStoryboardSkills(input.workflowConfig, input.manualCatalog),
    remotionShotSlots,
  };
  return {
    nodes: [
      buildScriptNode(ctx),
      buildScriptPlanNode(ctx),
      buildAssetsNode(ctx),
      buildStoryboardTableNode(ctx),
      buildStoryboardPanelNode(ctx),
      buildRemotionProductionNode(ctx),
      buildWorkbenchNode(ctx),
    ],
    edges: PRODUCTION_FLOW_EDGES,
    remotionShotSlots,
  };
}

function buildScriptNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  return {
    id: "script",
    label: "剧本",
    description: "章节剧本与正文台词输入。",
    status: ctx.scriptDrafts.length > 0 ? "ready" : "empty",
    metrics: ctx.scriptDrafts.length ? [`${ctx.scriptChars} 字`] : [],
    previewTitle: "剧本内容",
    previewLines: previewTextLines(ctx.flowData.script, "暂无剧本内容", 220),
    targetStage: "script",
  };
}

function buildScriptPlanNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  return {
    id: "scriptPlan",
    label: "导演规划",
    description: "场次、节奏、镜头策略和声音方向。",
    status: ctx.input.scriptPlans.length > 0 ? "ready" : "empty",
    metrics: ctx.input.scriptPlans.length
      ? [`${ctx.input.scriptPlans.length} 份规划`]
      : ["待运行导演规划"],
    previewTitle: "导演规划",
    previewLines: previewTextLines(
      ctx.flowData.scriptPlan,
      "暂无导演规划",
      DIRECTOR_PLAN_PREVIEW_MAX_LINES,
    ),
    skill: ctx.directorPlanSkill,
    skills: ctx.directorPlanSkills,
    actions: [
      {
        id: "generate-director-plan",
        label: ctx.input.scriptPlans.length > 0 ? "重新生成导演规划" : "生成导演规划",
        targetStage: "script",
        disabled: ctx.scriptDrafts.length === 0,
        promptPlaceholder:
          "给导演规划补充要求，例如：节奏更压迫、保留所有对白、突出雨夜和断剑意象。",
      },
    ],
    targetStage: "script",
  };
}

function buildAssetsNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  return {
    id: "assets",
    label: "衍生资产",
    description: "从剧本抽取角色、场景、道具，并作为分镜画面引用。",
    status: ctx.assetCounts.total > 0 ? "ready" : "empty",
    metrics: ctx.assetMetrics,
    previewTitle: "剧本资产",
    previewLines: ctx.assetPreviewLines.length
      ? ctx.assetPreviewLines
      : ["暂无角色、场景、道具资产"],
    previewKind: "asset-derivation",
    assetGroups: ctx.assetDerivation.groups,
    assetSummary: ctx.assetDerivation.summary,
    targetStage: "assets",
  };
}

function buildStoryboardTableNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  return {
    id: "storyboardTable",
    label: "分镜表",
    description: "按导演规划拆出镜头表。",
    status: ctx.storyboardTableCount > 0 ? "ready" : "empty",
    metrics: ctx.storyboardTableCount
      ? [`${ctx.storyboardTableCount} 份分镜表`]
      : ["待生成分镜表"],
    previewTitle: "分镜表",
    previewLines: previewTextLines(ctx.flowData.storyboardTable, "暂无分镜表"),
    previewKind: "table",
    tableRows: ctx.storyboardTableRows,
    skills: ctx.storyboardTableSkills,
    actions: [
      {
        id: "generate-storyboard-table",
        label: ctx.storyboardTableCount > 0 ? "重新生成分镜表" : "生成分镜表",
        targetStage: "storyboard",
        disabled: ctx.input.scriptPlans.length === 0,
        promptPlaceholder:
          "给分镜表补充要求，例如：每镜约 5 秒、台词不丢、道具和角色资产必须进入镜头。",
      },
    ],
    targetStage: "storyboard",
  };
}

function buildStoryboardPanelNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  return {
    id: "storyboard",
    label: "分镜面板",
    description: "分镜图、台词、配音与视频节点绑定。",
    status: ctx.chapterStoryboards.length > 0 ? "ready" : "empty",
    metrics: ctx.chapterStoryboards.length
      ? [
          `${ctx.chapterStoryboards.length} 个分镜`,
          `${ctx.visualStoryboardCount} 个画面`,
        ]
      : ["待生成分镜"],
    previewTitle: "分镜面板",
    previewLines: ctx.storyboardPreview.length
      ? ctx.storyboardPreview
      : ["暂无分镜图、台词和音频绑定"],
    previewKind: "storyboard-grid",
    storyboardTiles: ctx.storyboardTiles,
    skills: ctx.storyboardSkills,
    actions: [],
    targetStage: "storyboardPanel",
  };
}

function buildRemotionProductionNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  const summary = ctx.remotionSummary;
  return {
    id: "remotionProduction",
    label: "Remotion 单镜生产",
    description: "将当前章节的每个分镜分别生成一条单镜 MP4（自动带上旁白配音与音效）；全部通过后才能进入章节工作台。",
    status: summary.failed || summary.blocked
      ? "warning"
      : summary.running || summary.queued
        ? "pending"
        : summary.chapterReady
          ? "ready"
          : "empty",
    metrics: [
      "Remotion renderer",
      `${summary.succeeded}/${summary.total} 个分镜 MP4`,
      ...(summary.running ? [`渲染中 ${summary.running}`] : []),
      ...(summary.failed ? [`失败 ${summary.failed}`] : []),
      ...(summary.blocked ? [`阻塞 ${summary.blocked}`] : []),
    ],
    previewTitle: "逐镜 Remotion 队列",
    previewLines: ctx.remotionShots.length
      ? ctx.remotionShots.slice(0, 6).map((shot) => `${String(shot.index).padStart(2, "0")} · ${shot.status} · ${Math.round(shot.progress * 100)}% · ${shot.title}`)
      : ["等待分镜面板提供当前章节的分镜"],
    previewKind: "remotion-shots",
    remotionShots: ctx.remotionShots,
    remotionSummary: summary,
    remotionQueueConcurrency: ctx.remotionQueueConcurrency,
    actions: [
      {
        id: "enqueue-remotion-shots",
        label: summary.chapterReady
          ? "分镜视频已完成"
          : summary.running || summary.queued
            ? "Remotion 生产中"
            : "一键生成所有视频",
        targetStage: "workbench",
        disabled: ctx.chapterStoryboards.length === 0 || summary.chapterReady || Boolean(summary.running || summary.queued),
        showPromptInput: false,
      },
    ],
    targetStage: "workbench",
  };
}

function buildWorkbenchNode(ctx: ProductionFlowBuildContext): ProductionFlowNodeModel {
  const summary = ctx.remotionSummary;
  return {
    id: "workbench",
    label: "Remotion 视频工作台",
    description: "加载当前章节的原生 Remotion Studio，进行时间线预览、剪辑和章节导出。",
    status: summary.chapterReady || ctx.remotionFinalExportReady
      ? "ready"
      : summary.succeeded > 0
        ? "pending"
        : "empty",
    metrics: [
      "原生 Remotion Studio",
      `${summary.succeeded}/${summary.total} 个分镜已就绪`,
      ctx.rendererSummary.actual
        ? `${formatRendererLabel(ctx.rendererSummary.lastRequested ?? ctx.rendererSummary.requested)} → ${formatRendererLabel(ctx.rendererSummary.actual)}`
        : "章节成片待渲染",
      ctx.remotionFinalExportReady ? "已导出章节成片" : "等待 ChapterVideo",
    ],
    previewTitle: "原生 Remotion Studio",
    previewLines: [
      `章节工作台 · ${summary.chapterReady ? "可进入" : "等待全部分镜成功"}`,
      `${summary.succeeded}/${summary.total} 单镜 MP4 已就绪`,
      "Studio Timeline / Preview / Inspector / Render",
      ...(ctx.rendererSummary.outputPath ? [`ChapterVideo · ${ctx.rendererSummary.outputPath}`] : []),
    ],
    previewKind: "workbench-lanes",
    workbenchTracks: ctx.workbenchTracks,
    finalExportPath: ctx.flowData.workbench.finalExportPath,
    rendererSummary: ctx.rendererSummary,
    remotionSummary: summary,
    targetStage: "workbench",
  };
}

function buildStoryboardTiles(
  chapterStoryboards: StoryboardItem[],
): ProductionFlowStoryboardTile[] {
  return chapterStoryboards
    .slice()
    .sort((a, b) => a.index - b.index)
    .map<ProductionFlowStoryboardTile>((item) => ({
      id: item.id,
      index: item.index,
      mediaPath:
        item.mediaRef?.kind === "image" || item.mediaRef?.kind === "video"
          ? item.mediaRef.path
          : undefined,
      title: item.videoDesc || item.prompt || `分镜 ${item.index}`,
      lines: item.lines,
      state: item.state,
      imageWorkflowId: item.imageWorkflowId ?? item.mediaRef?.imageWorkflowId,
      imageWorkflowNodeId: item.imageWorkflowNodeId ?? item.mediaRef?.imageWorkflowNodeId,
      shouldGenerateImage: item.shouldGenerateImage,
      sourceFingerprint: item.sourceFingerprint,
    }));
}

function buildRemotionShots(
  chapterStoryboards: StoryboardItem[],
  input: ProductionFlowModelInput & { rendererSummary?: ProductionFlowRendererSummary },
  remotionShotSlots: ProductionFlowModelInput["remotionCurrentShotSlots"],
): ProductionFlowRemotionShot[] {
  const remotionJobs = input.remotionQueueJobs ?? [];
  const shotJobs = new Map(
    remotionJobs
      .filter((job): job is RemotionRenderJobV1 & { target: { kind: "shot" } } => job.target.kind === "shot")
      .map((job) => [job.target.shotId, job]),
  );
  const currentSlotByShotId = new Map(
    (remotionShotSlots ?? []).map((slot) => [slot.target.kind === "shot" ? slot.target.shotId : "", slot] as const),
  );
  return chapterStoryboards
    .slice()
    .sort((a, b) => a.index - b.index)
    .map<ProductionFlowRemotionShot>((storyboard) => {
      const job = shotJobs.get(storyboard.id);
      const currentSlot = job && job.status === "succeeded"
        ? currentSlotByShotId.get(storyboard.id)
        : undefined;
      const currentSlotMatchesJob = Boolean(
        currentSlot
          && job
          && currentSlot.job.jobId === job.jobId
          && currentSlot.job.inputHash === job.inputHash
          && currentSlot.job.bundleContentHash === job.bundleContentHash
          && currentSlot.job.renderSettingsHash === job.renderSettingsHash,
      );
      const status: RemotionStageStatus = job?.status === "succeeded" && !currentSlotMatchesJob
        ? "blocked"
        : job?.status ?? "pending";
      const mediaPath = storyboard.mediaRef?.kind === "image" || storyboard.mediaRef?.kind === "video"
        ? storyboard.mediaRef.path
        : undefined;
      const bindings = storyboard.shotAudioBindings ?? [];
      const voice = bindings.find((binding) => binding.role === "voice");
      const sfx = bindings.find((binding) => binding.role === "sfx");
      const ttsStatus = storyboard.ttsJob?.status === "failed"
        ? "failed"
        : voice?.ttsInputFingerprint
          ? storyboard.ttsJob?.status === "completed" ? "ready" : "pending"
          : "missing";
      return {
        shotId: storyboard.id,
        index: storyboard.index,
        title: storyboard.videoDesc || storyboard.prompt || `分镜 ${storyboard.index}`,
        mediaPath,
        ...(job ? {
          jobId: job.jobId,
          status,
          progress: job.progress,
          outputPath: currentSlotMatchesJob ? currentSlot?.outputPath : undefined,
          evidencePath: currentSlotMatchesJob ? currentSlot?.evidencePath : undefined,
          error: job.error?.message ?? (status === "blocked" ? "队列 job 成功但 current slot 尚未验证" : undefined),
          revision: job.target.shotRevision,
        } : {
          status: "pending" as const,
          progress: 0,
          revision: Math.max(1, storyboard.outputVersion ?? 1),
        }),
        ttsStatus,
        sfxStatus: sfx ? "ready" : "missing",
        shotAudioBindingCount: bindings.length,
        ttsInputFingerprint: voice?.ttsInputFingerprint,
        bindingFingerprints: bindings.map((binding) => binding.bindingFingerprint),
        duplicateMixRisk: new Set(bindings.map((binding) => binding.sourceFingerprint)).size < bindings.length,
        chapterSharedAudioReferenced: (input.chapterSharedAudioRoles?.length ?? 0) > 0,
      };
    });
}

function summarizeRemotionShots(
  shots: ProductionFlowRemotionShot[],
  loading = false,
  error?: string,
): ProductionFlowRemotionSummary {
  const counts = shots.reduce<Record<RemotionStageStatus, number>>((result, shot) => {
    result[shot.status] = (result[shot.status] ?? 0) + 1;
    return result;
  }, {
    pending: 0,
    blocked: 0,
    ready: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    stale: 0,
  });
  return {
    total: shots.length,
    succeeded: counts.succeeded,
    running: counts.running,
    queued: counts.queued,
    failed: counts.failed + counts.canceled,
    blocked: counts.blocked,
    stale: counts.stale,
    pending: counts.pending + counts.ready,
    chapterReady: shots.length > 0 && shots.every((shot) => shot.status === "succeeded" && Boolean(shot.outputPath && shot.evidencePath)),
    ...(loading ? { loading: true } : {}),
    ...(error ? { error } : {}),
  };
}

export function formatRendererLabel(renderer: TimelineRendererId) {
  return renderer === "remotion" ? "Remotion" : "FFmpeg";
}

export function normalizeRemotionRendererSummary(
  summary?: ProductionFlowRendererSummary,
): ProductionFlowRendererSummary {
  const evidenceRequested = summary?.lastRequested ?? summary?.requested;
  if (evidenceRequested !== "remotion" || summary?.actual !== "remotion") {
    return {
      requested: "remotion",
      ...(summary?.runtimeStatus ? { runtimeStatus: summary.runtimeStatus } : {}),
    };
  }
  const { fallbackEffectIds: _ignoredFallbackEffectIds, ...accepted } = summary;
  return {
    ...accepted,
    requested: "remotion",
    lastRequested: "remotion",
    actual: "remotion",
  };
}

function buildNodeSkill(id: string): ProductionFlowNodeSkill | undefined {
  const preset = getAgentSkillPreset(id);
  if (!preset) return undefined;
  return {
    id: preset.id,
    name: preset.name,
    source: preset.source,
    role: "base",
    summaryLines: previewTextLines(
      stripFrontmatter(preset.content),
      "暂无 skill 内容",
      8,
    ),
  };
}

function buildDirectorPlanSkills(
  workflowConfig: ProductionFlowModelInput["workflowConfig"],
  manualCatalog: StudioManualCatalog = {},
): ProductionFlowNodeSkill[] {
  return [
    buildNodeSkill("production_execution_director_plan"),
    ...buildSelectedDirectorSkillModules(workflowConfig, manualCatalog),
  ].filter((skill): skill is ProductionFlowNodeSkill => Boolean(skill));
}

function buildStoryboardTableSkills(
  workflowConfig: ProductionFlowModelInput["workflowConfig"],
  manualCatalog: StudioManualCatalog = {},
): ProductionFlowNodeSkill[] {
  return [
    buildNodeSkill("production_execution_storyboard_table"),
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "director_storyboard_table_style",
      role: "visual-storyboard-table",
      labelPrefix: "视觉风格分镜表技法",
      fallback: "当前视觉风格未提供分镜表技法模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("director", workflowConfig?.directorManualId, manualCatalog),
      moduleKey: "director_storyboard_table_narrative",
      role: "director-storyboard-table",
      labelPrefix: "题材分镜表技法",
      fallback: "当前题材导演手册未提供分镜表技法模块",
    }),
    buildManualNodeSkill({
      manual: resolveProductionManual(manualCatalog),
      moduleKey: "storyboard_table_techniques",
      role: "production-technique",
      labelPrefix: "通用分镜表技法",
      fallback: "当前制作技法未提供分镜表模块",
    }),
  ].filter((skill): skill is ProductionFlowNodeSkill => Boolean(skill));
}

function buildStoryboardSkills(
  workflowConfig: ProductionFlowModelInput["workflowConfig"],
  manualCatalog: StudioManualCatalog = {},
): ProductionFlowNodeSkill[] {
  return [
    buildNodeSkill("production_execution_storyboard_panel"),
    buildNodeSkill("production_execution_storyboard_gen"),
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "director_storyboard",
      role: "visual-storyboard",
      labelPrefix: "视觉风格分镜提示词技法",
      fallback: "当前视觉风格未提供分镜提示词技法模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "art_storyboard_video",
      role: "visual-video",
      labelPrefix: "视觉风格视频提示词",
      fallback: "当前视觉风格未提供视频提示词模块",
    }),
    buildManualNodeSkill({
      manual: resolveProductionManual(manualCatalog),
      moduleKey: "storyboard_prompt_techniques",
      role: "production-technique",
      labelPrefix: "通用分镜提示词技法",
      fallback: "当前制作技法未提供分镜提示词模块",
    }),
  ].filter((skill): skill is ProductionFlowNodeSkill => Boolean(skill));
}

function buildSelectedDirectorSkillModules(
  workflowConfig: ProductionFlowModelInput["workflowConfig"],
  manualCatalog: StudioManualCatalog,
): ProductionFlowNodeSkill[] {
  return [
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "director_planning_style",
      role: "visual-style",
      labelPrefix: "视觉风格导演规划",
      fallback: "当前视觉风格未提供导演规划模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "director_storyboard",
      role: "visual-storyboard",
      labelPrefix: "视觉风格分镜提示词技法",
      fallback: "当前视觉风格未提供分镜提示词技法模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("visual", workflowConfig?.visualManualId, manualCatalog),
      moduleKey: "director_storyboard_table_style",
      role: "visual-storyboard-table",
      labelPrefix: "视觉风格分镜表技法",
      fallback: "当前视觉风格未提供分镜表技法模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("director", workflowConfig?.directorManualId, manualCatalog),
      moduleKey: "director_planning_narrative",
      role: "director-narrative",
      labelPrefix: "题材导演规划",
      fallback: "当前题材导演手册未提供导演规划模块",
    }),
    buildManualNodeSkill({
      manual: resolveManual("director", workflowConfig?.directorManualId, manualCatalog),
      moduleKey: "director_storyboard_table_narrative",
      role: "director-storyboard-table",
      labelPrefix: "题材分镜表技法",
      fallback: "当前题材导演手册未提供分镜表技法模块",
    }),
  ].filter((skill): skill is ProductionFlowNodeSkill => Boolean(skill));
}

function resolveManual(
  kind: "visual" | "director",
  id: string | undefined,
  manualCatalog: StudioManualCatalog,
): StudioManualPreset | null {
  if (!id) return null;
  return manualCatalog[kind]?.find((manual) => manual.id === id) ?? getStudioManualPreset(kind, id);
}

function resolveProductionManual(manualCatalog: StudioManualCatalog): StudioManualPreset | null {
  return manualCatalog.production?.[0] ?? getStudioManualPreset("production", "toonflow-production");
}

function buildManualNodeSkill(input: {
  manual: StudioManualPreset | null;
  moduleKey: string;
  role: Exclude<ProductionFlowNodeSkill["role"], "base">;
  labelPrefix: string;
  fallback: string;
}): ProductionFlowNodeSkill | undefined {
  if (!input.manual) return undefined;
  const content = input.manual.modules[input.moduleKey] ?? "";
  return {
    id: `${input.manual.id}/${input.moduleKey}`,
    name: `${input.labelPrefix} · ${input.manual.name}`,
    source: input.manual.source,
    role: input.role,
    summaryLines: previewTextLines(stripFrontmatter(content), input.fallback, 8),
  };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, "").trim();
}

function previewTextLines(
  text: string,
  fallback: string,
  maxLines = 6,
): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  return lines.length ? lines : [fallback];
}


