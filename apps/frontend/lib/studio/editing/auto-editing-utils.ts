import type { AutoEditingDecision, AutoEditingWarning, EditingClip, EditingProjectV1, EditingSourceEvidence, EditingTrack } from "@/types/editing";
import { ApprovedEditingSfx, SelectedEditingBgm } from "./auto-editing-contract";

/**
 * 自动剪辑工具族——轨选择/来源规则/证据合并/决策与告警构造/记录判别。file-size-reduction 拆出,体逐字保留。
 */
export function orderedVisualClips(project: EditingProjectV1) {
  const visualTrackIds = new Set(
    project.tracks
      .filter((item) => item.kind === "video" || item.kind === "image")
      .map((item) => item.id),
  );
  return project.clips
    .filter((clip) => visualTrackIds.has(clip.trackId))
    .sort(
      (left, right) =>
        left.startUs - right.startUs || left.id.localeCompare(right.id),
    );
}

export function sourceRuleId(clip: EditingClip) {
  switch (clip.source.kind) {
    case "videoCandidate":
      return "source.selected-candidate";
    case "storyboardVideo":
      return "source.storyboard-video";
    case "storyboardImage":
      return "source.storyboard-image";
    default:
      return "source.adapter";
  }
}

export function sourceReason(clip: EditingClip) {
  switch (clip.source.kind) {
    case "videoCandidate":
      return "使用已选择、ready、非 stale 的视频候选";
    case "storyboardVideo":
      return "没有可用已选候选，使用分镜自身视频";
    case "storyboardImage":
      return "没有可用视频，使用分镜图片";
    default:
      return "使用 adapter 已验证的画面来源";
  }
}

export function track(
  id: string,
  kind: EditingTrack["kind"],
  name: string,
  order: number,
  clips: EditingClip[],
): EditingTrack {
  return {
    id,
    kind,
    name,
    order,
    clipIds: clips.map((clip) => clip.id),
    muted: false,
    locked: false,
  };
}

export function validSelectedAudio(value: SelectedEditingBgm) {
  return Boolean(
    value.id.trim() &&
      value.mediaId.trim() &&
      value.name.trim() &&
      value.path.trim(),
  );
}

export function validApprovedSfx(value: ApprovedEditingSfx) {
  return (
    validSelectedAudio(value) &&
    value.storyboardId.trim().length > 0 &&
    Number.isSafeInteger(value.durationUs) &&
    value.durationUs > 0
  );
}

export function mergeEvidence(
  from: EditingSourceEvidence,
  to: EditingSourceEvidence,
): EditingSourceEvidence {
  return {
    storyboardId: to.storyboardId ?? from.storyboardId,
    trackId: to.trackId ?? from.trackId,
    candidateId: to.candidateId ?? from.candidateId,
    mediaId: to.mediaId ?? from.mediaId,
    sourceRunId: to.sourceRunId ?? from.sourceRunId,
    sourceFingerprint: to.sourceFingerprint ?? from.sourceFingerprint,
    outputVersion: to.outputVersion ?? from.outputVersion,
  };
}

export function decision(
  id: string,
  kind: AutoEditingDecision["kind"],
  ruleId: string,
  targetId: string,
  input: AutoEditingDecision["input"],
  output: AutoEditingDecision["output"],
  reason: string,
  sourceEvidence: EditingSourceEvidence,
): AutoEditingDecision {
  return {
    id,
    kind,
    ruleId,
    targetId,
    input,
    output,
    reason,
    sourceEvidence,
  };
}

export function warning(
  code: string,
  message: string,
  recoverable: boolean,
  targetId?: string,
): AutoEditingWarning {
  return { code, message, recoverable, ...(targetId ? { targetId } : {}) };
}

export function projectInvalidWarning(message: string | undefined) {
  return warning(
    "editing.auto.project_invalid",
    message ?? "一键剪辑项目未通过 T1 validator",
    false,
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
