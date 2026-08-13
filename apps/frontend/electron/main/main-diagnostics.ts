/**
 * main.ts 诊断网络工具 — 从 main.ts 拆出(08-11-structure-refactor)。
 *
 * 提取零状态依赖的诊断函数:
 * 1. createDiagnosticsOperationId —— 仅依赖 node:crypto,纯函数。
 * 2. diagnosticsFetchJson / diagnosticsFetchBytes —— 仅通过 deps.logEvent 注入
 *    日志接收器,避免在 main.ts 关闭的 diagnosticsLogService 单例上形成闭包。
 *
 * 行为与原 main.ts 内联实现逐字节一致(writeDiagnosticsLog → deps.logEvent)。
 */
import crypto from "node:crypto";
import { observedFetch } from "../../lib/diagnostics/network";
import type { DiagnosticsLogEntryInput } from "../../types/diagnostics";

export function createDiagnosticsOperationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** diagnostics 日志接收器契约,对应 main.ts 内的 writeDiagnosticsLog。 */
export type DiagnosticsLogSink = (entry: DiagnosticsLogEntryInput) => void;

/** diagnostics 抓取函数的外部依赖(logEvent 不能关闭 diagnosticsLogService 单例)。 */
export interface DiagnosticsFetchDeps {
  logEvent: DiagnosticsLogSink;
}

export async function diagnosticsFetchJson(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string },
  deps: DiagnosticsFetchDeps,
) {
  const operationId = createDiagnosticsOperationId("tts-http");
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId("req"),
    endpointFamily: "tts-runtime",
    providerName: "Manying Local TTS",
    fetcher: fetch as typeof fetch,
    logEvent: deps.logEvent,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `TTS backend request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response.text();
  }
  return response.json();
}

export async function diagnosticsFetchBytes(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string },
  deps: DiagnosticsFetchDeps,
) {
  const operationId = createDiagnosticsOperationId("tts-http");
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId("req"),
    endpointFamily: "tts-runtime-bytes",
    providerName: "Manying Local TTS",
    fetcher: fetch as typeof fetch,
    logEvent: deps.logEvent,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `TTS backend request failed (${response.status})`);
  }
  return {
    data: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? undefined,
  };
}
