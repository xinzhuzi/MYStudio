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
  const directorPlanSkill = buildNodeSkill("production_execution_director_plan");
  const directorPlanSkills = buildDirectorPlanSkills(
    input.workflowConfig,
    input.manualCatalog,
  );
  const storyboardTableSkills = buildStoryboardTableSkills(
    input.workflowConfig,
    input.manualCatalog,
  );
  const storyboardSkills = buildStoryboardSkills(
    input.workflowConfig,
    input.manualCatalog,
  );
  const scriptDrafts = input.agentWorkData.filter(
    (item) => item.key === "scriptDraft" && item.data.trim(),
  );
  const scriptChars = flowData.script.length;
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
  const assetGroups = assetDerivation.groups;
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
  const assetPreviewLines = assetGroups.slice(0, 18).flatMap((group) => [
    `${group.source.typeLabel} · ${group.source.name}${group.source.note ? ` · ${group.source.note}` : ""}`,
    ...group.derived.map((item) => `衍生 · ${item.name}${item.reason ? ` · ${item.reason}` : ""}`),
  ]);
  const storyboardTableRows = parseStoryboardPreviewRows(
    flowData.storyboardTable,
  );
  const visualStoryboardCount = flowData.storyboard.filter(
    (item) => item.mediaPath,
  ).length;
  const rendererSummary = normalizeRemotionRendererSummary(input.rendererSummary);
  const remotionFinalExportReady = rendererSummary.actual === "remotion"
    && Boolean(rendererSummary.outputPath);
  const storyboardPreview = flowData.storyboard.slice(0, 4).map((item) =>
    [
      `#${item.id}`,
      `${item.duration}s`,
      item.videoDesc || item.prompt || item.lines || "未填写分镜内容",
    ].join(" · "),
  );
  const storyboardTiles = chapterStoryboards
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
    }));
  const workbenchTracks = flowData.workbench.tracks
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
    }));
  const remotionJobs = input.remotionQueueJobs ?? [];
  const shotJobs = new Map(
    remotionJobs
      .filter((job): job is RemotionRenderJobV1 & { target: { kind: "shot" } } => job.target.kind === "shot")
      .map((job) => [job.target.shotId, job]),
  );
  const currentSlotByShotId = new Map(
    remotionShotSlots.map((slot) => [slot.target.kind === "shot" ? slot.target.shotId : "", slot] as const),
  );
  const remotionShots = chapterStoryboards
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
  const remotionSummary = summarizeRemotionShots(
    remotionShots,
    input.remotionQueueLoading,
    input.remotionQueueError,
  );
  return {
    nodes: [
      {
        id: "script",
        label: "剧本",
        description: "章节剧本与正文台词输入。",
        status: scriptDrafts.length > 0 ? "ready" : "empty",
        metrics: scriptDrafts.length ? [`${scriptChars} 字`] : [],
        previewTitle: "剧本内容",
        previewLines: previewTextLines(flowData.script, "暂无剧本内容", 220),
        targetStage: "script",
      },
      {
        id: "scriptPlan",
        label: "导演规划",
        description: "场次、节奏、镜头策略和声音方向。",
        status: input.scriptPlans.length > 0 ? "ready" : "empty",
        metrics: input.scriptPlans.length
          ? [`${input.scriptPlans.length} 份规划`]
          : ["待运行导演规划"],
        previewTitle: "导演规划",
        previewLines: previewTextLines(
          flowData.scriptPlan,
          "暂无导演规划",
          DIRECTOR_PLAN_PREVIEW_MAX_LINES,
        ),
        skill: directorPlanSkill,
        skills: directorPlanSkills,
        actions: [
          {
            id: "generate-director-plan",
            label: input.scriptPlans.length > 0 ? "重新生成导演规划" : "生成导演规划",
            targetStage: "storyboard",
            disabled: scriptDrafts.length === 0,
            promptPlaceholder:
              "给导演规划补充要求，例如：节奏更压迫、保留所有对白、突出雨夜和断剑意象。",
          },
        ],
        targetStage: "storyboard",
      },
      {
        id: "assets",
        label: "衍生资产",
        description: "从剧本抽取角色、场景、道具，并作为分镜画面引用。",
        status: assetCounts.total > 0 ? "ready" : "empty",
        metrics: assetMetrics,
        previewTitle: "剧本资产",
        previewLines: assetPreviewLines.length
          ? assetPreviewLines
          : ["暂无角色、场景、道具资产"],
        previewKind: "asset-derivation",
        assetGroups,
        assetSummary: assetDerivation.summary,
        targetStage: "assets",
      },
      {
        id: "storyboardTable",
        label: "分镜表",
        description: "按导演规划拆出镜头表。",
        status: storyboardTableCount > 0 ? "ready" : "empty",
        metrics: storyboardTableCount
          ? [`${storyboardTableCount} 份分镜表`]
          : ["待生成分镜表"],
        previewTitle: "分镜表",
        previewLines: previewTextLines(flowData.storyboardTable, "暂无分镜表"),
        previewKind: "table",
        tableRows: storyboardTableRows,
        skills: storyboardTableSkills,
        actions: [
          {
            id: "generate-storyboard-table",
            label: storyboardTableCount > 0 ? "重新生成分镜表" : "生成分镜表",
            targetStage: "storyboard",
            disabled: input.scriptPlans.length === 0,
            promptPlaceholder:
              "给分镜表补充要求，例如：每镜约 5 秒、台词不丢、道具和角色资产必须进入镜头。",
          },
        ],
        targetStage: "storyboard",
      },
      {
        id: "storyboard",
        label: "分镜面板",
        description: "分镜图、台词、配音与视频节点绑定。",
        status: chapterStoryboards.length > 0 ? "ready" : "empty",
        metrics: chapterStoryboards.length
          ? [
              `${chapterStoryboards.length} 个分镜`,
              `${visualStoryboardCount} 个画面`,
            ]
          : ["待生成分镜"],
        previewTitle: "分镜面板",
        previewLines: storyboardPreview.length
          ? storyboardPreview
          : ["暂无分镜图、台词和音频绑定"],
        previewKind: "storyboard-grid",
        storyboardTiles,
        skills: storyboardSkills,
        actions: [],
        targetStage: "storyboard",
      },
      {
        id: "remotionProduction",
        label: "Remotion 视频生产",
        description: "将当前章节的每个分镜分别生成 StoryboardShot MP4；全部通过后才能进入章节工作台。",
        status: remotionSummary.failed || remotionSummary.blocked
          ? "warning"
          : remotionSummary.running || remotionSummary.queued
            ? "pending"
            : remotionSummary.chapterReady
              ? "ready"
              : "empty",
        metrics: [
          "Remotion renderer",
          `${remotionSummary.succeeded}/${remotionSummary.total} 个分镜 MP4`,
          ...(remotionSummary.running ? [`渲染中 ${remotionSummary.running}`] : []),
          ...(remotionSummary.failed ? [`失败 ${remotionSummary.failed}`] : []),
          ...(remotionSummary.blocked ? [`阻塞 ${remotionSummary.blocked}`] : []),
        ],
        previewTitle: "逐镜 Remotion 队列",
        previewLines: remotionShots.length
          ? remotionShots.slice(0, 6).map((shot) => `${String(shot.index).padStart(2, "0")} · ${shot.status} · ${Math.round(shot.progress * 100)}% · ${shot.title}`)
          : ["等待分镜面板提供当前章节的分镜"],
        previewKind: "remotion-shots",
        remotionShots,
        remotionSummary,
        actions: [
          {
            id: "enqueue-remotion-shots",
            label: remotionSummary.chapterReady
              ? "分镜视频已完成"
              : remotionSummary.running || remotionSummary.queued
                ? "Remotion 生产中"
                : "生成当前章分镜视频",
            targetStage: "workbench",
            disabled: chapterStoryboards.length === 0 || remotionSummary.chapterReady || Boolean(remotionSummary.running || remotionSummary.queued),
            showPromptInput: false,
          },
        ],
        targetStage: "workbench",
      },
      {
        id: "workbench",
        label: "Remotion 视频工作台",
        description: "加载当前章节的原生 Remotion Studio，进行时间线预览、剪辑和章节导出。",
        status: remotionSummary.chapterReady || remotionFinalExportReady
          ? "ready"
          : remotionSummary.succeeded > 0
            ? "pending"
            : "empty",
        metrics: [
          "原生 Remotion Studio",
          `${remotionSummary.succeeded}/${remotionSummary.total} 个分镜已就绪`,
          rendererSummary.actual
            ? `${formatRendererLabel(rendererSummary.lastRequested ?? rendererSummary.requested)} → ${formatRendererLabel(rendererSummary.actual)}`
            : "章节成片待渲染",
          remotionFinalExportReady ? "已导出章节成片" : "等待 ChapterVideo",
        ],
        previewTitle: "原生 Remotion Studio",
        previewLines: [
          `章节工作台 · ${remotionSummary.chapterReady ? "可进入" : "等待全部分镜成功"}`,
          `${remotionSummary.succeeded}/${remotionSummary.total} StoryboardShot MP4 已就绪`,
          "Studio Timeline / Preview / Inspector / Render",
          ...(rendererSummary.outputPath ? [`ChapterVideo · ${rendererSummary.outputPath}`] : []),
        ],
        previewKind: "workbench-lanes",
        workbenchTracks,
        finalExportPath: flowData.workbench.finalExportPath,
        rendererSummary,
        remotionSummary,
        targetStage: "workbench",
      },
    ],
    edges: PRODUCTION_FLOW_EDGES,
    remotionShotSlots,
  };
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


