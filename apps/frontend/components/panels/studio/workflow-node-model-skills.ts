import type { StudioManualPreset } from "@/types/studio";
import type { TimelineRendererId } from "@rendering/contracts/timeline-renderer";
import {
  type StudioManualCatalog,
  getAgentSkillPreset,
  getStudioManualPreset,
} from "@/lib/studio/manuals";
import type { ProductionFlowModelInput } from "./workflow-asset-types";

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

import type {
  ProductionFlowNodeSkill,
  ProductionFlowRendererSummary,
} from "./workflow-node-model-schema";

export function buildNodeSkill(id: string): ProductionFlowNodeSkill | undefined {
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

export function buildDirectorPlanSkills(
  workflowConfig: ProductionFlowModelInput["workflowConfig"],
  manualCatalog: StudioManualCatalog = {},
): ProductionFlowNodeSkill[] {
  return [
    buildNodeSkill("production_execution_director_plan"),
    ...buildSelectedDirectorSkillModules(workflowConfig, manualCatalog),
  ].filter((skill): skill is ProductionFlowNodeSkill => Boolean(skill));
}

export function buildStoryboardTableSkills(
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

export function buildStoryboardSkills(
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

export function previewTextLines(
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
