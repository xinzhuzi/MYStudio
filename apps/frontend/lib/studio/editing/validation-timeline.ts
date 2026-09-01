import type { AutoEditingRun, EditingValidationIssue, EditingValidationResult, TimelineRenderRecord, TimelineRenderPlan } from "@/types/editing";
import { validateEditingProject, validateSourceEvidence, validateRenderSettings, validateClipSource, validateTransform, validateEnvelope, validateSubtitleMetadata, validateTransitions, validateEffects, TRACK_KINDS } from "./validation-project";
import type { EffectTargetInfo } from "./validation-shared";
import { validateTimelineAudioPostProcessEvidence, validateTimelineRendererEvidence } from "@rendering/contracts/timeline-renderer";
import { arrayValue, booleanValue, enumValue, exactOne, isRecord, issue, nonNegativeInteger, optionalNonNegativeInteger, optionalString, positiveFinite, positiveInteger, positiveTime, rangedNumber, requiredString, addUniqueId, scanForbiddenRenderKeys } from "./validation-shared";
/**
 * 时间线校验族——autoEditingRun 与 timelineRenderPlan/Record。
 * 08-31 深网专批,体逐字保留。
 */


export const AUTO_EDITING_STAGES = new Set([
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
export const AUTO_DECISION_KINDS = new Set([
  "source",
  "duration",
  "transition",
  "motion",
  "audio",
  "subtitle",
  "proposal",
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
    if (evidence.renderer !== undefined) {
      appendRendererContractIssues(
        validateTimelineRendererEvidence(evidence.renderer),
        issues,
        "$.evidence.renderer",
        "editing.render_evidence.renderer",
      );
    }
    if (evidence.audioPostProcess !== undefined) {
      appendRendererContractIssues(
        validateTimelineAudioPostProcessEvidence(evidence.audioPostProcess),
        issues,
        "$.evidence.audioPostProcess",
        "editing.render_evidence.audio_postprocess",
      );
    }
  }

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as TimelineRenderRecord };
}

export function appendRendererContractIssues(
  result: ReturnType<
    | typeof validateTimelineRendererEvidence
    | typeof validateTimelineAudioPostProcessEvidence
  >,
  issues: EditingValidationIssue[],
  path: string,
  code: string,
): void {
  if (result.success) return;
  result.issues.forEach((contractIssue) => {
    issue(
      issues,
      code,
      contractIssue.path === "$" ? path : `${path}.${contractIssue.path}`,
      contractIssue.message,
    );
  });
}

export function primitiveRecord(value: unknown, issues: EditingValidationIssue[], path: string) {
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

export function nonNegativeFinite(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
  code: string,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issue(issues, code, path, "字段必须是非负有限数字");
  }
}

export function sha256String(
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    issue(issues, "editing.render_evidence.sha256", path, "字段必须是小写 SHA-256");
  }
}
