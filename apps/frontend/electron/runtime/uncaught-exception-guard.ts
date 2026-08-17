// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import process from 'node:process'
import type { DiagnosticsLogEntryInput } from '../../types/diagnostics'

export interface UncaughtExceptionGuardOptions {
  writeLog: (entry: DiagnosticsLogEntryInput) => void
  // 测试注入用;生产默认 setImmediate 异步重抛。
  deferThrow?: (throwFn: () => void) => void
}

// undici(Node 内置 fetch 的 H1 写路径)无条件调用 socket.setTypeOfService(),
// macOS 在 socket 复用/半拆除状态下内核返回 EINVAL,并以 uncaught exception
// 逃逸弹出 Electron 崩溃框,对请求本身无害。上游修复见 nodejs/undici#5544 /
// #5547(undici v8.8.0),Electron 43 内嵌 Node 24 副本未包含,故进程级只
// 过滤这一已知无害错误,其余异常保持默认崩溃语义。
export function isHarmlessUndiciSocketOptionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message
  if (!message || !message.includes('setTypeOfService')) return false
  const code = (error as NodeJS.ErrnoException).code
  if (typeof code === 'string' && code.length > 0) return code === 'EINVAL'
  return message.includes('EINVAL')
}

export function createUncaughtExceptionHandler(options: UncaughtExceptionGuardOptions) {
  const { writeLog, deferThrow = (throwFn) => setImmediate(throwFn) } = options
  const handler = (error: unknown): void => {
    if (isHarmlessUndiciSocketOptionError(error)) {
      writeLog({
        level: 'warn',
        category: 'runtime',
        message: 'Swallowed harmless undici socket option error (setTypeOfService EINVAL, upstream undici#5544)',
        error,
      })
      return
    }
    writeLog({
      level: 'error',
      category: 'runtime',
      message: 'Fatal uncaught exception, rethrowing to default crash path',
      error,
    })
    // 必须先摘除自身再异步重抛:否则 handler 会再次捕获自己无限自旋;
    // 摘除后由 Node/Electron 默认路径接管(崩溃对话框 + 退出)。
    process.removeListener('uncaughtException', handler)
    deferThrow(() => {
      throw error
    })
  }
  return handler
}

export function installUncaughtExceptionGuard(options: UncaughtExceptionGuardOptions): void {
  process.on('uncaughtException', createUncaughtExceptionHandler(options))
}
