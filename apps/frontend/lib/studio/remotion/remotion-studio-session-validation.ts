import {
  REMOTION_STUDIO_ALLOWED_WRITE_FIELDS,
  type RemotionStudioSessionContractV1,
  type RemotionStudioWriteRequestV1,
} from "@/types/remotion-workspace";
import {
  RemotionValidator,
  validationResult,
  type RemotionValidationResult,
} from "./remotion-validation-utils";

const SESSION_KEYS = [
  "schemaVersion", "sessionId", "projectId", "chapterId", "editingProjectId",
  "editingRevision", "projectionSourceHash", "projectionSourcePath", "allowedWriteFields",
  "status", "createdAt", "updatedAt",
] as const;

const WRITE_REQUEST_KEYS = [
  "schemaVersion", "sessionId", "projectId", "chapterId", "editingProjectId",
  "editingRevision", "projectionSourceHash", "projectionSourcePath", "changedFields", "sourceInspection",
] as const;

export function validateRemotionStudioSessionContract(
  value: unknown,
): RemotionValidationResult<RemotionStudioSessionContractV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", SESSION_KEYS);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  const sessionId = validator.id(record.sessionId, "$.sessionId");
  validator.id(record.projectId, "$.projectId");
  validator.id(record.chapterId, "$.chapterId");
  validator.id(record.editingProjectId, "$.editingProjectId");
  validator.integer(record.editingRevision, "$.editingRevision", 0);
  validator.sha256(record.projectionSourceHash, "$.projectionSourceHash");
  const sourcePath = validator.relativePath(record.projectionSourcePath, "$.projectionSourcePath");
  if (sessionId && sourcePath !== expectedProjectionSourcePath(sessionId)) {
    validator.issue("$.projectionSourcePath", "projection source path 不属于当前 Studio session");
  }
  validateAllowedWriteFields(record.allowedWriteFields, "$.allowedWriteFields", validator, true);
  validator.status(record.status, "$.status");
  const createdAt = validator.timestamp(record.createdAt, "$.createdAt");
  const updatedAt = validator.timestamp(record.updatedAt, "$.updatedAt");
  if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) {
    validator.issue("$.updatedAt", "updatedAt 不得早于 createdAt");
  }
  return validationResult(value, validator);
}

export function validateRemotionStudioWriteRequest(
  value: unknown,
  session: RemotionStudioSessionContractV1,
): RemotionValidationResult<RemotionStudioWriteRequestV1> {
  const validator = new RemotionValidator();
  const record = validator.record(value, "$", WRITE_REQUEST_KEYS);
  if (!record) return validationResult(value, validator);
  validator.exact(record.schemaVersion, 1, "$.schemaVersion");
  validator.id(record.sessionId, "$.sessionId");
  validator.id(record.projectId, "$.projectId");
  validator.id(record.chapterId, "$.chapterId");
  validator.id(record.editingProjectId, "$.editingProjectId");
  validator.integer(record.editingRevision, "$.editingRevision", 0);
  validator.sha256(record.projectionSourceHash, "$.projectionSourceHash");
  validator.relativePath(record.projectionSourcePath, "$.projectionSourcePath");
  validateAllowedWriteFields(record.changedFields, "$.changedFields", validator, false);
  validateSourceInspection(record.sourceInspection, validator);
  const identityFields = [
    "sessionId", "projectId", "chapterId", "editingProjectId", "editingRevision",
    "projectionSourceHash", "projectionSourcePath",
  ] as const;
  for (const field of identityFields) {
    if (record[field] !== session[field]) {
      validator.issue(`$.${field}`, `write request ${field} 与当前 session 不一致`);
    }
  }
  if (session.status !== "ready") {
    validator.issue("$.sessionId", "只有 ready Studio session 可以回写");
  }
  return validationResult(value, validator);
}

function validateSourceInspection(value: unknown, validator: RemotionValidator): void {
  const record = validator.record(value, "$.sourceInspection", [
    "unknownImports",
    "unknownJsxNodes",
    "unknownMediaReferences",
    "unknownShotIds",
    "structureValid",
  ]);
  if (!record) return;
  for (const key of [
    "unknownImports",
    "unknownJsxNodes",
    "unknownMediaReferences",
    "unknownShotIds",
  ] as const) {
    const values = validator.array(record[key], `$.sourceInspection.${key}`);
    if (!values) continue;
    values.forEach((item, index) => validator.nonEmptyString(item, `$.sourceInspection.${key}[${index}]`));
    if (values.length > 0) {
      validator.issue(`$.sourceInspection.${key}`, `${key} 必须为空，未知源码不得回写`);
    }
  }
  if (record.structureValid !== true) {
    validator.issue("$.sourceInspection.structureValid", "Studio projection 结构必须与生成器合同一致");
  }
}

function validateAllowedWriteFields(
  value: unknown,
  path: string,
  validator: RemotionValidator,
  requireCompleteWhitelist: boolean,
): void {
  const fields = validator.array(value, path);
  if (!fields) return;
  if (!requireCompleteWhitelist && fields.length === 0) validator.issue(path, "changedFields 不得为空");
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const validated = validator.enum(field, REMOTION_STUDIO_ALLOWED_WRITE_FIELDS, `${path}[${index}]`);
    if (!validated) return;
    if (seen.has(validated)) validator.issue(`${path}[${index}]`, "字段不得重复");
    seen.add(validated);
  });
  if (requireCompleteWhitelist) {
    const exact = fields.length === REMOTION_STUDIO_ALLOWED_WRITE_FIELDS.length
      && fields.every((field, index) => field === REMOTION_STUDIO_ALLOWED_WRITE_FIELDS[index]);
    if (!exact) validator.issue(path, "allowedWriteFields 必须严格等于系统白名单");
  }
}

function expectedProjectionSourcePath(sessionId: string): string {
  return `studio/sessions/${sessionId}/chapter.tsx`;
}
