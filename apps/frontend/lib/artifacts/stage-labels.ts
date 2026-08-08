import type { ArtifactStage } from "@/types/artifacts";

/**
 * Stage display labels — single source of truth.
 *
 * Order matters: it drives both the navigation tree node order and the
 * filter/table column order. `backup` is intentionally placed LAST so it
 * always sits at the bottom of every stage listing.
 *
 * Previously this map was duplicated across ArtifactCenter (2x),
 * ArtifactDetailPanel and ArtifactTable, and the copies had drifted
 * (different `backup` positions). Keep it here only.
 */
export const STAGE_LABELS: Record<ArtifactStage, string> = {
  "novel": "小说导入",
  "analysis": "内容分析",
  "script": "剧本生产阶段",
  "assets": "剧本资产管理",
  "storyboard": "分镜视频生成",
  "image": "图像节点图",
  "voice": "视频工作台：语音合成",
  "production": "视频工作台：视频生产",
  "editing": "视频工作台：剪辑编辑",
  "remotion": "视频工作台：Remotion 编排",
  "export": "导出输出",
  "media-library": "媒体库",
  "backup": "备份归档",
};

/**
 * Fixed navigation stage set — all 13 artifact stages always shown in the
 * product-center FilterBar dropdown and navigation tree, regardless of
 * whether the project currently has artifacts in each stage. Stages with
 * zero artifacts still render (count 0), so every workflow stage is filterable
 * and visible as a group even when empty.
 *
 * Order is the display order and matches {@link STAGE_LABELS} (novel import →
 * final export → media library → backup last). These keys MUST exist in
 * {@link STAGE_LABELS}.
 */
export const FIXED_NAV_STAGES: readonly ArtifactStage[] = [
  "novel",
  "analysis",
  "script",
  "assets",
  "storyboard",
  "image",
  "voice",
  "production",
  "editing",
  "remotion",
  "export",
  "media-library",
  "backup",
];

/**
 * Stage labels keyed by raw string (for refs that aren't typed as ArtifactStage).
 * Same values as {@link STAGE_LABELS}, just with a permissive key type.
 */
export const STAGE_LABELS_BY_KEY: Record<string, string> = STAGE_LABELS;
