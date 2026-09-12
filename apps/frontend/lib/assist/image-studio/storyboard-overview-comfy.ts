// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 章节分镜总览图生成器(09-09 主视图 ComfyUI 化·批7):
 * storyboards → ComfyUI workflow JSON(UI 格式)——每镜一个 ManyingShot
 * 节点,网格布局(每列 ROWS_PER_COLUMN 镜);媒体生产状态随 widget 展示。
 * 产物入工作流库后在 ComfyUI 画布打开=章节总览;镜级生产动作走
 * 「漫影」侧栏(批8 接动作区)。
 */

import type { StoryboardItem } from "@/types/studio";

const ROWS_PER_COLUMN = 10;
const NODE_WIDTH = 360;
// 09-10 用户裁定:漫影节点要展示该镜成图——底部留图片带(扩展 onDrawBackground 绘制),
// 描述 widget 截断防与图带重叠
const NODE_HEIGHT = 330;
const COLUMN_GAP = 90;
const ROW_GAP = 40;
/** 描述 widget 截断上限(超出部分侧栏可见完整版) */
const DESCRIPTION_MAX_CHARS = 80;

/** 媒体生产状态速览(纯展示,大白话) */
export function shotMediaStatus(storyboard: StoryboardItem): string {
  const image = storyboard.mediaRef?.kind === "image" && storyboard.mediaRef.path ? "图✓" : "图—";
  const video = storyboard.mediaRef?.kind === "video" && storyboard.mediaRef.path ? "视频✓" : storyboard.videoDesc ? "视频—" : "";
  return [image, video].filter(Boolean).join(" ");
}

export function shotLabel(storyboard: StoryboardItem): string {
  return `S${String(storyboard.index).padStart(2, "0")}${storyboard.videoDesc ? ` · ${storyboard.videoDesc.slice(0, 14)}` : ""}`;
}

/** 该镜成图在引擎 input 目录的缩略图名(保鲜同步上传,扩展按名渲染;无图=空) */
export function shotPreviewName(storyboard: StoryboardItem): string {
  if (storyboard.mediaRef?.kind !== "image" || !storyboard.mediaRef.path) return "";
  const safeId = storyboard.id.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `manying-shot-${safeId}.jpg`;
}

/** 描述 widget 文案(截断,完整描述走业务侧栏) */
export function shotDescription(storyboard: StoryboardItem): string {
  const text = storyboard.videoDesc ?? "";
  return text.length > DESCRIPTION_MAX_CHARS ? `${text.slice(0, DESCRIPTION_MAX_CHARS)}…` : text;
}

interface OverviewNode {
  id: number;
  type: string;
  title: string;
  pos: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: unknown[];
  outputs: unknown[];
  properties: Record<string, unknown>;
  widgets_values: unknown[];
}

export interface StoryboardOverviewResult {
  /** ComfyUI UI 格式 workflow(入工作流库/画布直开) */
  ui: Record<string, unknown>;
  report: {
    shots: number;
    chapters: string[];
    name: string;
  };
}

export function buildStoryboardOverviewWorkflow(
  storyboards: StoryboardItem[],
  options: { name?: string } = {},
): StoryboardOverviewResult {
  const sorted = [...storyboards].sort((a, b) =>
    a.episodeId.localeCompare(b.episodeId) || a.index - b.index,
  );
  const nodes: OverviewNode[] = sorted.map((storyboard, index) => {
    const column = Math.floor(index / ROWS_PER_COLUMN);
    const row = index % ROWS_PER_COLUMN;
    const preview = shotPreviewName(storyboard);
    return {
      id: index + 1,
      type: "ManyingShot",
      // 09-12 用户裁定:镜子节点也是固定的,标题栏显示镜号(S01 · 描述)
      // ——不设 title 时 litegraph 回落类型名,38 个节点全同名
      title: shotLabel(storyboard),
      pos: [40 + column * (NODE_WIDTH + COLUMN_GAP), 40 + row * (NODE_HEIGHT + ROW_GAP)],
      flags: {},
      order: index + 1,
      mode: 0,
      inputs: [],
      outputs: [],
      // manyingPreview=引擎 input 目录缩略图名;空图镜不写键(扩展见缺键=纯文字卡)
      properties: preview
        ? { "Node name for S&R": "ManyingShot", manyingPreview: preview }
        : { "Node name for S&R": "ManyingShot" },
      widgets_values: [
        storyboard.id,
        shotLabel(storyboard),
        shotDescription(storyboard),
        shotMediaStatus(storyboard),
      ],
    };
  });
  const chapters = [...new Set(sorted.map((item) => item.episodeId))];
  const name = options.name ?? (chapters.length === 1 ? `分镜总览 · ${chapters[0]}` : `分镜总览(${chapters.length} 章)`);
  return {
    ui: {
      last_node_id: nodes.length,
      last_link_id: 0,
      nodes,
      links: [],
      groups: chapters.map((chapter, index) => ({
        id: index + 1,
        title: chapter,
        bounding: [
          20 + index * 0, // 单章占满;多章时按列分组的视觉留待画布手调
          20,
          40 + Math.ceil(sorted.filter((item) => item.episodeId === chapter).length / ROWS_PER_COLUMN) * (NODE_WIDTH + COLUMN_GAP),
          ROWS_PER_COLUMN * (NODE_HEIGHT + ROW_GAP) + 20,
        ],
        color: "#3f789e",
        flags: {},
        order: index + 1,
      })),
      config: {},
      extra: { manyingOverview: true },
      version: 0.4,
    },
    report: { shots: sorted.length, chapters, name },
  };
}
