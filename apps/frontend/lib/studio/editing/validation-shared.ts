import type { EditingValidationIssue } from "@/types/editing";

/**
 * 校验共享微工具层(依赖图矩阵驱动归属)——13+ 个跨族工具与禁用键扫描。
 * 08-31 深网专批:按逐消费者矩阵定层,体逐字保留。
 */


export interface EffectTargetInfo {
  startUs: unknown;
  durationUs: unknown;
  trackKind: unknown;
  sourceKind: unknown;
}

export const FORBIDDEN_RENDER_KEYS = new Set([
  "command",
  "args",
  "extraArgs",
  "outputPath",
  "shell",
  "filterGraph",
  "filter_complex",
  "token",
  "sessionId",
  "assetId",
  "url",
  "src",
  "mediaUrlByClipId",
  "composition",
]);

export function scanForbiddenRenderKeys(
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

export function addUniqueId(
  id: string | null,
  ids: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!id) return;
  if (ids.has(id)) issue(issues, "editing.id.duplicate", path, `重复 ID: ${id}`);
  ids.add(id);
}

export function arrayValue(value: unknown, issues: EditingValidationIssue[], path: string): unknown[] {
  if (Array.isArray(value)) return value;
  issue(issues, "editing.array", path, "字段必须是数组");
  return [];
}

export function exactOne(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== 1) issue(issues, "editing.schema_version", path, "schemaVersion 必须为 1");
}

export function requiredString(value: unknown, issues: EditingValidationIssue[], path: string): string | null {
  if (typeof value === "string" && value.trim()) return value;
  issue(issues, "editing.string.required", path, "字段必须是非空字符串");
  return null;
}

export function optionalString(value: unknown, issues: EditingValidationIssue[], path: string): string | null {
  if (value === undefined) return null;
  return requiredString(value, issues, path);
}

export function enumValue(value: unknown, values: Set<string>, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "string" || !values.has(value)) issue(issues, code, path, "字段不在允许值中");
}

export function booleanValue(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (typeof value !== "boolean") issue(issues, "editing.boolean", path, "字段必须是布尔值");
}

export function rangedNumber(value: unknown, min: number, max: number, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issue(issues, code, path, `字段必须是 ${min}..${max} 的有限数字`);
  }
}

export function positiveFinite(value: unknown, issues: EditingValidationIssue[], path: string, code = "editing.number.positive") {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issue(issues, code, path, "字段必须是正有限数字");
}

export function nonNegativeInteger(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issue(issues, "editing.time.non_negative_integer", path, "字段必须是非负安全整数");
    return undefined;
  }
  return value;
}

export function positiveInteger(value: unknown, issues: EditingValidationIssue[], path: string, code: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) issue(issues, code, path, "字段必须是正安全整数");
}

export function positiveTime(value: unknown, issues: EditingValidationIssue[], path: string, code = "editing.time.positive_integer") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) issue(issues, code, path, "时长必须是正安全整数");
  if (code !== "editing.time.positive_integer" && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)) {
    issue(issues, "editing.time.positive_integer", path, "时长必须是正安全整数");
  }
}

export function optionalNonNegativeInteger(value: unknown, issues: EditingValidationIssue[], path: string) {
  if (value !== undefined) nonNegativeInteger(value, issues, path);
}

export function issue(issues: EditingValidationIssue[], code: string, path: string, message: string) {
  issues.push({ code, path, message });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
