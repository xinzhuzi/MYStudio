// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 分镜流程链工作流生成器(旧分镜画布迁移,09-11):
 * 旧 React Flow 画布的七环节链(剧本→导演规划→[衍生资产]→分镜表→
 * 分镜面板→单镜视频生产→视频工作台)转成 ComfyUI 原生工作流(UI 格式):
 * 每环节一个 MyStage 锚点(标题+实时摘要+状态),MANYING_FLOW 连线
 * 串链;分镜网格(MyShot 总览)平移到链右侧——进分镜阶段打开即
 * 一张图看整条工作流+本章分镜。环节语义真源=workflow-node-model 族
 * (node-builders 的 label/status/metrics 降档映射,见任务 research)。
 */

import { buildStoryboardOverviewWorkflow, shotPreviewName } from "./storyboard-overview-comfy";
import { parseStoryboardTable } from "@/lib/studio/storyboard-table";
import { buildStudioFlowData, type StudioFlowData } from "@/lib/studio/studio-flow-data";
import type { StoryboardItem } from "@/types/studio";
import type { useStudioStore } from "@/stores/studio/studio-store";

/** 链布局(09-12 用户裁定:节点图横向摆放)——主线左→右横排,顶部对齐;
 * 衍生资产分支与分镜内容子图挂主线下方第二排,连线自然下探。
 * 正方形常理布局(09-13 用户裁定:正方形展示是故意的设计):引擎 syncSize
 * 恒强制环节节点 [540,760] 近正方形,布局一律按 hardMax 顶格步进——
 * 节点落位后内容再长高长宽都不可能与邻节点重叠。 */
const MAINLINE_Y = 60;
const STAGE_SQUARE = 600; // 标准正方形基准(引擎 CINEMA 代币 defaultSize 同源)
const STAGE_SQUARE_MAX = 760; // 引擎硬天花板(hardMax 同源)
const STAGE_GAP_X = 80;
const LOWER_ROW_GAP = 120; // 下排(资产分支/分镜子图)与主线的垂直间距
// 组框(主节点区):每环节一个组,子节点归入对应主节点组(09-12 用户裁定:
// 主节点+子节点层级,照旧画布的组织方式;ComfyUI 原生 groups,数据层零干预)
const GROUP_PAD = 20;
const SHOTS_PER_COLUMN = 10;
const SHOT_NODE_WIDTH = 360;
const SHOT_NODE_HEIGHT = 276; // 输入框退役(官方 hidden 位)=标题栏+缩略图带
const SHOT_COLUMN_GAP = 90;
const SHOT_ROW_GAP = 40;

/** 环节 key 与旧画布 ProductionFlowNodeId 一一对应(真源 schema) */
export type PipelineStageKey =
  | "script"
  | "scriptPlan"
  | "assets"
  | "storyboardTable"
  | "storyboard"
  | "remotionProduction"
  | "workbench";

export interface PipelineStageSummary {
  key: PipelineStageKey;
  title: string;
  summary: string;
  status: string;
}

/**
 * 环节节点富内容载荷 v2(09-12 stage-node-content-parity 用户终裁:内容一定
 * 要做好,像之前的 flow 画布一样——**全量内容**,非概览卡):正文完整换行展示
 * (仅 60 行画布物理上限+尾行指路)、分镜 tiles 带缩略图名、分镜表成表行、
 * 逐镜带视频/配音双状态、资产分组、轨道全列。写进 properties.myStage,
 * 引擎侧 manying.js 的 my.stage.render 自绘消费(照 MyShot 先例,
 * 不进 widgets_values=序列化契约稳定)。
 */
export interface StageNodePayload {
  key: PipelineStageKey;
  title: string;
  description: string;
  status: "ready" | "pending" | "empty" | "warning";
  statusText: string;
  metrics: string[];
  previewTitle?: string;
  /** 正文行(生成器已按节点宽换行;≤60 行,超限尾行指路阶段面板) */
  previewLines?: string[];
  /** 分镜 tiles(全量;preview=引擎 input 缩略图名 my-shot-*.jpg) */
  tiles?: { index: number; title: string; preview?: string; hasImage: boolean; hasVideo: boolean; lines?: string; state?: string }[];
  /** 分镜表行(照老画布表格预览全字段;解析自 storyboardTable 正文) */
  tableRows?: {
    index: number; scene: string; title: string; duration: number; shotSize: string;
    cameraMove: string; action: string; lines: string; sound: string; assets: string;
  }[];
  /** 逐镜队列(全量;视频/配音双状态照老画布 remotionShots) */
  shots?: {
    index: number; label: string;
    videoReady: boolean; imageReady: boolean; ttsReady: boolean; sfxReady: boolean;
    revision: number;
    /** 队列实时态(渲染层注入;running 带 progress 0~1,failed/blocked/queued) */
    status?: string;
    progress?: number;
  }[];
  /** 资产分组(照老画布资产预览:角色/场景/道具名全列) */
  assetGroups?: { characters: string[]; scenes: string[]; props: string[] };
  tracks?: { name: string; state: string; count: number; duration: number; mediaCount: number; videoCount?: number }[];
  finalExport?: boolean;
  /** 环节动作(09-12 功能完备:老画布节点按钮回流;paid=付费云端金色) */
  actions?: { kind: string; label: string; paid?: boolean; disabled?: boolean }[];
  /** 参与技能名(老画布 skills 徽标,09-12 v4 全量补全;组件层映射器喂入) */
  skills?: string[];
  /** 技能详情(09-13 用户裁定:技能胶囊可点开详情;与 skills 下标对齐) */
  skillDetails?: { name: string; source?: string; summary?: string[] }[];
  /** 进度对(09-13 用户裁定:要做多少/已做多少;total 缺省=纯计数) */
  progress?: { label: string; done: number; total?: number }[];
  /** 资产卡(老画布 assetGroups 卡片平铺;cover=本地路径,保鲜链上传后换引擎 input 文件名) */
  assets?: { name: string; typeLabel: string; views: number; cover?: string; state?: string }[];
  /** 渲染器降级链标签(如 "remotion → ffmpeg")与硬件并发槽 */
  rendererLabel?: string;
  concurrency?: number;
}


/** 绘制区纵向标尺(生成器与 manying.js 同源;design §3) */
export const STAGE_METRICS = {
  width: 560,
  headerTop: 150,     // 原生标题+四 widget 区让位
  contentTop: 218,    // 状态行+描述+指标芯片之后的内容框顶
  lineH: 15,          // 正文/队列/表行行高
  tileH: 112,         // tiles 单行高(84 图 + 标题 + 台词行,09-12 内容全量补齐)
  tilesPerRow: 6,
  pad: 26,            // 内容框内上下留白合计
  actionRowH: 44,     // 底部动作按钮行高(含上下留白)
} as const;

const STATUS_TEXT: Record<StageNodePayload["status"], string> = {
  ready: "已完成",
  pending: "进行中",
  empty: "未开始",
  warning: "有失败",
};

/** 全文→md 段落结构(09-13 用户裁定:正文展示完全,禁再截断):
 * 源行=独立段落(空行分隔),markdown-it 按节点宽自然回流——不再 50 字
 * 硬切(那会把一行拆成碎行、把不同行黏成墙),不再 60 行截断(滚动区
 * 就是为此而生)。输出仍是行数组契约,空串=段间空行。 */
function wrapFullText(text: string): string[] {
  const paragraphs = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  paragraphs.forEach((line, i) => {
    if (i > 0) out.push("");
    out.push(line);
  });
  return out.length > 0 ? out : ["暂无内容"];
}

/**
 * 组装七环节富内容载荷 v2(内容语义照 workflow-node-model-node-builders
 * 全量对齐,数据源=buildStudioFlowData+分镜表 lib 解析器)。
 */
export function buildStageNodePayload(input: {
  novelChapters: { id: string }[];
  scriptPlans: unknown[];
  entityExtractions: unknown[];
  storyboards: StoryboardItem[];
  flowData: StudioFlowData;
}): StageNodePayload[] {
  const shots = input.storyboards.slice().sort((a, b) => a.index - b.index);
  const images = shots.filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path).length;
  const videos = shots.filter((item) => item.mediaRef?.kind === "video" && item.mediaRef.path).length;
  const scriptChars = input.flowData.script.replace(/\s/g, "").length;
  const hasScript = input.novelChapters.length > 0 || scriptChars > 0;
  const planText = input.flowData.scriptPlan.trim();
  const tableText = input.flowData.storyboardTable.trim();
  const tableRows = tableText ? parseStoryboardTable(tableText, "preview").rows : [];
  const allImages = shots.length > 0 && images >= shots.length;
  const someImages = images > 0;
  const allVideos = shots.length > 0 && videos >= shots.length;
  const someVideos = videos > 0;
  const assetNames = (type: "character" | "scene" | "prop") =>
    input.flowData.assets.filter((asset) => asset.type === type).map((asset) => asset.name);

  const payload = (
    key: PipelineStageKey,
    title: string,
    description: string,
    status: StageNodePayload["status"],
    metrics: string[],
    extra: Partial<StageNodePayload> = {},
  ): StageNodePayload => ({
    key, title, description, status, statusText: STATUS_TEXT[status], metrics, ...extra,
  });

  return [
    payload("script", "剧本", "章节剧本与正文台词输入。", hasScript ? "ready" : "empty",
      scriptChars ? [`${scriptChars} 字`] : [],
      { previewTitle: "剧本内容", previewLines: wrapFullText(input.flowData.script || "暂无剧本内容") }),
    payload("scriptPlan", "导演规划", "场次、节奏、镜头策略和声音方向。", input.scriptPlans.length ? "ready" : "empty",
      input.scriptPlans.length ? [`${input.scriptPlans.length} 份规划`] : ["待运行导演规划"],
      {
        previewTitle: "导演规划",
        previewLines: wrapFullText(planText || "暂无导演规划"),
        actions: [{
          kind: "generate-director-plan",
          label: input.scriptPlans.length ? "重新生成导演规划" : "生成导演规划",
          paid: true,
          disabled: !hasScript,
        }],
      }),
    payload("assets", "衍生资产", "从剧本抽取角色、场景、道具,并作为分镜画面引用。",
      input.entityExtractions.length ? "ready" : "empty",
      [
        `角色 ${assetNames("character").length}`,
        `场景 ${assetNames("scene").length}`,
        `道具 ${assetNames("prop").length}`,
      ],
      {
        previewTitle: "剧本资产",
        assetGroups: { characters: assetNames("character"), scenes: assetNames("scene"), props: assetNames("prop") },
        actions: [{
          kind: "extract-assets",
          label: assetNames("character").length ? "重新抽取资产" : "抽取资产",
          disabled: !input.flowData.script,
        }],
      }),
    payload("storyboardTable", "分镜表", "按导演规划拆出镜头表。",
      shots.length || tableRows.length ? "ready" : "empty",
      tableRows.length ? [`${tableRows.length} 行分镜表`] : shots.length ? [`${shots.length} 个分镜`] : ["待生成分镜表"],
      {
        previewTitle: "分镜表",
        progress: [{ label: "分镜", done: tableRows.length }],
        tableRows: tableRows.length
          ? tableRows.map((row) => ({
              index: row.index,
              scene: row.scene || "—",
              title: row.description || `分镜 ${row.index}`,
              duration: row.duration,
              shotSize: row.shotSize || "",
              cameraMove: row.cameraMove || "",
              action: row.action || "",
              lines: row.lines || "",
              sound: row.sound || "",
              assets: row.associateAssetsNames.join("·"),
            }))
          : undefined,
        previewLines: tableRows.length ? undefined : wrapFullText(tableText || "暂无分镜表"),
        actions: [{
          kind: "generate-storyboard-table",
          label: tableRows.length ? "重新生成分镜表" : "生成分镜表",
          paid: true,
          disabled: !input.scriptPlans.length,
        }],
      }),
    payload("storyboard", "分镜面板", "分镜图、台词、配音与视频节点绑定。",
      allImages ? "ready" : someImages ? "pending" : "empty",
      shots.length ? [`${shots.length} 个分镜`, `${images} 个画面`, `${videos} 个视频`] : ["待生成分镜"],
      {
        previewTitle: "分镜概览",
        progress: shots.length
          ? [
              { label: "已出图", done: images, total: shots.length },
              { label: "已出片", done: videos, total: shots.length },
            ]
          : undefined,
        actions: [{ kind: "generate-images", label: "一键生图", disabled: shots.length === 0 }],
        tiles: shots.map((item) => ({
          index: item.index,
          // 09-14 用户裁定:磁贴只放标号——描述不铺字(悬停 tooltip 走 lines)
          title: `S${String(item.index).padStart(2, "0")}`,
          preview: shotPreviewName(item),
          hasImage: item.mediaRef?.kind === "image" && Boolean(item.mediaRef.path),
          hasVideo: item.mediaRef?.kind === "video" && Boolean(item.mediaRef.path),
          lines: item.lines || "",
        })),
      }),
    payload("remotionProduction", "单镜视频生产",
      "将当前章节的每个分镜分别生成一条单镜 MP4(自动带上旁白配音与音效);全部通过后才能进入章节工作台。",
      allVideos ? "ready" : someVideos ? "pending" : "empty",
      shots.length
        ? [`${videos}/${shots.length} 个分镜 MP4`, `${shots.filter((item) => item.ttsJob?.status === "completed").length} 镜已配音`]
        : ["等待分镜面板提供分镜"],
      {
        previewTitle: "逐镜队列",
        progress: shots.length
          ? [
              { label: "视频", done: videos, total: shots.length },
              { label: "配音", done: shots.filter((item) => item.ttsJob?.status === "completed").length, total: shots.length },
            ]
          : undefined,
        actions: [{
          kind: "generate-videos",
          label: allVideos ? "分镜视频已完成" : "一键生成所有视频",
          disabled: shots.length === 0 || allVideos,
        }],
        shots: shots.map((item) => ({
          index: item.index,
          label: item.videoDesc || item.prompt || `分镜 ${item.index}`,
          videoReady: item.mediaRef?.kind === "video" && Boolean(item.mediaRef.path),
          imageReady: item.mediaRef?.kind === "image" && Boolean(item.mediaRef.path),
          ttsReady: item.ttsJob?.status === "completed",
          sfxReady: (item.shotAudioBindings ?? []).some((binding) => binding.role === "sfx"),
          revision: Math.max(1, item.outputVersion ?? 1),
        })),
      }),
    payload("workbench", "视频工作台", "加载当前章节的原生 Remotion Studio,进行时间线预览、剪辑和章节导出。",
      input.flowData.workbench.finalExportPath || allVideos ? "ready" : someVideos || input.flowData.workbench.tracks.length ? "pending" : "empty",
      [
        "Remotion Studio",
        shots.length ? `${videos}/${shots.length} 个分镜已就绪` : "等待全部分镜成功",
        input.flowData.workbench.finalExportPath ? "已导出章节成片" : "等待章节成片",
      ],
      {
        previewTitle: "制作轨",
        progress: input.flowData.workbench.tracks.length
          ? [{ label: "轨道完成", done: input.flowData.workbench.tracks.filter((track) => track.state === "ready").length, total: input.flowData.workbench.tracks.length }]
          : undefined,
        finalExport: Boolean(input.flowData.workbench.finalExportPath),
        actions: [{ kind: "rebuild-workbench-tracks", label: "重建视频轨道" }],
        tracks: input.flowData.workbench.tracks.map((track) => ({
          name: track.prompt || track.id,
          state: String(track.state),
          count: track.storyboardIds.length,
          duration: Math.round(track.duration || 0),
          mediaCount: track.medias.length,
        })),
      }),
  ];
}

/** 按载荷内容计算节点尺寸(生成器与自绘两端同源;design §3)。 */
export function computeStageNodeSize(payload: StageNodePayload | undefined): [number, number] {
  if (!payload) return [STAGE_METRICS.width, 170];
  const { contentTop, lineH, tileH, tilesPerRow, pad, width } = STAGE_METRICS;
  let contentH = 0;
  if (payload.tiles && payload.tiles.length > 0) {
    const rows = Math.ceil(payload.tiles.length / tilesPerRow);
    contentH = rows * tileH;
  } else if (payload.tableRows && payload.tableRows.length > 0) {
    // 表行两行制:首行=镜号/场景/描述/景别/运镜/时长;次行=台词/声音/关联资产(有则)
    contentH = payload.tableRows.reduce(
      (h, row) => h + (row.lines || row.sound || row.assets ? lineH * 2 + 2 : lineH),
      0,
    );
  } else if (payload.shots && payload.shots.length > 0) {
    contentH = payload.shots.length * lineH;
  } else if (payload.tracks && payload.tracks.length > 0) {
    contentH = payload.tracks.length * lineH;
  } else if (payload.assets && payload.assets.length > 0) {
    // 资产卡网格(v4):3 列 × 76/卡,与 manying.js ASSET_CARD_H 同源
    contentH = Math.ceil(payload.assets.length / 3) * 76;
  } else if (payload.assetGroups) {
    // 与 manying.js 绘制端同式:标签 14 + 名字行 + 组间 4(深审修正:漏 4 会尾行被裁剪兜底吃掉)
    for (const names of [payload.assetGroups.characters, payload.assetGroups.scenes, payload.assetGroups.props]) {
      contentH += 14 + Math.max(1, Math.ceil(names.length / 2)) * lineH + 4;
    }
  } else {
    contentH = (payload.previewLines?.length ?? 1) * lineH;
  }
  const actionH = payload.actions?.length ? STAGE_METRICS.actionRowH : 0;
  const skillH = payload.skills?.length ? 20 : 0;
  return [width, Math.max(300, contentTop + pad + skillH + contentH + 20 + actionH)];
}

type StudioSnapshot = ReturnType<typeof useStudioStore.getState>;

/** 从 store 快照一步组装七环节富载荷(autoOpen 注入与保鲜链落库共用入口)。 */
export function buildStageNodePayloadFromState(state: StudioSnapshot): StageNodePayload[] {
  // 防御缺省:测试 store mock/局部快照可能缺字段(09-12 实弹教训:缺字段在
  // 调用方 try/catch 里被静默吞→autoOpen 少注入;?? [] 让降级可见可控)
  const flowData = buildStudioFlowData({
    agentWorkData: state.agentWorkData ?? [],
    entityExtractions: state.entityExtractions ?? [],
    scriptPlans: state.scriptPlans ?? [],
    storyboards: state.storyboards ?? [],
    productionTracks: state.productionTracks ?? [],
    videoCandidates: state.videoCandidates ?? [],
  });
  return buildStageNodePayload({
    novelChapters: state.novelChapters,
    scriptPlans: state.scriptPlans,
    entityExtractions: state.entityExtractions,
    storyboards: state.storyboards,
    flowData,
  });
}

/** 主线顺序+分支位(照旧画布 mainline;assets 分支与导演规划同排) */
const MAINLINE: PipelineStageKey[] = [
  "script",
  "scriptPlan",
  "storyboardTable",
  "storyboard",
  "remotionProduction",
  "workbench",
];

/** 组装环节摘要(大白话;判定语义照 node-builders 的 status 降档) */
export function buildStageSummaries(input: {
  novelChapters: { id: string }[];
  scriptPlans: unknown[];
  entityExtractions: unknown[];
  storyboards: StoryboardItem[];
  productionTracks: unknown[];
}): PipelineStageSummary[] {
  const shots = input.storyboards;
  const images = shots.filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path).length;
  const videos = shots.filter((item) => item.mediaRef?.kind === "video" && item.mediaRef.path).length;
  const stage = (
    key: PipelineStageKey,
    title: string,
    summary: string,
    done: boolean,
    started: boolean,
  ): PipelineStageSummary => ({
    key,
    title,
    summary,
    status: done ? "已完成" : started ? "进行中" : "未开始",
  });
  return [
    stage("script", "剧本", input.novelChapters.length
      ? `已导入 ${input.novelChapters.length} 章原文`
      : "还没有导入小说原文", input.novelChapters.length > 0, false),
    stage("scriptPlan", "导演规划", input.scriptPlans.length
      ? `${input.scriptPlans.length} 份导演规划`
      : "待运行导演规划", input.scriptPlans.length > 0, false),
    stage("assets", "衍生资产", input.entityExtractions.length
      ? `已提取 ${input.entityExtractions.length} 批(角色/场景/道具)`
      : "待提取剧本资产", input.entityExtractions.length > 0, false),
    stage("storyboardTable", "分镜表", shots.length
      ? `${shots.length} 个分镜`
      : "待生成分镜表", shots.length > 0, false),
    stage("storyboard", "分镜面板", shots.length
      ? `${shots.length} 个分镜 · ${images} 张画面已生成`
      : "待生成分镜", shots.length > 0 && images >= shots.length, images > 0),
    stage("remotionProduction", "单镜视频生产", shots.length
      ? `${videos}/${shots.length} 个分镜已有视频`
      : "等待分镜面板提供分镜", videos >= shots.length && shots.length > 0, videos > 0),
    stage("workbench", "视频工作台", input.productionTracks.length
      ? `${input.productionTracks.length} 条制作轨`
      : "等待单镜视频就绪", videos >= shots.length && shots.length > 0, videos > 0),
  ];
}

/** 链的六条边(照旧画布 PRODUCTION_FLOW_EDGES;assets 挂剧本下游) */
const PIPELINE_EDGES: Array<readonly [PipelineStageKey, PipelineStageKey]> = [
  ["script", "scriptPlan"],
  ["script", "assets"],
  ["scriptPlan", "storyboardTable"],
  ["storyboardTable", "storyboard"],
  ["storyboard", "remotionProduction"],
  ["remotionProduction", "workbench"],
];

export interface StoryboardPipelineResult {
  ui: Record<string, unknown>;
  report: { stages: number; edges: number; shots: number; name: string };
}

export function buildStoryboardPipelineWorkflow(input: {
  summaries: PipelineStageSummary[];
  storyboards: StoryboardItem[];
  /** 09-12 stage-node-content-parity:富内容载荷(缺省=不带,旧调用兼容) */
  payloads?: StageNodePayload[];
  name?: string;
}): StoryboardPipelineResult {
  // 节点 id:主线 1..6;assets=7(不占主线序)
  const nodeId = new Map<PipelineStageKey, number>();
  MAINLINE.forEach((key, index) => nodeId.set(key, index + 1));
  nodeId.set("assets", MAINLINE.length + 1);

  interface StageNode {
    id: number;
    type: string;
    title: string;
    pos: [number, number];
    flags: Record<string, unknown>;
    order: number;
    mode: number;
    inputs: Array<{ name: string; type: string; link: number | null; label?: string }>;
    outputs: Array<{ name: string; type: string; links: number[] }>;
    properties: Record<string, unknown>;
    widgets_values: unknown[];
    size: [number, number];
  }
  // 环节尺寸=标准正方形(引擎侧按内容在 [540,760] 内自适应,布局按顶格算)
  const payloadByKey = new Map((input.payloads ?? []).map((entry) => [entry.key, entry]));
  const sizeByKey = new Map<PipelineStageKey, [number, number]>(
    input.summaries.map((item) => [item.key, [STAGE_SQUARE, STAGE_SQUARE] as [number, number]]),
  );
  const xCursor = new Map<PipelineStageKey, number>();
  let xCursorValue = 40;
  for (const key of MAINLINE) {
    xCursor.set(key, xCursorValue);
    xCursorValue += STAGE_SQUARE_MAX + STAGE_GAP_X;
  }
  // 下排锚点:主线最坏高度(hardMax)底 + 间距(资产分支/分镜子图共用)
  const mainlineBottom = MAINLINE_Y + STAGE_SQUARE_MAX;
  const lowerRowY = mainlineBottom + LOWER_ROW_GAP;
  const stageNodes: StageNode[] = input.summaries.map((item) => {
    const id = nodeId.get(item.key)!;
    const mainlineIndex = MAINLINE.indexOf(item.key);
    // 横向:主线沿 X 铺开;衍生资产分支挂导演规划正下方(剧本→资产边自然下探)
    const pos: [number, number] = mainlineIndex >= 0
      ? [xCursor.get(item.key)!, MAINLINE_Y]
      : [xCursor.get("scriptPlan")!, lowerRowY];
    const payload = payloadByKey.get(item.key);
    return {
      id,
      type: "MyStage",
      pos,
      flags: {},
      order: id,
      mode: 0,
      // 09-12 用户裁定:环节是固定节点,标题栏直接显示环节名(剧本/导演规划/…)
      // ——不设 title 时 litegraph 回落类型名「漫影 环节」,七个节点全同名
      title: item.title,
      // 非链头有 upstream 入槽;全节点一个 flow 出槽(末端无人消费也无妨)
      // slot_index 必带:缺它 ComfyUI 前端配线时槽位落空→连线不建(09-11 实弹)
      // 槽位代名词(09-13 用户裁定:upstream/MANYING_FLOW 裸英文退役);
      // 剧本是链头无入槽,引擎侧还会在其被前端补建后摘除
      inputs: item.key === "script" ? [] : [
        { name: "upstream", type: "MANYING_FLOW", link: null, slot_index: 0, label: "上游环节" },
      ],
      outputs: [{ name: "flow", type: "MANYING_FLOW", links: [], slot_index: 0, label: "下游环节" }],
      // 富内容载荷(照 MyShot myPreview 先例进 properties,
      // 不进 widgets_values=序列化契约稳定;引擎侧自绘消费)
      properties: {
        "Node name for S&R": "MyStage",
        ...(payload ? { myStage: payload } : {}),
      },
      widgets_values: [item.key, item.title, item.summary, item.status],
      size: sizeByKey.get(item.key)!,
      color: payload ? "#3f789e" : undefined,
      bgcolor: payload ? "#20262f" : undefined,
    };
  });

  // 边:回填两端槽位 link 引用(与 links 数组一致)
  let linkId = 0;
  const links = PIPELINE_EDGES.map(([from, to]) => {
    linkId += 1;
    const link = [linkId, nodeId.get(from), 0, nodeId.get(to), 0, "MANYING_FLOW"];
    const fromNode = stageNodes.find((node) => node.id === nodeId.get(from))!;
    const toNode = stageNodes.find((node) => node.id === nodeId.get(to))!;
    fromNode.outputs[0].links.push(linkId);
    toNode.inputs[0].link = linkId;
    return link;
  });

  // 分镜内容子图(09-12 用户裁定:镜子节点住子图,主图只留整条流程):
  // 复用总览产物作为子图内部节点;引用节点泊远场(09-14 裁定,见下)。
  const overview = buildStoryboardOverviewWorkflow(input.storyboards);
  const chapters = (overview.report.chapters ?? []) as string[];
  const chapterKey = chapters[0] ?? "all";
  // 确定性子图 id(同章同名,uuid 形态;每文档独立命名空间,无碰撞面)
  let hash = 0x811c9dc5;
  for (const ch of chapterKey) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  const subgraphId = `${hex.slice(0, 8)}-4${hex.slice(9, 12)}-4${hex.slice(13, 16)}-8${hex.slice(16, 20)}-${hex}${hex.slice(0, 4)}`.slice(0, 36);

  const subNodes = (overview.ui.nodes as Array<Record<string, unknown>>).map((node, index) => ({
    ...node,
    id: index + 1,
  }));
  const gridColumns = Math.max(1, Math.ceil(subNodes.length / SHOTS_PER_COLUMN));
  const gridWidth = gridColumns * (SHOT_NODE_WIDTH + SHOT_COLUMN_GAP);
  const gridRows = Math.min(subNodes.length, SHOTS_PER_COLUMN);
  const gridHeight = Math.max(1, gridRows) * (SHOT_NODE_HEIGHT + SHOT_ROW_GAP);

  // 主图:子图引用节点泊远场+折叠(09-14 用户裁定:主图不再展示独立
  // 「分镜内容」节点,入口=分镜面板节点「分镜内容」按钮经 canvas.openSubgraph
  // 原生进入)——节点本体必须保留:它是子图定义的引用锚,删了定义随保存丢失;
  // 泊到主线最右端外+折叠,工作区不可见,引擎按钮按标题寻址进入。
  const subgraphNode = {
    id: stageNodes.length + 1,
    type: subgraphId,
    // 标题栏与子图定义同名(不设则回落 uuid 型名,不可读;引擎按钮寻址依赖)
    title: `分镜内容 · ${chapterKey}`,
    pos: [8000, MAINLINE_Y] as [number, number],
    size: [480, 300],
    flags: { collapsed: true },
    order: stageNodes.length + 1,
    mode: 0,
    inputs: [] as unknown[],
    outputs: [] as unknown[],
    properties: {} as Record<string, unknown>,
    widgets_values: [],
  };
  const allNodes = [...stageNodes, subgraphNode];

  // 09-12 用户裁定:节点后不加 group 组框——节点自带标题栏+状态色条,
  // 组框信息冗余;节点位置(主线横向/下排分支)已是绝对坐标,不依赖组框。
  const groups: unknown[] = [];

  // 09-12 用户裁定:标题就是「分镜工作流」不加其他内容——分镜阶段章内
  // 聚焦,当前章的画布恒此名(库文件单条,随章保鲜覆写;切章=已开未修改
  // 则关旧开新拿保鲜链最新,单实例协议照常)。
  // 09-14 用户裁定(二次修订):漫影工作流文件名一律 `MY-` 前缀(弃 _my 后缀)。
  const name = input.name ?? "MY-分镜工作流";

  return {
    ui: {
      last_node_id: allNodes.length,
      last_link_id: links.length,
      nodes: allNodes,
      links,
      groups,
      definitions: {
        subgraphs: [{
          id: subgraphId,
          name: `分镜内容 · ${chapterKey}`,
          version: 1,
          revision: 0,
          state: { lastGroupId: 0, lastNodeId: subNodes.length, lastLinkId: 0, lastRerouteId: 0 },
          nodes: subNodes,
          links: [],
          groups: [],
          inputs: [],
          outputs: [],
          // 子图标记节点(官方样例必带):-10 输入桩/-20 输出桩,分列网格两侧
          inputNode: { id: -10, bounding: [-SHOT_NODE_WIDTH, 40, 172, Math.max(68, gridHeight)] },
          outputNode: { id: -20, bounding: [gridWidth + GROUP_PAD, 40, 128, 68] },
          widgets: [],
          config: {},
          extra: {},
        }],
      },
      config: {},
      extra: { myPipeline: true },
      version: 0.4,
    },
    report: { stages: stageNodes.length, edges: links.length, shots: overview.report.shots, name },
  };
}
