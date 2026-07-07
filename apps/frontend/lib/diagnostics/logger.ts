import type { DiagnosticsLogEntryInput } from "@/types/diagnostics";
import { sanitizeDiagnosticsError } from "./sanitize";

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createOperationId(prefix = "op") {
  return `${prefix}-${randomId()}`;
}

export async function logEvent(entry: DiagnosticsLogEntryInput) {
  try {
    await window.diagnosticsLog?.write(entry);
  } catch {
    // Diagnostics must never break production flows.
  }
}

export function captureError(error: unknown) {
  return sanitizeDiagnosticsError(error);
}

export function startSpan(params: Omit<DiagnosticsLogEntryInput, "durationMs">) {
  const startedAt = performance.now();
  void logEvent({
    ...params,
    level: params.level ?? "debug",
  });
  return {
    operationId: params.operationId,
    requestId: params.requestId,
    end: (entry: DiagnosticsLogEntryInput) => logEvent({
      ...entry,
      operationId: entry.operationId ?? params.operationId,
      requestId: entry.requestId ?? params.requestId,
      durationMs: Math.round(performance.now() - startedAt),
    }),
  };
}
