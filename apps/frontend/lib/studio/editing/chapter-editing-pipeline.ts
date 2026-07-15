import type {
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderEvidence,
  TimelineRenderPlan,
  TimelineRenderRecord,
  TimelineRenderResult,
} from "@/types/editing";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import {
  runAutoEditingDraft,
  STORY_DRIVEN_V1_PRESET,
  type RunAutoEditingDraftResult,
} from "./auto-editing-engine";
import { buildEditingSourceSnapshotHash } from "./source-snapshot";
import { compileTimelineRenderPlan } from "./timeline-render-compiler";
import { validateTimelineRenderRecord } from "./validation";

export interface BuildChapterEditingProjectInput {
  projectId: string;
  episodeId: string;
  projectName: string;
  aspectRatio?: string;
  directorPlan?: ScriptPlan;
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  existingProjects: EditingProjectV1[];
  runId: string;
  editingProjectId: string;
  now: () => number;
  onRun?: (run: AutoEditingRun) => void | Promise<void>;
}

export type BuildChapterEditingProjectResult = RunAutoEditingDraftResult;

export async function buildChapterEditingProject(
  input: BuildChapterEditingProjectInput,
): Promise<BuildChapterEditingProjectResult> {
  const sourceSnapshotHash = await buildEditingSourceSnapshotHash({
    projectId: input.projectId,
    episodeId: input.episodeId,
    aspectRatio: input.aspectRatio,
    directorPlan: input.directorPlan,
    storyboards: input.storyboards,
    productionTracks: input.productionTracks,
    videoCandidates: input.videoCandidates,
  });
  return runAutoEditingDraft({
    request: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      mode: "draft",
      preset: STORY_DRIVEN_V1_PRESET,
    },
    adapterInput: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      sourceSnapshotHash,
      sourceRunId: input.directorPlan?.id,
      aspectRatio: input.aspectRatio,
      storyboards: input.storyboards,
      productionTracks: input.productionTracks,
      videoCandidates: input.videoCandidates,
      directorPlan: input.directorPlan,
    },
    existingProjects: input.existingProjects,
    runId: input.runId,
    editingProjectId: input.editingProjectId,
    now: input.now,
    draftName: `${input.projectName} · ${input.episodeId} 自动剪辑`,
    onRun: input.onRun,
  });
}

export type RenderChapterEditingProjectResult =
  | {
      success: true;
      plan: TimelineRenderPlan;
      evidence: TimelineRenderEvidence;
    }
  | { success: false; jobId: string; error: string };

export async function renderChapterEditingProject(input: {
  project: EditingProjectV1;
  jobId: string;
  createdAt: number;
  render: (plan: TimelineRenderPlan) => Promise<TimelineRenderResult>;
}): Promise<RenderChapterEditingProjectResult> {
  const compiled = compileTimelineRenderPlan(input.project, {
    jobId: input.jobId,
    createdAt: input.createdAt,
  });
  if (!compiled.success) {
    return {
      success: false,
      jobId: input.jobId,
      error: compiled.issues.map((issue) => issue.message).join("；"),
    };
  }
  const rendered = await input.render(compiled.value);
  if (!rendered.success) {
    return { success: false, jobId: rendered.jobId, error: rendered.error };
  }
  if (rendered.evidence.jobId !== input.jobId) {
    return {
      success: false,
      jobId: input.jobId,
      error: "时间线渲染证据的 job ID 与编译计划不一致",
    };
  }
  return { success: true, plan: compiled.value, evidence: rendered.evidence };
}

export function createTimelineRenderRecord(
  project: EditingProjectV1,
  evidence: TimelineRenderEvidence,
  completedAt: number,
) {
  return validateTimelineRenderRecord({
    projectId: project.projectId,
    episodeId: project.episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash: project.sourceSnapshotHash,
    completedAt,
    evidence,
  } satisfies TimelineRenderRecord);
}
