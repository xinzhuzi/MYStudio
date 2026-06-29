import { useMemo } from "react";
import {
  buildWorkflowReadiness,
  type WorkflowReadinessInput,
} from "@/lib/studio/workflow-readiness";
import { useTtsStore } from "@/stores/tts-store";

type WorkflowReadinessHookInput = Omit<
  WorkflowReadinessInput,
  "voiceBindings" | "sceneVoiceLines" | "capabilities" | "fileExists"
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
}: WorkflowReadinessHookInput) {
  const ttsProjectForReadiness = useTtsStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : undefined,
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
      novelChapters,
      productionTracks,
      scriptPlans,
      seriesBible,
      storyboards,
      ttsProjectForReadiness?.bindings,
      ttsProjectForReadiness?.voiceLines,
      videoCandidates,
      workflowConfig,
    ],
  );
}
