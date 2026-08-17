// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it, vi } from 'vitest'
import { createUncaughtExceptionHandler, isHarmlessUndiciSocketOptionError } from './uncaught-exception-guard'

function makeError(message: string, code?: string) {
  const error = new Error(message)
  if (code !== undefined) (error as NodeJS.ErrnoException).code = code
  return error
}

describe('isHarmlessUndiciSocketOptionError', () => {
  it('匹配 code=EINVAL 的 setTypeOfService 错误', () => {
    expect(isHarmlessUndiciSocketOptionError(makeError('setTypeOfService EINVAL', 'EINVAL'))).toBe(true)
  })

  it('无 code 时回退 message 判定', () => {
    expect(isHarmlessUndiciSocketOptionError(makeError('setTypeOfService EINVAL'))).toBe(true)
  })

  it('非 Error 一律不吞', () => {
    expect(isHarmlessUndiciSocketOptionError('setTypeOfService EINVAL')).toBe(false)
    expect(isHarmlessUndiciSocketOptionError(null)).toBe(false)
    expect(isHarmlessUndiciSocketOptionError(undefined)).toBe(false)
  })

  it('message 缺 setTypeOfService 不吞(即使 code=EINVAL)', () => {
    expect(isHarmlessUndiciSocketOptionError(makeError('read EINVAL', 'EINVAL'))).toBe(false)
  })

  it('有 code 且非 EINVAL 不吞', () => {
    expect(isHarmlessUndiciSocketOptionError(makeError('setTypeOfService EACCES', 'EACCES'))).toBe(false)
  })

  it('无 code 且 message 不含 EINVAL 不吞', () => {
    expect(isHarmlessUndiciSocketOptionError(makeError('setTypeOfService failed'))).toBe(false)
  })
})

describe('createUncaughtExceptionHandler', () => {
  it('无害错误:warn 记日志后吞掉,不摘监听器不重抛', () => {
    const writeLog = vi.fn()
    const deferThrow = vi.fn()
    const handler = createUncaughtExceptionHandler({ writeLog, deferThrow })
    handler(makeError('setTypeOfService EINVAL', 'EINVAL'))
    expect(writeLog).toHaveBeenCalledTimes(1)
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', category: 'runtime' }))
    expect(deferThrow).not.toHaveBeenCalled()
  })

  it('其它异常:error 记日志,摘除监听器并异步重抛回归默认崩溃路径', () => {
    const writeLog = vi.fn()
    const deferThrow = vi.fn()
    const removeListenerSpy = vi.spyOn(process, 'removeListener')
    const handler = createUncaughtExceptionHandler({ writeLog, deferThrow })
    const error = makeError('boom', 'EACCES')
    handler(error)
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', category: 'runtime' }))
    expect(removeListenerSpy).toHaveBeenCalledWith('uncaughtException', handler)
    expect(deferThrow).toHaveBeenCalledTimes(1)
    const throwFn = deferThrow.mock.calls[0][0] as () => void
    expect(() => throwFn()).toThrow(error)
    removeListenerSpy.mockRestore()
  })
})
