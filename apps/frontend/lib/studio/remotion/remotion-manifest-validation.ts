import type {
  RemotionChapterAudioBindingV2,
  RemotionChapterManifestV1,
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
  RemotionWorkspaceManifestV1,
} from "@/types/remotion-workspace";
import {
  REMOTION_CHAPTER_AUDIO_ROLES,
  REMOTION_SHOT_AUDIO_ROLES,
} from "@/types/remotion-workspace";
import {
  validateEditingRenderSettings,
  validateEditingTransform,
  validateMediaRole,
  validateProjectMediaReference,
  validateShotMotion,
} from "./remotion-contract-field-validation";
import {
  RemotionValidator,
  validationResult,
  type RemotionValidationResult,
} from "./remotion-validation-utils";
import { canonicalJson } from "./canonical-json";

export function validateRemotionWorkspaceManifest(
  value: unknown,
): RemotionValidationResult<RemotionWorkspaceManifestV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", [
    "schemaVersion",
    "projectId",
    "workspaceId",
    "templateId",
    "templateVersion",
    "remotionVersion",
    "bundleContentHash",
    "compositionIds",
    "defaultRenderSettings",
    "productionProfile",
    "createdAt",
    "updatedAt",
  ]);
  if (record) {
    validator.exact(record.schemaVersion, 1, "$.schemaVersion");
    validator.id(record.projectId, "$.projectId");
    validator.id(record.workspaceId, "$.workspaceId");
    validator.exact(record.templateId, "mystudio-remotion-v1", "$.templateId");
    validator.semver(record.templateVersion, "$.templateVersion");
    validator.semver(record.remotionVersion, "$.remotionVersion");
    validator.sha256(record.bundleContentHash, "$.bundleContentHash");
    const compositionIds = validator.array(record.compositionIds, "$.compositionIds");
    if (compositionIds) {
      if (
        compositionIds.length !== 2
        || compositionIds[0] !== "StoryboardShot"
        || compositionIds[1] !== "ChapterVideo"
      ) {
        validator.issue("$.compositionIds", "Composition IDs 必须按 StoryboardShot、ChapterVideo 排列");
      }
    }
    validateEditingRenderSettings(record.defaultRenderSettings, "$.defaultRenderSettings", validator);
    validateProductionProfile(record.productionProfile, "$.productionProfile", validator);
    validateTimestampOrder(record.createdAt, record.updatedAt, "$", validator);
  }
  return validationResult(value, validator);
}

function validateProductionProfile(
  value: unknown,
  path: string,
  validator: RemotionValidator,
): void {
  if (value === undefined) return;
  const record = validator.record(value, path, [
    "schemaVersion",
    "referenceEpisodeDurationMin",
    "platformSpec",
    "visualManualId",
    "directorManualId",
    "stylePositioning",
  ]);
  if (!record) return;
  validator.exact(record.schemaVersion, 1, `${path}.schemaVersion`);
  if (record.referenceEpisodeDurationMin !== undefined) {
    validator.range(record.referenceEpisodeDurationMin, 0.01, 24 * 60, `${path}.referenceEpisodeDurationMin`);
  }
  validator.optionalString(record.platformSpec, `${path}.platformSpec`);
  if (record.visualManualId !== undefined) validator.id(record.visualManualId, `${path}.visualManualId`);
  if (record.directorManualId !== undefined) validator.id(record.directorManualId, `${path}.directorManualId`);
  validator.optionalString(record.stylePositioning, `${path}.stylePositioning`);
}

export function validateRemotionChapterManifest(
  value: unknown,
): RemotionValidationResult<RemotionChapterManifestV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", [
    "schemaVersion",
    "projectId",
    "chapterId",
    "revision",
    "sourceSnapshotHash",
    "requiredShotIds",
    "sharedAudioTracks",
    "shots",
    "renderSettings",
    "createdAt",
    "updatedAt",
  ]);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const projectId = validator.id(record.projectId, "$.projectId");
  validator.id(record.chapterId, "$.chapterId");
  validator.integer(record.revision, "$.revision", 1);
  validator.sha256(record.sourceSnapshotHash, "$.sourceSnapshotHash");
  const requiredShotIds = validateRequiredShotIds(record.requiredShotIds, validator);
  const tracks = validateSharedAudioTracks(record.sharedAudioTracks, projectId, validator);
  const shotIds = validateShots(record.shots, projectId, tracks, validator);
  if (requiredShotIds && shotIds) {
    if (requiredShotIds.length !== shotIds.length) {
      validator.issue("$.requiredShotIds", "requiredShotIds 必须与 shots 一一对应");
    }
    requiredShotIds.forEach((shotId, index) => {
      if (shotIds[index] !== shotId) {
        validator.issue(`$.requiredShotIds[${index}]`, "required shot 顺序必须与 shots 顺序一致");
      }
    });
  }
  validateEditingRenderSettings(record.renderSettings, "$.renderSettings", validator);
  validateTimestampOrder(record.createdAt, record.updatedAt, "$", validator);
  return validationResult(value, validator);
}

function validateRequiredShotIds(value: unknown, validator: RemotionValidator): string[] | undefined {
  const items = validator.array(value, "$.requiredShotIds");
  if (!items) return undefined;
  if (items.length === 0) validator.issue("$.requiredShotIds", "必须至少包含一个 required shot");
  const seen = new Set<string>();
  return items.flatMap((item, index) => {
    const shotId = validator.id(item, `$.requiredShotIds[${index}]`);
    if (!shotId) return [];
    if (seen.has(shotId)) validator.issue(`$.requiredShotIds[${index}]`, "required shot ID 不得重复");
    seen.add(shotId);
    return [shotId];
  });
}

function validateSharedAudioTracks(
  value: unknown,
  projectId: string | undefined,
  validator: RemotionValidator,
): Map<string, string> {
  const tracks = new Map<string, string>();
  const items = validator.array(value, "$.sharedAudioTracks");
  if (!items) return tracks;
  items.forEach((item, index) => {
    const path = `$.sharedAudioTracks[${index}]`;
    const record = validator.record(item, path, ["trackId", "role", "source", "sourceFingerprint"]);
    if (!record) return;
    const trackId = validator.id(record.trackId, `${path}.trackId`);
    const role = validateMediaRole(record.role, `${path}.role`, validator);
    if (projectId) validateProjectMediaReference(record.source, projectId, `${path}.source`, validator);
    validator.sha256(record.sourceFingerprint, `${path}.sourceFingerprint`);
    if (!trackId || !role) return;
    if (tracks.has(trackId)) validator.issue(`${path}.trackId`, "shared track ID 不得重复");
    tracks.set(trackId, role);
  });
  return tracks;
}

function validateShots(
  value: unknown,
  projectId: string | undefined,
  tracks: Map<string, string>,
  validator: RemotionValidator,
): string[] | undefined {
  const items = validator.array(value, "$.shots");
  if (!items) return undefined;
  if (items.length === 0) validator.issue("$.shots", "必须至少包含一个 shot 配置");
  const shotIds = new Set<string>();
  const storyboardIds = new Set<string>();
  let previousIndex = -1;
  return items.flatMap((item, index) => {
    const path = `$.shots[${index}]`;
    const record = validator.record(item, path, [
      "shotId",
      "storyboardId",
      "index",
      "revision",
      "sourceFingerprint",
      "durationUs",
      "visualSource",
      "subtitleText",
      "audioBindings",
      "motion",
      "transform",
      "approvedContinuityVersion",
    ]);
    if (!record) return [];
    const shotId = uniqueId(record.shotId, shotIds, `${path}.shotId`, validator);
    uniqueId(record.storyboardId, storyboardIds, `${path}.storyboardId`, validator);
    const shotIndex = validator.integer(record.index, `${path}.index`, 0);
    if (shotIndex !== undefined && shotIndex <= previousIndex) {
      validator.issue(`${path}.index`, "shot index 必须严格递增");
    }
    if (shotIndex !== undefined) previousIndex = shotIndex;
    validator.integer(record.revision, `${path}.revision`, 1);
    validator.sha256(record.sourceFingerprint, `${path}.sourceFingerprint`);
    const durationUs = validator.integer(record.durationUs, `${path}.durationUs`, 1);
    if (projectId) validateProjectMediaReference(record.visualSource, projectId, `${path}.visualSource`, validator);
    validator.optionalString(record.subtitleText, `${path}.subtitleText`);
    validateAudioBindings(record.audioBindings, projectId, tracks, durationUs, `${path}.audioBindings`, validator);
    validateShotMotion(record.motion, `${path}.motion`, validator);
    validateEditingTransform(record.transform, `${path}.transform`, validator);
    validator.optionalString(record.approvedContinuityVersion, `${path}.approvedContinuityVersion`);
    return shotId ? [shotId] : [];
  });
}

function validateAudioBindings(
  value: unknown,
  projectId: string | undefined,
  tracks: Map<string, string>,
  shotDurationUs: number | undefined,
  path: string,
  validator: RemotionValidator,
): void {
  const items = validator.array(value, path);
  if (!items) return;
  const chapterBindingKeys = new Set<string>();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      validator.issue(itemPath, "audio binding 必须是对象");
      return;
    }
    const scope = (item as Record<string, unknown>).renderScope;
    if (scope === "shot") {
      const record = validator.record(item, itemPath, [
        "renderScope", "role", "source", "sourceStartUs", "shotStartUs", "durationUs", "volume",
      ]);
      if (!record) return;
      validateMediaRole(record.role, `${itemPath}.role`, validator);
      if (projectId) validateProjectMediaReference(record.source, projectId, `${itemPath}.source`, validator);
      validator.integer(record.sourceStartUs, `${itemPath}.sourceStartUs`, 0);
      const startUs = validator.integer(record.shotStartUs, `${itemPath}.shotStartUs`, 0);
      const durationUs = validator.integer(record.durationUs, `${itemPath}.durationUs`, 1);
      validator.range(record.volume, 0, 4, `${itemPath}.volume`);
      if (startUs !== undefined && durationUs !== undefined && shotDurationUs !== undefined
        && startUs + durationUs > shotDurationUs) {
        validator.issue(`${itemPath}.durationUs`, "shot-scoped 音频不得超出 shot 时长");
      }
      return;
    }
    if (scope === "chapter") {
      const record = validator.record(item, itemPath, [
        "renderScope", "role", "sharedTrackId", "sourceStartUs", "chapterStartUs", "durationUs", "volume",
      ]);
      if (!record) return;
      const role = validateMediaRole(record.role, `${itemPath}.role`, validator);
      const trackId = validator.id(record.sharedTrackId, `${itemPath}.sharedTrackId`);
      const sourceStartUs = validator.integer(record.sourceStartUs, `${itemPath}.sourceStartUs`, 0);
      const chapterStartUs = validator.integer(record.chapterStartUs, `${itemPath}.chapterStartUs`, 0);
      const durationUs = validator.integer(record.durationUs, `${itemPath}.durationUs`, 1);
      validator.range(record.volume, 0, 4, `${itemPath}.volume`);
      if (trackId && (!tracks.has(trackId) || tracks.get(trackId) !== role)) {
        validator.issue(`${itemPath}.sharedTrackId`, "chapter binding 必须引用同章同角色 shared track");
      }
      const key = `${trackId}:${sourceStartUs}:${chapterStartUs}:${durationUs}`;
      if (chapterBindingKeys.has(key)) validator.issue(`${itemPath}.sharedTrackId`, "chapter binding 不得重复");
      chapterBindingKeys.add(key);
      return;
    }
    validator.issue(`${itemPath}.renderScope`, "renderScope 必须是 shot 或 chapter");
  });
}

export interface RemotionShotAudioBindingValidationContext {
  projectId: string;
  chapterId: string;
  shotId: string;
  shotRevision: number;
  shotDurationUs: number;
}

export interface RemotionChapterAudioBindingValidationContext {
  projectId: string;
  chapterId: string;
}

export function validateRemotionShotAudioBindingV2(
  value: unknown,
  expected: RemotionShotAudioBindingValidationContext,
): RemotionValidationResult<RemotionShotAudioBindingV2> {
  const validator = new RemotionValidator();
  validateShotAudioBindingV2(value, expected, "$", validator);
  return validationResult(value, validator);
}

export function validateRemotionChapterAudioBindingV2(
  value: unknown,
  expected: RemotionChapterAudioBindingValidationContext,
): RemotionValidationResult<RemotionChapterAudioBindingV2> {
  const validator = new RemotionValidator();
  validateChapterAudioBindingV2(value, expected, "$", validator);
  return validationResult(value, validator);
}

export function validateRemotionChapterManifestV2(
  value: unknown,
): RemotionValidationResult<RemotionChapterManifestV2> {
  const validator = new RemotionValidator();
  if (isRecord(value) && value.schemaVersion === 1) {
    validator.issue(
      "$.schemaVersion",
      "Remotion chapter manifest V1 必须由明确迁移流程升级，禁止猜测音频 scope",
      "schema_upgrade_required",
    );
    return validationResult(value, validator);
  }
  const record = validator.record(value, "$", [
    "schemaVersion",
    "manifestFingerprint",
    "projectId",
    "chapterId",
    "revision",
    "sourceSnapshotHash",
    "requiredShotIds",
    "sharedAudioBindings",
    "shots",
    "renderSettings",
    "createdAt",
    "updatedAt",
  ]);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 2, "$.schemaVersion");
  validator.sha256(record.manifestFingerprint, "$.manifestFingerprint");
  const projectId = validator.id(record.projectId, "$.projectId");
  const chapterId = validator.id(record.chapterId, "$.chapterId");
  validator.integer(record.revision, "$.revision", 1);
  validator.sha256(record.sourceSnapshotHash, "$.sourceSnapshotHash");
  const requiredShotIds = validateRequiredShotIds(record.requiredShotIds, validator);
  const shotIds = validateShotsV2(record.shots, projectId, chapterId, validator);
  validateSharedAudioBindingsV2(record.sharedAudioBindings, projectId, chapterId, validator);
  if (requiredShotIds && shotIds) {
    if (requiredShotIds.length !== shotIds.length) {
      validator.issue("$.requiredShotIds", "requiredShotIds 必须与 shots 一一对应");
    }
    requiredShotIds.forEach((shotId, index) => {
      if (shotIds[index] !== shotId) {
        validator.issue(`$.requiredShotIds[${index}]`, "required shot 顺序必须与 shots 顺序一致");
      }
    });
  }
  validateEditingRenderSettings(record.renderSettings, "$.renderSettings", validator);
  validateTimestampOrder(record.createdAt, record.updatedAt, "$", validator);
  return validationResult(value, validator);
}

function validateShotsV2(
  value: unknown,
  projectId: string | undefined,
  chapterId: string | undefined,
  validator: RemotionValidator,
): string[] | undefined {
  const items = validator.array(value, "$.shots");
  if (!items) return undefined;
  if (items.length === 0) validator.issue("$.shots", "必须至少包含一个 shot 配置");
  const shotIds = new Set<string>();
  const storyboardIds = new Set<string>();
  let previousIndex = -1;
  return items.flatMap((item, index) => {
    const path = `$.shots[${index}]`;
    const record = validator.record(item, path, [
      "shotId",
      "storyboardId",
      "index",
      "revision",
      "sourceFingerprint",
      "durationUs",
      "visualSource",
      "subtitleText",
      "audioBindings",
      "motion",
      "transform",
      "approvedContinuityVersion",
    ]);
    if (!record) return [];
    const shotId = uniqueId(record.shotId, shotIds, `${path}.shotId`, validator);
    uniqueId(record.storyboardId, storyboardIds, `${path}.storyboardId`, validator);
    const shotIndex = validator.integer(record.index, `${path}.index`, 0);
    if (shotIndex !== undefined && shotIndex <= previousIndex) {
      validator.issue(`${path}.index`, "shot index 必须严格递增");
    }
    if (shotIndex !== undefined) previousIndex = shotIndex;
    const shotRevision = validator.integer(record.revision, `${path}.revision`, 1);
    validator.sha256(record.sourceFingerprint, `${path}.sourceFingerprint`);
    const shotDurationUs = validator.integer(record.durationUs, `${path}.durationUs`, 1);
    if (projectId) validateProjectMediaReference(record.visualSource, projectId, `${path}.visualSource`, validator);
    validator.optionalString(record.subtitleText, `${path}.subtitleText`);
    const bindings = validator.array(record.audioBindings, `${path}.audioBindings`);
    if (bindings && projectId && chapterId && shotId && shotRevision !== undefined && shotDurationUs !== undefined) {
      const bindingIds = new Set<string>();
      const bindingFingerprints = new Set<string>();
      bindings.forEach((binding, bindingIndex) => {
        const bindingPath = `${path}.audioBindings[${bindingIndex}]`;
        const validated = validateShotAudioBindingV2(binding, {
          projectId,
          chapterId,
          shotId,
          shotRevision,
          shotDurationUs,
        }, bindingPath, validator);
        if (!validated) return;
        rejectDuplicateBinding(
          validated.bindingId,
          validated.bindingFingerprint,
          bindingIds,
          bindingFingerprints,
          bindingPath,
          validator,
        );
      });
    }
    validateShotMotion(record.motion, `${path}.motion`, validator);
    validateEditingTransform(record.transform, `${path}.transform`, validator);
    validator.optionalString(record.approvedContinuityVersion, `${path}.approvedContinuityVersion`);
    return shotId ? [shotId] : [];
  });
}

function validateSharedAudioBindingsV2(
  value: unknown,
  projectId: string | undefined,
  chapterId: string | undefined,
  validator: RemotionValidator,
): void {
  const items = validator.array(value, "$.sharedAudioBindings");
  if (!items || !projectId || !chapterId) return;
  const bindingIds = new Set<string>();
  const bindingFingerprints = new Set<string>();
  const identicalTracks = new Set<string>();
  items.forEach((item, index) => {
    const path = `$.sharedAudioBindings[${index}]`;
    const validated = validateChapterAudioBindingV2(item, { projectId, chapterId }, path, validator);
    if (!validated) return;
    rejectDuplicateBinding(
      validated.bindingId,
      validated.bindingFingerprint,
      bindingIds,
      bindingFingerprints,
      path,
      validator,
    );
    const identicalKey = canonicalJson({ ...validated, bindingId: "", bindingFingerprint: "" });
    if (identicalTracks.has(identicalKey)) {
      validator.issue(path, "完全相同的 chapter shared audio track 不得重复", "remotion.audio.duplicate_shared_track");
    }
    identicalTracks.add(identicalKey);
  });
}

function validateShotAudioBindingV2(
  value: unknown,
  expected: RemotionShotAudioBindingValidationContext,
  path: string,
  validator: RemotionValidator,
): RemotionShotAudioBindingV2 | undefined {
  const record = validator.record(value, path, [
    "schemaVersion",
    "bindingId",
    "bindingFingerprint",
    "renderScope",
    "projectId",
    "chapterId",
    "shotId",
    "shotRevision",
    "role",
    "source",
    "sourceFingerprint",
    "sourceDurationUs",
    "sourceStartUs",
    "shotStartUs",
    "durationUs",
    "volume",
    "fadeInUs",
    "fadeOutUs",
    "envelope",
    "ttsInputFingerprint",
  ]);
  if (!record) return undefined;
  validator.exact(record.schemaVersion, 2, `${path}.schemaVersion`);
  validator.exact(record.renderScope, "shot", `${path}.renderScope`);
  const bindingId = validator.id(record.bindingId, `${path}.bindingId`);
  const bindingFingerprint = validator.sha256(record.bindingFingerprint, `${path}.bindingFingerprint`);
  validateExpectedId(record.projectId, expected.projectId, `${path}.projectId`, validator);
  validateExpectedId(record.chapterId, expected.chapterId, `${path}.chapterId`, validator);
  validateExpectedId(record.shotId, expected.shotId, `${path}.shotId`, validator);
  const shotRevision = validator.integer(record.shotRevision, `${path}.shotRevision`, 1);
  if (shotRevision !== undefined && shotRevision !== expected.shotRevision) {
    validator.issue(`${path}.shotRevision`, "音频 binding 必须绑定当前 shot revision");
  }
  const role = validator.enum(record.role, REMOTION_SHOT_AUDIO_ROLES, `${path}.role`);
  validateAudioBindingMediaAndTiming(record, expected.projectId, path, validator);
  const shotStartUs = validator.integer(record.shotStartUs, `${path}.shotStartUs`, 0);
  const durationUs = validator.integer(record.durationUs, `${path}.durationUs`, 1);
  if (shotStartUs !== undefined && durationUs !== undefined
    && shotStartUs + durationUs > expected.shotDurationUs) {
    validator.issue(`${path}.durationUs`, "shot-scoped 音频不得超出 shot 时长");
  }
  if (role === "voice") {
    validator.sha256(record.ttsInputFingerprint, `${path}.ttsInputFingerprint`);
  } else if (record.ttsInputFingerprint !== undefined) {
    validator.issue(`${path}.ttsInputFingerprint`, "只有 voice binding 可以携带 TTS input fingerprint");
  }
  const sourcePath = mediaRelativePath(record.source);
  if (role && sourcePath) {
    const prefix = `remotion/audio/${expected.chapterId}/shots/${expected.shotId}/${role}/`;
    if (!sourcePath.startsWith(prefix)) {
      validator.issue(`${path}.source.relativePath`, "shot 音频必须位于当前 chapter/shot/role 目录", "remotion.audio.path_scope_mismatch");
    }
  }
  return bindingId && bindingFingerprint ? record as unknown as RemotionShotAudioBindingV2 : undefined;
}

function validateChapterAudioBindingV2(
  value: unknown,
  expected: RemotionChapterAudioBindingValidationContext,
  path: string,
  validator: RemotionValidator,
): RemotionChapterAudioBindingV2 | undefined {
  const record = validator.record(value, path, [
    "schemaVersion",
    "bindingId",
    "bindingFingerprint",
    "renderScope",
    "projectId",
    "chapterId",
    "role",
    "source",
    "sourceFingerprint",
    "sourceDurationUs",
    "sourceStartUs",
    "chapterStartUs",
    "durationUs",
    "volume",
    "fadeInUs",
    "fadeOutUs",
    "envelope",
    "ducking",
  ]);
  if (!record) return undefined;
  validator.exact(record.schemaVersion, 2, `${path}.schemaVersion`);
  validator.exact(record.renderScope, "chapter", `${path}.renderScope`);
  const bindingId = validator.id(record.bindingId, `${path}.bindingId`);
  const bindingFingerprint = validator.sha256(record.bindingFingerprint, `${path}.bindingFingerprint`);
  validateExpectedId(record.projectId, expected.projectId, `${path}.projectId`, validator);
  validateExpectedId(record.chapterId, expected.chapterId, `${path}.chapterId`, validator);
  const role = validator.enum(record.role, REMOTION_CHAPTER_AUDIO_ROLES, `${path}.role`);
  validateAudioBindingMediaAndTiming(record, expected.projectId, path, validator);
  validator.integer(record.chapterStartUs, `${path}.chapterStartUs`, 0);
  const ducking = validator.record(record.ducking, `${path}.ducking`, [
    "enabled",
    "reductionDb",
    "attackUs",
    "releaseUs",
  ]);
  if (ducking) {
    if (typeof ducking.enabled !== "boolean") validator.issue(`${path}.ducking.enabled`, "必须是布尔值");
    validator.range(ducking.reductionDb, -60, 0, `${path}.ducking.reductionDb`);
    validator.integer(ducking.attackUs, `${path}.ducking.attackUs`, 0);
    validator.integer(ducking.releaseUs, `${path}.ducking.releaseUs`, 0);
  }
  const sourcePath = mediaRelativePath(record.source);
  if (role && sourcePath) {
    const prefix = `remotion/audio/${expected.chapterId}/shared/${role}/`;
    if (!sourcePath.startsWith(prefix)) {
      validator.issue(`${path}.source.relativePath`, "chapter 音频必须位于当前 chapter/shared/role 目录", "remotion.audio.path_scope_mismatch");
    }
  }
  return bindingId && bindingFingerprint ? record as unknown as RemotionChapterAudioBindingV2 : undefined;
}

function validateAudioBindingMediaAndTiming(
  record: Record<string, unknown>,
  projectId: string,
  path: string,
  validator: RemotionValidator,
): void {
  const source = validateProjectMediaReference(record.source, projectId, `${path}.source`, validator);
  const sourceFingerprint = validator.sha256(record.sourceFingerprint, `${path}.sourceFingerprint`);
  if (source && sourceFingerprint && source.contentSha256 !== sourceFingerprint) {
    validator.issue(`${path}.sourceFingerprint`, "sourceFingerprint 必须等于 source.contentSha256", "remotion.audio.source_fingerprint_mismatch");
  }
  const sourceDurationUs = validator.integer(record.sourceDurationUs, `${path}.sourceDurationUs`, 1);
  const sourceStartUs = validator.integer(record.sourceStartUs, `${path}.sourceStartUs`, 0);
  const durationUs = validator.integer(record.durationUs, `${path}.durationUs`, 1);
  if (sourceDurationUs !== undefined && sourceStartUs !== undefined && durationUs !== undefined
    && sourceStartUs + durationUs > sourceDurationUs) {
    validator.issue(`${path}.durationUs`, "绑定的源范围不得超出音频源时长");
  }
  validator.range(record.volume, 0, 4, `${path}.volume`);
  const fadeInUs = validator.integer(record.fadeInUs, `${path}.fadeInUs`, 0);
  const fadeOutUs = validator.integer(record.fadeOutUs, `${path}.fadeOutUs`, 0);
  if (durationUs !== undefined && fadeInUs !== undefined && fadeOutUs !== undefined
    && fadeInUs + fadeOutUs > durationUs) {
    validator.issue(`${path}.fadeOutUs`, "fadeInUs + fadeOutUs 不得超过 binding 时长");
  }
  validateAudioEnvelope(record.envelope, durationUs, `${path}.envelope`, validator);
}

function validateAudioEnvelope(
  value: unknown,
  durationUs: number | undefined,
  path: string,
  validator: RemotionValidator,
): void {
  const points = validator.array(value, path);
  if (!points) return;
  let previousTime = -1;
  points.forEach((point, index) => {
    const pointPath = `${path}[${index}]`;
    const record = validator.record(point, pointPath, ["timeUs", "gain"]);
    if (!record) return;
    const timeUs = validator.integer(record.timeUs, `${pointPath}.timeUs`, 0);
    validator.range(record.gain, 0, 4, `${pointPath}.gain`);
    if (timeUs !== undefined) {
      if (timeUs <= previousTime) validator.issue(`${pointPath}.timeUs`, "envelope timeUs 必须严格递增且唯一");
      if (durationUs !== undefined && timeUs > durationUs) {
        validator.issue(`${pointPath}.timeUs`, "envelope timeUs 不得超过 binding 时长");
      }
      previousTime = timeUs;
    }
  });
}

function rejectDuplicateBinding(
  bindingId: string,
  bindingFingerprint: string,
  bindingIds: Set<string>,
  bindingFingerprints: Set<string>,
  path: string,
  validator: RemotionValidator,
): void {
  if (bindingIds.has(bindingId)) validator.issue(`${path}.bindingId`, "bindingId 不得重复");
  if (bindingFingerprints.has(bindingFingerprint)) {
    validator.issue(`${path}.bindingFingerprint`, "bindingFingerprint 不得重复");
  }
  bindingIds.add(bindingId);
  bindingFingerprints.add(bindingFingerprint);
}

function validateExpectedId(
  value: unknown,
  expected: string,
  path: string,
  validator: RemotionValidator,
): void {
  const actual = validator.id(value, path);
  if (actual && actual !== expected) validator.issue(path, "音频 binding 身份与当前 render scope 不一致");
}

function mediaRelativePath(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.relativePath !== "string") return undefined;
  return value.relativePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueId(
  value: unknown,
  seen: Set<string>,
  path: string,
  validator: RemotionValidator,
): string | undefined {
  const id = validator.id(value, path);
  if (!id) return undefined;
  if (seen.has(id)) validator.issue(path, "ID 不得重复");
  seen.add(id);
  return id;
}

function validateTimestampOrder(
  createdAt: unknown,
  updatedAt: unknown,
  path: string,
  validator: RemotionValidator,
): void {
  const created = validator.timestamp(createdAt, `${path}.createdAt`);
  const updated = validator.timestamp(updatedAt, `${path}.updatedAt`);
  if (created !== undefined && updated !== undefined && updated < created) {
    validator.issue(`${path}.updatedAt`, "updatedAt 不得早于 createdAt");
  }
}
