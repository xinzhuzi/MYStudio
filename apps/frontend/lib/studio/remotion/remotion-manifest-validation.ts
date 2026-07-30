import type {
  RemotionChapterManifestV1,
  RemotionWorkspaceManifestV1,
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
    validateTimestampOrder(record.createdAt, record.updatedAt, "$", validator);
  }
  return validationResult(value, validator);
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
