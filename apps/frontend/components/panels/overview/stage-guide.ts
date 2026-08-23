// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { LucideIcon } from "lucide-react";
import { WORKFLOW_TABS } from "@/components/panels/studio/workflow-tabs";

/**
 * Per-stage explanatory copy shown on the project overview so users understand
 * the production pipeline before entering the workflow.
 *
 * The stage id / label / icon are sourced from {@link WORKFLOW_TABS} (the
 * single source of truth for the in-workflow stage list) so this can never
 * drift from what the workflow actually shows. Only the descriptions are
 * maintained here — they are net-new copy (WORKFLOW_TABS carries none).
 *
 * Worded to stay consistent with the existing action-label vocabulary in
 * `lib/studio/workflow-readiness.ts` (STAGE_DEFS).
 */
const STAGE_DESCRIPTIONS: Record<string, string> = {
  storyboardPanel:
    "浏览当前章节全部分镜,逐镜进入图片工作流生成画面。",
  manuals:
    "选定视觉风格与色彩基调，编写视觉、导演手册，确立全片统一的画面与镜头语言基调。",
  novel:
    "导入小说原文并按章节拆分，完成事件分析，为剧本生产提供结构化素材。",
  script:
    "基于大纲与事件分析，生成故事骨架、改编策略与结构化剧本，输出场次、情节与角色台词。",
  assets:
    "从剧本提取角色、场景与道具，生成对应的形象和场景资产，供分镜画面引用。",
  storyboard:
    "依据导演规划拆分镜头表，生成分镜图、音色素材与视频节点，将剧本落实为可剪辑画面。",
  imageWorkflow:
    "通过节点图批量生成与精修图像素材，统一画风并提升素材的复用与连贯性。",
  workbench:
    "在工作台生成候选视频，完成配音与剪辑合成，最终输出并导出成片。",
};

export interface OverviewStageGuideEntry {
  id: string;
  label: string;
  Icon: LucideIcon;
  description: string;
}

/**
 * Ordered stage guide for the project overview. Derived 1:1 from
 * {@link WORKFLOW_TABS} (same order) with a description attached to each.
 */
export const OVERVIEW_STAGE_GUIDE: OverviewStageGuideEntry[] = WORKFLOW_TABS.map(
  ({ value, label, Icon }) => ({
    id: value,
    label,
    Icon,
    description: STAGE_DESCRIPTIONS[value] ?? "",
  }),
);
