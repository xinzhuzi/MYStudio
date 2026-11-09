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
  let lastQEventAt = 0
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
      if (process.env.QUIT_GUARD_DEBUG) {
        // eslint-disable-next-line no-console -- QUIT_GUARD_DEBUG=1 时的真机事件流诊断出口(1110 排障专用,默认静默)
        console.log(`[quit-guard] ${input.type} key=${input.key} meta=${input.meta} ctrl=${input.control} rep=${input.isAutoRepeat} src=${sourceId}`)
      }
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
      // 1110 真机定谳(dev 事件流):macOS 对 Cmd+Q 保留组合,keyDown(q) 被
      // preventDefault 后整组后续事件(keyUp q / keyUp Meta / repeat)全部不再
      // 派发——timer 启动后零取消信号,短按也在 1s 后误退。双保险:
      // ①keyDown 不再 preventDefault(菜单已无绑定、无默认动作、Cmd 组合不输
      //   入字符)——不拦它,系统才会继续派发 keyUp;
      // ②活力信号:timer 到点时距最后一个 q 事件(keyUp/repeat)超 400ms =
      //   已松开(宁可少退不可误退,防误触是本功能初衷)。
      lastQEventAt = now()
      if (isDown && !input.isAutoRepeat) qHeld = true
      if (isUp) {
        qHeld = false
        if (startedAt !== null) {
          release()
          return false
        }
      }
      if (!input.meta && !input.control && startedAt === null) return false
      if (isDown) {
        if (!input.isAutoRepeat && startedAt === null && (input.meta || input.control)) {
          metaHeld = input.meta
          controlHeld = input.control
          startedAt = now()
          lastQEventAt = now()
          activeSource = sourceId
          deps.broadcast('start', 0)
          timer = schedule(() => {
            if (startedAt === null) return
            if (now() - lastQEventAt > 400) {
              // 按住期间无 keyUp/repeat 续命:视为已松开,不退出
              finish('too-short')
              return
            }
            finish('end')
            deps.quit()
          }, QUIT_HOLD_MS)
        }
        return false
      }
      if (isUp) {
        return false
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
