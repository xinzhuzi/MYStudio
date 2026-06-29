import type {
  AgentWorkData,
  EntityExtractionResult,
  ProductionTrack,
  ScriptPlan,
  StudioManualPreset,
  StudioWorkflowConfig,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import { buildStudioFlowData } from "@/lib/studio/studio-flow-data";
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

export type ProductionFlowNodeId = (typeof PRODUCTION_FLOW_NODE_IDS)[number];
export type ProductionFlowStage =
  | "script"
  | "assets"
  | "generation"
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
  previewKind?: "text" | "table" | "storyboard-grid" | "asset-derivation";
  tableRows?: ProductionFlowTableRow[];
  storyboardTiles?: ProductionFlowStoryboardTile[];
  assetGroups?: ProductionFlowAssetGroup[];
  skills?: ProductionFlowNodeSkill[];
  skill?: ProductionFlowNodeSkill;
  actions?: ProductionFlowNodeAction[];
  targetStage: ProductionFlowStage;
}

export interface ProductionFlowNodeAction {
  id: "generate-director-plan" | "generate-storyboard-table";
  label: string;
  targetStage: ProductionFlowStage;
  disabled?: boolean;
  promptPlaceholder?: string;
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
}

export interface ProductionFlowAssetCard {
  id: string;
  name: string;
  typeLabel: string;
  mediaPath?: string;
  note?: string;
  state?: string;
  reason?: string;
  isDerived: boolean;
}

export interface ProductionFlowAssetGroup {
  source: ProductionFlowAssetCard;
  derived: ProductionFlowAssetCard[];
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
  assetMediaById?: Record<string, { id: string; name: string; path: string; prompt?: string } | undefined>;
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
  const assetGroups = buildAssetGroups(
    flowData.assets,
    input.scriptPlans,
    input.assetMediaById,
  );
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
    .slice(0, 24)
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
  return {
    nodes: [
      {
        id: "script",
        label: "剧本",
        description: "章节剧本与正文台词输入。",
        status: scriptDrafts.length > 0 ? "ready" : "empty",
        metrics: scriptDrafts.length
          ? ["当前剧本", `${scriptChars} 字`]
          : ["待生成剧本"],
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
        previewLines: previewTextLines(flowData.scriptPlan, "暂无导演规划", 80),
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
        metrics: assetCounts.total
          ? [
              `${assetCounts.total} 个资产`,
              `${assetCounts.character} 角色`,
              `${assetCounts.scene} 场景`,
              `${assetCounts.prop} 道具`,
            ]
          : ["待提取资产"],
        previewTitle: "剧本资产",
        previewLines: assetPreviewLines.length
          ? assetPreviewLines
          : ["暂无角色、场景、道具资产"],
        previewKind: "asset-derivation",
        assetGroups,
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

function buildAssetGroups(
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  scriptPlans: ScriptPlan[],
  assetMediaById: ProductionFlowModelInput["assetMediaById"] = {},
): ProductionFlowAssetGroup[] {
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const mediaLookup = new Map<string, NonNullable<ProductionFlowModelInput["assetMediaById"]>[string]>();
  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
  }
  for (const media of Object.values(assetMediaById)) {
    if (!media) continue;
    mediaLookup.set(media.id, media);
    mediaLookup.set(media.name, media);
  }

  const derivedByParent = new Map<string, ProductionFlowAssetCard[]>();
  for (const plan of scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      const parent = assetLookup.get(item.parentAssetId);
      if (!parent) continue;
      const derived: ProductionFlowAssetCard = {
        id: `${parent.id}:${item.state}`,
        name: item.state,
        typeLabel: typeLabelForAsset(parent.type),
        mediaPath: mediaLookup.get(item.state)?.path,
        state: item.state,
        reason: item.reason,
        isDerived: true,
      };
      derivedByParent.set(parent.id, [
        ...(derivedByParent.get(parent.id) ?? []),
        derived,
      ]);
    }
  }

  return assets.slice(0, 12).map((asset) => ({
    source: {
      id: asset.id,
      name: asset.name,
      typeLabel: typeLabelForAsset(asset.type),
      mediaPath: mediaLookup.get(asset.id)?.path ?? mediaLookup.get(asset.name)?.path,
      note: asset.note,
      isDerived: false,
    },
    derived: derivedByParent.get(asset.id) ?? [],
  }));
}

function typeLabelForAsset(type: ReturnType<typeof buildStudioFlowData>["assets"][number]["type"]) {
  return type === "character" ? "角色" : type === "scene" ? "场景" : "道具";
}

function parseStoryboardPreviewRows(text: string): ProductionFlowTableRow[] {
  if (!text.trim()) return [];
  const parsed = parseStoryboardTable(text, "preview");
  if (parsed.rows.length) {
    return parsed.rows.slice(0, 12).map((row) => ({
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
    .slice(1, 13)
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
