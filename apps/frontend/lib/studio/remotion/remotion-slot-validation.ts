import type {
  RemotionCurrentSlotPublicationV1,
  RemotionCurrentSlotV1,
  RemotionEvidenceV1,
  RemotionRenderJobV1,
  RemotionRenderJobTarget,
} from "@/types/remotion-workspace";
import { validateRemotionJobTarget } from "./remotion-contract-field-validation";
import { remotionCurrentSlotPaths } from "./remotion-current-paths";
import { validateRemotionEvidence, validateRemotionRenderJob } from "./remotion-render-validation";
import {
  RemotionValidator,
  appendResult,
  isRecord,
  remotionTargetKey,
  sameRemotionTarget,
  validationResult,
  type RemotionValidationResult,
} from "./remotion-validation-utils";

export function validateRemotionCurrentSlot(value: unknown): RemotionValidationResult<RemotionCurrentSlotV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", [
    "schemaVersion", "projectId", "target", "jobPath", "evidencePath", "outputPath",
    "job", "evidence", "publishedAt",
  ]);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const projectId = validator.id(record.projectId, "$.projectId");
  const target = validateRemotionJobTarget(record.target, "$.target", validator);
  validator.relativePath(record.jobPath, "$.jobPath");
  validator.relativePath(record.evidencePath, "$.evidencePath");
  validator.relativePath(record.outputPath, "$.outputPath");
  const jobResult = validateRemotionRenderJob(record.job);
  const evidenceResult = validateRemotionEvidence(record.evidence);
  appendResult(validator, jobResult, "$.job");
  appendResult(validator, evidenceResult, "$.evidence");
  validator.timestamp(record.publishedAt, "$.publishedAt");
  if (target) validateExpectedCurrentPaths(record, target, validator);
  if (jobResult.success && evidenceResult.success && projectId && target) {
    validateSlotIdentity(record, projectId, target, jobResult.value, evidenceResult.value, validator);
  }
  return validationResult(value, validator);
}

export function validateRemotionCurrentSlotCollection(
  value: unknown,
): RemotionValidationResult<RemotionCurrentSlotV1[]> {
  const validator = new RemotionValidator();
  const items = validator.array(value, "$" );
  if (!items) return validationResult(value, validator);
  const targets = new Set<string>();
  const paths = new Set<string>();
  items.forEach((item, index) => {
    const result = validateRemotionCurrentSlot(item);
    appendResult(validator, result, `$[${index}]`);
    if (!result.success) return;
    const key = `${result.value.projectId}:${remotionTargetKey(result.value.target)}`;
    if (targets.has(key)) validator.issue(`$[${index}].target`, "同一项目 target 只能有一个 current slot");
    targets.add(key);
    for (const path of [result.value.jobPath, result.value.evidencePath, result.value.outputPath]) {
      const scopedPath = `${result.value.projectId}:${path}`;
      if (paths.has(scopedPath)) validator.issue(`$[${index}].target`, "current slot 路径不得被多个 target 复用");
      paths.add(scopedPath);
    }
  });
  return validationResult(value, validator);
}

export function validateRemotionCurrentSlotPublication(
  value: unknown,
): RemotionValidationResult<RemotionCurrentSlotPublicationV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", [
    "schemaVersion", "publicationId", "projectId", "target", "currentPaths",
    "stagedJobPath", "stagedEvidencePath", "stagedOutput", "job", "evidence", "preparedAt",
  ]);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const publicationId = validator.id(record.publicationId, "$.publicationId");
  const projectId = validator.id(record.projectId, "$.projectId");
  const target = validateRemotionJobTarget(record.target, "$.target", validator);
  const currentPaths = validator.record(record.currentPaths, "$.currentPaths", [
    "jobPath", "evidencePath", "outputPath",
  ]);
  if (currentPaths) {
    validator.relativePath(currentPaths.jobPath, "$.currentPaths.jobPath");
    validator.relativePath(currentPaths.evidencePath, "$.currentPaths.evidencePath");
    validator.relativePath(currentPaths.outputPath, "$.currentPaths.outputPath");
    if (target) validateExpectedCurrentPaths(currentPaths, target, validator, "$.currentPaths");
  }
  const stagedJobPath = validator.relativePath(record.stagedJobPath, "$.stagedJobPath");
  const stagedEvidencePath = validator.relativePath(record.stagedEvidencePath, "$.stagedEvidencePath");
  for (const [path, label] of [
    [stagedJobPath, "$.stagedJobPath"],
    [stagedEvidencePath, "$.stagedEvidencePath"],
  ] as const) {
    if (path && publicationId && !path.startsWith(`staging/${publicationId}/`)) {
      validator.issue(label, "staged contract 必须属于本 publication staging 目录");
    }
  }
  const stagedOutput = validator.record(record.stagedOutput, "$.stagedOutput", [
    "relativePath", "sizeBytes", "mtimeMs", "sha256",
  ]);
  if (stagedOutput) {
    const stagedPath = validator.relativePath(stagedOutput.relativePath, "$.stagedOutput.relativePath");
    validator.integer(stagedOutput.sizeBytes, "$.stagedOutput.sizeBytes", 1);
    validator.timestamp(stagedOutput.mtimeMs, "$.stagedOutput.mtimeMs");
    validator.sha256(stagedOutput.sha256, "$.stagedOutput.sha256");
    if (stagedPath && publicationId && !stagedPath.startsWith(`staging/${publicationId}/`)) {
      validator.issue("$.stagedOutput.relativePath", "staged output 必须属于本 publication staging 目录");
    }
    const stagingPaths = [stagedJobPath, stagedEvidencePath, stagedPath].filter(
      (path): path is string => typeof path === "string",
    );
    if (new Set(stagingPaths).size !== stagingPaths.length) {
      validator.issue("$.stagedOutput.relativePath", "staged job、evidence 与 output 必须使用独立路径");
    }
  }
  const jobResult = validateRemotionRenderJob(record.job);
  const evidenceResult = validateRemotionEvidence(record.evidence);
  appendResult(validator, jobResult, "$.job");
  appendResult(validator, evidenceResult, "$.evidence");
  const preparedAt = validator.timestamp(record.preparedAt, "$.preparedAt");
  if (isRecord(record.job) && record.job.status !== "succeeded") {
    validator.issue("$.job.status", "只有 succeeded staged job 可以发布");
  }
  if (jobResult.success && evidenceResult.success && projectId && target && currentPaths) {
    validatePublicationIdentity(
      record,
      projectId,
      target,
      currentPaths,
      jobResult.value,
      evidenceResult.value,
      stagedOutput,
      preparedAt,
      validator,
    );
  }
  return validationResult(value, validator);
}

function validateExpectedCurrentPaths(
  record: Record<string, unknown>,
  target: RemotionRenderJobTarget,
  validator: RemotionValidator,
  path = "$",
): void {
  const expected = remotionCurrentSlotPaths(target);
  for (const key of ["jobPath", "evidencePath", "outputPath"] as const) {
    if (record[key] !== expected[key]) validator.issue(`${path}.${key}`, `current ${key} 与 target 不一致`);
  }
}

function validateSlotIdentity(
  record: Record<string, unknown>,
  projectId: string,
  target: RemotionRenderJobTarget,
  job: RemotionRenderJobV1,
  evidence: RemotionEvidenceV1,
  validator: RemotionValidator,
): void {
  if (job.status !== "succeeded") validator.issue("$.job.status", "current slot job 必须 succeeded");
  compareCoreIdentity(projectId, target, job, evidence, validator);
  if (record.outputPath !== job.outputPath) validator.issue("$.outputPath", "slot outputPath 与 job 不一致");
  if (record.outputPath !== evidence.outputPath) validator.issue("$.outputPath", "slot outputPath 与 evidence 不一致");
  if (record.evidencePath !== job.evidencePath) validator.issue("$.evidencePath", "slot evidencePath 与 job 不一致");
  const publishedAt = typeof record.publishedAt === "number" ? record.publishedAt : undefined;
  if (publishedAt !== undefined && publishedAt < evidence.completedAt) {
    validator.issue("$.publishedAt", "publishedAt 不得早于 evidence 完成时间");
  }
}

function validatePublicationIdentity(
  record: Record<string, unknown>,
  projectId: string,
  target: RemotionRenderJobTarget,
  currentPaths: Record<string, unknown>,
  job: RemotionRenderJobV1,
  evidence: RemotionEvidenceV1,
  stagedOutput: Record<string, unknown> | undefined,
  preparedAt: number | undefined,
  validator: RemotionValidator,
): void {
  compareCoreIdentity(projectId, target, job, evidence, validator);
  if (job.outputPath !== currentPaths.outputPath) validator.issue("$.job.outputPath", "job 必须指向目标 current output");
  if (job.evidencePath !== currentPaths.evidencePath) validator.issue("$.job.evidencePath", "job 必须指向目标 current evidence");
  if (evidence.outputPath !== currentPaths.outputPath) validator.issue("$.evidence.outputPath", "evidence 必须指向目标 current output");
  if (stagedOutput) {
    for (const key of ["sizeBytes", "mtimeMs", "sha256"] as const) {
      if (stagedOutput[key] !== evidence[key]) validator.issue(`$.stagedOutput.${key}`, `staged ${key} 与 evidence 不一致`);
    }
  }
  if (preparedAt !== undefined && preparedAt < evidence.completedAt) {
    validator.issue("$.preparedAt", "preparedAt 不得早于 evidence 完成时间");
  }
  void record;
}

function compareCoreIdentity(
  projectId: string,
  target: RemotionRenderJobTarget,
  job: RemotionRenderJobV1,
  evidence: RemotionEvidenceV1,
  validator: RemotionValidator,
): void {
  if (job.projectId !== projectId) validator.issue("$.job.projectId", "job 与 slot projectId 不一致");
  if (evidence.projectId !== projectId) validator.issue("$.evidence.projectId", "evidence 与 slot projectId 不一致");
  if (!sameRemotionTarget(job.target, target)) validator.issue("$.job.target", "job target 与 slot 不一致");
  if (!sameRemotionTarget(evidence.target, target)) validator.issue("$.evidence.target", "evidence target 与 slot 不一致");
  for (const key of [
    "jobId", "inputHash", "bundleContentHash", "renderSettingsHash",
    "templateVersion", "remotionVersion", "attempt",
  ] as const) {
    if (job[key] !== evidence[key]) validator.issue(`$.evidence.${key}`, `evidence ${key} 与 job 不一致`);
  }
}
