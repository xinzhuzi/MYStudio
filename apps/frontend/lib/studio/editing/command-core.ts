import type {
  EditingAudioEnvelopePoint,
  EditingClip,
  EditingClipSource,
  EditingEffect,
  EditingProjectV1,
  EditingProposal,
  EditingTransition,
  EditingValidationIssue,
} from "@/types/editing";
import { validateEditingProject } from "./validation";

interface EditingCommandBase {
  issuedAt: number;
}

export type EditingProposalPatch = Partial<Pick<
  EditingProposal,
  "effectId" | "targetClipId" | "startUs" | "durationUs" | "params" | "reason"
>>;

export type EditingCommand =
  | (EditingCommandBase & {
      type: "clip.split";
      clipId: string;
      splitAtUs: number;
      newClipId: string;
    })
  | (EditingCommandBase & {
      type: "clip.trim";
      clipId: string;
      startUs: number;
      durationUs: number;
      trimStartUs: number;
    })
  | (EditingCommandBase & {
      type: "clip.move";
      clipId: string;
      trackId: string;
      startUs: number;
    })
  | (EditingCommandBase & {
      type: "clip.replaceSource";
      clipId: string;
      source: EditingClipSource;
    })
  | (EditingCommandBase & {
      type: "clip.updateAudio";
      clipId: string;
      volume: number;
      muted: boolean;
      fadeInUs?: number;
      fadeOutUs?: number;
      envelope?: EditingAudioEnvelopePoint[];
    })
  | (EditingCommandBase & {
      type: "clip.updateText";
      clipId: string;
      text: string;
    })
  | (EditingCommandBase & {
      type: "subtitle.replaceTrackCues";
      trackId: string;
      trackName?: string;
      clips: EditingClip[];
    })
  | (EditingCommandBase & { type: "effect.upsert"; effect: EditingEffect })
  | (EditingCommandBase & { type: "effect.remove"; effectId: string })
  | (EditingCommandBase & {
      type: "transition.upsert";
      transition: EditingTransition;
    })
  | (EditingCommandBase & {
      type: "transition.remove";
      transitionId: string;
    })
  | (EditingCommandBase & {
      type: "proposal.modify";
      proposalId: string;
      patch: EditingProposalPatch;
    })
  | (EditingCommandBase & { type: "proposal.accept"; proposalIds: string[] })
  | (EditingCommandBase & { type: "proposal.reject"; proposalId: string })
  | (EditingCommandBase & { type: "proposal.disable"; proposalId: string });

export type EditingCommandResult =
  | { success: true; project: EditingProjectV1 }
  | { success: false; issue: EditingValidationIssue };

export interface EditingHistoryEntry {
  command: EditingCommand;
  before: EditingProjectV1;
  after: EditingProjectV1;
}

export interface EditingCommandHistory {
  present: EditingProjectV1;
  past: EditingHistoryEntry[];
  future: EditingHistoryEntry[];
  limit: number;
}

export type EditingHistoryResult =
  | { success: true; history: EditingCommandHistory }
  | { success: false; issue: EditingValidationIssue };

export interface TimelineSnapRequest {
  project: EditingProjectV1;
  proposedTimeUs: number;
  thresholdUs: number;
  markersUs?: number[];
  excludeClipId?: string;
}

export type TimelineSnapResult =
  | { snapped: true; timeUs: number; targetUs: number }
  | { snapped: false; timeUs: number };

export function applyEditingCommand(
  project: EditingProjectV1,
  command: EditingCommand,
): EditingCommandResult {
  if (!isNonNegativeSafeInteger(command.issuedAt)) {
    return failure("editing.command.issued_at", "$.issuedAt", "命令时间必须是非负安全整数");
  }

  let changed: EditingProjectV1 | EditingCommandResult;
  switch (command.type) {
    case "clip.split":
      changed = splitClip(project, command);
      break;
    case "clip.trim":
      changed = trimClip(project, command);
      break;
    case "clip.move":
      changed = moveClip(project, command);
      break;
    case "clip.replaceSource":
      changed = replaceClipSource(project, command);
      break;
    case "clip.updateAudio":
      changed = updateClipAudio(project, command);
      break;
    case "clip.updateText":
      changed = updateClipText(project, command);
      break;
    case "subtitle.replaceTrackCues":
      changed = replaceSubtitleTrackCues(project, command);
      break;
    case "effect.upsert":
      changed = {
        ...project,
        effects: upsertById(project.effects, command.effect),
      };
      break;
    case "effect.remove":
      changed = removeEffect(project, command.effectId);
      break;
    case "transition.upsert":
      changed = {
        ...project,
        transitions: upsertById(project.transitions, command.transition),
      };
      break;
    case "transition.remove":
      changed = removeTransition(project, command.transitionId);
      break;
    case "proposal.modify":
      changed = modifyProposal(project, command.proposalId, command.patch);
      break;
    case "proposal.accept":
      changed = acceptProposals(project, command.proposalIds);
      break;
    case "proposal.reject":
      changed = rejectProposal(project, command.proposalId);
      break;
    case "proposal.disable":
      changed = disableProposal(project, command.proposalId);
      break;
  }
  if (isCommandResult(changed)) return changed;

  const finalized: EditingProjectV1 = {
    ...changed,
    revision: project.revision + 1,
    manuallyEdited: true,
    updatedAt: command.issuedAt,
  };
  const validation = validateEditingProject(finalized);
  if (!validation.success) {
    return {
      success: false,
      issue: validation.issues[0] ?? {
        code: "editing.command.invalid_project",
        path: "$",
        message: "命令产生了无效剪辑项目",
      },
    };
  }
  return { success: true, project: validation.value };
}

function splitClip(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.split" }>,
): EditingProjectV1 | EditingCommandResult {
  const clipIndex = project.clips.findIndex((clip) => clip.id === command.clipId);
  if (clipIndex < 0) return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  if (project.clips.some((clip) => clip.id === command.newClipId)) {
    return failure("editing.command.clip_duplicate", "$.newClipId", "新片段 ID 已存在");
  }
  const clip = project.clips[clipIndex];
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (!track) return failure("editing.command.track_missing", "$.clipId", "片段轨道不存在");
  if (track.locked) return failure("editing.command.track_locked", "$.clipId", "片段轨道已锁定");
  const clipEndUs = clip.startUs + clip.durationUs;
  if (command.splitAtUs <= clip.startUs || command.splitAtUs >= clipEndUs) {
    return failure("editing.command.split_boundary", "$.splitAtUs", "切分点必须位于片段内部");
  }
  const leftDurationUs = command.splitAtUs - clip.startUs;
  const trimAdvanceUs = Math.round(leftDurationUs * clip.speed);
  const rightTrimStartUs = clip.trimStartUs + trimAdvanceUs;
  if (!isNonNegativeSafeInteger(rightTrimStartUs)) {
    return failure("editing.command.split_trim", "$.splitAtUs", "切分后的源偏移无效");
  }
  const left = { ...clip, durationUs: leftDurationUs };
  const right = {
    ...clip,
    id: command.newClipId,
    name: `${clip.name} 右段`,
    startUs: command.splitAtUs,
    durationUs: clipEndUs - command.splitAtUs,
    trimStartUs: rightTrimStartUs,
  };
  const clips = [...project.clips];
  clips.splice(clipIndex, 1, left, right);
  const memberIndex = track.clipIds.indexOf(clip.id);
  const nextClipIds = [...track.clipIds];
  nextClipIds.splice(memberIndex + 1, 0, right.id);
  return {
    ...project,
    clips,
    tracks: project.tracks.map((item) =>
      item.id === track.id ? { ...item, clipIds: nextClipIds } : item,
    ),
  };
}

function trimClip(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.trim" }>,
): EditingProjectV1 | EditingCommandResult {
  const clip = project.clips.find((item) => item.id === command.clipId);
  if (!clip) return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) return failure("editing.command.track_locked", "$.clipId", "片段轨道已锁定");
  if (!isNonNegativeSafeInteger(command.startUs)) {
    return failure("editing.command.trim_start", "$.startUs", "开始时间必须是非负安全整数");
  }
  if (!isPositiveSafeInteger(command.durationUs)) {
    return failure("editing.command.trim_duration", "$.durationUs", "时长必须是正安全整数");
  }
  if (!isNonNegativeSafeInteger(command.trimStartUs)) {
    return failure("editing.command.trim_source", "$.trimStartUs", "源偏移必须是非负安全整数");
  }
  return {
    ...project,
    clips: project.clips.map((item) => item.id === clip.id
      ? {
          ...item,
          startUs: command.startUs,
          durationUs: command.durationUs,
          trimStartUs: command.trimStartUs,
        }
      : item),
  };
}

function moveClip(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.move" }>,
): EditingProjectV1 | EditingCommandResult {
  const clip = project.clips.find((item) => item.id === command.clipId);
  if (!clip) return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  if (!isNonNegativeSafeInteger(command.startUs)) {
    return failure("editing.command.move_start", "$.startUs", "开始时间必须是非负安全整数");
  }
  const sourceTrack = project.tracks.find((track) => track.id === clip.trackId);
  const targetTrack = project.tracks.find((track) => track.id === command.trackId);
  if (!sourceTrack || !targetTrack) {
    return failure("editing.command.track_missing", "$.trackId", "目标或来源轨道不存在");
  }
  if (sourceTrack.locked || targetTrack.locked) {
    return failure("editing.command.track_locked", "$.trackId", "来源或目标轨道已锁定");
  }
  const clips = project.clips.map((item) => item.id === clip.id
    ? { ...item, trackId: targetTrack.id, startUs: command.startUs }
    : item);
  const clipById = new Map(clips.map((item) => [item.id, item]));
  const tracks = project.tracks.map((track) => {
    const withoutMoved = track.clipIds.filter((id) => id !== clip.id);
    const ids = track.id === targetTrack.id
      ? [...withoutMoved, clip.id]
      : withoutMoved;
    return {
      ...track,
      clipIds: ids.sort((left, right) =>
        (clipById.get(left)?.startUs ?? 0) - (clipById.get(right)?.startUs ?? 0)
        || left.localeCompare(right)),
    };
  });
  return { ...project, clips, tracks };
}

function replaceClipSource(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.replaceSource" }>,
): EditingProjectV1 | EditingCommandResult {
  if (!project.clips.some((clip) => clip.id === command.clipId)) {
    return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  }
  return {
    ...project,
    clips: project.clips.map((clip) =>
      clip.id === command.clipId ? { ...clip, source: command.source } : clip,
    ),
  };
}

function updateClipAudio(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.updateAudio" }>,
): EditingProjectV1 | EditingCommandResult {
  const clip = project.clips.find((item) => item.id === command.clipId);
  if (!clip) return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (!track) return failure("editing.command.track_missing", "$.clipId", "片段轨道不存在");
  if (track.locked) return failure("editing.command.track_locked", "$.clipId", "片段轨道已锁定");
  if (!new Set(["voice", "bgm", "sfx"]).has(track.kind)) {
    return failure("editing.command.audio_track", "$.clipId", "只有 voice、BGM 或 SFX 片段可编辑音频属性");
  }
  return {
    ...project,
    clips: project.clips.map((item) => item.id === clip.id
      ? {
          ...item,
          volume: command.volume,
          muted: command.muted,
          fadeInUs: command.fadeInUs,
          fadeOutUs: command.fadeOutUs,
          envelope: command.envelope?.map((point) => ({ ...point })),
        }
      : item),
  };
}

function updateClipText(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "clip.updateText" }>,
): EditingProjectV1 | EditingCommandResult {
  const clip = project.clips.find((item) => item.id === command.clipId);
  if (!clip) return failure("editing.command.clip_missing", "$.clipId", "片段不存在");
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (!track) return failure("editing.command.track_missing", "$.clipId", "片段轨道不存在");
  if (track.locked) return failure("editing.command.track_locked", "$.clipId", "片段轨道已锁定");
  if (track.kind !== "text" || clip.source.kind !== "text") {
    return failure("editing.command.subtitle_clip", "$.clipId", "只有字幕片段可编辑文本");
  }
  return {
    ...project,
    clips: project.clips.map((item) => item.id === clip.id
      ? { ...item, source: { ...item.source, text: command.text } }
      : item),
  };
}

function replaceSubtitleTrackCues(
  project: EditingProjectV1,
  command: Extract<EditingCommand, { type: "subtitle.replaceTrackCues" }>,
): EditingProjectV1 | EditingCommandResult {
  const track = project.tracks.find((item) => item.id === command.trackId) ?? {
    id: command.trackId,
    kind: "text" as const,
    name: command.trackName?.trim() || "字幕",
    order: Math.max(-1, ...project.tracks.map((item) => item.order)) + 1,
    clipIds: [],
    muted: false,
    locked: false,
  };
  if (track.locked) return failure("editing.command.track_locked", "$.trackId", "字幕轨道已锁定");
  if (track.kind !== "text") {
    return failure("editing.command.subtitle_track", "$.trackId", "目标轨道不是字幕轨道");
  }
  if (command.clips.some((clip) => clip.trackId !== track.id || clip.source.kind !== "text")) {
    return failure("editing.command.subtitle_clip", "$.clips", "导入字幕必须全部属于目标 text 轨道");
  }
  const previousIds = new Set(track.clipIds);
  return {
    ...project,
    tracks: project.tracks.some((item) => item.id === track.id)
      ? project.tracks.map((item) => item.id === track.id
          ? { ...item, clipIds: command.clips.map((clip) => clip.id) }
          : item)
      : [...project.tracks, { ...track, clipIds: command.clips.map((clip) => clip.id) }],
    clips: [
      ...project.clips.filter((clip) => !previousIds.has(clip.id)),
      ...command.clips.map((clip) => structuredClone(clip)),
    ],
  };
}

function removeEffect(
  project: EditingProjectV1,
  effectId: string,
): EditingProjectV1 | EditingCommandResult {
  if (!project.effects.some((effect) => effect.id === effectId)) {
    return failure("editing.command.effect_missing", "$.effectId", "效果不存在");
  }
  return {
    ...project,
    effects: project.effects.filter((effect) => effect.id !== effectId),
  };
}

function removeTransition(
  project: EditingProjectV1,
  transitionId: string,
): EditingProjectV1 | EditingCommandResult {
  if (!project.transitions.some((transition) => transition.id === transitionId)) {
    return failure("editing.command.transition_missing", "$.transitionId", "转场不存在");
  }
  return {
    ...project,
    transitions: project.transitions.filter(
      (transition) => transition.id !== transitionId,
    ),
  };
}

const EDITABLE_PROPOSAL_KEYS = new Set([
  "effectId",
  "targetClipId",
  "startUs",
  "durationUs",
  "params",
  "reason",
]);

function modifyProposal(
  project: EditingProjectV1,
  proposalId: string,
  patch: EditingProposalPatch,
): EditingProjectV1 | EditingCommandResult {
  const proposal = project.proposals.find((item) => item.id === proposalId);
  if (!proposal) {
    return failure("editing.command.proposal_missing", "$.proposalId", "剪辑建议不存在");
  }
  if (proposal.status !== "pending") {
    return failure("editing.command.proposal_status", "$.proposalId", "只有 pending 建议可以修改");
  }
  if (Object.keys(patch).some((key) => !EDITABLE_PROPOSAL_KEYS.has(key))) {
    return failure("editing.command.proposal_patch", "$.patch", "建议修改包含非白名单字段");
  }
  return {
    ...project,
    proposals: project.proposals.map((proposal) =>
      proposal.id === proposalId
        ? {
            ...proposal,
            ...patch,
            ...(patch.params ? { params: { ...patch.params } } : {}),
          }
        : proposal,
    ),
  };
}

function acceptProposals(
  project: EditingProjectV1,
  proposalIds: string[],
): EditingProjectV1 | EditingCommandResult {
  const orderedIds = [...new Set(proposalIds)].sort((left, right) => left.localeCompare(right));
  if (orderedIds.length === 0) {
    return failure("editing.command.proposal_batch_empty", "$.proposalIds", "至少选择一条剪辑建议");
  }
  const proposalById = new Map(project.proposals.map((proposal) => [proposal.id, proposal]));
  const accepted: EditingProposal[] = [];
  for (const proposalId of orderedIds) {
    const proposal = proposalById.get(proposalId);
    if (!proposal) {
      return failure("editing.command.proposal_missing", "$.proposalIds", `剪辑建议不存在: ${proposalId}`);
    }
    if (proposal.status !== "pending") {
      return failure("editing.command.proposal_status", "$.proposalIds", `只有 pending 建议可以接受: ${proposalId}`);
    }
    const effectId = effectIdForProposal(proposalId);
    if (project.effects.some((effect) => effect.id === effectId || effect.proposalId === proposalId)) {
      return failure("editing.command.proposal_effect_exists", "$.proposalIds", `建议已存在关联效果: ${proposalId}`);
    }
    const clip = project.clips.find((item) => item.id === proposal.targetClipId);
    const track = project.tracks.find((item) => item.id === clip?.trackId);
    if (track?.locked) {
      return failure("editing.command.track_locked", "$.proposalIds", `建议目标轨道已锁定: ${proposalId}`);
    }
    accepted.push(proposal);
  }

  const acceptedIds = new Set(orderedIds);
  const effects = accepted.map((proposal): EditingEffect => ({
    id: effectIdForProposal(proposal.id),
    effectId: proposal.effectId,
    targetClipId: proposal.targetClipId,
    startUs: proposal.startUs,
    durationUs: proposal.durationUs,
    params: { ...proposal.params },
    enabled: true,
    proposalId: proposal.id,
  }));
  return {
    ...project,
    proposals: project.proposals.map((proposal) =>
      acceptedIds.has(proposal.id) ? { ...proposal, status: "accepted" } : proposal,
    ),
    effects: [...project.effects, ...effects],
  };
}

function rejectProposal(
  project: EditingProjectV1,
  proposalId: string,
): EditingProjectV1 | EditingCommandResult {
  const proposal = project.proposals.find((item) => item.id === proposalId);
  if (!proposal) return failure("editing.command.proposal_missing", "$.proposalId", "剪辑建议不存在");
  if (proposal.status !== "pending") {
    return failure("editing.command.proposal_status", "$.proposalId", "只有 pending 建议可以拒绝");
  }
  return {
    ...project,
    proposals: project.proposals.map((item) =>
      item.id === proposalId ? { ...item, status: "rejected" } : item,
    ),
  };
}

function disableProposal(
  project: EditingProjectV1,
  proposalId: string,
): EditingProjectV1 | EditingCommandResult {
  const proposal = project.proposals.find((item) => item.id === proposalId);
  if (!proposal) return failure("editing.command.proposal_missing", "$.proposalId", "剪辑建议不存在");
  if (proposal.status !== "accepted") {
    return failure("editing.command.proposal_status", "$.proposalId", "只有 accepted 建议可以禁用");
  }
  const linkedEffect = project.effects.find((effect) => effect.proposalId === proposalId);
  if (!linkedEffect) {
    return failure("editing.command.proposal_effect_missing", "$.proposalId", "已接受建议缺少关联效果");
  }
  return {
    ...project,
    proposals: project.proposals.map((item) =>
      item.id === proposalId ? { ...item, status: "disabled" } : item,
    ),
    effects: project.effects.map((effect) =>
      effect.id === linkedEffect.id ? { ...effect, enabled: false } : effect,
    ),
  };
}

export function effectIdForProposal(proposalId: string) {
  return `effect-from-proposal-${proposalId}`;
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function isCommandResult(
  value: EditingProjectV1 | EditingCommandResult,
): value is EditingCommandResult {
  return Boolean(value && "success" in value);
}

function failure(
  code: string,
  path: string,
  message: string,
): EditingCommandResult {
  return { success: false, issue: { code, path, message } };
}

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export function snapTimelineTime(
  request: TimelineSnapRequest,
): TimelineSnapResult {
  if (
    !isNonNegativeSafeInteger(request.proposedTimeUs)
    || !isNonNegativeSafeInteger(request.thresholdUs)
  ) {
    return { snapped: false, timeUs: request.proposedTimeUs };
  }
  const targets = new Set<number>([0]);
  for (const clip of request.project.clips) {
    if (clip.id === request.excludeClipId) continue;
    targets.add(clip.startUs);
    targets.add(clip.startUs + clip.durationUs);
  }
  for (const marker of request.markersUs ?? []) {
    if (isNonNegativeSafeInteger(marker)) targets.add(marker);
  }
  const ordered = [...targets].sort((left, right) => left - right);
  let nearest: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of ordered) {
    const distance = Math.abs(target - request.proposedTimeUs);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  if (nearest !== undefined && nearestDistance <= request.thresholdUs) {
    return { snapped: true, timeUs: nearest, targetUs: nearest };
  }
  return { snapped: false, timeUs: request.proposedTimeUs };
}

export function createEditingHistory(
  project: EditingProjectV1,
  limit = 100,
): EditingCommandHistory {
  return {
    present: project,
    past: [],
    future: [],
    limit: isPositiveSafeInteger(limit) ? limit : 100,
  };
}

export function executeEditingHistory(
  history: EditingCommandHistory,
  command: EditingCommand,
): EditingHistoryResult {
  const result = applyEditingCommand(history.present, command);
  if (!result.success) return result;
  const entry: EditingHistoryEntry = {
    command,
    before: history.present,
    after: result.project,
  };
  return {
    success: true,
    history: {
      ...history,
      present: result.project,
      past: [...history.past, entry].slice(-history.limit),
      future: [],
    },
  };
}

export function undoEditingHistory(
  history: EditingCommandHistory,
  issuedAt: number,
): EditingHistoryResult {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    return {
      success: false,
      issue: { code: "editing.history.undo_empty", path: "$", message: "没有可撤销命令" },
    };
  }
  const present = restoreHistorySnapshot(entry.before, history.present, issuedAt);
  if (!present.success) return present;
  return {
    success: true,
    history: {
      ...history,
      present: present.project,
      past: history.past.slice(0, -1),
      future: [entry, ...history.future],
    },
  };
}

export function redoEditingHistory(
  history: EditingCommandHistory,
  issuedAt: number,
): EditingHistoryResult {
  const entry = history.future[0];
  if (!entry) {
    return {
      success: false,
      issue: { code: "editing.history.redo_empty", path: "$", message: "没有可重做命令" },
    };
  }
  const present = restoreHistorySnapshot(entry.after, history.present, issuedAt);
  if (!present.success) return present;
  return {
    success: true,
    history: {
      ...history,
      present: present.project,
      past: [...history.past, entry].slice(-history.limit),
      future: history.future.slice(1),
    },
  };
}

function restoreHistorySnapshot(
  snapshot: EditingProjectV1,
  current: EditingProjectV1,
  issuedAt: number,
): EditingCommandResult {
  if (!isNonNegativeSafeInteger(issuedAt)) {
    return failure("editing.command.issued_at", "$.issuedAt", "命令时间必须是非负安全整数");
  }
  const project: EditingProjectV1 = {
    ...snapshot,
    revision: current.revision + 1,
    manuallyEdited: true,
    updatedAt: issuedAt,
  };
  const validation = validateEditingProject(project);
  if (!validation.success) {
    return {
      success: false,
      issue: validation.issues[0] ?? {
        code: "editing.history.invalid_snapshot",
        path: "$",
        message: "历史快照无效",
      },
    };
  }
  return { success: true, project: validation.value };
}
