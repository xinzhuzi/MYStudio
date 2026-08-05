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
  "script": "剧本生成",
  "assets": "素材准备",
  "storyboard": "分镜设计",
  "image": "图像生成",
  "voice": "语音合成",
  "production": "视频生产",
  "editing": "剪辑编辑",
  "remotion": "Remotion 编排",
  "export": "导出输出",
  "media-library": "媒体库",
  "backup": "备份归档",
};

/**
 * Fixed navigation stage set — the 6 workflow stages always shown in the
 * middle "工作流阶段" column, regardless of whether the project currently has
 * artifacts in each stage. Stages with zero artifacts still render (count 0).
 *
 * Order is the display order. These keys MUST exist in {@link STAGE_LABELS}.
 */
export const FIXED_NAV_STAGES: readonly ArtifactStage[] = [
  "novel",
  "storyboard",
  "image",
  "production",
  "export",
  "media-library",
];

/**
 * Stage labels keyed by raw string (for refs that aren't typed as ArtifactStage).
 * Same values as {@link STAGE_LABELS}, just with a permissive key type.
 */
export const STAGE_LABELS_BY_KEY: Record<string, string> = STAGE_LABELS;
