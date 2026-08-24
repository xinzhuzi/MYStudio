import type {
  RemotionEvidenceV1,
  RemotionJobError,
  RemotionRenderJobV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { createRemotionRenderJobId } from "./remotion-job-identity";
import { validateRemotionJobTarget } from "./remotion-contract-field-validation";
import {
  RemotionValidator,
  validationResult,
  type RemotionValidationResult,
} from "./remotion-validation-utils";
import { CINEMATIC_CAMERA_PRESETS } from "../cinematic-preset";

const JOB_KEYS = [
  "schemaVersion", "jobId", "projectId", "target", "inputHash", "bundleContentHash",
  "renderSettingsHash", "templateVersion", "remotionVersion", "status", "attempt", "progress",
  "createdAt", "startedAt", "completedAt", "error", "outputPath", "evidencePath",
] as const;

const EVIDENCE_KEYS = [
  "schemaVersion", "jobId", "projectId", "target", "inputHash", "bundleContentHash",
  "renderSettingsHash", "templateVersion", "remotionVersion", "attempt", "compositionId",
  "renderer", "outputPath", "sizeBytes", "mtimeMs", "sha256", "width", "height", "durationUs",
  "streams", "inputManifestPath", "renderPlanPath", "snapshotPath", "cinematic", "startedAt", "completedAt",
] as const;

export function validateRemotionRenderJob(value: unknown): RemotionValidationResult<RemotionRenderJobV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", JOB_KEYS);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const target = validateRemotionJobTarget(record.target, "$.target", validator);
  validateIdentity(record, target, validator);
  validator.semver(record.templateVersion, "$.templateVersion");
  validator.semver(record.remotionVersion, "$.remotionVersion");
  validator.status(record.status, "$.status");
  const attempt = validator.integer(record.attempt, "$.attempt", 0);
  const progress = validator.range(record.progress, 0, 1, "$.progress");
  const createdAt = validator.timestamp(record.createdAt, "$.createdAt");
  const startedAt = validator.optionalTimestamp(record.startedAt, "$.startedAt");
  const completedAt = validator.optionalTimestamp(record.completedAt, "$.completedAt");
  const error = validateJobError(record.error, validator);
  if (record.outputPath !== undefined) validator.relativePath(record.outputPath, "$.outputPath");
  if (record.evidencePath !== undefined) validator.relativePath(record.evidencePath, "$.evidencePath");
  validateTimestampOrder(createdAt, startedAt, completedAt, validator);
  validateJobStatus(record, attempt, progress, startedAt, completedAt, error, validator);
  return validationResult(value, validator);
}

export function validateRemotionEvidence(value: unknown): RemotionValidationResult<RemotionEvidenceV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", EVIDENCE_KEYS);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const target = validateRemotionJobTarget(record.target, "$.target", validator);
  validateIdentity(record, target, validator);
  validator.semver(record.templateVersion, "$.templateVersion");
  validator.semver(record.remotionVersion, "$.remotionVersion");
  validator.integer(record.attempt, "$.attempt", 1);
  const compositionId = validator.enum(record.compositionId, ["StoryboardShot", "ChapterVideo"], "$.compositionId");
  if (target?.kind === "shot" && compositionId !== "StoryboardShot") {
    validator.issue("$.compositionId", "shot evidence 必须使用 StoryboardShot");
  }
  if ((target?.kind === "chapter" || target?.kind === "chapter-scene") && compositionId !== "ChapterVideo") {
    validator.issue("$.compositionId", "chapter evidence 必须使用 ChapterVideo");
  }
  validateRenderer(record.renderer, validator);
  validator.relativePath(record.outputPath, "$.outputPath");
  validator.integer(record.sizeBytes, "$.sizeBytes", 1);
  validator.timestamp(record.mtimeMs, "$.mtimeMs");
  validator.sha256(record.sha256, "$.sha256");
  const width = validator.integer(record.width, "$.width", 1);
  const height = validator.integer(record.height, "$.height", 1);
  validator.integer(record.durationUs, "$.durationUs", 1);
  validateProbeStreams(record.streams, width, height, validator);
  validator.relativePath(record.inputManifestPath, "$.inputManifestPath");
  if (record.renderPlanPath !== undefined) validator.relativePath(record.renderPlanPath, "$.renderPlanPath");
  if (record.snapshotPath !== undefined) validator.relativePath(record.snapshotPath, "$.snapshotPath");
  validateCinematicEvidence(record.cinematic, target?.kind, validator);
  if (target?.kind === "chapter") {
    if (record.renderPlanPath === undefined) validator.issue("$.renderPlanPath", "chapter evidence 必须包含 render plan");
    if (record.snapshotPath === undefined) validator.issue("$.snapshotPath", "chapter evidence 必须包含 editing snapshot");
  }
  const startedAt = validator.timestamp(record.startedAt, "$.startedAt");
  const completedAt = validator.timestamp(record.completedAt, "$.completedAt");
  if (startedAt !== undefined && completedAt !== undefined && completedAt < startedAt) {
    validator.issue("$.completedAt", "completedAt 不得早于 startedAt");
  }
  return validationResult(value, validator);
}

function validateCinematicEvidence(
  value: unknown,
  targetKind: RemotionRenderJobTarget["kind"] | undefined,
  validator: RemotionValidator,
): void {
  if (value === undefined) return;
  const record = validator.record(value, "$.cinematic", [
    "schemaVersion", "preset", "model", "inputSha256", "outputSha256",
    "depthMapPath", "width", "height",
  ]);
  if (!record) return;
  if (targetKind !== "shot") validator.issue("$.cinematic", "cinematic evidence 仅允许用于 shot render");
  validator.exact(record.schemaVersion, 1, "$.cinematic.schemaVersion");
  validator.enum(record.preset, CINEMATIC_CAMERA_PRESETS, "$.cinematic.preset");
  validator.exact(record.model, "depth-anything-v2-small", "$.cinematic.model");
  validator.sha256(record.inputSha256, "$.cinematic.inputSha256");
  validator.sha256(record.outputSha256, "$.cinematic.outputSha256");
  validator.relativePath(record.depthMapPath, "$.cinematic.depthMapPath");
  validator.integer(record.width, "$.cinematic.width", 1);
  validator.integer(record.height, "$.cinematic.height", 1);
}

/**
 * Async boundary check for persisted artifacts. The synchronous validators above
 * validate shape and field formats; this check binds the job ID digest to the
 * complete project/target/input/bundle/settings identity.
 */
export async function validateRemotionRenderJobIdentity(
  value: unknown,
): Promise<RemotionValidationResult<RemotionRenderJobV1>> {
  const result = validateRemotionRenderJob(value);
  if (!result.success) return result;
  const expectedJobId = await createRemotionRenderJobId(result.value);
  if (result.value.jobId !== expectedJobId) {
    return {
      success: false,
      issues: [{
        code: "remotion.job.identity_mismatch",
        path: "$.jobId",
        message: "jobId digest 与 project/target/input/bundle/renderSettings identity 不一致",
      }],
    };
  }
  return result;
}

export async function validateRemotionEvidenceIdentity(
  value: unknown,
): Promise<RemotionValidationResult<RemotionEvidenceV1>> {
  const result = validateRemotionEvidence(value);
  if (!result.success) return result;
  const expectedJobId = await createRemotionRenderJobId(result.value);
  if (result.value.jobId !== expectedJobId) {
    return {
      success: false,
      issues: [{
        code: "remotion.evidence.identity_mismatch",
        path: "$.jobId",
        message: "evidence jobId digest 与 project/target/input/bundle/renderSettings identity 不一致",
      }],
    };
  }
  return result;
}

function validateIdentity(
  record: Record<string, unknown>,
  target: RemotionRenderJobTarget | undefined,
  validator: RemotionValidator,
): void {
  validator.id(record.projectId, "$.projectId");
  const jobId = validator.nonEmptyString(record.jobId, "$.jobId");
  validator.sha256(record.inputHash, "$.inputHash");
  validator.sha256(record.bundleContentHash, "$.bundleContentHash");
  validator.sha256(record.renderSettingsHash, "$.renderSettingsHash");
  if (jobId && target && !new RegExp(`^${target.kind}:[a-f0-9]{64}$`).test(jobId)) {
    validator.issue("$.jobId", `jobId 必须是 ${target.kind}:<sha256>`);
  }
}

function validateJobError(value: unknown, validator: RemotionValidator): RemotionJobError | undefined {
  if (value === undefined) return undefined;
  const record = validator.record(value, "$.error", ["code", "message", "stage"]);
  if (!record) return undefined;
  const code = validator.nonEmptyString(record.code, "$.error.code");
  const message = validator.nonEmptyString(record.message, "$.error.message");
  validator.stage(record.stage, "$.error.stage");
  return code && message ? record as unknown as RemotionJobError : undefined;
}

function validateJobStatus(
  record: Record<string, unknown>,
  attempt: number | undefined,
  progress: number | undefined,
  startedAt: number | undefined,
  completedAt: number | undefined,
  error: RemotionJobError | undefined,
  validator: RemotionValidator,
): void {
  const status = record.status;
  if (["blocked", "failed", "canceled", "stale"].includes(String(status)) && !error) {
    validator.issue("$.error", `${String(status)} job 必须包含结构化原因`);
  }
  if (["pending", "ready", "queued", "running", "succeeded"].includes(String(status))
    && record.error !== undefined) {
    validator.issue("$.error", `${String(status)} job 不得保留旧 error`);
  }
  if (["queued", "running", "succeeded", "failed", "canceled"].includes(String(status))
    && attempt !== undefined && attempt < 1) {
    validator.issue("$.attempt", `${String(status)} job 的 attempt 必须至少为 1`);
  }
  if (status === "running" && startedAt === undefined) validator.issue("$.startedAt", "running job 必须记录 startedAt");
  if (["succeeded", "failed", "canceled"].includes(String(status)) && completedAt === undefined) {
    validator.issue("$.completedAt", `${String(status)} job 必须记录 completedAt`);
  }
  if (status === "succeeded") {
    if (progress !== 1) validator.issue("$.progress", "succeeded job 的 progress 必须为 1");
    if (startedAt === undefined) validator.issue("$.startedAt", "succeeded job 必须记录 startedAt");
    if (record.outputPath === undefined) validator.issue("$.outputPath", "succeeded job 必须绑定 current output");
    if (record.evidencePath === undefined) validator.issue("$.evidencePath", "succeeded job 必须绑定 current evidence");
    if (record.error !== undefined) validator.issue("$.error", "succeeded job 不得包含 error");
  }
  if (!["succeeded", "failed", "canceled"].includes(String(status)) && completedAt !== undefined) {
    validator.issue("$.completedAt", "非终态 job 不得记录 completedAt");
  }
}

function validateRenderer(value: unknown, validator: RemotionValidator): void {
  const record = validator.record(value, "$.renderer", ["requested", "actual"]);
  if (!record) return;
  validator.exact(record.requested, "remotion", "$.renderer.requested");
  validator.exact(record.actual, "remotion", "$.renderer.actual");
}

function validateProbeStreams(
  value: unknown,
  width: number | undefined,
  height: number | undefined,
  validator: RemotionValidator,
): void {
  const streams = validator.array(value, "$.streams");
  if (!streams) return;
  let videoCount = 0;
  let audioCount = 0;
  streams.forEach((stream, index) => {
    const path = `$.streams[${index}]`;
    if (typeof stream !== "object" || stream === null || Array.isArray(stream)) {
      validator.issue(path, "stream 必须是对象");
      return;
    }
    const kind = (stream as Record<string, unknown>).kind;
    if (kind === "video") {
      videoCount += 1;
      const record = validator.record(stream, path, ["kind", "codec", "width", "height"]);
      if (!record) return;
      validator.exact(record.codec, "h264", `${path}.codec`);
      const streamWidth = validator.integer(record.width, `${path}.width`, 1);
      const streamHeight = validator.integer(record.height, `${path}.height`, 1);
      if (streamWidth !== width) validator.issue(`${path}.width`, "video stream width 与 evidence 不一致");
      if (streamHeight !== height) validator.issue(`${path}.height`, "video stream height 与 evidence 不一致");
      return;
    }
    if (kind === "audio") {
      audioCount += 1;
      const record = validator.record(stream, path, ["kind", "codec", "channels", "sampleRate"]);
      if (!record) return;
      validator.exact(record.codec, "aac", `${path}.codec`);
      validator.integer(record.channels, `${path}.channels`, 1);
      validator.integer(record.sampleRate, `${path}.sampleRate`, 1);
      return;
    }
    validator.issue(`${path}.kind`, "stream.kind 必须是 video 或 audio");
  });
  if (videoCount !== 1) validator.issue("$.streams", "evidence 必须包含且仅包含一个视频流");
  if (audioCount !== 1) validator.issue("$.streams", "evidence 必须包含且仅包含一个音频流");
}

function validateTimestampOrder(
  createdAt: number | undefined,
  startedAt: number | undefined,
  completedAt: number | undefined,
  validator: RemotionValidator,
): void {
  if (createdAt !== undefined && startedAt !== undefined && startedAt < createdAt) {
    validator.issue("$.startedAt", "startedAt 不得早于 createdAt");
  }
  if (startedAt !== undefined && completedAt !== undefined && completedAt < startedAt) {
    validator.issue("$.completedAt", "completedAt 不得早于 startedAt");
  }
}
