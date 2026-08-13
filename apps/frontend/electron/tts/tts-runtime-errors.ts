/**
 * tts-runtime 错误封装与传输错误归一化 — 从 tts-runtime.ts 拆出(08-11-structure-refactor)。
 *
 * 集中 TTS 后端 HTTP 错误解析、TtsRuntimeError 类、传输错误归一化与请求超时/上下文包装。
 * tts-runtime.ts 会 re-export 公共符号(TtsRuntimeError/TtsRuntimeErrorEnvelope/decodeTtsErrorEnvelope)。
 */

import {
  getErrorMessage, isRecord, parseJsonString, readStringField,
  readBooleanField, readStatusField, isRetryableTtsStatus, isAbortError, formatTtsTimeout,
} from "./tts-runtime-utils";

export interface TtsRuntimeErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
}

export class TtsRuntimeError extends Error {
  readonly envelope: TtsRuntimeErrorEnvelope;
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(envelope: TtsRuntimeErrorEnvelope, legacyMessage = envelope.message) {
    super(legacyMessage);
    this.name = "TtsRuntimeError";
    this.envelope = envelope;
    this.code = envelope.code;
    this.retryable = envelope.retryable;
    this.status = envelope.status;
  }
}

export function findTtsErrorRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonString(value);
  if (!isRecord(parsed)) return undefined;

  for (const key of ["error", "detail", "result", "data"] as const) {
    const nested = parsed[key];
    if (isRecord(nested)) {
      const found = findTtsErrorRecord(nested);
      if (found) return found;
    }
  }

  const hasErrorField = [
    "code",
    "errorCode",
    "error_code",
    "message",
    "detail",
    "error",
    "retryable",
    "status",
    "statusCode",
    "status_code",
  ].some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  return hasErrorField ? parsed : undefined;
}

export function decodeTtsErrorEnvelope(value: unknown, fallbackStatus?: number): TtsRuntimeErrorEnvelope | undefined {
  const record = findTtsErrorRecord(value);
  if (!record) return undefined;

  const message = readStringField(record, ["message", "detail", "error"]);
  if (!message) return undefined;
  const status = readStatusField(record) ?? fallbackStatus;
  const explicitRetryable = readBooleanField(record, ["retryable"]);
  return {
    code: readStringField(record, ["code", "errorCode", "error_code"]) ?? "http-error",
    message,
    retryable: explicitRetryable ?? (status !== undefined && isRetryableTtsStatus(status)),
    status,
  };
}

export function createTtsBackendHttpError(bodyText: string, status: number): TtsRuntimeError {
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = undefined;
  }
  const envelope = decodeTtsErrorEnvelope(body, status) ?? {
    code: "http-error",
    message: bodyText || `TTS backend request failed (${status})`,
    retryable: isRetryableTtsStatus(status),
    status,
  };
  return new TtsRuntimeError(envelope, bodyText || `TTS backend request failed (${status})`);
}

export function normalizeTtsTransportError(error: unknown): TtsRuntimeError {
  if (error instanceof TtsRuntimeError) return error;
  if (isAbortError(error)) {
    return new TtsRuntimeError({
      code: "aborted",
      message: "TTS backend request was aborted",
      retryable: false,
    }, getErrorMessage(error));
  }
  const message = getErrorMessage(error) || "TTS backend request failed";
  const decoded = decodeTtsErrorEnvelope(error) ?? decodeTtsErrorEnvelope(message);
  return decoded
    ? new TtsRuntimeError(decoded, message)
    : new TtsRuntimeError({ code: "network-error", message, retryable: true }, message);
}

export async function fetchWithTtsDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new TtsRuntimeError({
        code: "timeout",
        message: `TTS backend request timed out after ${formatTtsTimeout(timeoutMs)}`,
        retryable: true,
      });
    }
    throw normalizeTtsTransportError(error);
  } finally {
    clearTimeout(timer);
  }
}

export function withTtsRequestContext(error: unknown, method: string, requestUrl: string): TtsRuntimeError {
  const message = `本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage(error)}`;
  const normalized = normalizeTtsTransportError(error);
  return new TtsRuntimeError(normalized.envelope, message);
}
