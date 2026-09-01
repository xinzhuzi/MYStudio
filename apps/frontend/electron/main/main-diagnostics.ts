/**
 * main.ts 诊断观测族(assembly 专批外迁,体逐字保留)——diagnostics 日志服务/
 * 写手/操作 id/TTS HTTP 观测 fetch/TTS runtime 诊断包装。
 * 零装配顺序依赖:全部只依赖 electron userData 路径与纯函数。
 */
import { app } from 'electron'
import path from 'node:path'
import crypto from 'node:crypto'
import { createDiagnosticsLogService } from '../diagnostics/diagnostics-log'
import { observedFetch } from '../../lib/diagnostics/network'
import type { DiagnosticsLogEntryInput } from '../../types/diagnostics'

export const diagnosticsLogService = createDiagnosticsLogService({
  rootDir: path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  retentionDays: 30,
})

export function writeDiagnosticsLog(entry: DiagnosticsLogEntryInput) {
  diagnosticsLogService.write(entry).catch((error) => {
    console.warn('Failed to write diagnostics log:', error)
  })
}

export function createDiagnosticsOperationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

export async function diagnosticsFetchJson(url: string, options: { method: string; headers?: Record<string, string>; body?: string }) {
  const operationId = createDiagnosticsOperationId('tts-http')
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId('req'),
    endpointFamily: 'tts-runtime',
    providerName: 'Manying Local TTS',
    fetcher: fetch as typeof fetch,
    logEvent: writeDiagnosticsLog,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `TTS backend request failed (${response.status})`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return response.text()
  }
  return response.json()
}

export async function diagnosticsFetchBytes(url: string, options: { method: string; headers?: Record<string, string>; body?: string }) {
  const operationId = createDiagnosticsOperationId('tts-http')
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId('req'),
    endpointFamily: 'tts-runtime-bytes',
    providerName: 'Manying Local TTS',
    fetcher: fetch as typeof fetch,
    logEvent: writeDiagnosticsLog,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `TTS backend request failed (${response.status})`)
  }
  return {
    data: await response.arrayBuffer(),
    mimeType: response.headers.get('content-type') ?? undefined,
  }
}

export async function runTtsRuntimeDiagnostics<T>(
  action: string,
  context: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const operationId = createDiagnosticsOperationId(`tts-${action}`)
  writeDiagnosticsLog({
    level: action === 'status' ? 'debug' : 'info',
    category: 'tts',
    operationId,
    message: `TTS runtime ${action} started`,
    context,
  })
  try {
    const result = await run()
    writeDiagnosticsLog({
      level: 'info',
      category: 'tts',
      operationId,
      message: `TTS runtime ${action} completed`,
      context: { ...context, result },
    })
    return result
  } catch (error) {
    writeDiagnosticsLog({
      level: 'error',
      category: 'tts',
      operationId,
      message: `TTS runtime ${action} failed`,
      context,
      error,
    })
    throw error
  }
}
