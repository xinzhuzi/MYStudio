import type {
  AgentWorkData,
  AgentWorkKey,
  EntityExtractionResult,
  NovelChapter,
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  StudioWorkflowConfig,
} from "@/types/studio";
import type { EditingStore } from "@/stores/editing-store";
import type { TtsProjectState } from "@/stores/tts-store";

export interface WorkflowSmokeStageEvidenceInput {
  stageId: string;
  studio: {
    workflowConfig: Pick<
      StudioWorkflowConfig,
      "visualManualId" | "directorManualId"
    >;
    novelChapters: Pick<NovelChapter, "eventTaskState">[];
    agentWorkData: AgentWorkData[];
    entityExtractions: Array<
      Pick<EntityExtractionResult, "characters" | "scenes" | "props">
    >;
    scriptPlans: Pick<ScriptPlan, "id">[];
    storyboards: Pick<StoryboardItem, "mediaRef">[];
    productionTracks: Pick<ProductionTrack, "selectedVideoId">[];
  };
  ttsProject?: Pick<TtsProjectState, "bindings" | "voiceLines">;
  editing: Pick<
    EditingStore,
    | "currentEditingProjectIdByEpisode"
    | "editingProjects"
    | "timelineRenderRecordsByEditingProjectId"
  >;
  episodeId: string;
}

export function buildWorkflowSmokeStageEvidenceText({
  stageId,
  studio,
  ttsProject,
  editing,
  episodeId,
}: WorkflowSmokeStageEvidenceInput) {
  if (stageId === "manuals") {
    return `visualManualId=${studio.workflowConfig.visualManualId}; directorManualId=${studio.workflowConfig.directorManualId}`;
  }
  if (stageId === "novel") {
    return `chapters=${studio.novelChapters.length}; analyzed=${studio.novelChapters.filter((chapter) => chapter.eventTaskState === "success").length}`;
  }
  if (stageId === "script") {
    return [
      `storySkeleton=${countNonEmptyWorkItems(studio.agentWorkData, "storySkeleton")}`,
      `storySkeletonReview=${countNonEmptyWorkItems(studio.agentWorkData, "storySkeletonReview")}`,
      `adaptationStrategy=${countNonEmptyWorkItems(studio.agentWorkData, "adaptationStrategy")}`,
      `adaptationStrategyReview=${countNonEmptyWorkItems(studio.agentWorkData, "adaptationStrategyReview")}`,
      `scriptDraft=${countNonEmptyWorkItems(studio.agentWorkData, "scriptDraft")}`,
      `scriptDraftReview=${countNonEmptyWorkItems(studio.agentWorkData, "scriptDraftReview")}`,
    ].join("; ");
  }
  if (stageId === "assets") {
    const batch = studio.entityExtractions[0];
    return `entityExtraction=characters:${batch?.characters.length ?? 0}, scenes:${batch?.scenes.length ?? 0}, props:${batch?.props.length ?? 0}`;
  }
  if (stageId === "storyboard") {
    return `directorPlan=${studio.scriptPlans.length}; storyboards=${studio.storyboards.length}; imageRefs=${studio.storyboards.filter((item) => item.mediaRef?.path).length}; voiceBindings=${Object.keys(ttsProject?.bindings ?? {}).length}; voiceLines=${Object.keys(ttsProject?.voiceLines ?? {}).length}`;
  }
  if (stageId === "workbench") {
    const editingProjectId = editing.currentEditingProjectIdByEpisode[episodeId];
    const record = editingProjectId
      ? editing.timelineRenderRecordsByEditingProjectId[editingProjectId]
      : undefined;
    return `tracks=${studio.productionTracks.length}; selectedCandidates=${studio.productionTracks.filter((track) => track.selectedVideoId).length}; editingProject=${editingProjectId ?? "missing"}; editingRevision=${editingProjectId ? editing.editingProjects[editingProjectId]?.revision ?? "missing" : "missing"}; timelineRecord=${record?.evidence.jobId ?? "missing"}; seededTimelineEvidence=true`;
  }
  return "";
}

export function countNonEmptyWorkItems(
  items: AgentWorkData[],
  key: AgentWorkKey,
) {
  return items.filter((item) => item.key === key && item.data.trim()).length;
}
