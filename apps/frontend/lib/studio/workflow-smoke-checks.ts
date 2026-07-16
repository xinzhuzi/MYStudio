import type { WorkflowStageReadiness } from "./workflow-readiness";
import type { WorkflowParityReport } from "./workflow-parity-report";

export interface WorkflowSmokeChecksInput {
  stages: WorkflowStageReadiness[];
  report: WorkflowParityReport;
  storyboardsCount: number;
  selectedCandidateCount: number;
  voiceBindingCount: number;
  completedVoiceAudioCount: number;
}

/** Builds the stable smoke contract checks from readiness and parity evidence. */
export function buildWorkflowSmokeChecks({
  stages,
  report,
  storyboardsCount,
  selectedCandidateCount,
  voiceBindingCount,
  completedVoiceAudioCount,
}: WorkflowSmokeChecksInput): Record<string, boolean> {
  return {
    manualsReady: stages[0]?.status === "ready",
    novelReady: stages[1]?.status === "ready",
    scriptReady: stages[2]?.status === "ready",
    assetsReady: stages[3]?.status === "ready",
    generationReady: stages[3]?.status === "ready",
    storyboardReady: stages[4]?.status === "ready",
    workbenchReady: stages[5]?.status === "ready",
    hasFinalExport: report.video.hasFinalExport,
    hasLegacyCompatibilityExport: report.video.hasLegacyCompatibilityExport,
    hasEditingProject: Boolean(report.video.currentEditingProjectId),
    hasTimelineRenderRecord: report.video.timelineRenderRecords > 0,
    hasCompleteTimelineEvidence: report.video.completeTimelineEvidence > 0,
    seededEditingEvidence: true,
    hasSelectedCandidate: selectedCandidateCount > 0,
    hasVoiceBinding: voiceBindingCount > 0,
    hasVoiceAudio: completedVoiceAudioCount > 0,
    hasWorkflowParityReport: true,
    workflowParityNoErrors: !report.issues.some((issue) => issue.severity === "error"),
    workflowParityHasOrderedReferences:
      report.references.storyboardsWithOrderedManifest === storyboardsCount,
    workflowParityHasSourceEvidence:
      report.storyboard.withSourceEvidence === storyboardsCount,
  };
}
