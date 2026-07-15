import type {
  EditingProjectV1,
  EditingValidationIssue,
  EditingValidationResult,
  TimelineRenderClip,
  TimelineRenderPlan,
} from "@/types/editing";
import {
  validateEditingProject,
  validateTimelineRenderPlan,
} from "./validation";
import { resolveEditingAudioDucking } from "./audio-policy";

export interface CompileTimelineRenderPlanOptions {
  jobId: string;
  createdAt: number;
}

const MAIN_VISUAL_TRACK_KINDS = new Set(["video", "image"]);

export function compileTimelineRenderPlan(
  projectValue: unknown,
  options: CompileTimelineRenderPlanOptions,
): EditingValidationResult<TimelineRenderPlan> {
  const projectResult = validateEditingProject(projectValue);
  if (!projectResult.success) return projectResult;

  const project = projectResult.value;
  const issues = validateCompilerInvariants(project, options);
  if (issues.length > 0) return { success: false, issues };

  const trackById = new Map(project.tracks.map((track) => [track.id, track]));
  const clips: TimelineRenderClip[] = project.clips
    .map((clip) => {
      const track = trackById.get(clip.trackId)!;
      return {
        id: clip.id,
        trackId: clip.trackId,
        trackKind: track.kind,
        source: clip.source,
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        trimStartUs: clip.trimStartUs,
        speed: clip.speed,
        volume: clip.volume,
        muted: clip.muted || track.muted,
        transform: clip.transform,
        fadeInUs: clip.fadeInUs,
        fadeOutUs: clip.fadeOutUs,
        envelope: clip.envelope,
        subtitle: clip.subtitle,
      };
    })
    .sort((left, right) => {
      const leftTrack = trackById.get(left.trackId)!;
      const rightTrack = trackById.get(right.trackId)!;
      return leftTrack.order - rightTrack.order
        || left.startUs - right.startUs
        || left.id.localeCompare(right.id);
    });

  const plan: TimelineRenderPlan = {
    schemaVersion: 1,
    jobId: options.jobId,
    projectId: project.projectId,
    episodeId: project.episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash: project.sourceSnapshotHash,
    editingProjectSnapshot: structuredClone(project),
    renderSettings: {
      ...project.renderSettings,
      audioDucking: resolveEditingAudioDucking(project.renderSettings.audioDucking),
    },
    clips,
    transitions: [...project.transitions].sort((left, right) =>
      left.fromClipId.localeCompare(right.fromClipId)
        || left.toClipId.localeCompare(right.toClipId)
        || left.id.localeCompare(right.id),
    ),
    effects: [...project.effects]
      .filter((effect) => effect.enabled)
      .sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id)),
    createdAt: options.createdAt,
  };

  return validateTimelineRenderPlan(plan);
}

function validateCompilerInvariants(
  project: EditingProjectV1,
  options: CompileTimelineRenderPlanOptions,
) {
  const issues: EditingValidationIssue[] = [];
  if (!options.jobId.trim()) {
    issues.push(issue("editing.render.job_id", "$.jobId", "渲染任务 ID 不能为空"));
  }
  if (!Number.isSafeInteger(options.createdAt) || options.createdAt < 0) {
    issues.push(issue("editing.render.created_at", "$.createdAt", "渲染时间必须是非负安全整数"));
  }

  const trackById = new Map(project.tracks.map((track) => [track.id, track]));
  const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const mainVisuals = project.clips
    .filter((clip) => MAIN_VISUAL_TRACK_KINDS.has(trackById.get(clip.trackId)?.kind ?? ""))
    .sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id));

  if (mainVisuals.length === 0) {
    issues.push(issue("editing.render.main_visual_missing", "$.clips", "时间线缺少主画面片段"));
  }

  for (const [index, clip] of mainVisuals.entries()) {
    const previous = mainVisuals[index - 1];
    if (previous && previous.startUs + previous.durationUs > clip.startUs) {
      issues.push(issue(
        "editing.render.main_visual_overlap",
        `$.clips.${clip.id}`,
        `主画面片段重叠: ${previous.id} -> ${clip.id}`,
      ));
    }
    if (clip.source.kind !== "text" && !clip.source.path?.trim()) {
      issues.push(issue(
        "editing.render.source_missing",
        `$.clips.${clip.id}.source.path`,
        `片段缺少素材路径: ${clip.id}`,
      ));
    }
  }

  for (const transition of project.transitions) {
    if (transition.effectId === "cut") continue;
    const from = clipById.get(transition.fromClipId);
    const to = clipById.get(transition.toClipId);
    if (!from || !to) continue;
    const maxDurationUs = Math.min(350_000, Math.floor(Math.min(from.durationUs, to.durationUs) * 0.15));
    if (transition.durationUs > maxDurationUs) {
      issues.push(issue(
        "editing.render.transition_too_long",
        `$.transitions.${transition.id}.durationUs`,
        `转场超过镜头允许上限: ${transition.id}`,
      ));
    }
  }

  return issues;
}

function issue(code: string, path: string, message: string): EditingValidationIssue {
  return { code, path, message };
}
