import type {
  AgentWorkData,
  EntityExtractionResult,
  ImageWorkflowTarget,
  ProductionTrack,
  ScriptPlan,
  StudioManualPreset,
  StudioWorkflowConfig,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { StudioAssetKind, StudioAssetSummary } from "@/types/studio-assets";
import {
  buildStudioFlowData,
  type StudioFlowData,
} from "@/lib/studio/studio-flow-data";
import {
  type StudioManualCatalog,
  getAgentSkillPreset,
  getStudioManualPreset,
} from "@/lib/studio/manuals";
import { parseStoryboardTable } from "@/lib/studio/storyboard-table";

export const PRODUCTION_FLOW_NODE_IDS = [
  "script",
  "scriptPlan",
  "assets",
  "storyboardTable",
  "storyboard",
  "workbench",
] as const;

const DIRECTOR_PLAN_PREVIEW_MAX_LINES = 600;

export type ProductionFlowNodeId = (typeof PRODUCTION_FLOW_NODE_IDS)[number];
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
    | "workbench-lanes";
  tableRows?: ProductionFlowTableRow[];
  storyboardTiles?: ProductionFlowStoryboardTile[];
  assetGroups?: ProductionFlowAssetGroup[];
  assetSummary?: ProductionFlowAssetSummary;
  workbenchTracks?: ProductionFlowWorkbenchTrack[];
  finalExportPath?: string;
  skills?: ProductionFlowNodeSkill[];
  skill?: ProductionFlowNodeSkill;
  actions?: ProductionFlowNodeAction[];
  targetStage: ProductionFlowStage;
}

export interface ProductionFlowNodeAction {
  id:
    | "generate-director-plan"
    | "rebuild-workbench-tracks"
    | "generate-storyboard-table";
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

export interface ProductionFlowTableRow {
  index: number;
  title: string;
  titleEn: string;
  description: string;
  scene: string;
  associateAssetsNames: string[];
  duration: number;
  shotSize: string;
  cameraMove: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  emotion: string;
  lines: string;
  sound: string;
  associateAssetsIds: string[];
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
  ["storyboard", "workbench"],
] as const satisfies readonly (readonly [
  ProductionFlowNodeId,
  ProductionFlowNodeId,
])[];

export interface ProductionFlowModelInput {
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  workflowConfig?: Pick<StudioWorkflowConfig, "visualManualId" | "directorManualId">;
  manualCatalog?: StudioManualCatalog;
  assetMediaById?: Record<string, ProductionFlowAssetMedia | undefined>;
  fileExists?: (filePath: string) => boolean;
}

export interface ProductionFlowModel {
  nodes: ProductionFlowNodeModel[];
  edges: typeof PRODUCTION_FLOW_EDGES;
}

export function buildProductionFlowModel(
  input: ProductionFlowModelInput,
): ProductionFlowModel {
  const flowData = buildStudioFlowData(input);
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
  const readyCandidateCount = input.videoCandidates.filter(
    (item) => item.state === "ready" && item.filePath,
  ).length;
  const finalExportReady = Boolean(flowData.workbench.finalExportPath);
  const storyboardPreview = flowData.storyboard.slice(0, 4).map((item) =>
    [
      `#${item.id}`,
      `${item.duration}s`,
      item.videoDesc || item.prompt || item.lines || "未填写分镜内容",
    ].join(" · "),
  );
  const storyboardTiles = input.storyboards
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
  const workbenchPreview = flowData.workbench.tracks.slice(0, 4).map((track) =>
    [
      track.id,
      `${track.duration}s`,
      track.state,
      `${track.medias.length} medias`,
      `${track.videoList.length} videos`,
    ].join(" · "),
  );
  const workbenchPreviewLines = [
    ...workbenchPreview,
    ...(flowData.workbench.finalExportPath
      ? [`成片 · ${flowData.workbench.finalExportPath}`]
      : []),
  ];
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
        status: input.storyboards.length > 0 ? "ready" : "empty",
        metrics: input.storyboards.length
          ? [
              `${input.storyboards.length} 个分镜`,
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
        actions: [
          {
            id: "rebuild-workbench-tracks",
            label: "重建视频轨道",
            targetStage: "workbench",
            disabled: input.storyboards.length === 0,
          },
        ],
        targetStage: "storyboard",
      },
      {
        id: "workbench",
        label: "视频工作台",
        description: "候选片段、剪辑合成和最终导出。",
        status: finalExportReady
          ? "ready"
          : readyCandidateCount > 0
            ? "pending"
            : "empty",
        metrics: input.productionTracks.length
          ? [
              `${input.productionTracks.length} 条轨道`,
              `${readyCandidateCount} 个候选`,
              finalExportReady ? "已导出成片" : "待导出成片",
            ]
          : ["待重建轨道"],
        previewTitle: "视频工作台",
        previewLines: workbenchPreviewLines.length
          ? workbenchPreviewLines
          : ["暂无 track、候选视频和导出成片"],
        previewKind: "workbench-lanes",
        workbenchTracks,
        finalExportPath: flowData.workbench.finalExportPath,
        targetStage: "workbench",
      },
    ],
    edges: PRODUCTION_FLOW_EDGES,
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

function buildAssetDerivationModel(
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  scriptPlans: ScriptPlan[],
  assetMediaById: ProductionFlowModelInput["assetMediaById"] = {},
): { groups: ProductionFlowAssetGroup[]; summary: ProductionFlowAssetSummary } {
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const mediaLookup = new Map<string, ProductionFlowAssetMedia>();
  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
  }
  for (const media of Object.values(assetMediaById)) {
    if (!media) continue;
    indexAssetMedia(mediaLookup, media);
  }

  const derivedByParent = new Map<string, ProductionFlowAssetCard[]>();
  const derivedKeys = new Set<string>();
  const summary: ProductionFlowAssetSummary = {
    planned: 0,
    existing: 0,
    linked: 0,
    completed: 0,
    missingParent: 0,
  };
  const existingMediaIds = new Set<string>();
  const countExistingDerivedMedia = (media: ProductionFlowAssetMedia | undefined) => {
    if (!media || existingMediaIds.has(media.id)) return;
    existingMediaIds.add(media.id);
    summary.existing += 1;
  };
  for (const plan of scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      summary.planned += 1;
      const parent = resolvePlannedDerivedParent(item, assetLookup, assets, mediaLookup);
      if (!parent) {
        summary.missingParent += 1;
        continue;
      }
      summary.linked += 1;
      const media = resolveDerivedAssetMedia(item, parent, mediaLookup);
      const sourceMedia = resolveAssetMedia(parent, mediaLookup);
      const mediaPath = media?.path;
      countExistingDerivedMedia(media);
      if (mediaPath) summary.completed += 1;
      const derived: ProductionFlowAssetCard = {
        id: `${parent.id}:${item.state}`,
        name: item.state,
        typeLabel: typeLabelForAsset(parent.type),
        runtimeType: runtimeTypeForAsset(parent.type),
        mediaPath,
        state: item.state,
        reason: media?.reason || item.reason,
        parentAssetId: parent.id,
        prompt: media?.prompt || `${item.state}：${item.reason}`.trim(),
        generationState: mediaPath ? "已完成" : "未生成",
        isDerived: true,
        sourceImagePath: sourceMedia?.path,
        imageWorkflowId: media?.imageWorkflowId || item.imageWorkflowId,
        imageWorkflowTarget:
          media?.imageWorkflowTarget ?? {
            kind: "asset",
            assetType: assetWorkflowTargetTypeForAsset(parent.type),
            parentId: parent.id,
            id: media?.id || `${parent.id}:${item.state}`,
          },
      };
      addDerivedAssetCard(derivedByParent, derivedKeys, parent.id, derived);
    }
  }

  for (const media of uniqueAssetMedia(Object.values(assetMediaById))) {
    if (!media.parentAssetId && !media.parentAssetName) continue;
    const parent = resolveParentAssetForMedia(media, assets, mediaLookup);
    if (!parent) continue;
    const sourceMedia = resolveAssetMedia(parent, mediaLookup);
    const derived: ProductionFlowAssetCard = {
      id: media.id,
      name: media.state || media.name,
      typeLabel: typeLabelForAsset(parent.type),
      runtimeType: runtimeTypeForAsset(parent.type),
      mediaPath: media.path,
      state: media.state || media.name,
      reason: media.reason || media.prompt,
      parentAssetId: parent.id,
      prompt: media.prompt,
      generationState: media.path ? "已完成" : "未生成",
      isDerived: true,
      sourceImagePath: sourceMedia?.path,
      imageWorkflowId: media.imageWorkflowId,
      imageWorkflowTarget:
        media.imageWorkflowTarget ?? {
          kind: "asset",
          assetType: assetWorkflowTargetTypeForAsset(parent.type),
          parentId: parent.id,
          id: media.id,
        },
    };
    if (addDerivedAssetCard(derivedByParent, derivedKeys, parent.id, derived)) {
      countExistingDerivedMedia(media);
      summary.linked += 1;
      if (media.path) summary.completed += 1;
    }
  }

  const groups = assets.map<ProductionFlowAssetGroup>((asset) => {
    const media = resolveAssetMedia(asset, mediaLookup);
    const mediaPath = media?.path;
    return {
      source: {
        id: asset.id,
        name: asset.name,
        typeLabel: typeLabelForAsset(asset.type),
        runtimeType: runtimeTypeForAsset(asset.type),
        mediaPath,
        note: asset.note,
        prompt: media?.prompt,
        generationState: mediaPath ? "已完成" : "未生成",
        isDerived: false,
      },
      derived: derivedByParent.get(asset.id) ?? [],
    };
  });
  return { groups, summary };
}

function indexAssetMedia(
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
  media: ProductionFlowAssetMedia,
) {
  const aliases = [
    media.id,
    media.name,
    media.state,
    media.toonflowAssetId == null ? undefined : String(media.toonflowAssetId),
    media.toonflowAssetId == null ? undefined : `toonflow-db:${media.toonflowAssetId}`,
    media.parentAssetId && media.state
      ? `${media.parentAssetId}:${media.state}`
      : undefined,
    media.parentAssetId && media.name
      ? `${media.parentAssetId}:${media.name}`
      : undefined,
    media.parentAssetId && media.state
      ? `${media.parentAssetId}·${media.state}`
      : undefined,
    media.parentAssetId && media.name
      ? `${media.parentAssetId}·${media.name}`
      : undefined,
    media.parentAssetName && media.state
      ? `${media.parentAssetName}:${media.state}`
      : undefined,
    media.parentAssetName && media.name
      ? `${media.parentAssetName}:${media.name}`
      : undefined,
    media.parentAssetName && media.state
      ? `${media.parentAssetName}·${media.state}`
      : undefined,
    media.parentAssetName && media.name
      ? `${media.parentAssetName}·${media.name}`
      : undefined,
    media.toonflowParentAssetId != null && media.state
      ? `${media.toonflowParentAssetId}:${media.state}`
      : undefined,
    media.toonflowParentAssetId != null && media.name
      ? `${media.toonflowParentAssetId}:${media.name}`
      : undefined,
    media.toonflowParentAssetId != null && media.state
      ? `toonflow-db:${media.toonflowParentAssetId}:${media.state}`
      : undefined,
    media.toonflowParentAssetId != null && media.name
      ? `toonflow-db:${media.toonflowParentAssetId}:${media.name}`
      : undefined,
  ].filter((alias): alias is string => Boolean(alias?.trim()));
  for (const alias of aliases) {
    mediaLookup.set(alias, media);
  }
}

function resolvePlannedDerivedParent(
  item: ScriptPlan["derivedAssetPlan"][number],
  assetLookup: Map<string, ReturnType<typeof buildStudioFlowData>["assets"][number]>,
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  const direct = assetLookup.get(item.parentAssetId);
  if (direct) return direct;

  const parentMedia = [
    item.toonflowAssetsId == null ? undefined : mediaLookup.get(String(item.toonflowAssetsId)),
    item.toonflowAssetsId == null ? undefined : mediaLookup.get(`toonflow-db:${item.toonflowAssetsId}`),
    mediaLookup.get(item.parentAssetId),
  ].find(Boolean);
  if (!parentMedia) return undefined;

  return assets.find((asset) => {
    const assetMedia = resolveAssetMedia(asset, mediaLookup);
    return [
      asset.id,
      asset.name,
      assetMedia?.id,
      assetMedia?.name,
      assetMedia?.toonflowAssetId == null ? undefined : String(assetMedia.toonflowAssetId),
      assetMedia?.toonflowAssetId == null ? undefined : `toonflow-db:${assetMedia.toonflowAssetId}`,
    ].includes(parentMedia.id) || [
      asset.id,
      asset.name,
      assetMedia?.id,
      assetMedia?.name,
    ].includes(parentMedia.name);
  });
}

function uniqueAssetMedia(
  values: Array<ProductionFlowAssetMedia | undefined>,
): ProductionFlowAssetMedia[] {
  const seen = new Set<string>();
  const unique: ProductionFlowAssetMedia[] = [];
  for (const media of values) {
    if (!media || seen.has(media.id)) continue;
    seen.add(media.id);
    unique.push(media);
  }
  return unique;
}

function addDerivedAssetCard(
  derivedByParent: Map<string, ProductionFlowAssetCard[]>,
  derivedKeys: Set<string>,
  parentId: string,
  derived: ProductionFlowAssetCard,
) {
  const key = `${parentId}:${derived.id}:${derived.name}`;
  const stateKey = `${parentId}:${derived.name}`;
  if (derivedKeys.has(key) || derivedKeys.has(stateKey)) return false;
  derivedKeys.add(key);
  derivedKeys.add(stateKey);
  derivedByParent.set(parentId, [
    ...(derivedByParent.get(parentId) ?? []),
    derived,
  ]);
  return true;
}

function resolveAssetMedia(
  asset: ReturnType<typeof buildStudioFlowData>["assets"][number],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  return mediaLookup.get(asset.id) ?? mediaLookup.get(asset.name);
}

function resolveParentAssetForMedia(
  media: ProductionFlowAssetMedia,
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  return assets.find((asset) => {
    const parentMedia = resolveAssetMedia(asset, mediaLookup);
    return [
      asset.id,
      asset.name,
      parentMedia?.id,
      parentMedia?.name,
    ].includes(media.parentAssetId) || [
      asset.id,
      asset.name,
      parentMedia?.id,
      parentMedia?.name,
    ].includes(media.parentAssetName);
  });
}

function typeLabelForAsset(type: ReturnType<typeof buildStudioFlowData>["assets"][number]["type"]) {
  return type === "character" ? "角色" : type === "scene" ? "场景" : "道具";
}

function runtimeTypeForAsset(type: ReturnType<typeof buildStudioFlowData>["assets"][number]["type"]) {
  return type === "character" ? "role" : type === "scene" ? "scene" : "tool";
}

function resolveDerivedAssetMedia(
  item: ScriptPlan["derivedAssetPlan"][number],
  parent: ReturnType<typeof buildStudioFlowData>["assets"][number],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  return (
    mediaLookup.get(`${parent.id}:${item.state}`) ??
    mediaLookup.get(`${parent.id}·${item.state}`) ??
    mediaLookup.get(`${parent.name}:${item.state}`) ??
    mediaLookup.get(`${parent.name}·${item.state}`) ??
    (item.toonflowAssetsId == null ? undefined : mediaLookup.get(`${item.toonflowAssetsId}:${item.state}`)) ??
    (item.toonflowAssetsId == null ? undefined : mediaLookup.get(`toonflow-db:${item.toonflowAssetsId}:${item.state}`)) ??
    mediaLookup.get(item.state)
  );
}

export function buildAssetLibraryMatchNamesForProductionFlow(input: {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
}): Record<ProductionFlowRuntimeAssetKind, string[]> {
  const assets = buildStudioFlowData({
    agentWorkData: [],
    entityExtractions: input.entityExtractions,
    scriptPlans: [],
    storyboards: [],
    productionTracks: [],
    videoCandidates: [],
  }).assets;
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const names: Record<ProductionFlowRuntimeAssetKind, Set<string>> = {
    role: new Set(),
    scene: new Set(),
    tool: new Set(),
  };

  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
    names[runtimeTypeForAsset(asset.type)].add(asset.name);
  }

  for (const plan of input.scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      const parent = assetLookup.get(item.parentAssetId);
      if (parent) {
        names[runtimeTypeForAsset(parent.type)].add(item.state);
        continue;
      }
      if (item.toonflowAssetsId == null) continue;
      for (const asset of assets) {
        names[runtimeTypeForAsset(asset.type)].add(item.state);
      }
    }
  }

  return {
    role: [...names.role],
    scene: [...names.scene],
    tool: [...names.tool],
  };
}

export function buildAssetLibraryMediaMapForProductionFlow(input: {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  matchesByType: ProductionFlowAssetLibraryMatches;
}): Record<string, ProductionFlowAssetMedia> {
  const assets = buildStudioFlowData({
    agentWorkData: [],
    entityExtractions: input.entityExtractions,
    scriptPlans: [],
    storyboards: [],
    productionTracks: [],
    videoCandidates: [],
  }).assets;
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const entries: Record<string, ProductionFlowAssetMedia> = {};

  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
    const media = studioAssetSummaryToMedia(
      findAssetLibraryMatch(
        input.matchesByType,
        runtimeTypeForAsset(asset.type),
        asset.name,
      ),
      {
        id: asset.id,
        name: asset.name,
      },
    );
    if (!media) continue;
    entries[asset.id] = media;
    entries[asset.name] = media;
  }

  for (const plan of input.scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      const parent = assetLookup.get(item.parentAssetId);
      if (!parent) {
        if (item.toonflowAssetsId == null) continue;
        for (const kind of ["role", "scene", "tool"] as const) {
          const numericMedia = studioAssetSummaryToMedia(
            findAssetLibraryMatch(input.matchesByType, kind, item.state),
            {
              id: `toonflow-db:${item.toonflowAssetsId}:${item.state}`,
              name: item.state,
              parentAssetId: `toonflow-db:${item.toonflowAssetsId}`,
              state: item.state,
              reason: item.reason,
              imageWorkflowId: item.imageWorkflowId,
              toonflowParentAssetId: item.toonflowAssetsId,
              imageWorkflowTarget: {
                kind: "asset",
                assetType:
                  kind === "role" ? "character" : kind === "tool" ? "prop" : "scene",
                parentId: `toonflow-db:${item.toonflowAssetsId}`,
              },
            },
          );
          if (!numericMedia) continue;
          entries[`${item.toonflowAssetsId}:${item.state}`] = numericMedia;
          entries[`toonflow-db:${item.toonflowAssetsId}:${item.state}`] = numericMedia;
        }
        continue;
      }
      const media = studioAssetSummaryToMedia(
        findAssetLibraryMatch(
          input.matchesByType,
          runtimeTypeForAsset(parent.type),
          item.state,
        ),
        {
          id: `${parent.id}:${item.state}`,
          name: item.state,
          parentAssetId: parent.id,
          parentAssetName: parent.name,
          state: item.state,
          reason: item.reason,
          imageWorkflowTarget: {
            kind: "asset",
            assetType: assetWorkflowTargetTypeForAsset(parent.type),
            parentId: parent.id,
          },
        },
      );
      if (!media) continue;
      entries[`${parent.id}:${item.state}`] = media;
      entries[`${parent.id}·${item.state}`] = media;
      entries[`${parent.name}:${item.state}`] = media;
      entries[`${parent.name}·${item.state}`] = media;
    }
  }

  return entries;
}

function assetWorkflowTargetTypeForAsset(
  type: StudioFlowData["assets"][number]["type"],
) {
  return type === "character" ? "character" : type === "prop" ? "prop" : "scene";
}

function findAssetLibraryMatch(
  matchesByType: ProductionFlowAssetLibraryMatches,
  kind: ProductionFlowRuntimeAssetKind,
  name: string,
) {
  return matchesByType[kind]?.[name.trim()] ?? null;
}

function studioAssetSummaryToMedia(
  asset: StudioAssetSummary | null | undefined,
  fallback: Pick<ProductionFlowAssetMedia, "id" | "name"> &
    Partial<ProductionFlowAssetMedia>,
): ProductionFlowAssetMedia | null {
  if (!asset) return null;
  const path = getStudioAssetPreviewPath(asset);
  if (!path) return null;
  const imageWorkflowTarget = fallback.imageWorkflowTarget
    ? { ...fallback.imageWorkflowTarget, id: fallback.imageWorkflowTarget.id || asset.id }
    : undefined;
  return {
    id: fallback.id,
    name: fallback.name,
    path,
    prompt:
      asset.prompt ||
      asset.description ||
      asset.setting ||
      asset.remark ||
      fallback.prompt,
    parentAssetId: fallback.parentAssetId || asset.parentAssetId,
    parentAssetName: fallback.parentAssetName || asset.parentAssetName,
    state: fallback.state || asset.state,
    reason: fallback.reason || asset.description || asset.remark,
    imageWorkflowId: asset.imageWorkflowId || fallback.imageWorkflowId,
    imageWorkflowTarget,
    toonflowAssetId: asset.toonflowAssetId ?? fallback.toonflowAssetId,
    toonflowParentAssetId: asset.toonflowParentAssetId ?? fallback.toonflowParentAssetId,
  };
}

function getStudioAssetPreviewPath(asset: StudioAssetSummary) {
  return (
    asset.thumbnailUrl ||
    asset.previewUrl ||
    asset.images?.find((image) => image.url || image.filePath)?.url ||
    asset.images?.find((image) => image.url || image.filePath)?.filePath ||
    asset.filePath ||
    asset.sourcePath
  );
}

function parseStoryboardPreviewRows(text: string): ProductionFlowTableRow[] {
  if (!text.trim()) return [];
  const parsed = parseStoryboardTable(text, "preview");
  if (parsed.rows.length) {
    return parsed.rows.map((row) => ({
      index: row.index,
      title: buildStoryboardRowTitle(row.description, row.index),
      titleEn: `shot-${String(row.index).padStart(3, "0")}`,
      description: row.description,
      scene: row.scene,
      associateAssetsNames: row.associateAssetsNames,
      duration: row.duration,
      shotSize: row.shotSize,
      cameraMove: row.cameraMove,
      action: row.action,
      orientation: row.orientation,
      spatialRelation: row.spatialRelation,
      emotion: row.emotion,
      lines: row.lines,
      sound: row.sound,
      associateAssetsIds: row.associateAssetsIds,
    }));
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line, index) => {
      const fields = line.slice(1, -1).split("|").map((item) => item.trim());
      return {
        index: Number.parseInt(fields[0] ?? "", 10) || index + 1,
        title: buildStoryboardRowTitle(fields[1] ?? "", index + 1),
        titleEn: `shot-${String(index + 1).padStart(3, "0")}`,
        description: fields[1] ?? "",
        scene: fields[2] ?? "",
        associateAssetsNames: splitPreviewList(fields[3] ?? ""),
        duration: Number.parseInt(fields[4] ?? "", 10) || 0,
        shotSize: fields[5] ?? "",
        cameraMove: fields[6] ?? "",
        action: fields[7] ?? "",
        orientation: fields[8] ?? "",
        spatialRelation: fields[9] ?? "",
        emotion: fields[10] ?? "",
        lines: fields[11] ?? "",
        sound: fields[12] ?? "",
        associateAssetsIds: splitPreviewList(fields[13] ?? ""),
      };
    });
}

function buildStoryboardRowTitle(description: string, index: number): string {
  const text = description.trim();
  if (!text) return `分镜 ${index}`;
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function splitPreviewList(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[，,、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
