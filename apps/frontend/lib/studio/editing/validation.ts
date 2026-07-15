import type {
  AutoEditingRun,
  EditingEffect,
  EditingEffectParams,
  EditingProjectV1,
  EditingProposal,
  EditingRenderSettings,
  EditingTransition,
  EditingValidationIssue,
  EditingValidationResult,
  TimelineRenderRecord,
  TimelineRenderPlan,
} from "@/types/editing";
import {
  getEditingEffectDefinition,
  isEditingEffectId,
} from "./effect-registry";

const TRACK_KINDS = new Set([
  "video",
  "image",
  "overlay",
  "text",
  "voice",
  "bgm",
  "sfx",
  "effect",
]);
const SOURCE_KINDS = new Set([
  "storyboardImage",
  "storyboardVideo",
  "videoCandidate",
  "audio",
  "text",
  "asset",
]);
const PROPOSAL_STATUSES = new Set([
  "pending",
  "accepted",
  "disabled",
  "rejected",
]);
const VISUAL_EFFECT_TRACK_KINDS = new Set(["video", "image"]);

interface EffectTargetInfo {
  startUs: unknown;
  durationUs: unknown;
  trackKind: unknown;
  sourceKind: unknown;
}

export function validateEditingProject(
  value: unknown,
): EditingValidationResult<EditingProjectV1> {
  const issues: EditingValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "editing.project.object", "$", "剪辑项目必须是对象");
    return { success: false, issues };
  }

  exactOne(value.schemaVersion, issues, "$.schemaVersion");
  requiredString(value.id, issues, "$.id");
  requiredString(value.projectId, issues, "$.projectId");
  requiredString(value.episodeId, issues, "$.episodeId");
  requiredString(value.name, issues, "$.name");
  positiveInteger(value.revision, issues, "$.revision", "editing.revision");
  requiredString(value.sourceSnapshotHash, issues, "$.sourceSnapshotHash");
  optionalString(value.sourceRunId, issues, "$.sourceRunId");
  enumValue(value.createdBy, new Set(["auto", "manual"]), issues, "$.createdBy", "editing.created_by");
  booleanValue(value.manuallyEdited, issues, "$.manuallyEdited");
  booleanValue(value.stale, issues, "$.stale");
  optionalString(value.staleReason, issues, "$.staleReason");
  validateRenderSettings(value.renderSettings, issues, "$.renderSettings", false);
  nonNegativeInteger(value.createdAt, issues, "$.createdAt");
  nonNegativeInteger(value.updatedAt, issues, "$.updatedAt");

  const tracks = arrayValue(value.tracks, issues, "$.tracks");
  const clips = arrayValue(value.clips, issues, "$.clips");
  const transitions = arrayValue(value.transitions, issues, "$.transitions");
  const effects = arrayValue(value.effects, issues, "$.effects");
  const proposals = arrayValue(value.proposals, issues, "$.proposals");

  const trackIds = new Set<string>();
  const trackKindById = new Map<string, unknown>();
  const trackClipIds = new Map<string, Set<string>>();
  tracks.forEach((track, index) => {
    const path = `$.tracks[${index}]`;
    if (!isRecord(track)) {
      issue(issues, "editing.track.object", path, "轨道必须是对象");
      return;
    }
    const id = requiredString(track.id, issues, `${path}.id`);
    addUniqueId(id, trackIds, issues, `${path}.id`);
    enumValue(track.kind, TRACK_KINDS, issues, `${path}.kind`, "editing.track.kind");
    if (id) trackKindById.set(id, track.kind);
    requiredString(track.name, issues, `${path}.name`);
    nonNegativeInteger(track.order, issues, `${path}.order`);
    booleanValue(track.muted, issues, `${path}.muted`);
    booleanValue(track.locked, issues, `${path}.locked`);
    const ids = arrayValue(track.clipIds, issues, `${path}.clipIds`);
    const owned = new Set<string>();
    ids.forEach((clipId, clipIndex) => {
      const clipPath = `${path}.clipIds[${clipIndex}]`;
      const normalized = requiredString(clipId, issues, clipPath);
      addUniqueId(normalized, owned, issues, clipPath);
    });
    if (id) trackClipIds.set(id, owned);
  });

  const clipIds = new Set<string>();
  const clipTrackIds = new Map<string, string>();
  const effectTargetByClipId = new Map<string, EffectTargetInfo>();
  clips.forEach((clip, index) => {
    const path = `$.clips[${index}]`;
    if (!isRecord(clip)) {
      issue(issues, "editing.clip.object", path, "片段必须是对象");
      return;
    }
    const id = requiredString(clip.id, issues, `${path}.id`);
    addUniqueId(id, clipIds, issues, `${path}.id`);
    const trackId = requiredString(clip.trackId, issues, `${path}.trackId`);
    if (id && trackId) clipTrackIds.set(id, trackId);
    if (id) {
      effectTargetByClipId.set(id, {
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        trackKind: trackKindById.get(trackId ?? ""),
        sourceKind: isRecord(clip.source) ? clip.source.kind : undefined,
      });
    }
    if (trackId && !trackIds.has(trackId)) {
      issue(issues, "editing.clip.track_missing", `${path}.trackId`, "片段引用的轨道不存在");
    }
    requiredString(clip.name, issues, `${path}.name`);
    validateClipSource(clip.source, issues, `${path}.source`);
    nonNegativeInteger(clip.startUs, issues, `${path}.startUs`);
    positiveTime(clip.durationUs, issues, `${path}.durationUs`, "editing.clip.duration");
    nonNegativeInteger(clip.trimStartUs, issues, `${path}.trimStartUs`);
    positiveFinite(clip.speed, issues, `${path}.speed`, "editing.clip.speed");
    rangedNumber(clip.volume, 0, 4, issues, `${path}.volume`, "editing.clip.volume");
    booleanValue(clip.muted, issues, `${path}.muted`);
    optionalNonNegativeInteger(clip.fadeInUs, issues, `${path}.fadeInUs`);
    optionalNonNegativeInteger(clip.fadeOutUs, issues, `${path}.fadeOutUs`);
    validateTransform(clip.transform, issues, `${path}.transform`);
    validateEnvelope(clip.envelope, clip.durationUs, issues, `${path}.envelope`);
    validateSubtitleMetadata(clip.subtitle, issues, `${path}.subtitle`);
    optionalBooleanValue(clip.stale, issues, `${path}.stale`);
    optionalString(clip.staleReason, issues, `${path}.staleReason`);
    if (id && trackId && !trackClipIds.get(trackId)?.has(id)) {
      issue(issues, "editing.clip.track_membership", path, "片段未出现在所属轨道的 clipIds 中");
    }
  });

  for (const [trackId, ownedClipIds] of trackClipIds) {
    for (const clipId of ownedClipIds) {
      if (!clipIds.has(clipId)) {
        issue(issues, "editing.track.clip_missing", `$.tracks.${trackId}.clipIds`, `轨道引用的片段不存在: ${clipId}`);
      } else if (clipTrackIds.get(clipId) !== trackId) {
        issue(issues, "editing.track.clip_ownership", `$.tracks.${trackId}.clipIds`, `片段不属于当前轨道: ${clipId}`);
      }
    }
  }

  validateTransitions(transitions, clipIds, issues, "$.transitions");
  validateEffects(effects, clipIds, trackIds, effectTargetByClipId, issues, "$.effects");
  validateProposals(proposals, clipIds, trackIds, effectTargetByClipId, issues, "$.proposals");
  validateProposalEffectLinks(proposals, effects, issues);

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as EditingProjectV1 };
}

function validateClipSource(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!isRecord(value)) {
    issue(issues, "editing.source.object", path, "片段来源必须是对象");
    return;
  }
  enumValue(value.kind, SOURCE_KINDS, issues, `${path}.kind`, "editing.source.kind");
  optionalString(value.path, issues, `${path}.path`);
  optionalString(value.text, issues, `${path}.text`);
  if (value.kind === "text") requiredString(value.text, issues, `${path}.text`);
  else requiredString(value.path, issues, `${path}.path`);
  validateSourceEvidence(value.evidence, issues, `${path}.evidence`);
}

function validateSourceEvidence(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!isRecord(value)) {
    issue(issues, "editing.source.evidence", path, "来源证据必须是对象");
    return;
  }
  optionalString(value.storyboardId, issues, `${path}.storyboardId`);
  optionalString(value.trackId, issues, `${path}.trackId`);
  optionalString(value.candidateId, issues, `${path}.candidateId`);
  optionalString(value.mediaId, issues, `${path}.mediaId`);
  optionalString(value.sourceRunId, issues, `${path}.sourceRunId`);
  optionalString(value.sourceFingerprint, issues, `${path}.sourceFingerprint`);
  if (value.outputVersion !== undefined) {
    positiveInteger(value.outputVersion, issues, `${path}.outputVersion`, "editing.source.output_version");
  }
}

function validateTransform(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, "editing.transform.object", path, "画面变换必须是对象");
    return;
  }
  finiteNumber(value.x, issues, `${path}.x`, "editing.transform.position");
  finiteNumber(value.y, issues, `${path}.y`, "editing.transform.position");
  positiveFinite(value.scaleX, issues, `${path}.scaleX`, "editing.transform.scale");
  positiveFinite(value.scaleY, issues, `${path}.scaleY`, "editing.transform.scale");
  finiteNumber(value.rotation, issues, `${path}.rotation`, "editing.transform.rotation");
  rangedNumber(value.opacity, 0, 1, issues, `${path}.opacity`, "editing.transform.opacity");
}

function validateEnvelope(
  value: unknown,
  durationUs: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (value === undefined) return;
  const points = arrayValue(value, issues, path);
  let previousTimeUs = -1;
  points.forEach((point, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isRecord(point)) {
      issue(issues, "editing.audio.envelope_point", pointPath, "音量包络点必须是对象");
      return;
    }
    const timeUs = nonNegativeInteger(point.timeUs, issues, `${pointPath}.timeUs`);
    rangedNumber(point.gain, 0, 4, issues, `${pointPath}.gain`, "editing.audio.gain");
    if (typeof timeUs === "number") {
      if (timeUs <= previousTimeUs) {
        issue(issues, "editing.audio.envelope_order", `${pointPath}.timeUs`, "音量包络时间必须严格递增且不得重复");
      }
      if (typeof durationUs === "number" && Number.isSafeInteger(durationUs) && timeUs > durationUs) {
        issue(issues, "editing.audio.envelope_bounds", `${pointPath}.timeUs`, "音量包络时间不得超过片段时长");
      }
      previousTimeUs = timeUs;
    }
  });
}

function validateSubtitleMetadata(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, "editing.subtitle.metadata", path, "字幕元数据必须是对象");
    return;
  }
  enumValue(value.sourceFormat, new Set(["generated", "srt", "ass"]), issues, `${path}.sourceFormat`, "editing.subtitle.source_format");
  if (value.warnings !== undefined) {
    arrayValue(value.warnings, issues, `${path}.warnings`).forEach((warning, index) => {
      requiredString(warning, issues, `${path}.warnings[${index}]`);
    });
  }
}

function validateRenderSettings(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
  requireAudioDucking: boolean,
): value is EditingRenderSettings {
  if (!isRecord(value)) {
    issue(issues, "editing.render_settings.object", path, "渲染设置必须是对象");
    return false;
  }
  positiveInteger(value.width, issues, `${path}.width`, "editing.render.width");
  positiveInteger(value.height, issues, `${path}.height`, "editing.render.height");
  positiveInteger(value.fps, issues, `${path}.fps`, "editing.render.fps");
  enumValue(value.codec, new Set(["h264"]), issues, `${path}.codec`, "editing.render.codec");
  enumValue(value.subtitleMode, new Set(["burn-in", "none"]), issues, `${path}.subtitleMode`, "editing.render.subtitle_mode");
  finiteNumber(value.loudnessLufs, issues, `${path}.loudnessLufs`, "editing.render.loudness");
  finiteNumber(value.truePeakDbtp, issues, `${path}.truePeakDbtp`, "editing.render.true_peak");
  validateAudioDucking(value.audioDucking, issues, `${path}.audioDucking`, requireAudioDucking);
  return true;
}

function validateAudioDucking(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
  required: boolean,
) {
  if (value === undefined) {
    if (required) issue(issues, "editing.render.ducking_object", path, "渲染计划必须包含音频 ducking 设置");
    return;
  }
  if (!isRecord(value)) {
    issue(issues, "editing.render.ducking_object", path, "音频 ducking 设置必须是对象");
    return;
  }
  rangedNumber(value.reductionDb, -60, 0, issues, `${path}.reductionDb`, "editing.render.ducking_reduction");
  nonNegativeInteger(value.attackUs, issues, `${path}.attackUs`);
  nonNegativeInteger(value.releaseUs, issues, `${path}.releaseUs`);
}

function validateTransitions(
  values: unknown[],
  clipIds: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(value)) {
      issue(issues, "editing.transition.object", itemPath, "转场必须是对象");
      return;
    }
    addUniqueId(requiredString(value.id, issues, `${itemPath}.id`), ids, issues, `${itemPath}.id`);
    referenceId(value.fromClipId, clipIds, issues, `${itemPath}.fromClipId`, "editing.transition.clip_missing");
    referenceId(value.toClipId, clipIds, issues, `${itemPath}.toClipId`, "editing.transition.clip_missing");
    const definition = getEditingEffectDefinition(value.effectId);
    if (!definition || definition.category !== "transition") {
      issue(issues, "editing.effect.id", `${itemPath}.effectId`, "未知或非转场效果");
    }
    positiveTime(value.durationUs, issues, `${itemPath}.durationUs`);
    validateEffectParams(value.effectId, value.params, issues, `${itemPath}.params`);
  });
}

function validateEffects(
  values: unknown[],
  clipIds: Set<string>,
  trackIds: Set<string>,
  targetByClipId: Map<string, EffectTargetInfo>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(value)) {
      issue(issues, "editing.effect.object", itemPath, "效果必须是对象");
      return;
    }
    addUniqueId(requiredString(value.id, issues, `${itemPath}.id`), ids, issues, `${itemPath}.id`);
    const targetClipId = validateEffectTarget(value, clipIds, trackIds, issues, itemPath);
    validateVisualEffectSemantics(value, targetClipId, targetByClipId, issues, itemPath);
    nonNegativeInteger(value.startUs, issues, `${itemPath}.startUs`);
    positiveTime(value.durationUs, issues, `${itemPath}.durationUs`);
    validateEffectParams(value.effectId, value.params, issues, `${itemPath}.params`);
    booleanValue(value.enabled, issues, `${itemPath}.enabled`);
    optionalString(value.proposalId, issues, `${itemPath}.proposalId`);
  });
}

function validateProposals(
  values: unknown[],
  clipIds: Set<string>,
  trackIds: Set<string>,
  targetByClipId: Map<string, EffectTargetInfo>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(value)) {
      issue(issues, "editing.proposal.object", itemPath, "建议必须是对象");
      return;
    }
    addUniqueId(requiredString(value.id, issues, `${itemPath}.id`), ids, issues, `${itemPath}.id`);
    const targetClipId = validateEffectTarget(value, clipIds, trackIds, issues, itemPath);
    validateVisualEffectSemantics(value, targetClipId, targetByClipId, issues, itemPath);
    nonNegativeInteger(value.startUs, issues, `${itemPath}.startUs`);
    positiveTime(value.durationUs, issues, `${itemPath}.durationUs`);
    validateEffectParams(value.effectId, value.params, issues, `${itemPath}.params`);
    requiredString(value.reason, issues, `${itemPath}.reason`);
    rangedNumber(value.confidence, 0, 1, issues, `${itemPath}.confidence`, "editing.proposal.confidence");
    enumValue(value.status, PROPOSAL_STATUSES, issues, `${itemPath}.status`, "editing.proposal.status");
    validateSourceEvidence(value.sourceEvidence, issues, `${itemPath}.sourceEvidence`);
  });
}

function validateProposalEffectLinks(
  proposals: unknown[],
  effects: unknown[],
  issues: EditingValidationIssue[],
) {
  const proposalIds = new Set(
    proposals
      .filter(isRecord)
      .map((proposal) => typeof proposal.id === "string" ? proposal.id : "")
      .filter(Boolean),
  );
  const effectsByProposalId = new Map<string, Record<string, unknown>[]>();
  effects.filter(isRecord).forEach((effect, index) => {
    if (typeof effect.proposalId !== "string" || !effect.proposalId.trim()) return;
    if (!proposalIds.has(effect.proposalId)) {
      issue(issues, "editing.effect.proposal_missing", `$.effects[${index}].proposalId`, "效果关联的建议不存在");
    }
    const linked = effectsByProposalId.get(effect.proposalId) ?? [];
    linked.push(effect);
    effectsByProposalId.set(effect.proposalId, linked);
  });
  proposals.filter(isRecord).forEach((proposal, index) => {
    if (typeof proposal.id !== "string") return;
    const linked = effectsByProposalId.get(proposal.id) ?? [];
    const path = `$.proposals[${index}]`;
    if (proposal.status === "accepted" || proposal.status === "disabled") {
      if (linked.length !== 1) {
        issue(issues, "editing.proposal.effect_link", path, "已接受或禁用建议必须关联唯一效果");
        return;
      }
      const expectedEnabled = proposal.status === "accepted";
      if (linked[0]!.enabled !== expectedEnabled) {
        issue(issues, "editing.proposal.effect_state", path, "建议状态与关联效果启用状态不一致");
      }
    } else if (linked.length > 0) {
      issue(issues, "editing.proposal.effect_state", path, "未接受建议不得预先关联效果");
    }
  });
}

const AUTO_EDITING_STAGES = new Set([
  "preflight",
  "preparingMedia",
  "selectingSources",
  "arrangingClips",
  "arrangingAudio",
  "arrangingSubtitles",
  "generatingProposals",
  "previewReady",
  "rendering",
  "probing",
  "completed",
  "failed",
]);
const AUTO_DECISION_KINDS = new Set([
  "source",
  "duration",
  "transition",
  "motion",
  "audio",
  "subtitle",
  "proposal",
]);
const FORBIDDEN_RENDER_KEYS = new Set([
  "command",
  "args",
  "extraArgs",
  "outputPath",
  "shell",
  "filterGraph",
  "filter_complex",
]);

export function validateAutoEditingRun(
  value: unknown,
): EditingValidationResult<AutoEditingRun> {
  const issues: EditingValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "editing.auto_run.object", "$", "自动剪辑运行必须是对象");
    return { success: false, issues };
  }
  requiredString(value.id, issues, "$.id");
  requiredString(value.projectId, issues, "$.projectId");
  requiredString(value.episodeId, issues, "$.episodeId");
  requiredString(value.sourceSnapshotHash, issues, "$.sourceSnapshotHash");
  enumValue(value.presetId, new Set(["story-driven-v1"]), issues, "$.presetId", "editing.auto_run.preset");
  enumValue(value.stage, AUTO_EDITING_STAGES, issues, "$.stage", "editing.auto_run.stage");
  optionalString(value.editingProjectId, issues, "$.editingProjectId");
  optionalString(value.renderJobId, issues, "$.renderJobId");
  optionalString(value.error, issues, "$.error");
  nonNegativeInteger(value.startedAt, issues, "$.startedAt");
  nonNegativeInteger(value.updatedAt, issues, "$.updatedAt");
  optionalNonNegativeInteger(value.completedAt, issues, "$.completedAt");

  const decisions = arrayValue(value.decisions, issues, "$.decisions");
  const decisionIds = new Set<string>();
  decisions.forEach((decision, index) => {
    const path = `$.decisions[${index}]`;
    if (!isRecord(decision)) {
      issue(issues, "editing.auto_decision.object", path, "自动剪辑决策必须是对象");
      return;
    }
    addUniqueId(requiredString(decision.id, issues, `${path}.id`), decisionIds, issues, `${path}.id`);
    enumValue(decision.kind, AUTO_DECISION_KINDS, issues, `${path}.kind`, "editing.auto_decision.kind");
    requiredString(decision.ruleId, issues, `${path}.ruleId`);
    requiredString(decision.targetId, issues, `${path}.targetId`);
    primitiveRecord(decision.input, issues, `${path}.input`);
    primitiveRecord(decision.output, issues, `${path}.output`);
    requiredString(decision.reason, issues, `${path}.reason`);
    validateSourceEvidence(decision.sourceEvidence, issues, `${path}.sourceEvidence`);
  });

  const warnings = arrayValue(value.warnings, issues, "$.warnings");
  warnings.forEach((warning, index) => {
    const path = `$.warnings[${index}]`;
    if (!isRecord(warning)) {
      issue(issues, "editing.auto_warning.object", path, "自动剪辑警告必须是对象");
      return;
    }
    requiredString(warning.code, issues, `${path}.code`);
    requiredString(warning.message, issues, `${path}.message`);
    optionalString(warning.targetId, issues, `${path}.targetId`);
    booleanValue(warning.recoverable, issues, `${path}.recoverable`);
  });

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as AutoEditingRun };
}

export function validateTimelineRenderPlan(
  value: unknown,
): EditingValidationResult<TimelineRenderPlan> {
  const issues: EditingValidationIssue[] = [];
  scanForbiddenRenderKeys(value, "$", issues);
  if (!isRecord(value)) {
    issue(issues, "editing.render_plan.object", "$", "时间线渲染计划必须是对象");
    return { success: false, issues };
  }
  exactOne(value.schemaVersion, issues, "$.schemaVersion");
  requiredString(value.jobId, issues, "$.jobId");
  requiredString(value.projectId, issues, "$.projectId");
  requiredString(value.episodeId, issues, "$.episodeId");
  requiredString(value.editingProjectId, issues, "$.editingProjectId");
  positiveInteger(value.editingRevision, issues, "$.editingRevision", "editing.revision");
  requiredString(value.sourceSnapshotHash, issues, "$.sourceSnapshotHash");
  const snapshotResult = validateEditingProject(value.editingProjectSnapshot);
  if (!snapshotResult.success) {
    snapshotResult.issues.forEach((snapshotIssue) => {
      issue(
        issues,
        snapshotIssue.code,
        `$.editingProjectSnapshot${snapshotIssue.path.slice(1)}`,
        snapshotIssue.message,
      );
    });
  } else {
    if (snapshotResult.value.id !== value.editingProjectId) {
      issue(issues, "editing.render.snapshot_project", "$.editingProjectSnapshot.id", "快照项目 ID 与渲染计划不一致");
    }
    if (snapshotResult.value.revision !== value.editingRevision) {
      issue(issues, "editing.render.snapshot_revision", "$.editingProjectSnapshot.revision", "快照版本与渲染计划不一致");
    }
    if (snapshotResult.value.sourceSnapshotHash !== value.sourceSnapshotHash) {
      issue(issues, "editing.render.snapshot_hash", "$.editingProjectSnapshot.sourceSnapshotHash", "快照来源哈希与渲染计划不一致");
    }
  }
  validateRenderSettings(value.renderSettings, issues, "$.renderSettings", true);
  nonNegativeInteger(value.createdAt, issues, "$.createdAt");

  const clips = arrayValue(value.clips, issues, "$.clips");
  const clipIds = new Set<string>();
  const trackIds = new Set<string>();
  const effectTargetByClipId = new Map<string, EffectTargetInfo>();
  clips.forEach((clip, index) => {
    const path = `$.clips[${index}]`;
    if (!isRecord(clip)) {
      issue(issues, "editing.render_clip.object", path, "渲染片段必须是对象");
      return;
    }
    const clipId = requiredString(clip.id, issues, `${path}.id`);
    addUniqueId(clipId, clipIds, issues, `${path}.id`);
    const trackId = requiredString(clip.trackId, issues, `${path}.trackId`);
    if (trackId) trackIds.add(trackId);
    enumValue(clip.trackKind, TRACK_KINDS, issues, `${path}.trackKind`, "editing.track.kind");
    validateClipSource(clip.source, issues, `${path}.source`);
    nonNegativeInteger(clip.startUs, issues, `${path}.startUs`);
    positiveTime(clip.durationUs, issues, `${path}.durationUs`, "editing.clip.duration");
    nonNegativeInteger(clip.trimStartUs, issues, `${path}.trimStartUs`);
    positiveFinite(clip.speed, issues, `${path}.speed`, "editing.clip.speed");
    rangedNumber(clip.volume, 0, 4, issues, `${path}.volume`, "editing.clip.volume");
    booleanValue(clip.muted, issues, `${path}.muted`);
    optionalNonNegativeInteger(clip.fadeInUs, issues, `${path}.fadeInUs`);
    optionalNonNegativeInteger(clip.fadeOutUs, issues, `${path}.fadeOutUs`);
    validateTransform(clip.transform, issues, `${path}.transform`);
    validateEnvelope(clip.envelope, clip.durationUs, issues, `${path}.envelope`);
    validateSubtitleMetadata(clip.subtitle, issues, `${path}.subtitle`);
    if (clipId) {
      effectTargetByClipId.set(clipId, {
        startUs: clip.startUs,
        durationUs: clip.durationUs,
        trackKind: clip.trackKind,
        sourceKind: isRecord(clip.source) ? clip.source.kind : undefined,
      });
    }
  });
  validateTransitions(arrayValue(value.transitions, issues, "$.transitions"), clipIds, issues, "$.transitions");
  validateEffects(
    arrayValue(value.effects, issues, "$.effects"),
    clipIds,
    trackIds,
    effectTargetByClipId,
    issues,
    "$.effects",
  );

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as TimelineRenderPlan };
}

export function validateTimelineRenderRecord(
  value: unknown,
): EditingValidationResult<TimelineRenderRecord> {
  const issues: EditingValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "editing.render_record.object", "$", "时间线渲染记录必须是对象");
    return { success: false, issues };
  }
  requiredString(value.projectId, issues, "$.projectId");
  requiredString(value.episodeId, issues, "$.episodeId");
  requiredString(value.editingProjectId, issues, "$.editingProjectId");
  positiveInteger(value.editingRevision, issues, "$.editingRevision", "editing.revision");
  requiredString(value.sourceSnapshotHash, issues, "$.sourceSnapshotHash");
  nonNegativeInteger(value.completedAt, issues, "$.completedAt");

  if (!isRecord(value.evidence)) {
    issue(issues, "editing.render_evidence.object", "$.evidence", "时间线媒体证据必须是对象");
  } else {
    const evidence = value.evidence;
    requiredString(evidence.jobId, issues, "$.evidence.jobId");
    requiredString(evidence.path, issues, "$.evidence.path");
    positiveFinite(evidence.sizeBytes, issues, "$.evidence.sizeBytes", "editing.render_evidence.size");
    nonNegativeFinite(evidence.mtimeMs, issues, "$.evidence.mtimeMs", "editing.render_evidence.mtime");
    sha256String(evidence.sha256, issues, "$.evidence.sha256");
    positiveFinite(evidence.duration, issues, "$.evidence.duration", "editing.render_evidence.duration");
    positiveInteger(evidence.width, issues, "$.evidence.width", "editing.render_evidence.width");
    positiveInteger(evidence.height, issues, "$.evidence.height", "editing.render_evidence.height");
    const streams = arrayValue(evidence.streams, issues, "$.evidence.streams");
    const streamKinds = new Set<string>();
    streams.forEach((stream, index) => {
      const kind = requiredString(stream, issues, `$.evidence.streams[${index}]`);
      if (kind) streamKinds.add(kind);
    });
    if (!streamKinds.has("video") || !streamKinds.has("audio")) {
      issue(
        issues,
        "editing.render_evidence.streams",
        "$.evidence.streams",
        "时间线成片必须同时包含 video 和 audio 流",
      );
    }
    sha256String(evidence.snapshotHash, issues, "$.evidence.snapshotHash");
    requiredString(evidence.snapshotPath, issues, "$.evidence.snapshotPath");
    requiredString(evidence.renderPlanPath, issues, "$.evidence.renderPlanPath");
    requiredString(evidence.inputManifestPath, issues, "$.evidence.inputManifestPath");
    requiredString(evidence.filterGraphPath, issues, "$.evidence.filterGraphPath");
    requiredString(evidence.logPath, issues, "$.evidence.logPath");
    requiredString(evidence.ffprobePath, issues, "$.evidence.ffprobePath");
  }

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as TimelineRenderRecord };
}

function validateEffectTarget(
  value: Record<string, unknown>,
  clipIds: Set<string>,
  trackIds: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const clipId = optionalString(value.targetClipId, issues, `${path}.targetClipId`);
  const trackId = optionalString(value.targetTrackId, issues, `${path}.targetTrackId`);
  if (!clipId && !trackId) {
    issue(issues, "editing.effect.target", path, "效果必须指定片段或轨道目标");
  }
  if (clipId && trackId) {
    issue(issues, "editing.effect.target_ambiguous", path, "效果只能指定一个片段目标");
  }
  if (clipId && !clipIds.has(clipId)) issue(issues, "editing.effect.clip_missing", `${path}.targetClipId`, "效果目标片段不存在");
  if (trackId && !trackIds.has(trackId)) issue(issues, "editing.effect.track_missing", `${path}.targetTrackId`, "效果目标轨道不存在");
  if (trackId) issue(issues, "editing.effect.track_unsupported", `${path}.targetTrackId`, "首期效果不支持轨道目标");
  return clipId;
}

function validateVisualEffectSemantics(
  value: Record<string, unknown>,
  targetClipId: string | null,
  targetByClipId: Map<string, EffectTargetInfo>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const definition = getEditingEffectDefinition(value.effectId);
  if (!definition) {
    issue(issues, "editing.effect.id", `${path}.effectId`, "未知效果 ID");
    return;
  }
  if (definition.category === "transition") {
    issue(issues, "editing.effect.category", `${path}.effectId`, "转场必须使用 EditingTransition");
  }
  if (!targetClipId) return;
  const target = targetByClipId.get(targetClipId);
  if (!target) return;
  if (!VISUAL_EFFECT_TRACK_KINDS.has(String(target.trackKind))) {
    issue(issues, "editing.effect.visual_target", `${path}.targetClipId`, "效果目标必须是视觉片段");
  }

  const startUs = value.startUs;
  const durationUs = value.durationUs;
  if (
    typeof startUs === "number"
    && Number.isSafeInteger(startUs)
    && typeof durationUs === "number"
    && Number.isSafeInteger(durationUs)
    && typeof target.startUs === "number"
    && Number.isSafeInteger(target.startUs)
    && typeof target.durationUs === "number"
    && Number.isSafeInteger(target.durationUs)
  ) {
    const targetEndUs = target.startUs + target.durationUs;
    if (startUs < target.startUs || startUs + durationUs > targetEndUs) {
      issue(issues, "editing.effect.window_bounds", `${path}.durationUs`, "效果时间窗必须完整位于目标片段内");
    }
    if (
      (definition.id === "panZoom" || definition.id === "speed")
      && (startUs !== target.startUs || durationUs !== target.durationUs)
    ) {
      issue(issues, "editing.effect.full_clip_required", path, `${definition.id} 必须覆盖完整目标片段`);
    }
  }
  if (definition.id === "speed" && target.sourceKind === "storyboardImage") {
    issue(issues, "editing.effect.speed_visual", `${path}.targetClipId`, "静态图片不支持速度效果");
  }
}

function validateEffectParams(
  effectId: unknown,
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!isRecord(value)) {
    issue(issues, "editing.effect.params", path, "效果参数必须是对象");
    return;
  }
  const definition = getEditingEffectDefinition(effectId);
  if (!definition) return;
  const parameters = new Map(definition.parameters.map((item) => [item.name, item]));
  for (const [key, parameterValue] of Object.entries(value)) {
    const parameter = parameters.get(key);
    if (!parameter) {
      issue(issues, "editing.effect.param_unknown", `${path}.${key}`, "效果参数不在白名单");
      continue;
    }
    if (parameter.kind === "number") {
      rangedNumber(parameterValue, parameter.min ?? -Infinity, parameter.max ?? Infinity, issues, `${path}.${key}`, "editing.effect.param_number");
    } else if (parameter.kind === "boolean") {
      booleanValue(parameterValue, issues, `${path}.${key}`);
    } else if (typeof parameterValue !== "string" || !parameter.values?.includes(parameterValue)) {
      issue(issues, "editing.effect.param_enum", `${path}.${key}`, "效果枚举参数无效");
    }
  }
}

function scanForbiddenRenderKeys(
  value: unknown,
  path: string,
  issues: EditingValidationIssue[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenRenderKeys(item, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RENDER_KEYS.has(key)) {
      issue(issues, "editing.render.forbidden_key", `${path}.${key}`, `渲染计划禁止字段 ${key}`);
    }
    scanForbiddenRenderKeys(nested, `${path}.${key}`, issues);
  }
}

function primitiveRecord(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (!isRecord(value)) {
    issue(issues, "editing.auto_decision.values", path, "决策输入输出必须是对象");
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      (!["string", "number", "boolean"].includes(typeof nested) && nested !== null)
      || (typeof nested === "number" && !Number.isFinite(nested))
    ) {
      issue(issues, "editing.auto_decision.value", `${path}.${key}`, "决策值必须是基础类型");
    }
  }
}

function addUniqueId(
  id: string | null,
  ids: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!id) return;
  if (ids.has(id)) issue(issues, "editing.id.duplicate", path, `重复 ID: ${id}`);
  ids.add(id);
}

function referenceId(
  value: unknown,
  ids: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
  code: string,
) {
  const id = requiredString(value, issues, path);
  if (id && !ids.has(id)) issue(issues, code, path, `引用的 ID 不存在: ${id}`);
}

function arrayValue(value: unknown, issues: EditingValidationIssue[], path: string): unknown[] {
  if (Array.isArray(value)) return value;
  issue(issues, "editing.array", path, "字段必须是数组");
  return [];
}

function exactOne(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== 1) issue(issues, "editing.schema_version", path, "schemaVersion 必须为 1");
}

function requiredString(value: unknown, issues: EditingValidationIssue[], path: string): string | null {
  if (typeof value === "string" && value.trim()) return value;
  issue(issues, "editing.string.required", path, "字段必须是非空字符串");
  return null;
}

function optionalString(value: unknown, issues: EditingValidationIssue[], path: string): string | null {
  if (value === undefined) return null;
  return requiredString(value, issues, path);
}

function enumValue(value: unknown, values: Set<string>, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "string" || !values.has(value)) issue(issues, code, path, "字段不在允许值中");
}

function booleanValue(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (typeof value !== "boolean") issue(issues, "editing.boolean", path, "字段必须是布尔值");
}

function optionalBooleanValue(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== undefined) booleanValue(value, issues, path);
}

function finiteNumber(value: unknown, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) issue(issues, code, path, "字段必须是有限数字");
}

function nonNegativeFinite(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
  code: string,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issue(issues, code, path, "字段必须是非负有限数字");
  }
}

function sha256String(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    issue(issues, "editing.render_evidence.sha256", path, "字段必须是小写 SHA-256");
  }
}

function rangedNumber(value: unknown, min: number, max: number, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issue(issues, code, path, `字段必须是 ${min}..${max} 的有限数字`);
  }
}

function positiveFinite(value: unknown, issues: EditingValidationIssue[], path: string, code = "editing.number.positive") {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issue(issues, code, path, "字段必须是正有限数字");
}

function nonNegativeInteger(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issue(issues, "editing.time.non_negative_integer", path, "字段必须是非负安全整数");
    return undefined;
  }
  return value;
}

function positiveInteger(value: unknown, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) issue(issues, code, path, "字段必须是正安全整数");
}

function positiveTime(value: unknown, issues: EditingValidationIssue[], path: string, code = "editing.time.positive_integer") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) issue(issues, code, path, "时长必须是正安全整数");
  if (code !== "editing.time.positive_integer" && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)) {
    issue(issues, "editing.time.positive_integer", path, "时长必须是正安全整数");
  }
}

function optionalNonNegativeInteger(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== undefined) nonNegativeInteger(value, issues, path);
}

function issue(issues: EditingValidationIssue[], code: string, path: string, message: string) {
  issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
