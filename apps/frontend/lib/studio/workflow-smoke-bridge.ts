import { inspectWorkflow, seedCompleteWorkflow } from "./workflow-smoke-core";
import { isIsolatedSmokeUserDataDir, setWorkflowStage } from "./workflow-smoke-shared";
import { resetForStepwiseExecution, runStepwiseWorkflowStage } from "./workflow-smoke-steps";

export function installWorkflowSmokeBridge() {
  if (typeof window === "undefined" || !window.mystudioSmoke?.enabled) return;
  if (!isIsolatedSmokeUserDataDir(window.mystudioSmoke.userDataDir)) return;
  window.mystudioWorkflowSmoke = {
    seedCompleteWorkflow,
    inspectWorkflow,
    inspectWorkflowStages: inspectWorkflow,
    resetForStepwiseExecution,
    runStepwiseWorkflowStage,
    setWorkflowStage,
  };
}



export { DEFAULT_SMOKE_VIDEO_PATH, SMOKE_AUDIO_PATH, SMOKE_CHAPTER_ID, SMOKE_EDITING_PROJECT_ID, SMOKE_PROJECT_ID, SMOKE_PROP_ID, SMOKE_ROLE_ID, SMOKE_SCENE_ID, SMOKE_STORYBOARD_ID, SMOKE_TRACK_ID, SMOKE_VIDEO_ID, getSmokeAudioPath, getSmokeFrameGraphPath, getSmokeStoryboardFramePath, getSmokeVideoPath, isIsolatedSmokeUserDataDir, setWorkflowStage } from "./workflow-smoke-shared";
export type { WorkflowSmokeEditingEvidence, WorkflowSmokeInspection, WorkflowSmokeResult, WorkflowSmokeStageEvidence, WorkflowSmokeStageResult } from "./workflow-smoke-shared";
export { stepwiseEvidence } from "./workflow-smoke-evidence";
export { applyAssetsStep, applyManualsStep, applyNovelStep, applyScriptStep, applyStoryboardStep, applyWorkbenchStep, resetForStepwiseExecution, runStepwiseWorkflowStage } from "./workflow-smoke-steps";
export { bindSmokeVoice, inspectWorkflow, recordStageEvidence, run, seedCompleteWorkflow, stageEvidenceText, waitForPersist, work } from "./workflow-smoke-core";
