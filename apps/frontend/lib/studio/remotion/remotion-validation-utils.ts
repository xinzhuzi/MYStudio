import {
  REMOTION_STAGE_IDS,
  REMOTION_STAGE_STATUSES,
  type RemotionRenderJobTarget,
} from "@/types/remotion-workspace";

export interface RemotionValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type RemotionValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: RemotionValidationIssue[] };

export class RemotionValidator {
  readonly issues: RemotionValidationIssue[] = [];

  issue(path: string, message: string, code = "remotion.contract.invalid"): void {
    this.issues.push({ code, path, message });
  }

  record(value: unknown, path: string, allowedKeys: readonly string[]): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
      this.issue(path, "必须是对象");
      return undefined;
    }
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) this.issue(`${path}.${key}`, "字段不属于当前 schema");
    }
    return value;
  }

  array(value: unknown, path: string): unknown[] | undefined {
    if (!Array.isArray(value)) {
      this.issue(path, "必须是数组");
      return undefined;
    }
    return value;
  }

  nonEmptyString(value: unknown, path: string): string | undefined {
    if (typeof value !== "string" || value.trim().length === 0) {
      this.issue(path, "必须是非空字符串");
      return undefined;
    }
    return value;
  }

  optionalString(value: unknown, path: string): void {
    if (value !== undefined && typeof value !== "string") this.issue(path, "必须是字符串");
  }

  id(value: unknown, path: string): string | undefined {
    const result = this.nonEmptyString(value, path);
    if (!result) return undefined;
    if (result === "." || result === ".." || /[\\/\0]/.test(result)) {
      this.issue(path, "标识符不得包含路径分隔符或路径逃逸片段");
      return undefined;
    }
    return result;
  }

  relativePath(value: unknown, path: string): string | undefined {
    const result = this.nonEmptyString(value, path);
    if (!result) return undefined;
    const invalid = result.startsWith("/")
      || result.startsWith("\\")
      || result.includes("\\")
      || result.includes("\0")
      || /^[a-z][a-z0-9+.-]*:/i.test(result)
      || /%(?:2e|2f|5c)/i.test(result)
      || result.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
    if (invalid) {
      this.issue(path, "必须是项目内规范化相对路径");
      return undefined;
    }
    return result;
  }

  sha256(value: unknown, path: string): string | undefined {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
      this.issue(path, "必须是 64 位小写 SHA-256 十六进制字符串");
      return undefined;
    }
    return value;
  }

  semver(value: unknown, path: string): string | undefined {
    if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
      this.issue(path, "必须是明确的语义版本");
      return undefined;
    }
    return value;
  }

  exact(value: unknown, expected: unknown, path: string): void {
    if (value !== expected) this.issue(path, `必须等于 ${String(expected)}`);
  }

  enum(value: unknown, allowed: readonly string[], path: string): string | undefined {
    if (typeof value !== "string" || !allowed.includes(value)) {
      this.issue(path, `必须是 ${allowed.join(" | ")}`);
      return undefined;
    }
    return value;
  }

  integer(value: unknown, path: string, minimum = 0): number | undefined {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      this.issue(path, `必须是大于等于 ${minimum} 的安全整数`);
      return undefined;
    }
    return value as number;
  }

  finite(value: unknown, path: string): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.issue(path, "必须是有限数值");
      return undefined;
    }
    return value;
  }

  range(value: unknown, minimum: number, maximum: number, path: string): number | undefined {
    const result = this.finite(value, path);
    if (result === undefined) return undefined;
    if (result < minimum || result > maximum) {
      this.issue(path, `必须位于 ${minimum}..${maximum}`);
      return undefined;
    }
    return result;
  }

  timestamp(value: unknown, path: string): number | undefined {
    return this.integer(value, path, 0);
  }

  optionalTimestamp(value: unknown, path: string): number | undefined {
    return value === undefined ? undefined : this.timestamp(value, path);
  }

  status(value: unknown, path: string): void {
    this.enum(value, REMOTION_STAGE_STATUSES, path);
  }

  stage(value: unknown, path: string): void {
    this.enum(value, REMOTION_STAGE_IDS, path);
  }
}

export function validationResult<T>(value: unknown, validator: RemotionValidator): RemotionValidationResult<T> {
  if (validator.issues.length > 0) return { success: false, issues: validator.issues };
  return { success: true, value: value as T };
}

export function appendResult(
  validator: RemotionValidator,
  result: RemotionValidationResult<unknown>,
  prefix = "",
): void {
  if (result.success) return;
  for (const issue of result.issues) {
    validator.issues.push({ ...issue, path: prefix ? `${prefix}${issue.path.slice(1)}` : issue.path });
  }
}

export function sameRemotionTarget(left: RemotionRenderJobTarget, right: RemotionRenderJobTarget): boolean {
  if (left.kind !== right.kind || left.chapterId !== right.chapterId) return false;
  if (left.kind === "shot" && right.kind === "shot") {
    return left.shotId === right.shotId && left.shotRevision === right.shotRevision;
  }
  if (left.kind === "chapter" && right.kind === "chapter") {
    return left.editingProjectId === right.editingProjectId
      && left.editingRevision === right.editingRevision;
  }
  return false;
}

export function remotionTargetKey(target: RemotionRenderJobTarget): string {
  return target.kind === "shot"
    ? `shot:${target.chapterId}:${target.shotId}`
    : `chapter:${target.chapterId}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
