import type { MenuItemConstructorOptions } from 'electron'

export const QUIT_HOLD_MS = 1000
export const QUIT_HOLD_STATE_IPC = 'quit-hold-state'
export type QuitHoldPhase = 'start' | 'end' | 'too-short'
export type QuitHoldState = { phase: QuitHoldPhase; heldMs?: number }

type QuitInput = {
  type: string
  key: string
  control: boolean
  meta: boolean
  isAutoRepeat?: boolean
}

export function createQuitHoldGuard(deps: {
  quit: () => void
  broadcast: (phase: QuitHoldPhase, heldMs: number) => void
  now?: () => number
  schedule?: (callback: () => void, delay: number) => { cancel: () => void }
}) {
  const now = deps.now ?? Date.now
  const schedule = deps.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay)
    return { cancel: () => clearTimeout(timer) }
  })
  let startedAt: number | null = null
  let activeSource: number | null = null
  let qHeld = false
  let metaHeld = false
  let controlHeld = false
  let timer: { cancel: () => void } | null = null
  const finish = (phase: 'end' | 'too-short') => {
    if (startedAt === null) return
    const heldMs = Math.max(0, now() - startedAt)
    timer?.cancel()
    timer = null
    startedAt = null
    activeSource = null
    deps.broadcast(phase, heldMs)
  }
  const release = () => {
    if (startedAt === null) return
    if (now() - startedAt >= QUIT_HOLD_MS) {
      finish('end')
      deps.quit()
    } else finish('too-short')
  }
  return {
    cancel(sourceId?: number) {
      if (sourceId === undefined || sourceId === activeSource) {
        finish('end')
        qHeld = false
        metaHeld = false
        controlHeld = false
      }
    },
    handleInput(input: QuitInput, sourceId: number): boolean {
      const key = input.key.toLowerCase()
      // macOS 上带修饰组合常报 rawKeyDown 而非 keyDown(Electron Input.type 枚举
      // 两者皆有,electron.d.ts;只匹配 keyDown 会静默失效)——按下类双匹配
      const isDown = input.type === 'keyDown' || input.type === 'rawKeyDown'
      const isUp = input.type === 'keyUp'
      if (key === 'meta' || key === 'control') {
        if (isDown || isUp) {
          if (key === 'meta') metaHeld = isDown
          else controlHeld = isDown
          if (isUp && startedAt !== null && qHeld && !metaHeld && !controlHeld) finish('too-short')
        }
        return false
      }
      if (key !== 'q') return false
      if (isDown && !input.isAutoRepeat) qHeld = true
      if (isUp) {
        qHeld = false
        if (startedAt !== null) {
          release()
          return true
        }
      }
      if (!input.meta && !input.control && startedAt === null) return false
      if (isDown) {
        if (!input.isAutoRepeat && startedAt === null && (input.meta || input.control)) {
          metaHeld = input.meta
          controlHeld = input.control
          startedAt = now()
          activeSource = sourceId
          deps.broadcast('start', 0)
          timer = schedule(() => {
            if (startedAt === null) return
            finish('end')
            deps.quit()
          }, QUIT_HOLD_MS)
        }
        return true
      }
      if (isUp) {
        return true
      }
      return false
    },
  }
}

export function attachQuitHoldGuard(contents: Electron.WebContents, guard: ReturnType<typeof createQuitHoldGuard>, cancelOnBlur = false) {
  const sourceId = contents.id
  contents.on('before-input-event', (event, input) => {
    if (guard.handleInput(input, sourceId)) event.preventDefault()
  })
  if (cancelOnBlur) {
    contents.on('blur', () => guard.cancel(sourceId))
    contents.once('destroyed', () => guard.cancel(sourceId))
  }
}

export function buildDarwinAppMenuTemplate(app: { name: string; quit: () => void }): MenuItemConstructorOptions[] {
  return [
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { label: `退出 ${app.name}`, click: () => app.quit() },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]
}
