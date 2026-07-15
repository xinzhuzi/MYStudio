import { useMemo } from "react";
import {
  buildWorkflowReadiness,
  type WorkflowReadinessInput,
} from "@/lib/studio/workflow-readiness";
import { useTtsStore } from "@/stores/tts-store";
import { useEditingStore } from "@/stores/editing-store";

type WorkflowReadinessHookInput = Omit<
  WorkflowReadinessInput,
  | "voiceBindings"
  | "sceneVoiceLines"
  | "capabilities"
  | "fileExists"
  | "editingProjects"
  | "currentEditingProjectIdByEpisode"
  | "timelineRenderRecordsByEditingProjectId"
>;

export function useWorkflowReadiness({
  workflowConfig,
  novelChapters,
  agentWorkData,
  entityExtractions,
  scriptPlans,
  seriesBible,
  storyboards,
  productionTracks,
  videoCandidates,
  episodeId,
}: WorkflowReadinessHookInput) {
  const ttsProjectForReadiness = useTtsStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : undefined,
  );
  const editingProjects = useEditingStore((state) => state.editingProjects);
  const currentEditingProjectIdByEpisode = useEditingStore(
    (state) => state.currentEditingProjectIdByEpisode,
  );
  const timelineRenderRecordsByEditingProjectId = useEditingStore(
    (state) => state.timelineRenderRecordsByEditingProjectId,
  );

  return useMemo(
    () =>
      buildWorkflowReadiness({
        workflowConfig,
        novelChapters,
        agentWorkData,
        entityExtractions,
        scriptPlans,
        seriesBible,
        storyboards,
        productionTracks,
        videoCandidates,
        episodeId,
        editingProjects,
        currentEditingProjectIdByEpisode,
        timelineRenderRecordsByEditingProjectId,
        voiceBindings: Object.values(ttsProjectForReadiness?.bindings ?? {}),
        sceneVoiceLines: Object.values(
          ttsProjectForReadiness?.voiceLines ?? {},
        ),
        capabilities: {
          textCompletion: Boolean(window.electronAPI?.textCompletion),
          studioRenderer: Boolean(window.studioRenderer),
        },
      }),
    [
      agentWorkData,
      entityExtractions,
      editingProjects,
      currentEditingProjectIdByEpisode,
      episodeId,
      novelChapters,
      productionTracks,
      scriptPlans,
      seriesBible,
      storyboards,
      ttsProjectForReadiness?.bindings,
      ttsProjectForReadiness?.voiceLines,
      timelineRenderRecordsByEditingProjectId,
      videoCandidates,
      workflowConfig,
    ],
  );
}
