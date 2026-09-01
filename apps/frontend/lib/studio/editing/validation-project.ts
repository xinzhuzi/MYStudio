import type { EditingProjectV1, EditingRenderSettings, EditingValidationIssue, EditingValidationResult } from "@/types/editing";
import { getEditingEffectDefinition } from "./effect-registry";
import { validateProposalEffectLinks } from "./proposal-effect-links";
import { isKnownSubtitleFontId } from "../remotion/subtitle-fonts";
import { isCinematicLutId } from "../remotion/cinematic-luts";
import { arrayValue, booleanValue, enumValue, exactOne, isRecord, issue, nonNegativeInteger, optionalNonNegativeInteger, optionalString, positiveFinite, positiveInteger, positiveTime, rangedNumber, requiredString, addUniqueId, type EffectTargetInfo } from "./validation-shared";
import { validateEffectTarget, validateEffectParams, validateVisualEffectSemantics } from "./validation-effects";
/**
 * 剪辑工程校验族——validateEditingProject 及其 12 个子校验。
 * 08-31 深网专批,体逐字保留。
 */


export const TRACK_KINDS = new Set([
  "video",
  "image",
  "overlay",
  "text",
  "voice",
  "bgm",
  "sfx",
  "effect",
]);
export const SOURCE_KINDS = new Set([
  "storyboardImage",
  "storyboardVideo",
  "videoCandidate",
  "audio",
  "text",
  "asset",
]);
export const PROPOSAL_STATUSES = new Set([
  "pending",
  "accepted",
  "disabled",
  "rejected",
]);

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

export function validateClipSource(
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

export function validateSourceEvidence(
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
  optionalString(value.remotionJobId, issues, `${path}.remotionJobId`);
  optionalString(value.remotionEvidenceSha256, issues, `${path}.remotionEvidenceSha256`);
  optionalString(value.remotionInputHash, issues, `${path}.remotionInputHash`);
  optionalString(value.remotionBundleContentHash, issues, `${path}.remotionBundleContentHash`);
  if (value.outputVersion !== undefined) {
    positiveInteger(value.outputVersion, issues, `${path}.outputVersion`, "editing.source.output_version");
  }
}

export function validateTransform(
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

export function validateEnvelope(
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

export function validateSubtitleMetadata(
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

export function validateRenderSettings(
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
  if (value.subtitleFont !== undefined && !isKnownSubtitleFontId(value.subtitleFont)) {
    issue(issues, "editing.render.subtitle_font", `${path}.subtitleFont`, "字幕字体必须是注册表内的字体 id");
  }
  // 章节统一色调（08-19 导演定调）：lutId 闭集 fail-closed + blend 钳域校验。
  if (value.chapterGrade !== undefined) {
    const grade = value.chapterGrade as { lutId?: unknown; blend?: unknown } | null;
    if (typeof grade !== "object" || grade === null || typeof grade.lutId !== "string" || !isCinematicLutId(grade.lutId)) {
      issue(issues, "editing.render.chapter_grade", `${path}.chapterGrade.lutId`, "章节色调必须在 LUT 闭集内");
    } else if (
      grade.blend !== undefined
      && (typeof grade.blend !== "number" || !Number.isFinite(grade.blend) || grade.blend < 0 || grade.blend > 1)
    ) {
      issue(issues, "editing.render.chapter_grade", `${path}.chapterGrade.blend`, "章节色调混合强度必须是 0..1 有限数");
    }
  }
  if (value.subtitleSfxEnabled !== undefined && typeof value.subtitleSfxEnabled !== "boolean") {
    issue(issues, "editing.render.subtitle_sfx_enabled", `${path}.subtitleSfxEnabled`, "字幕音效开关必须是布尔值");
  }
  // 氛围层模式（08-19 multilayer Child2）：闭集 fail-closed。
  if (value.atmosphereMode !== undefined && value.atmosphereMode !== "ai" && value.atmosphereMode !== "off") {
    issue(issues, "editing.render.atmosphere_mode", `${path}.atmosphereMode`, "氛围层模式必须是 ai 或 off");
  }
  finiteNumber(value.loudnessLufs, issues, `${path}.loudnessLufs`, "editing.render.loudness");
  finiteNumber(value.truePeakDbtp, issues, `${path}.truePeakDbtp`, "editing.render.true_peak");
  validateAudioDucking(value.audioDucking, issues, `${path}.audioDucking`, requireAudioDucking);
  return true;
}

export function validateAudioDucking(
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

export function validateTransitions(
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

export function validateEffects(
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

export function validateProposals(
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

export function referenceId(
  value: unknown,
  ids: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
  code: string,
) {
  const id = requiredString(value, issues, path);
  if (id && !ids.has(id)) issue(issues, code, path, `引用的 ID 不存在: ${id}`);
}

export function optionalBooleanValue(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== undefined) booleanValue(value, issues, path);
}

export function finiteNumber(value: unknown, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) issue(issues, code, path, "字段必须是有限数字");
}
