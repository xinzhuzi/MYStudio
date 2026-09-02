/**
 * main.ts 窗口生命周期簇(assembly 专批外迁,体逐字保留)——win 状态/createWindow/
 * 四个 app.on 生命周期 handler/本地服务停止/更新清单解析。
 * ttsRuntimeController 与 selfMediaIpc 在 main.ts 装配后经 bindWindowRuntime 注入
 * (消费点均在运行期,晚于绑定);disposeRemotionRuntime 状态由 main.ts 经
 * setDisposeRemotionRuntime 回填。
 */
import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createBeforeQuitCleanup,
  createWindowAllClosedHandler,
  shouldCreateWindowOnActivate,
  shouldCreateWindowOnSecondInstance,
} from '../runtime/app-lifecycle'
import type { AvailableUpdateInfo } from '../../types/update'
import { fetchUpdateManifest as fetchUpdateManifestFromConfig } from './main-update'
import { compareVersions } from '../runtime/update-policy'
import packageMetadata from '../../../package.json'
import { isPathInsideRoot } from '../storage/storage-paths'
import { writeDiagnosticsLog } from './main-diagnostics'
import { hostedStudio } from './main-hosted-studio'
import { isBackgroundSmoke, RENDERER_DIST, RENDERER_INDEX_HTML, VITE_DEV_SERVER_URL } from './main-env'
import type { createTtsRuntimeController } from '../tts/tts-runtime'
import type { registerSelfMediaIpcHandlers } from '../ipc/self-media/self-media-ipc'

let win: BrowserWindow | null

export function getWin(): BrowserWindow | null {
  return win
}

type PackageUpdateConfig = {
  manifestUrl?: string
  defaultGithubUrl?: string
  defaultBaiduUrl?: string
  defaultBaiduCode?: string
}

type PackageMetadata = {
  updateConfig?: PackageUpdateConfig
  dependencies?: { remotion?: string }
}

export const typedPackageMetadata = packageMetadata as PackageMetadata
const packageUpdateConfig = typedPackageMetadata.updateConfig ?? {}


let stopLocalSidecarsPromise: Promise<void> | null = null
let disposeRemotionRuntime: (() => void | Promise<void>) | null = null


interface WindowRuntime {
  ttsRuntimeController: ReturnType<typeof createTtsRuntimeController>
  selfMediaIpc: ReturnType<typeof registerSelfMediaIpcHandlers>
}

let _windowRuntime: WindowRuntime | null = null

export function bindWindowRuntime(runtime: WindowRuntime): void {
  _windowRuntime = runtime
}

function requireWindowRuntime(): WindowRuntime {
  if (!_windowRuntime) throw new Error('main-window 运行时未装配:bindWindowRuntime 未被调用')
  return _windowRuntime
}

export function setDisposeRemotionRuntime(fn: (() => void | Promise<void>) | null): void {
  disposeRemotionRuntime = fn
}

// 图片生图 sidecar 停止回调:控制器在 main.ts 后段创建(晚于 bindWindowRuntime),
// 经此回填;quit/window-all-closed 时一并停,杜绝孤儿占死 17595(09-02 僵尸窗口根修)
let stopImageGenSidecar: (() => void | Promise<void>) | null = null

export function setStopImageGenSidecar(fn: (() => void | Promise<void>) | null): void {
  stopImageGenSidecar = fn
}

export function stopLocalSidecars() {
  if (!stopLocalSidecarsPromise) {
    const { ttsRuntimeController } = requireWindowRuntime()
    stopLocalSidecarsPromise = (async () => {
      const result = await ttsRuntimeController.stop()
      if (!result.success) {
        console.warn('Failed to stop local TTS backend:', result.error)
      }
      try {
        await stopImageGenSidecar?.()
      } catch (error) {
        console.warn('Failed to stop local image sidecar:', error)
      }
    })().finally(() => {
      stopLocalSidecarsPromise = null
    })
  }
  return stopLocalSidecarsPromise
}

export async function stopAllLocalServices() {
  const { selfMediaIpc } = requireWindowRuntime()
  await selfMediaIpc.dispose()
  await disposeRemotionRuntime?.()
  disposeRemotionRuntime = null
  await stopLocalSidecars()
}

// 更新清单抓取统一走 main-update.ts(含 GitHub Releases API 适配),
// 本模块只注入 package.json 的 updateConfig。
async function fetchUpdateManifest() {
  return fetchUpdateManifestFromConfig(packageUpdateConfig)
}

export async function resolveAvailableUpdate(currentVersion: string): Promise<AvailableUpdateInfo | null> {
  const manifest = await fetchUpdateManifest()
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return null
  }

  return {
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    publishedAt: manifest.publishedAt,
    githubUrl: manifest.githubUrl,
    baiduUrl: manifest.baiduUrl,
    baiduCode: manifest.baiduCode,
  }
}


export function createWindow() {
  win = new BrowserWindow({
    title: '漫影工作室',
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: '#17191c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !isBackgroundSmoke,
    },
  })

  let hasShownWindow = false
  const showWindow = () => {
    if (isBackgroundSmoke || !win || win.isDestroyed() || hasShownWindow) return
    hasShownWindow = true
    win.show()
  }

  win.once('ready-to-show', showWindow)

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
    writeDiagnosticsLog({
      level: 'info',
      category: 'runtime',
      message: 'Renderer finished loading',
      context: { url: win?.webContents.getURL() },
    })
    showWindow()
  })

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
    writeDiagnosticsLog({
      level: 'error',
      category: 'runtime',
      message: 'Renderer failed to load',
      context: { errorCode, errorDescription, url: win?.webContents.getURL() },
    })
    showWindow()
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const logLevel = level >= 3 ? 'error' : level >= 2 ? 'warn' : level >= 1 ? 'info' : 'debug'
    writeDiagnosticsLog({
      level: logLevel,
      category: 'runtime',
      message: 'Renderer console message',
      context: { consoleLevel: level, message, line, sourceId },
    })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    writeDiagnosticsLog({
      level: 'error',
      category: 'runtime',
      message: 'Renderer process gone',
      context: { reason: details.reason, exitCode: details.exitCode },
    })
  })

  win.on('unresponsive', () => {
    writeDiagnosticsLog({
      level: 'warn',
      category: 'runtime',
      message: 'Main window became unresponsive',
    })
  })

  // Open external links in system browser instead of inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (hostedStudio.isNavigationAllowed(url)) {
      return { action: 'deny' }
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const isRendererLocalFileUrl = (url: string) => {
    if (!url.startsWith('file://')) return false
    try {
      return isPathInsideRoot(RENDERER_DIST, fileURLToPath(url))
    } catch {
      return false
    }
  }

  win.webContents.on('will-navigate', (event, url) => {
    // Allow navigating to the app itself (dev server or local renderer files only)
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return
    if (isRendererLocalFileUrl(url)) return
    // Block and open externally
    event.preventDefault()
    shell.openExternal(url)
  })

  win.webContents.on('will-frame-navigate', (details) => {
    const { url, isMainFrame } = details
    if (!isMainFrame && hostedStudio.isNavigationAllowed(url)) return
    if (isMainFrame && ((VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) || isRendererLocalFileUrl(url))) return
    details.preventDefault()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(new URL(RENDERER_INDEX_HTML, VITE_DEV_SERVER_URL).toString())
  } else {
    win.loadFile(path.join(RENDERER_DIST, RENDERER_INDEX_HTML))
  }
}

app.on('second-instance', () => {
  if (isBackgroundSmoke) return
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore()
    }
    win.focus()
    return
  }

  if (shouldCreateWindowOnSecondInstance({
    isAppReady: app.isReady(),
    hasUsableWindow: false,
  })) {
    createWindow()
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', createWindowAllClosedHandler({
  platform: process.platform,
  stopLocalServices: stopLocalSidecars,
  quit: () => {
    app.quit()
    win = null
  },
  onError: (error) => {
    console.warn('Failed to stop local services after all windows closed:', error)
  },
}))

app.on('before-quit', createBeforeQuitCleanup({
  stopLocalServices: stopAllLocalServices,
  quit: () => app.quit(),
  onError: (error) => {
    console.warn('Failed to stop local services before quit:', error)
  },
}))

app.on('activate', () => {
  if (isBackgroundSmoke) return
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (shouldCreateWindowOnActivate({
    isAppReady: app.isReady(),
    openWindowCount: BrowserWindow.getAllWindows().length,
  })) {
    createWindow()
  }
})
