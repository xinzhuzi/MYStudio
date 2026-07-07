import type { DiagnosticsLogError } from "@/types/diagnostics";

const MAX_STRING_LENGTH = 1024;
const MAX_PROMPT_PREVIEW = 120;
const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|x-api-key|token|secret|password|access[-_]?key|bearer)/i;
const PROMPT_KEY_PATTERN = /(prompt|messages?|content|referenceText)/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return value;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
}

function summarizePrompt(value: string) {
  return {
    promptLength: value.length,
    promptHash: hashText(value),
    promptPreview: value.slice(0, MAX_PROMPT_PREVIEW),
    truncated: value.length > MAX_PROMPT_PREVIEW,
  };
}

function looksLikeBase64Payload(value: string) {
  if (value.startsWith("data:") && value.includes(";base64,")) return true;
  if (value.length < 512) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function sanitizeString(key: string | undefined, value: string) {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (looksLikeBase64Payload(value)) {
    return {
      binaryPayload: true,
      length: value.length,
      hash: hashText(value),
    };
  }
  if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
  if (key && PROMPT_KEY_PATTERN.test(key) && value.length > MAX_PROMPT_PREVIEW) {
    return summarizePrompt(value);
  }
  if (value.length > MAX_STRING_LENGTH) {
    return {
      textLength: value.length,
      textHash: hashText(value),
      textPreview: value.slice(0, MAX_STRING_LENGTH),
      truncated: true,
    };
  }
  return value;
}

export function sanitizeDiagnosticsData(value: unknown, key?: string, depth = 0): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(key, value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return sanitizeDiagnosticsError(value);
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDiagnosticsData(item, key, depth + 1));
  }
  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = sanitizeDiagnosticsData(entryValue, entryKey, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function sanitizeDiagnosticsError(error: unknown): DiagnosticsLogError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: String(sanitizeDiagnosticsData(error.message)),
      stack: error.stack ? String(sanitizeDiagnosticsData(error.stack)).slice(0, 2000) : undefined,
    };
  }
  return { message: String(sanitizeDiagnosticsData(String(error))) };
}

export function summarizeResponseBody(value: string, limit = MAX_STRING_LENGTH) {
  const sanitized = sanitizeDiagnosticsData(value);
  if (typeof sanitized === "string") return sanitized.slice(0, limit);
  return JSON.stringify(sanitized).slice(0, limit);
}
