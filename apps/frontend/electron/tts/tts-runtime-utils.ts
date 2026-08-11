/**
 * tts-runtime 纯工具函数 — 从 tts-runtime.ts 拆出(Child 2 R3)。
 *
 * 这些 JSON/HTTP 解析与判别函数无副作用、无 TtsRuntimeError 依赖,
 * 提取到独立文件便于单测,降低 tts-runtime.ts(原 1477 行)主文件行数。
 */

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function readStringField(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function readBooleanField(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return undefined;
}

export function readStatusField(
  record: Record<string, unknown>,
): number | undefined {
  for (const key of ["status", "statusCode", "status_code"] as const) {
    const value = record[key];
    const status =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : NaN;
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return undefined;
}

export function isRetryableTtsStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function formatTtsTimeout(timeoutMs: number): string {
  return timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
}
