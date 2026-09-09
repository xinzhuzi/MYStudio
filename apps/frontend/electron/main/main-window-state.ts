/**
 * 主窗口几何状态持久化:窗口关闭时把 {bounds, isMaximized} 落
 * <userData>/window-state.json,下次 createWindow 先校验再恢复。
 * 设计参考 electron-window-state(MIT,https://github.com/mawie81/electron-window-state):
 * resize/move 防抖只更新内存态,closed 时一次落盘;恢复前校验窗口完整
 * 落在某块显示器内(拔显示器/改分辨率则回退默认居中)。
 * 裁剪差异:固定主窗口无需通用 manage/unmanage;不恢复原生全屏
 * (macOS 惯例启动不自动进全屏空间,最大化/缩放态即用户实际用法)。
 */
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const STATE_FILE_NAME = 'window-state.json'
/** 与 createWindow 的历史默认一致;恢复失败时的回退尺寸 */
export const DEFAULT_WINDOW_WIDTH = 1400
export const DEFAULT_WINDOW_HEIGHT = 900
/** resize/move 事件节流窗口,与参考实现一致 */
const UPDATE_DEBOUNCE_MS = 100

export type PersistedWindowState = {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export type RestoredWindowState = {
  /** null = 无可用历史 bounds,调用方走默认尺寸(不传 x/y 由 Electron 居中) */
  bounds: Rectangle | null
  isMaximized: boolean
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE_NAME)
}

function hasIntegerBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Record<string, unknown>
  return (
    typeof x === 'number' && Number.isInteger(x) &&
    typeof y === 'number' && Number.isInteger(y) &&
    typeof width === 'number' && Number.isInteger(width) &&
    typeof height === 'number' && Number.isInteger(height) &&
    width > 0 &&
    height > 0
  )
}

function isWithinSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(
    ({ bounds: display }) =>
      bounds.x >= display.x &&
      bounds.y >= display.y &&
      bounds.x + bounds.width <= display.x + display.width &&
      bounds.y + bounds.height <= display.y + display.height,
  )
}

export function loadRestoredWindowState(): RestoredWindowState {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(stateFilePath(), 'utf8'))
  } catch {
    return { bounds: null, isMaximized: false }
  }
  if (typeof raw !== 'object' || raw === null) return { bounds: null, isMaximized: false }
  const candidate = raw as Record<string, unknown>
  const bounds = hasIntegerBounds(candidate)
    ? { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
    : null
  return {
    bounds: bounds && isWithinSomeDisplay(bounds) ? bounds : null,
    isMaximized: candidate.isMaximized === true,
  }
}

function isNormalWindow(win: BrowserWindow): boolean {
  return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen()
}

/** 首选显示器工作区内居中的默认尺寸(与 Electron 不传 x/y 的默认行为一致) */
function defaultCenteredBounds(): Rectangle {
  const workArea = screen.getPrimaryDisplay().workArea
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - DEFAULT_WINDOW_WIDTH) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - DEFAULT_WINDOW_HEIGHT) / 2)),
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  }
}

/**
 * 挂主窗口生命周期:期间只维护内存态,窗口 closed 时落盘一次。
 * 被强杀(pkill -9)不触发 closed,旧状态原样保留而不会被半新不旧覆盖。
 */
export function trackWindowState(win: BrowserWindow): void {
  const restored = loadRestoredWindowState()
  let state: PersistedWindowState | null = restored.bounds
    ? { ...restored.bounds, isMaximized: restored.isMaximized }
    : null
  let updateTimer: NodeJS.Timeout | null = null

  const updateState = () => {
    if (win.isDestroyed()) return
    try {
      const bounds = win.getBounds()
      // 最大化/最小化/全屏期间的 bounds 不是"正常态"尺寸:保留本会话上次
      // normal bounds(启动即最大化且全程未缩放时,用居中默认尺寸兜底)
      if (isNormalWindow(win)) {
        state = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, isMaximized: false }
      } else {
        const base = state ?? defaultCenteredBounds()
        state = { x: base.x, y: base.y, width: base.width, height: base.height, isMaximized: win.isMaximized() }
      }
    } catch {
      // 窗口销毁竞态:丢弃本次采样
    }
  }

  const scheduleUpdate = () => {
    if (updateTimer) clearTimeout(updateTimer)
    updateTimer = setTimeout(() => {
      updateTimer = null
      updateState()
    }, UPDATE_DEBOUNCE_MS)
  }

  const saveState = () => {
    if (!state) return
    try {
      writeFileSync(stateFilePath(), JSON.stringify(state))
    } catch (error) {
      console.warn('Failed to persist window state:', error)
    }
  }

  win.on('resize', scheduleUpdate)
  win.on('move', scheduleUpdate)
  win.on('close', updateState)
  win.on('closed', () => {
    if (updateTimer) clearTimeout(updateTimer)
    updateState()
    saveState()
  })
}
