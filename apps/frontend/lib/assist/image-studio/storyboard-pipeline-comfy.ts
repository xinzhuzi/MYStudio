// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 分镜流程链载荷与模板注入契约(09-11 旧画布迁移 → 09-14 零文件通用化 →
 * 09-15 零实体裁定):七环节链(剧本→导演规划→[衍生资产]→分镜表→分镜面板→
 * 单镜视频生产→视频工作台)的真源=仓库通用模板 0_分镜/分镜工作流.json
 * (恒 7 环节锚点,repo: 只读)。本文件只产「环节摘要+富内容载荷+注入块」,
 * 画布侧打开时对模板克隆注入,引擎 userdata 恒零分镜文件——旧「整图构建器
 * 落库」形态(buildStoryboardPipelineWorkflow/总览图生成器)已随零实体裁定
 * 退役删除。环节语义真源=workflow-node-model 族(node-builders 的
 * label/status/metrics 降档映射,见任务 research)。
 */

import { shotPreviewName } from "./storyboard-overview-comfy";
import { parseStoryboardTable } from "@/lib/studio/storyboard-table";
import { buildStudioFlowData, type StudioFlowData } from "@/lib/studio/studio-flow-data";
import type { StoryboardItem } from "@/types/studio";
import type { useStudioStore } from "@/stores/studio/studio-store";

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
          id: item.id,
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

type StudioSnapshot = ReturnType<typeof useStudioStore.getState>;

/** 从 store 快照一步组装七环节富载荷(autoOpen 注入与保鲜链上传共用入口)。 */
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

// ── 09-14 通用化:零文件形态的模板注入契约(引擎 userdata 恒零漫影)────────
// 通用模板真源=仓库 workflows/0_分镜/分镜工作流.json(repo: id 只读);
// 打开=克隆模板+按当前章数据注入环节节点(widgets+myStage 载荷),
// 镜内容全载荷渲染,不生成任何按镜实体节点/文件。
export const STAGE_TEMPLATE_REPO_ID = "repo:0_分镜/分镜工作流.json";

/** 画布主线签名(单实例协议锚;与库文件无关的临时签名) */
export const MAINLINE_TAB_NAME = "分镜工作流.json";

export interface StageInjection {
  id: number;
  title: string;
  widgets_values: unknown[];
  properties: Record<string, unknown>;
}

/** 按通用模板槽位契约(环节 id 与模板一致)产注入块 */
export function buildStageInjections(input: {
  summaries: Array<{ key: string; title: string; summary?: string; status?: string }>;
  payloads?: Array<{ key: string }>;
}): StageInjection[] {
  const nodeId = new Map<string, number>();
  MAINLINE.forEach((key, index) => nodeId.set(key, index + 1));
  nodeId.set("assets", MAINLINE.length + 1);
  const payloadByKey = new Map((input.payloads ?? []).map((entry) => [entry.key, entry]));
  return input.summaries.map((item) => {
    const payload = payloadByKey.get(item.key) as Record<string, unknown> | undefined;
    return {
      id: nodeId.get(item.key) ?? 0,
      title: item.title,
      widgets_values: [item.key, item.title, item.summary ?? "", item.status ?? ""],
      properties: {
        "Node name for S&R": "MyStage",
        ...(payload ? { myStage: payload } : {}),
      },
    };
  });
}

/** 克隆通用模板并应用注入(模板本体永不被改;章数据只存在于注入副本) */
export function applyStageInjections(
  template: unknown,
  injections: StageInjection[],
): Record<string, unknown> {
  const graph = typeof template === "string" ? JSON.parse(template) : structuredClone(template);
  const byId = new Map(injections.map((entry) => [entry.id, entry]));
  for (const node of (graph as { nodes: Array<Record<string, unknown>> }).nodes ?? []) {
    const injection = byId.get(Number(node.id));
    if (!injection) continue;
    node.title = injection.title;
    node.widgets_values = injection.widgets_values;
    node.properties = { ...(node.properties as object), ...injection.properties };
    node.color = "#3f789e";
    node.bgcolor = "#20262f";
  }
  return graph as Record<string, unknown>;
}
