import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachQuitHoldGuard, buildDarwinAppMenuTemplate, createQuitHoldGuard, QUIT_HOLD_STATE_IPC } from './quit-guard'
import { installWebviewKeyboardPassthrough } from './main-menu'

vi.mock('electron', () => ({ Menu: {} }))

const input = (type: string, overrides: Partial<{ key: string; meta: boolean; control: boolean; isAutoRepeat: boolean }> = {}) => ({
  type, key: 'q', meta: true, control: false, ...overrides,
})

afterEach(() => vi.useRealTimers())

describe('quit hold guard', () => {
  it.each(['meta', 'control'] as const)('cancels a short %s hold', (modifier) => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    const keys = { meta: modifier === 'meta', control: modifier === 'control' }
    expect(guard.handleInput(input('keyDown', keys), 1)).toBe(true)
    vi.advanceTimersByTime(500)
    expect(guard.handleInput(input('keyUp', keys), 1)).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 500)
  })

  it('quits after one second without resetting for repeat events', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    guard.handleInput(input('keyDown'), 1)
    vi.advanceTimersByTime(900)
    guard.handleInput(input('keyDown', { isAutoRepeat: true }), 1)
    vi.advanceTimersByTime(100)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenLastCalledWith('end', 1000)
  })

  it('treats rawKeyDown as a press and stays idempotent when both forms arrive', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    // macOS 带修饰组合常报 rawKeyDown;且同一物理按下可能 raw/key 两连发
    expect(guard.handleInput(input('rawKeyDown'), 1)).toBe(true)
    guard.handleInput(input('keyDown'), 1)
    vi.advanceTimersByTime(1000)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(broadcast.mock.calls.map(([phase]) => phase)).toEqual(['start', 'end'])
  })

  it('cancels a guest hold on host window blur and ignores unrelated keys', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    expect(guard.handleInput(input('keyDown', { key: 'x' }), 1)).toBe(false)
    guard.handleInput(input('keyDown'), 1)
    guard.cancel()
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('end', 0)
  })

  it('ignores a Meta key release during a Ctrl+Q hold', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast: vi.fn() })
    guard.handleInput(input('keyDown', { meta: false, control: true }), 1)
    expect(guard.handleInput(input('keyUp', { key: 'Meta', meta: false, control: true }), 1)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(quit).toHaveBeenCalledOnce()
  })

  it.each([
    { held: 'control', extra: 'meta' },
    { held: 'meta', extra: 'control' },
  ])('keeps holding when an additional $extra key is pressed and released', ({ held, extra }) => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    const modifiers = { meta: held === 'meta', control: held === 'control' }
    guard.handleInput(input('keyDown', modifiers), 1)
    guard.handleInput(input('keyDown', { key: extra, meta: true, control: true }), 1)
    guard.handleInput(input('keyUp', { key: extra, ...modifiers }), 1)
    vi.advanceTimersByTime(1000)
    expect(quit).toHaveBeenCalledOnce()
    expect(broadcast.mock.calls.map(([phase]) => phase)).toEqual(['start', 'end'])
  })

  it.each(['control', 'meta'] as const)('cancels when the held %s modifier is released while q is held', (modifier) => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    guard.handleInput(input('keyDown', { meta: modifier === 'meta', control: modifier === 'control' }), 1)
    vi.advanceTimersByTime(200)
    guard.handleInput(input('keyUp', { key: modifier, meta: false, control: false }), 2)
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 200)
  })

  it('cancels only after the last held modifier is released', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    guard.handleInput(input('keyDown', { meta: false, control: true }), 1)
    guard.handleInput(input('keyDown', { key: 'Meta', meta: true, control: true }), 1)
    guard.handleInput(input('keyUp', { key: 'Control', meta: true, control: false }), 2)
    vi.advanceTimersByTime(300)
    expect(broadcast).toHaveBeenCalledTimes(1)
    guard.handleInput(input('keyUp', { key: 'Meta', meta: false, control: false }), 2)
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 300)
  })

  it('recognizes q release even if the modifier flags disappeared', () => {
    vi.useFakeTimers()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit: vi.fn(), broadcast })
    guard.handleInput(input('keyDown'), 1)
    expect(guard.handleInput(input('keyUp', { meta: false }), 1)).toBe(true)
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 0)
  })

  it('quits on release after the threshold if its timer is delayed', () => {
    let time = 0
    const quit = vi.fn()
    const cancel = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast: vi.fn(), now: () => time, schedule: () => ({ cancel }) })
    guard.handleInput(input('keyDown'), 1)
    time = 1000
    guard.handleInput(input('keyUp', { meta: false }), 1)
    expect(cancel).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('accepts q release from another source while ignoring its cancellation', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    guard.handleInput(input('keyDown'), 1)
    guard.cancel(2)
    guard.handleInput(input('keyUp'), 2)
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 0)
  })

  it('cancels on matching guest blur or destruction', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast: vi.fn() })
    guard.handleInput(input('keyDown'), 1)
    guard.cancel(1)
    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()
  })

  it('keeps guest A holding when guest B is destroyed', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast: vi.fn() })
    const embedder = new EventEmitter()
    const guestA = Object.assign(new EventEmitter(), { id: 1 })
    const guestB = Object.assign(new EventEmitter(), { id: 2 })
    const api = { getApplicationMenu: () => null, setApplicationMenu: vi.fn() }
    installWebviewKeyboardPassthrough(embedder as Electron.WebContents, api, (guest) => {
      attachQuitHoldGuard(guest, guard, true)
    })
    embedder.emit('did-attach-webview', {}, guestA)
    embedder.emit('did-attach-webview', {}, guestB)
    guestA.emit('before-input-event', { preventDefault: vi.fn() }, input('keyDown'))
    guestB.emit('destroyed')
    vi.advanceTimersByTime(1000)
    expect(quit).toHaveBeenCalledOnce()
  })

  it('handles host q down and guest q up through the real input hooks', () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const broadcast = vi.fn()
    const guard = createQuitHoldGuard({ quit, broadcast })
    const host = Object.assign(new EventEmitter(), { id: 1 })
    const guest = Object.assign(new EventEmitter(), { id: 2 })
    attachQuitHoldGuard(host as Electron.WebContents, guard)
    attachQuitHoldGuard(guest as Electron.WebContents, guard, true)
    const event = { preventDefault: vi.fn() }
    host.emit('before-input-event', event, input('keyDown'))
    vi.advanceTimersByTime(200)
    guest.emit('before-input-event', event, input('keyUp', { meta: false }))
    vi.advanceTimersByTime(1000)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(quit).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenLastCalledWith('too-short', 200)
  })

  it('exposes a direct quit menu without an accelerator', () => {
    const quit = vi.fn()
    const template = buildDarwinAppMenuTemplate({ name: '漫影工作室', quit })
    const items = template[0].submenu
    expect(Array.isArray(items)).toBe(true)
    if (!Array.isArray(items)) throw new Error('expected submenu')
    const quitItem = items.find((item) => item.label === '退出 漫影工作室')
    expect(quitItem).toBeDefined()
    expect(quitItem?.accelerator).toBeUndefined()
    quitItem?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent)
    expect(quit).toHaveBeenCalledOnce()
    expect(template.slice(1).map((item) => item.role)).toEqual(['editMenu', 'viewMenu', 'windowMenu'])
    expect(QUIT_HOLD_STATE_IPC).toBe('quit-hold-state')
  })

  it('installs the optional guest hook without changing the menu gate', () => {
    const embedder = new EventEmitter()
    const guest = new EventEmitter()
    const saved = {} as Electron.Menu
    const api = { getApplicationMenu: vi.fn(() => saved), setApplicationMenu: vi.fn() }
    const attach = vi.fn()
    installWebviewKeyboardPassthrough(embedder as Electron.WebContents, api, attach)
    embedder.emit('did-attach-webview', {}, guest)
    expect(attach).toHaveBeenCalledWith(guest)
    guest.emit('focus')
    guest.emit('blur')
    expect(api.setApplicationMenu.mock.calls).toEqual([[null], [saved]])
  })

  it('wires the guard and custom menu only on macOS', () => {
    const windowSource = readFileSync(new URL('./main-window.ts', import.meta.url), 'utf8')
    const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    expect(windowSource).toContain("process.platform === 'darwin' ? createQuitHoldGuard")
    expect(windowSource).toContain('attachQuitHoldGuard(window.webContents, quitGuard)')
    expect(windowSource).toContain('attachQuitHoldGuard(guest, quitGuard, true)')
    expect(windowSource).toContain("window.on('blur', () => quitGuard.cancel())")
    expect(windowSource).toContain("window.on('closed', () => quitGuard.cancel())")
    expect(mainSource).toContain("if (process.platform === 'darwin') {\n    Menu.setApplicationMenu")
  })
})
