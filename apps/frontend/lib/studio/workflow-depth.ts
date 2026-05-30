import type { AgentWorkKey } from "@/types/studio";

export type WorkflowDepthMode = "flat" | "deep";

export interface WorkflowDepthConfig {
  episodeCount?: number;
  episodeDurationMin?: number;
}

export interface WorkflowDepthResult {
  mode: WorkflowDepthMode;
  stages: AgentWorkKey[];
  reason: string;
}

/**
 * M5 可调深度阈值：集数多或单集时长长 → 深链（先骨架/改编/细纲降跨度）；否则扁平改写。
 * 阈值取保守值，命中任一即升深链。
 */
const DEEP_EPISODE_COUNT = 12;
const DEEP_EPISODE_DURATION_MIN = 5;

/** 主干阶段（两种模式共用，按制作顺序）。 */
const PRODUCTION_STAGES: AgentWorkKey[] = [
  "entityExtraction",
  "directorPlan",
  "deriveAssets",
  "storyboardTable",
  "voiceAssign",
];

/** 深链独有的编剧前置阶段，插在事件分析之后、剧本之前。 */
const DEEP_WRITING_STAGES: AgentWorkKey[] = [
  "storySkeleton",
  "adaptationStrategy",
  "episodeOutline",
];

export function resolveWorkflowDepth(config: WorkflowDepthConfig): WorkflowDepthResult {
  const episodeCount = config.episodeCount ?? 0;
  const durationMin = config.episodeDurationMin ?? 0;

  const isDeep =
    episodeCount >= DEEP_EPISODE_COUNT || durationMin >= DEEP_EPISODE_DURATION_MIN;

  if (isDeep) {
    return {
      mode: "deep",
      stages: ["eventAnalysis", ...DEEP_WRITING_STAGES, "scriptDraft", ...PRODUCTION_STAGES],
      reason: `集数 ${episodeCount} 或单集 ${durationMin} 分钟达深链阈值（≥${DEEP_EPISODE_COUNT}集 或 ≥${DEEP_EPISODE_DURATION_MIN}分钟）：走 事件→骨架→改编→细纲→剧本 深链，降低骨架到剧本的跨度。`,
    };
  }

  return {
    mode: "flat",
    stages: ["eventAnalysis", "scriptDraft", ...PRODUCTION_STAGES],
    reason: `短篇（${episodeCount || "未设"}集 / ${durationMin || "未设"}分钟）：走 事件→剧本 扁平改写，省去骨架/改编/细纲前置。`,
  };
}
