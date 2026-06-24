import type {
  AgentWorkData,
  EntityExtractionResult,
  NovelChapter,
  ProductionTrack,
  ScriptPlan,
  SeriesBible,
  StudioWorkflowConfig,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { ProjectVoiceBinding, SceneVoiceLine } from "@/types/tts";

export type WorkflowStageStatus = "ready" | "active" | "blocked";

export interface WorkflowStageReadiness {
  id: string;
  label: string;
  status: WorkflowStageStatus;
  completed: string[];
  missing: string[];
  actionLabel: string;
}

export interface WorkflowReadiness {
  stages: WorkflowStageReadiness[];
  progress: number;
  nextStageId: string;
  nextActionLabel: string;
  nextAction: WorkflowNextAction;
}

export interface WorkflowCapabilities {
  textCompletion?: boolean;
  studioRenderer?: boolean;
}

interface WorkflowActionMeta {
  enabled: boolean;
  disabledReason?: string;
}

export type WorkflowNextAction = WorkflowActionMeta &
  (
    | { kind: "open-stage"; stageId: string; label: string }
    | { kind: "run-entity-extraction"; stageId: "assets"; label: string; targetId: string }
    | { kind: "run-director-plan"; stageId: "generation"; label: string; targetId: string }
    | { kind: "build-series-bible"; stageId: "generation"; label: string }
    | { kind: "run-storyboard-table"; stageId: "storyboard"; label: string; targetId: string }
    | { kind: "render-track"; stageId: "workbench"; label: string; targetId: string }
    | { kind: "merge-episode"; stageId: "workbench"; label: string }
  );

export interface WorkflowReadinessInput {
  workflowConfig: StudioWorkflowConfig;
  novelChapters: NovelChapter[];
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  voiceBindings?: Pick<ProjectVoiceBinding, "speakerId" | "profileId">[];
  sceneVoiceLines?: Pick<SceneVoiceLine, "sceneId" | "status" | "audioLocalPath" | "audioMaterialId" | "audioFilePath">[];
  capabilities?: WorkflowCapabilities;
}

const STAGE_DEFS = [
  { id: "manuals", label: "风格与导演", actionLabel: "选择视觉与导演手册" },
  { id: "novel", label: "小说导入", actionLabel: "导入原文并完成事件分析" },
  { id: "script", label: "策划编剧", actionLabel: "生成故事骨架、改编策略和结构化剧本" },
  { id: "assets", label: "剧本资产", actionLabel: "提取角色、场景、道具" },
  { id: "generation", label: "ProductionAgent", actionLabel: "完成导演规划、衍生资产和剧集圣经" },
  { id: "storyboard", label: "分镜面板", actionLabel: "落地分镜表、分镜面板、分镜图和音色素材" },
  { id: "workbench", label: "视频工作台", actionLabel: "生成候选视频并导出成片" },
] as const;

export function buildWorkflowReadiness(input: WorkflowReadinessInput): WorkflowReadiness {
  const manualReady = Boolean(input.workflowConfig.visualManualId && input.workflowConfig.directorManualId);
  const novelReady = input.novelChapters.length > 0;
  const analyzedNovelCount = input.novelChapters.filter((chapter) =>
    Boolean(chapter.eventState?.trim() || chapter.eventAnalysis || chapter.eventRawOutput?.trim() || chapter.eventTaskState === "success"),
  ).length;
  const novelAnalysisReady = input.novelChapters.length > 0 && analyzedNovelCount >= input.novelChapters.length;
  const scriptDraftCount = countWork(input.agentWorkData, "scriptDraft");
  const scriptReady = scriptDraftCount > 0;
  const assetReady = input.entityExtractions.some(
    (batch) => batch.characters.length + batch.scenes.length + batch.props.length > 0,
  );
  const generationReady = input.scriptPlans.length > 0 && Boolean(input.seriesBible);
  const visualStoryboardCount = input.storyboards.filter((item) => item.mediaRef && item.mediaRef.kind !== "audio").length;
  const storyboardVisualReady = input.storyboards.length > 0 && visualStoryboardCount === input.storyboards.length;
  const hasCharacterVoiceBinding = (input.voiceBindings ?? []).some(
    (binding) => binding.speakerId.startsWith("character:") && binding.profileId.trim(),
  );
  const completedVoiceLineCount = (input.sceneVoiceLines ?? []).filter(
    (line) => line.status === "completed" && Boolean(line.audioLocalPath || line.audioMaterialId || line.audioFilePath),
  ).length;
  const voiceLineReady = input.storyboards.length > 0 && completedVoiceLineCount >= input.storyboards.length;
  const storyboardReady = storyboardVisualReady && hasCharacterVoiceBinding && voiceLineReady;
  const selectedReadyCandidateCount = input.productionTracks.filter((track) => {
    if (!track.selectedVideoId) return false;
    const candidate = input.videoCandidates.find((item) => item.id === track.selectedVideoId);
    return Boolean(candidate?.filePath && candidate.state === "ready");
  }).length;
  const hasEpisodeOutput = input.agentWorkData.some(
    (item) => item.key === "productionPlan" && /本地成片输出\s*:/.test(item.data),
  );
  const workbenchReady = hasEpisodeOutput;

  const checks: Record<string, { ready: boolean; completed: string[]; missing: string[] }> = {
    manuals: {
      ready: manualReady,
      completed: [
        input.workflowConfig.visualManualId ? "已选择视觉手册" : "",
        input.workflowConfig.directorManualId ? "已选择导演手册" : "",
      ].filter(Boolean),
      missing: [
        input.workflowConfig.visualManualId ? "" : "选择视觉手册",
        input.workflowConfig.directorManualId ? "" : "选择导演手册",
      ].filter(Boolean),
    },
    novel: {
      ready: novelReady && novelAnalysisReady,
      completed: [
        novelReady ? `已导入 ${input.novelChapters.length} 章原文` : "",
        analyzedNovelCount ? `${analyzedNovelCount} 章已完成事件分析` : "",
      ].filter(Boolean),
      missing: [
        novelReady ? "" : "导入小说原文",
        novelAnalysisReady ? "" : "完成事件分析",
      ].filter(Boolean),
    },
    script: {
      ready: scriptReady,
      completed: [
        countWork(input.agentWorkData, "storySkeleton") ? "已生成故事骨架" : "",
        countWork(input.agentWorkData, "adaptationStrategy") ? "已生成改编策略" : "",
        scriptDraftCount ? `已生成 ${scriptDraftCount} 份剧本草稿` : "",
      ].filter(Boolean),
      missing: [
        countWork(input.agentWorkData, "storySkeleton") ? "" : "生成故事骨架",
        countWork(input.agentWorkData, "adaptationStrategy") ? "" : "生成改编策略",
        scriptDraftCount ? "" : "生成剧本草稿",
      ].filter(Boolean),
    },
    assets: {
      ready: assetReady,
      completed: assetReady ? [`已提取 ${input.entityExtractions.length} 批剧本资产`] : [],
      missing: assetReady ? [] : ["提取角色/场景/道具"],
    },
    generation: {
      ready: generationReady,
      completed: [
        input.scriptPlans.length ? `已生成 ${input.scriptPlans.length} 份导演计划` : "",
        input.seriesBible ? "已锁定剧集圣经" : "",
      ].filter(Boolean),
      missing: [
        input.scriptPlans.length ? "" : "生成导演计划",
        input.seriesBible ? "" : "锁定剧集圣经",
      ].filter(Boolean),
    },
    storyboard: {
      ready: storyboardReady,
      completed: [
        input.storyboards.length ? `已落地 ${input.storyboards.length} 条分镜` : "",
        visualStoryboardCount ? `${visualStoryboardCount} 条分镜已绑定画面素材` : "",
        hasCharacterVoiceBinding ? "已分配角色音色" : "",
        completedVoiceLineCount ? `${completedVoiceLineCount} 条分镜配音已生成` : "",
      ].filter(Boolean),
      missing: [
        input.storyboards.length ? "" : "生成分镜计划",
        storyboardVisualReady ? "" : "为所有分镜绑定画面素材",
        hasCharacterVoiceBinding ? "" : "分配角色音色",
        voiceLineReady ? "" : "生成分镜配音音频",
      ].filter(Boolean),
    },
    workbench: {
      ready: workbenchReady,
      completed: [
        input.productionTracks.length ? `已整理 ${input.productionTracks.length} 条制作轨` : "",
        selectedReadyCandidateCount ? `${selectedReadyCandidateCount} 条制作轨已有候选片段` : "",
        hasEpisodeOutput ? "已导出最终成片" : "",
      ].filter(Boolean),
      missing: [
        input.productionTracks.length ? "" : "重建制作轨",
        input.productionTracks.length && selectedReadyCandidateCount < input.productionTracks.length ? "生成候选片段" : "",
        hasEpisodeOutput ? "" : "导出最终成片",
      ].filter(Boolean),
    },
  };

  let blockedByPrevious = false;
  const stages = STAGE_DEFS.map((def) => {
    const check = checks[def.id];
    const status: WorkflowStageStatus = check.ready ? "ready" : blockedByPrevious ? "blocked" : "active";
    if (!check.ready) blockedByPrevious = true;
    return {
      ...def,
      status,
      completed: check.completed,
      missing: check.missing,
    };
  });

  const readyCount = stages.filter((stage) => stage.status === "ready").length;
  const next = stages.find((stage) => stage.status !== "ready") ?? stages[stages.length - 1]!;

  return {
    stages,
    progress: Math.round((readyCount / stages.length) * 100),
    nextStageId: next.id,
    nextActionLabel: next.actionLabel,
    nextAction: resolveNextAction(input, next.id),
  };
}

function countWork(items: AgentWorkData[], key: AgentWorkData["key"]) {
  return items.filter((item) => item.key === key && item.data.trim()).length;
}

function resolveNextAction(input: WorkflowReadinessInput, stageId: string): WorkflowNextAction {
  const textActionMeta = capabilityMeta(input.capabilities?.textCompletion, "未检测到可用模型调用通道");
  const renderActionMeta = capabilityMeta(input.capabilities?.studioRenderer, "当前环境不支持本地渲染");
  if (stageId === "manuals") {
    return { kind: "open-stage", stageId, label: "选择视觉与导演手册", enabled: true };
  }
  if (stageId === "novel") {
    return { kind: "open-stage", stageId, label: "导入小说原文", enabled: true };
  }
  if (stageId === "script") {
    return { kind: "open-stage", stageId, label: "进入策划编剧", enabled: true };
  }
  if (stageId === "assets") {
    const targetId = findScriptTarget(input.agentWorkData) ?? "episode-1";
    return { kind: "run-entity-extraction", stageId, label: "提取剧本资产", targetId, ...textActionMeta };
  }
  if (stageId === "generation") {
    const targetId = findLatestEntityExtractionTarget(input) ?? findScriptTarget(input.agentWorkData) ?? "episode-1";
    if (!input.scriptPlans.length) {
      return { kind: "run-director-plan", stageId, label: "生成导演计划", targetId, ...textActionMeta };
    }
    return { kind: "build-series-bible", stageId, label: "锁定剧集圣经", enabled: true };
  }
  if (stageId === "storyboard") {
    const targetId = findLatestScriptPlanTarget(input) ?? findScriptTarget(input.agentWorkData) ?? "episode-1";
    return { kind: "run-storyboard-table", stageId, label: "生成分镜计划", targetId, ...textActionMeta };
  }
  if (stageId === "workbench") {
    if (!input.productionTracks.length) {
      return { kind: "open-stage", stageId, label: "重建制作轨", enabled: true };
    }
    const track = input.productionTracks.find((item) => {
      if (!item.selectedVideoId) return true;
      const selected = input.videoCandidates.find((candidate) => candidate.id === item.selectedVideoId);
      return !selected?.filePath || selected.state !== "ready";
    });
    if (track) {
      return { kind: "render-track", stageId, label: "生成候选片段", targetId: track.id, ...renderActionMeta };
    }
    return { kind: "merge-episode", stageId, label: "导出最终成片", ...renderActionMeta };
  }
  return { kind: "open-stage", stageId, label: "进入下一步", enabled: true };
}

function capabilityMeta(enabled: boolean | undefined, disabledReason: string): WorkflowActionMeta {
  return enabled ? { enabled: true } : { enabled: false, disabledReason };
}

function findScriptTarget(items: AgentWorkData[]) {
  return [...items].reverse().find((item) => item.key === "scriptDraft" && item.episodeId)?.episodeId;
}

function findLatestEntityExtractionTarget(input: WorkflowReadinessInput) {
  const scriptedTarget = findScriptTarget(input.agentWorkData);
  if (scriptedTarget && input.entityExtractions.some((item) => item.episodeId === scriptedTarget)) {
    return scriptedTarget;
  }
  return input.entityExtractions[input.entityExtractions.length - 1]?.episodeId;
}

function findLatestScriptPlanTarget(input: WorkflowReadinessInput) {
  const scriptedTarget = findScriptTarget(input.agentWorkData);
  if (scriptedTarget && input.scriptPlans.some((item) => item.episodeId === scriptedTarget)) {
    return scriptedTarget;
  }
  return input.scriptPlans[input.scriptPlans.length - 1]?.episodeId;
}
