import { bindRuntimeControllerRoots, getStorageBasePath, getMediaRoot, getSkillsRoot, getAssetsRoot, getProjectDataRoot, scheduleAutoClean } from "./main-paths";
import { blessedDialogPaths, getDataDir, isStudioSourcePathAllowed, projectLocationStore, projectRootFor, readImageSource, storageManager } from "./main-paths";
import { ensureStudioSkillsAvailableAtStartup, getStudioManualsSourceRoot, getStudioSkillSyncOptions, resolveStudioSourcePath } from "./main-paths";
import { bindChapterProjectionRuntime, enqueueChapterSceneSegments, evaluateVideoWorkflowChapterGate, isRecord, loadChapterStudioProjection, readEditingProjectSnapshot, readRemotionCurrentShotSlots } from "./main-chapter-projection";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, protocol, shell, utilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import packageMetadata from '../../../package.json'
import { createDiagnosticsLogService } from '../diagnostics/diagnostics-log'
import { configureSidecarLogCapture } from '../diagnostics/sidecar-log-capture'
import { createTtsRuntimeController } from '../tts/tts-runtime'
import {
 
} from '../storage/studio-runtime-assets'
import { observedFetch } from '../../lib/diagnostics/network'
import type { DiagnosticsLogEntryInput } from '../../types/diagnostics'
import type { AvailableUpdateInfo } from '../../types/update'
import {
  compareVersions,
  isNonEmptyString,
  sanitizeExternalUrl,
} from '../runtime/update-policy'
import {
  makeStudioSkillFileUrl,
} from './main-utils'
import {
  createBeforeQuitCleanup,
  createWindowAllClosedHandler,
  shouldCreateWindowOnActivate,
  shouldCreateWindowOnSecondInstance,
} from '../runtime/app-lifecycle'
import { installUncaughtExceptionGuard } from '../runtime/uncaught-exception-guard'
import { registerTtsIpcHandlers } from '../ipc/tts/tts-ipc'
import { registerSelfMediaIpcHandlers } from '../ipc/self-media/self-media-ipc'
import { createCredentialVault } from '../aitoearn/credential-vault'
import { createAitoearnLocalPlatformBridge } from '../aitoearn/providers/aitoearn-local/platform-bridge'
import { createOfficialPlatformTransports } from '../aitoearn/providers/aitoearn-local/platforms/official/transports'
import { registerDiagnosticsIpcHandlers } from '../ipc/diagnostics/diagnostics-ipc'
import { registerRenderHwIpcHandlers } from '../ipc/rendering/render-hw-ipc'
import { registerStorageMediaIpcHandlers } from '../ipc/media/storage-media-ipc'
import { registerAppUpdaterIpcHandlers } from '../ipc/app/app-updater-ipc'
import {
 
  resolveLocalMediaPath,

  resolveProjectFileUrl,
  resolveProjectScopedFilePath,
  isPathInsideRoot,
} from '../storage/storage-paths'
import { registerProjectFileIpcHandlers } from '../ipc/files/project-file-ipc'
import { registerImageProbeIpcHandlers } from '../ipc/media/image-probe-ipc'
import { registerSourceMemoryIpcHandlers } from '../ipc/studio/source-memory-ipc'
import { configureArtifactManagementIpc } from '../ipc/files/artifact-management-ipc'
import { withFileStorageMutationLock } from '../ipc/files/file-storage-ipc'
import { registerStudioContentIpcHandlers } from '../ipc/assets/studio-content-ipc'
import { registerAppShellIpcHandlers } from '../ipc/app/app-shell-ipc'
import { fetchUpdateManifest as fetchUpdateManifestFromConfig } from './main-update'
import { registerApiRequestIpcHandlers } from '../ipc/ai/api-request-ipc'
import { registerFileExportIpcHandlers } from '../ipc/files/file-export-ipc'
import { registerAssetLibraryIpcHandlers } from '../ipc/assets/asset-library-ipc'
import { probeStudioMediaEvidence, registerStudioRenderIpcHandlers } from '../ipc/studio/studio-render-ipc'
import { registerRemotionRuntimeIpcHandlers } from '../ipc/studio/remotion-runtime-ipc'
import { registerSubtitleFontsIpcHandlers } from '../ipc/studio/subtitle-fonts-ipc'
import { customFontAbsolutePath } from '@/lib/studio/remotion/custom-font-store'
import { registerVideoWorkflowIpcHandlers } from '../ipc/studio/video-workflow-ipc'
import { registerRemotionPreviewIpcHandlers } from '../ipc/studio/remotion-preview-ipc'
import { registerRemotionShotIpcHandlers } from '../ipc/studio/remotion-shot-ipc'
import { registerRemotionQueueIpcHandlers } from '../ipc/studio/remotion-queue-ipc'
import { registerRemotionChapterManifestIpcHandlers } from '../ipc/studio/remotion-chapter-manifest-ipc'
import { broadcastRemotionStudioEditingUpdated, registerRemotionStudioIpcHandlers } from '../ipc/studio/remotion-studio-ipc'
import { RemotionShotRenderer } from '@rendering/plugins/remotion/renderer/remotion-shot-renderer'
import type { CinematicCameraPreset } from '@rendering/plugins/remotion/composition/composition-props'
import { RemotionChapterRenderer } from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import {
  createRemotionQueueFilePersistence,
  migrateQueueEventsFileIfNeeded,
  RemotionRenderQueue,
  resolveHardwareQueueConcurrency,
} from '@rendering/plugins/remotion/queue/remotion-render-queue'
import { resolveRemotionRuntimeDir } from '@rendering/plugins/remotion/browser/remotion-runtime-manifest'
import { RemotionChapterManifestService } from '@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service'
import { createVideoWorkflowChapterService } from '@rendering/plugins/video-workflow/video-workflow-chapter-service'
import { acceptVideoUseArtifact } from '@rendering/plugins/video-workflow/video-workflow-artifact-store'
import { createVideoUseAdapter } from '@rendering/plugins/video-use/video-use-adapter'
import { createHyperFramesAdapter } from '@rendering/plugins/hyperframes/hyperframes-adapter'
import { createDepthAdapter } from '@rendering/plugins/depth/depth-adapter'
import { createDepthRuntimeController } from '@rendering/plugins/depth/depth-runtime-controller'
import { registerDepthIpcHandlers } from '../ipc/studio/depth-ipc'
import { createImageGenRuntimeController } from '@rendering/plugins/image_gen/image-gen-runtime-controller'
import { registerImageGenIpcHandlers } from '../ipc/studio/image-gen-ipc'
import { createUpscaleRuntimeController } from '@rendering/plugins/upscale/upscale-runtime-controller'
import { registerUpscaleIpcHandlers } from '../ipc/studio/upscale-ipc'
import { registerSeedVr2IpcHandlers } from '../ipc/studio/seedvr2-ipc'
import { registerMcpIpcHandlers } from '../ipc/studio/mcp-ipc'
import { registerVlmReviewIpc } from '../ipc/studio/vlm-review-ipc'
import { VlmReviewRuntimeController } from '../rendering/plugins/vlm_review/vlm-review-runtime-controller'
import { createVideoQcRuntimeController } from '@rendering/plugins/videoqc/dover-runtime-controller'
import { registerVideoQcIpcHandlers } from '../ipc/studio/video-qc-ipc'
import { runChapterQc, type ChapterQcOrchestratorDeps } from '@rendering/plugins/videoqc/chapter-qc-orchestrator'
import { registerChapterQcIpcHandlers } from '../ipc/studio/chapter-qc-ipc'
import { createAudioGenRuntimeController } from '@rendering/plugins/audio_gen/audio-gen-runtime-controller'
import { registerAudioGenIpcHandlers } from '../ipc/studio/audio-gen-ipc'
import { createSfxGenRuntimeController } from '@rendering/plugins/sfx_gen/sfx-gen-runtime-controller'
import { registerSfxGenIpcHandlers } from '../ipc/studio/sfx-gen-ipc'
import { createMusic3GenRuntimeController } from '@rendering/plugins/music3_gen/music3-gen-runtime-controller'
import { registerMusic3GenIpcHandlers } from '../ipc/studio/music3-gen-ipc'
import { audioModelCacheDir, music3ModelCacheDir, sfxModelCacheDir, ttsModelCacheDir } from '../storage/model-dirs'
import { createVideoWorkflowRuntimeManager } from '@rendering/plugins/video-workflow/video-workflow-runtime-manager'
import { selectSharedVideoToolchain } from '@rendering/plugins/video-workflow/video-workflow-runtime'
import type {
  VideoUseChapterRunV1,
} from '@rendering/contracts/video-workflow'
import type { VideoWorkflowChapterRunRequestV1 } from '../rendering/contracts/video-workflow-ipc'
import { createDefaultProjectMoveEngine } from '../storage/project-move-engine'
import { registerProjectFolderIpcHandlers } from '../ipc/projects/project-folder-ipc'
import { parseProjectFileUrl, resolveDataFilePath } from '../storage/storage-paths'
import { readStudioWorkflowStore } from '../storage/studio-workflow-store-io'
import { validateEditingProject } from '../../lib/studio/editing/validation'
import {
  buildMinimalRemotionStudioStartOptions,
  RemotionStudioRenderQueueBridge,
  generateChapterStudioProjection,
  RemotionStudioService,
  type RemotionStudioChapterRenderContext,
} from '@rendering/plugins/remotion/studio'
import {
  createReadyRemotionChapterJob,
} from '@rendering/plugins/remotion/studio'
import { watchChapterStudioProjection } from '@rendering/plugins/remotion/studio'
import { readRemotionCurrentShotSlotsFromWorkspace } from '../../lib/studio/remotion/remotion-current-slot'
import { MediaBridgeServer } from '@rendering/plugins/remotion/media-bridge/media-bridge-server'
import { buildMediaUrlMap } from '@rendering/plugins/remotion/media-bridge/media-bridge-source-map'
import {
  getProtocolMimeType as getMimeType,
  registerPrivilegedSchemes,
  registerProtocolHandlers,
} from '../runtime/register-protocol-handlers'
import { ensureChromiumDataDir } from '../runtime/chromium-data-dir'

// electron-vite 构建后的目录结构
//
// ├─┬ out
// │ ├─┬ main
// │ │ └── index.cjs
// │ ├─┬ preload
// │ │ └── index.cjs
// │ └─┬ renderer
// │   └── index.html
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(__dirname)
export const RENDERER_DIST = path.join(__dirname, '../renderer')
const RENDERER_INDEX_HTML = path.join('renderer', 'index.html')
const isBackgroundSmoke = process.env.MYSTUDIO_SMOKE_BACKGROUND === '1'

process.env.VITE_PUBLIC = RENDERER_DIST

// Chromium 会话数据（Cache / Local Storage / IndexedDB / Cookies / OPFS 等）
// 收敛到 <userData>/Chromium，避免散落在 userData 根目录污染应用数据。
// Electron 要求在 app.ready 之前覆盖 sessionData；这里也先于单例锁，
// 让 Singleton 标记直接落在新根目录。一次性迁移失败时回退旧布局，绝不阻塞启动。
const chromiumDataDir = ensureChromiumDataDir({ userDataPath: app.getPath('userData') })
if (chromiumDataDir) app.setPath('sessionData', chromiumDataDir)

let win: BrowserWindow | null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

// 开发调试:MYSTUDIO_REMOTE_DEBUG=1 时开放 9222 远程调试端口,
// 供 chrome-devtools-mcp(--browser-url http://127.0.0.1:9222)接入做自动布局/盒模型诊断。
// 必须在 app.whenReady 之前 appendSwitch。默认不开,打包/smoke/正常运行无影响。
if (process.env.MYSTUDIO_REMOTE_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}
const diagnosticsLogService = createDiagnosticsLogService({
  rootDir: path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  retentionDays: 30,
})

if (!hasSingleInstanceLock) {
  app.exit(0)
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

const typedPackageMetadata = packageMetadata as PackageMetadata
const packageUpdateConfig = typedPackageMetadata.updateConfig ?? {}
const remotionVersion = typedPackageMetadata.dependencies?.remotion
if (!isNonEmptyString(remotionVersion)) {
  throw new Error('package.json 必须声明精确 Remotion 版本')
}

function writeDiagnosticsLog(entry: DiagnosticsLogEntryInput) {
  diagnosticsLogService.write(entry).catch((error) => {
    console.warn('Failed to write diagnostics log:', error)
  })
}

// 子进程(Python sidecar/Electron worker)输出统一捕获到 <userData>/logs/sidecars/。
// 未配置时捕获 no-op;各 spawn 现场只认 module 名。
configureSidecarLogCapture({
  getSidecarsDir: () => path.join(app.getPath('userData'), 'logs', 'sidecars'),
  writeDiagnostics: writeDiagnosticsLog,
})

function createDiagnosticsOperationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

// undici setTypeOfService EINVAL(上游 undici#5544)会以未捕获异常弹出 Electron
// 崩溃框,对请求本身无害;进程级过滤吞掉,其余异常保持默认崩溃语义。
installUncaughtExceptionGuard({
  writeLog: (entry) => writeDiagnosticsLog({ ...entry, operationId: createDiagnosticsOperationId('uncaught-exception') }),
})

async function diagnosticsFetchJson(url: string, options: { method: string; headers?: Record<string, string>; body?: string }) {
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

async function diagnosticsFetchBytes(url: string, options: { method: string; headers?: Record<string, string>; body?: string }) {
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

const ttsRuntimeController = createTtsRuntimeController({
  appRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
  userDataPath: app.getPath('userData'),
  storageBasePath: () => getStorageBasePath(),
  fetchJson: diagnosticsFetchJson,
  fetchBytes: diagnosticsFetchBytes,
})
let stopLocalSidecarsPromise: Promise<void> | null = null
let disposeRemotionRuntime: (() => void | Promise<void>) | null = null
const selfMediaCredentialVault = createCredentialVault(app.getPath('userData'))
const officialPlatformTransports = createOfficialPlatformTransports({
  userDataPath: app.getPath('userData'),
  allowedAssetRoots: () => [getDataDir(), getMediaRoot()],
})
const selfMediaIpc = registerSelfMediaIpcHandlers({
  credentialVault: selfMediaCredentialVault,
  localBridge: createAitoearnLocalPlatformBridge({
    userDataPath: app.getPath('userData'),
    allowedAssetRoots: () => [getDataDir(), getMediaRoot()],
    platformTransports: officialPlatformTransports.transports,
  }),
  taskStorePath: path.join(app.getPath('userData'), 'self-media', 'tasks.json'),
  resolveAsset: async (_projectId, asset) => {
    const source = asset.approvedUrl ?? asset.assetId;
    const resolved = resolveStudioSourcePath(source);
    if (!resolved || (!resolved.startsWith('http://') && !resolved.startsWith('https://') && !path.isAbsolute(resolved))) {
      throw new Error('自媒体资产无法解析为安全的本地路径或 URL');
    }
    return { assetId: asset.assetId, url: resolved, kind: asset.kind };
  },
})

function stopLocalSidecars() {
  if (!stopLocalSidecarsPromise) {
    stopLocalSidecarsPromise = (async () => {
      const result = await ttsRuntimeController.stop()
      if (!result.success) {
        console.warn('Failed to stop local TTS backend:', result.error)
      }
    })().finally(() => {
      stopLocalSidecarsPromise = null
    })
  }
  return stopLocalSidecarsPromise
}

async function stopAllLocalServices() {
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

async function resolveAvailableUpdate(currentVersion: string): Promise<AvailableUpdateInfo | null> {
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

function createWindow() {
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


registerSourceMemoryIpcHandlers({ getDataDir })
registerProjectFileIpcHandlers({
  getDataDir,
  readImageSource,
  getMimeType,
})

registerImageProbeIpcHandlers({
  getDataDir,
  getMediaRoot,
  getAssetsRoot,
})

configureArtifactManagementIpc({
  getDataDir,
  getMediaRoot,
})

registerStudioContentIpcHandlers({
  getSkillsRoot,
  getStudioSkillSyncOptions,
  makeStudioSkillFileUrl,
})
storageManager.registerIpcHandlers({ getStudioManualsSourceRoot })

registerProjectFolderIpcHandlers({
  locationStore: projectLocationStore,
  getProjectsDataRoot: () => getProjectDataRoot({ ensure: false }),
  createMoveEngine: () => createDefaultProjectMoveEngine(),
})

registerAppUpdaterIpcHandlers({
  getVersion: () => app.getVersion(),
  resolveAvailableUpdate,
  sanitizeExternalUrl,
  openExternal: (url) => shell.openExternal(url),
})

registerAppShellIpcHandlers({ resolveSourcePath: resolveStudioSourcePath })

registerDiagnosticsIpcHandlers({
  service: diagnosticsLogService,
  openPath: (targetPath) => shell.openPath(targetPath),
})

registerRenderHwIpcHandlers(() => app.getPath('userData'))

registerApiRequestIpcHandlers({
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
})

registerFileExportIpcHandlers({ getDataDir, getMediaRoot })

const remotionUserDataDir = app.getPath('userData')
const remotionBundlePath = app.isPackaged
  ? path.join(process.resourcesPath, 'remotion-bundle')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), '.cache/remotion-bundle')
const remotionBinariesDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules/@remotion/compositor-darwin-arm64')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'node_modules/@remotion/compositor-darwin-arm64')
// All adapters consume one process-wide FFmpeg/ffprobe pair. Prefer an explicit
// operator pair, then reuse an existing Apple Silicon Homebrew installation.
// The runtime probe blocks unsupported bundled binaries; it never downloads a
// private toolchain or silently swaps a partial explicit override.
const sharedVideoToolchain = selectSharedVideoToolchain({
  configuredFfmpeg: process.env.MYSTUDIO_FFMPEG_PATH,
  configuredFfprobe: process.env.MYSTUDIO_FFPROBE_PATH,
  bundledFfmpeg: path.join(remotionBinariesDirectory, 'ffmpeg'),
  bundledFfprobe: path.join(remotionBinariesDirectory, 'ffprobe'),
})
process.env.MYSTUDIO_FFMPEG_PATH = sharedVideoToolchain.ffmpegExecutable
process.env.MYSTUDIO_FFPROBE_PATH = sharedVideoToolchain.ffprobeExecutable
registerSubtitleFontsIpcHandlers({ getUserDataPath: () => app.getPath('userData') })
const remotionRuntime = registerRemotionRuntimeIpcHandlers({
  userDataDir: remotionUserDataDir,
  remotionVersion,
  workerPath: path.join(MAIN_DIST, 'remotion-browser-worker.cjs'),
  bundlePath: remotionBundlePath,
})
const remotionPreview = registerRemotionPreviewIpcHandlers({
  resolveSourcePath: resolveStudioSourcePath,
})
const remotionChapterManifestService = new RemotionChapterManifestService({
  projectRootForProject: projectRootFor,
  probeMedia: async (filePath) => {
    const evidence = await probeStudioMediaEvidence(filePath)
    return {
      durationUs: Math.round(evidence.duration * 1_000_000),
      streams: evidence.streams,
    }
  },
})
const remotionChapterManifestIpc = registerRemotionChapterManifestIpcHandlers(remotionChapterManifestService)
const videoWorkflowWorkspaceRootForProject = (projectId: string) => path.join(projectRootFor(projectId), 'video-use')
// electron-builder ships Python sources through extraResources, outside the
// asar archive. A packaged app must use Resources/backend as the subprocess
// cwd; app.asar/backend is a virtual path and causes spawn ENOTDIR.
const videoWorkflowBackendRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'backend')
const videoUseAdapter = createVideoUseAdapter({
  storageBasePath: getStorageBasePath,
  // video-use 权重住 TTS 家族缓存,但须经 model-dirs 单一拼装源(启动契约:生成类
  // 运行时不得挂 ttsRuntimeController 实例;08-28 补完 audio/sfx/music3 同款收口)
  modelCacheDir: () => ttsModelCacheDir(getStorageBasePath()),
  backendRoot: videoWorkflowBackendRoot,
  workspaceRootForProject: videoWorkflowWorkspaceRootForProject,
})
// 子进程(python adapter 等)继承此 env,据 <deps>/.ready 判断是否可推 hy: 模板
process.env.MYSTUDIO_REGISTRY_DEPS_DIR = path.join(app.getPath('userData'), 'hyperframes-registry-deps')
const hyperFramesAdapter = createHyperFramesAdapter({
  storageBasePath: getStorageBasePath,
  workspaceRootForProject: (projectId: string) => path.join(projectRootFor(projectId), 'hyperframes'),
  workerPath: path.join(MAIN_DIST, 'hyperframes-worker.cjs'),
  // hy:* registry 模板依赖(GSAP/Three/字体)下载落位;worker 内联渲染时经 env 读取
  registryDepsDir: path.join(app.getPath('userData'), 'hyperframes-registry-deps'),
  // 浏览器 utility 一次只服务一个请求:与设置页状态刷新并发时会被拒,重试一次避免瞬态"未找到可复用的 Headless Shell"误报
  resolveBrowserPath: async () => {
    const attempt = async () => (await remotionRuntime.controller.probeStatus()).executablePath
    try {
      const first = await attempt()
      if (first) return first
    } catch { /* 并发拒绝/进程冷启动,立即重试 */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      return await attempt()
    } catch {
      return undefined
    }
  },
})
const videoWorkflowRuntimeManager = createVideoWorkflowRuntimeManager(getStorageBasePath())
const videoWorkflowChapterService = createVideoWorkflowChapterService({
  workspaceRootForProject: videoWorkflowWorkspaceRootForProject,
  runVideoUse: videoUseAdapter.runChapter,
  renderHyperFrames: hyperFramesAdapter.renderOverlay,
  getCurrentEditingProject: readEditingProjectSnapshot,
  persistEditingProject: persistStudioEditingRevision,
  readChapterManifest: remotionChapterManifestService.read.bind(remotionChapterManifestService),
  writeChapterManifest: remotionChapterManifestService.writeCas.bind(remotionChapterManifestService),
  readCurrentShotSlots: (identity) => readRemotionCurrentShotSlotsFromWorkspace(path.join(projectRootFor(identity.projectId), 'remotion'), identity.projectId, identity.chapterId),
})
const buildManagedVideoUseChapterRun = (request: VideoWorkflowChapterRunRequestV1): VideoUseChapterRunV1 => {
  const paths = videoUseAdapter.paths
  const now = Date.now()
  const packageLockSha256 = fs.existsSync(paths.videoUseLockPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(paths.videoUseLockPath)).digest('hex')
    : '0'.repeat(64)
  // overlay 装饰槽内容感知定位：从项目 store 补每镜生成图路径（缺失回退公式定位）
  const imagePathByShotId = (() => {
    const map = new Map<string, string>()
    try {
      const store = readStudioWorkflowStore(getDataDir(), request.projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; mediaRef?: { path?: string } }>
      for (const storyboard of storyboards) {
        if (storyboard.episodeId !== request.chapterId || !storyboard.mediaRef?.path) continue
        const parsed = parseProjectFileUrl(storyboard.mediaRef.path)
        if (!parsed || parsed.projectId !== request.projectId) continue
        try {
          map.set(storyboard.id, resolveProjectScopedFilePath(getDataDir(), parsed.projectId, parsed.relativePath))
        } catch { /* 单镜媒体缺失不阻塞 */ }
      }
    } catch { /* store 缺失 → 公式定位 */ }
    return map
  })()
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    mode: request.mode,
    derivedInputPolicy: request.derivedInputPolicy,
    storyboardSourcePolicy: request.storyboardSourcePolicy ?? 'current-ready',
    stage: 'preparing',
    timeUnit: 'seconds',
    shots: request.shots.map((shot) => ({
      ...shot,
      videoPath: resolveStudioSourcePath(shot.videoPath),
      audioPath: resolveStudioSourcePath(shot.audioPath),
      ...(imagePathByShotId.get(shot.shotId) ? { imagePath: imagePathByShotId.get(shot.shotId)! } : {}),
    })),
    ...(request.boundaryIntents ? { boundaryIntents: request.boundaryIntents } : {}),
    sourceSha256: request.sourceSha256,
    audioSha256: request.audioSha256,
    textSha256: request.textSha256,
    featureFlags: request.featureFlags,
    runtime: {
      profileId: 'video-use-managed-python-v1',
      pythonExecutable: paths.pythonExecutable,
      ffmpegExecutable: paths.ffmpegExecutable,
      ffprobeExecutable: paths.ffprobeExecutable,
      packageLockSha256,
      markerPath: paths.videoUseMarkerPath,
    },
    createdAt: now,
    updatedAt: now,
  }
}
const videoWorkflowIpc = registerVideoWorkflowIpcHandlers({
  getStorageBasePath,
  appVersion: app.getVersion(),
  remotionVersion,
  probeRemotion: () => remotionRuntime.controller.status(),
  prepareRemotion: () => remotionRuntime.controller.download(() => undefined),
  probeVideoUse: videoUseAdapter.probe,
  probeHyperFrames: hyperFramesAdapter.probe,
  prepareVideoUseModel: async () => {
    const result = await ttsRuntimeController.prepareAlignmentModel()
    return { success: result.success, ...(result.error ? { error: result.error } : {}) }
  },
  runtimeManager: videoWorkflowRuntimeManager,
  reviewVideoUse: async (request) => {
    const result = await acceptVideoUseArtifact(videoWorkflowWorkspaceRootForProject, request)
    if (!result.success) {
      return {
        schemaVersion: 1,
        success: false,
        projectId: request.projectId,
        chapterId: request.chapterId,
        revision: request.revision,
        status: 'blocked',
        artifactPath: result.artifactPath,
        message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('；'),
      }
    }
    return {
      schemaVersion: 1,
      success: true,
      projectId: request.projectId,
      chapterId: request.chapterId,
      revision: request.revision,
      status: 'accepted',
      artifactPath: result.artifactPath,
    }
  },
  runVideoUseChapter: videoUseAdapter.runChapter,
  applyVideoWorkflowChapter: videoWorkflowChapterService.applyAcceptedArtifact,
  buildVideoUseChapterRun: buildManagedVideoUseChapterRun,
})
const remotionRuntimeDir = resolveRemotionRuntimeDir(remotionUserDataDir)

// Depth runtime controller — settings-facing lifecycle (设置 → 本地配置 → 深度估计模型).
// Model downloads are explicit and user-triggered; inference never downloads.
// The model cache dir is self-managed at <storageBase>/model/depth (config.json),
// mirroring the TTS model-dir feature set — no TTS cache fallback.
const depthRuntimeController = createDepthRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})

// Depth estimation adapter — enables cinematic 3D mode in shot rendering.
// Reuse the controller's persisted model cache resolver so settings probes and
// render workers always inspect the same explicitly downloaded model bytes.
const depthAdapter = createDepthAdapter({
  storageBasePath: getStorageBasePath,
  modelCacheDir: depthRuntimeController.getModelCacheDir,
  backendRoot: videoWorkflowBackendRoot,
})
const depthIpc = registerDepthIpcHandlers({
  controller: depthRuntimeController,
  getDataRoot: getDataDir,
  getDiagnosticsDir: () => path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  getLogBundleDir: () => path.join(app.getPath('userData'), 'logs', 'pipeline-bundles'),
})

// Local image generation sidecar — OpenAI-compatible HTTP server (127.0.0.1:17595)
// registered as the `manying-local-image` provider so cloud APIs can be replaced
// for character/scene/prop generation at zero cost. Models download explicitly.
const imageGenRuntimeController = createImageGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})
const imageGenIpc = registerImageGenIpcHandlers({ controller: imageGenRuntimeController })

// Local image super-resolution sidecar — pure-torch Real-ESRGAN CLI worker for
// 1K→4K upscaling of cloud/local generated images. Same explicit-download
// policy; the model cache dir is self-managed at <storageBase>/UpscaleModel.
const upscaleRuntimeController = createUpscaleRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  resolveProjectFilePath: (projectId, relativePath) => {
    try {
      return resolveProjectScopedFilePath(getDataDir(), projectId, relativePath)
    } catch {
      return null
    }
  },
  resolveLocalMediaPath: (url) => {
    try {
      return resolveLocalMediaPath(getMediaRoot(), url)
    } catch {
      return null
    }
  },
})
registerStorageMediaIpcHandlers({
  getDataDir,
  getMediaRoot,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
  readImageSource,
})

bindRuntimeControllerRoots(() => [ttsRuntimeController.getModelCacheDir(), depthRuntimeController.getModelCacheDir(), upscaleRuntimeController.getModelCacheDir()])
const upscaleIpc = registerUpscaleIpcHandlers({ controller: upscaleRuntimeController })
const seedvr2Ipc = registerSeedVr2IpcHandlers()
const mcpIpc = registerMcpIpcHandlers()
// 非阻塞启动期刷新:冷启动后 status() 即反映真实运行时/模型状态,超分动作的
// precheck(节点按钮/分镜 tile)无需用户先访问设置页。
void upscaleRuntimeController.refresh()

// VLM Review sidecar — Qwen3-VL visual consistency checking(生图后自动审核)。
// 复用 managed Python;权重显式下载,<storageBase>/model/vlm。
const vlmReviewController = new VlmReviewRuntimeController({
  pythonExecutable: path.join(getStorageBasePath(), "python", "bin", "python3"),
  // 复用打包感知的 backend 根:app.asar/backend 是虚拟路径,spawn 会 ENOTDIR(08-28 修)。
  backendRoot: videoWorkflowBackendRoot,
  storageBasePath: getStorageBasePath(),
  resolveProjectFilePath: async (url) => {
    try {
      // project-file://<projectId>/<percent-encoded 相对路径>——projectId 与每段
      // 路径都必须 decodeURIComponent(08-28 R14 实证:成图文件名含中文,原样传
      // 会让 VLM worker 拿到字面 %E5… 路径找不到文件,审核环产线整体失效)
      const match = /^project-file:\/\/([^/]+)\/(.*)$/.exec(url)
      if (!match) return null
      const projectId = decodeURIComponent(match[1])
      const relativePath = match[2]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      return resolveProjectScopedFilePath(getDataDir(), projectId, relativePath)
    } catch {
      return null
    }
  },
})
registerVlmReviewIpc(vlmReviewController)

// Chapter video QC sidecar — DOVER-Mobile 观感层(出片后 QC 链 L3)。
// 复用 managed Python(probe 路径零重依赖);权重显式下载,<storageBase>/model/videoqc。
const videoQcRuntimeController = createVideoQcRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})
const videoQcIpc = registerVideoQcIpcHandlers({ controller: videoQcRuntimeController })
// 非阻塞启动期刷新:QC 报告与设置页冷启动即反映模型就绪态。
void videoQcRuntimeController.refresh()

// 出片后 QC 链编排器(L1 结构/L2 逐帧/L3 观感;L4 语义由渲染端跑完回写)。
const chapterQcOrchestratorDeps: ChapterQcOrchestratorDeps = {
  remotionWorkspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), 'remotion'),
  videoUseWorkspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), 'video-use'),
  dataRoot: getDataDir(),
  videoQc: videoQcRuntimeController,
}
const chapterQcIpc = registerChapterQcIpcHandlers({
  deps: chapterQcOrchestratorDeps,
  runQc: runChapterQc,
  getWindow: () => win,
})

// Local music generation sidecar — MusicGen BGM generation via CLI worker.
// Same explicit-download policy; generated WAVs feed the chapter BGM track.
const audioGenRuntimeController = createAudioGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => audioModelCacheDir(getStorageBasePath()),
})
const audioGenIpc = registerAudioGenIpcHandlers({
  controller: audioGenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
})

// Local sfx generation sidecar (08-19-local-sfx-generation P1) — seed-deterministic
// short one-shots for the sfx binding role; explicit-download policy, exports dir first.
const sfxGenRuntimeController = createSfxGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => sfxModelCacheDir(getStorageBasePath()),
})
const sfxGenIpc = registerSfxGenIpcHandlers({
  controller: sfxGenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
})

// MiniMax-Music3 (MLX) whole-song BGM engine (08-19-minimax-music3-engine) —
// self-contained bf16 weight pack, native --seed; explicit download (~28.5 GB).
const music3GenRuntimeController = createMusic3GenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => music3ModelCacheDir(getStorageBasePath()),
})
const music3GenIpc = registerMusic3GenIpcHandlers({
  controller: music3GenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
  // 项目音乐目录 = <项目根>/music/;项目根经位置注册表动态解析(08-19 工作台音乐生成)
  getProjectMusicDir: (projectId: string) => path.join(projectRootFor(projectId), 'music'),
  // AI 参照曲解析读音频:受管根/对话框祝福路径守卫(managed-paths H-2/H-3)
  isSourcePathAllowed: isStudioSourcePathAllowed,
})

const remotionShotRenderer = new RemotionShotRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), "remotion"),
  projectRootForProject: projectRootFor,
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  emitProgress: () => undefined,
  depthAdapter,
  cinematicPreset: (shotId: string) => depthRuntimeController.getCinematicPresetForShot(shotId) as CinematicCameraPreset,
})
const remotionChapterRenderer = new RemotionChapterRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), "remotion"),
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  projectRootForProject: projectRootFor,
  chapterManifestService: remotionChapterManifestService,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  resolveCustomFontPath: (fontId) => customFontAbsolutePath(app.getPath('userData'), fontId),
  emitProgress: () => undefined,
  videoWorkflowGate: evaluateVideoWorkflowChapterGate,
  // 章节级资产（LUT/sfx，08-19）：dev=源码树 frontend/assets；打包=resources 下
  // extraResources 镜像（electron-builder.yml from frontend/assets/{luts,sfx}）。
  assetsDir: app.isPackaged
    ? process.resourcesPath
    : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'frontend/assets'),
  // 字幕音效类别表：分镜记录 shotFx.sfx（装饰层，同 store 单源；读取失败=空表零派生）。
  readSfxCategories: (projectId, chapterId) => {
    try {
      const store = readStudioWorkflowStore(getDataDir(), projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; shotFx?: { sfx?: unknown } }>
      const categories: Record<string, string> = {}
      for (const storyboard of storyboards) {
        if (storyboard.episodeId === chapterId && typeof storyboard.shotFx?.sfx === 'string') {
          categories[storyboard.id] = storyboard.shotFx.sfx
        }
      }
      return categories
    } catch {
      return {}
    }
  },
})
const remotionShotIpc = registerRemotionShotIpcHandlers(remotionShotRenderer)
// 日志统一归位:队列事件日志进 <userData>/logs/remotion-queue/,运行态快照留在数据根。
// 一次性迁移旧布局(与快照同目录)的事件文件,必须在构造队列前同步完成。
const remotionQueueStateRoot = path.join(getDataDir(), '_remotion', 'queue')
const remotionQueueEventsRoot = path.join(app.getPath('userData'), 'logs', 'remotion-queue')
migrateQueueEventsFileIfNeeded(
  path.join(remotionQueueStateRoot, 'queue-events.jsonl'),
  path.join(remotionQueueEventsRoot, 'queue-events.jsonl'),
)
const remotionQueue = new RemotionRenderQueue({
  // 硬件感知并发:每路渲染≈4核+8GB 预算,取约束最小值(M4 128G→3);缺省回落 1
  concurrency: resolveHardwareQueueConcurrency(),
  persistence: createRemotionQueueFilePersistence({ stateRoot: remotionQueueStateRoot, eventsRoot: remotionQueueEventsRoot }),
  executor: {
    render: remotionShotRenderer.render.bind(remotionShotRenderer),
    renderChapter: remotionChapterRenderer.render.bind(remotionChapterRenderer),
    renderChapterScene: remotionChapterRenderer.renderScene.bind(remotionChapterRenderer),
    cancel: (jobId) => {
      const shot = remotionShotRenderer.cancel(jobId)
      if (shot.success) return shot
      return remotionChapterRenderer.cancel(jobId)
    },
  },
  // 出片后 QC 链挂点:fire-and-forget,失败只进报告不影响队列(08-19-chapter-video-qc)
  onChapterJobSucceeded: (identity) => {
    void runChapterQc(chapterQcOrchestratorDeps, identity).catch(() => undefined)
  },
})
const remotionQueueIpc = registerRemotionQueueIpcHandlers(remotionQueue, {
  getCurrentShotSlots: readRemotionCurrentShotSlots,
  enqueueChapterScenes: enqueueChapterSceneSegments,
})
// chapter-projection 读簇的装配单例注入(全部消费点均在 whenReady 后的 IPC 调用)
bindChapterProjectionRuntime({
  remotionVersion,
  remotionBundlePath,
  remotionRuntime,
  remotionChapterManifestService,
  remotionQueue,
  videoWorkflowChapterService,
})
let hostedStudioChapterContext: RemotionStudioChapterRenderContext | null = null
const nativeStudioQueueBridge = new RemotionStudioRenderQueueBridge({
  getContext: () => hostedStudioChapterContext ?? undefined,
  enqueueChapter: async ({ context }) => {
    console.error('[chapter-video] step1: probeStatus...')
    const browser = await remotionRuntime.controller.probeStatus()
    if (browser.status.state !== 'ready') {
      return { accepted: false, message: `Remotion Headless Shell 未就绪: ${browser.status.message ?? browser.status.state}` }
    }
    console.error('[chapter-video] step2: bundle manifest...')
    const manifest = JSON.parse(await fs.promises.readFile(path.join(remotionBundlePath, 'manifest.json'), 'utf8')) as {
      contentHash?: unknown;
      templateVersion?: unknown;
    }
    if (typeof manifest.contentHash !== 'string' || typeof manifest.templateVersion !== 'string') {
      return { accepted: false, message: 'Remotion bundle manifest 缺少 template/content hash' }
    }
    console.error('[chapter-video] step3: chapter manifest...')
    const chapterManifest = await remotionChapterManifestService.read(context.projectId, context.chapterId)
    if (!chapterManifest) return { accepted: false, message: '当前章节缺少 RemotionChapterManifestV2' }
    console.error('[chapter-video] step4: createReadyRemotionChapterJob...')
    const job = await createReadyRemotionChapterJob({
      plan: context.plan,
      currentShotSlots: context.currentShotSlots,
      chapterManifest,
      bundleContentHash: manifest.contentHash,
      templateVersion: manifest.templateVersion,
      remotionVersion,
      // 分层发现根与 RemotionChapterRenderer.render 同款（08-19 multilayer Child1），
      // 保证 expectedJobId 不因层资产进身份哈希而失配。
      layerWorkspaceRoot: path.join(projectRootFor(context.projectId), 'remotion'),
    })
    console.error('[chapter-video] step5: evaluateVideoWorkflowChapterGate...')
    const gate = await evaluateVideoWorkflowChapterGate({
      projectId: context.projectId,
      chapterId: context.chapterId,
      revision: context.revision,
      inputSha256: job.inputHash,
    })
    if (!gate.accepted) {
      return { accepted: false, message: `视频工作流章节 gate blocked: ${gate.code} ${gate.message}` }
    }
    console.error('[chapter-video] step6: remotionQueue.enqueueChapter...')
    const result = await remotionQueue.enqueueChapter({
      kind: 'chapter',
      job,
      dependencyJobIds: context.currentShotSlots.map((slot) => slot.job.jobId),
      plan: context.plan,
      currentShotSlots: [...context.currentShotSlots],
    })
    if (!result.accepted) {
      const message = 'message' in result ? result.message : `ChapterVideo 队列拒绝: ${result.reason}`
      console.error('[chapter-video] enqueueChapter 拒绝:', message, 'deps:', context.currentShotSlots.length)
      return { accepted: false, message }
    }
    return { accepted: true, job: result.job }
  },
  getJob: (jobId) => remotionQueue.getJob(jobId),
  cancelJob: (jobId) => remotionQueue.cancel(jobId),
})

const hostedStudio = new RemotionStudioService()
const hostedStudioMedia = new MediaBridgeServer()
let hostedStudioMediaSession: ReturnType<MediaBridgeServer['createSession']> | null = null
let hostedStudioIdentity: { projectId: string; chapterId: string; revision: number } | null = null
let hostedStudioProjectionWatcher: { close: () => void } | null = null
async function closeHostedStudioSession(projectId: string): Promise<void> {
  if (hostedStudioIdentity && hostedStudioIdentity.projectId !== projectId) {
    throw new Error(`当前 Studio 会话属于项目 ${hostedStudioIdentity.projectId}，拒绝关闭 ${projectId}`)
  }
  hostedStudioProjectionWatcher?.close()
  hostedStudioProjectionWatcher = null
  hostedStudioChapterContext = null
  await hostedStudio.close()
  if (hostedStudioMediaSession) await hostedStudioMedia.revokeSession(hostedStudioMediaSession)
  else await hostedStudioMedia.close()
  hostedStudioMediaSession = null
  hostedStudioIdentity = null
}

async function persistStudioEditingRevision(project: import('../../types/editing').EditingProjectV1): Promise<void> {
  const editingPath = resolveDataFilePath(getDataDir(), `_p/${project.projectId}/editing`)
  await withFileStorageMutationLock(editingPath, async () => {
    const raw = JSON.parse(await fs.promises.readFile(editingPath, 'utf8')) as unknown
    const state = isRecord(raw) && isRecord(raw.state) ? raw.state : raw
    if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) {
      throw new Error('Studio 回写时 editing 持久化状态结构无效')
    }
    const current = state.editingProjects[project.id]
    const validated = validateEditingProject(current)
    if (!validated.success || validated.value.revision !== project.revision - 1) {
      throw new Error('Studio 回写目标已被更新或基线 revision 不连续，拒绝覆盖更新版本')
    }
    if (validated.value.projectId !== project.projectId || validated.value.episodeId !== project.episodeId) {
      throw new Error('Studio 回写目标项目/章节不一致')
    }
    if (state.currentEditingProjectIdByEpisode[project.episodeId] !== project.id) {
      throw new Error('Studio 回写目标不是当前章节工程，拒绝覆盖')
    }
    state.editingProjects[project.id] = project
    state.currentEditingProjectIdByEpisode[project.episodeId] = project.id
    const temporaryPath = `${editingPath}.${process.pid}.tmp`
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
    await fs.promises.rename(temporaryPath, editingPath)
    broadcastRemotionStudioEditingUpdated(BrowserWindow.getAllWindows(), {
      projectId: project.projectId,
      chapterId: project.episodeId,
      revision: project.revision,
    }, (error) => {
      console.error('[remotion-studio] editing revision notification failed', error)
    })
  })
}
const remotionStudioIpc = registerRemotionStudioIpcHandlers({
  ensureSession: async (request) => {
    hostedStudio.assertProjectCanEnsure(request.projectId)
    const projection = await loadChapterStudioProjection(request)
    const sameIdentity = hostedStudioIdentity?.projectId === request.projectId
      && hostedStudioIdentity?.chapterId === request.chapterId
      && hostedStudioIdentity?.revision === request.revision
    if (!sameIdentity) {
      hostedStudioProjectionWatcher?.close()
      hostedStudioProjectionWatcher = null
      await hostedStudioMedia.listen()
      const nextMediaSession = hostedStudioMedia.createSession()
      try {
        const urls = buildMediaUrlMap(hostedStudioMedia, nextMediaSession, projection.sources)
        const generated = generateChapterStudioProjection({
          ...projection.input,
          clips: projection.input.clips.map((clip) => ({ ...clip, src: urls[clip.shotId] ?? "" })),
        })
        await fs.promises.mkdir(path.dirname(projection.entryPoint), { recursive: true })
        await fs.promises.writeFile(projection.entryPoint, generated.source, 'utf8')
        const session = await hostedStudio.ensureSession(request, buildMinimalRemotionStudioStartOptions({
          appsRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
          entryPoint: projection.entryPoint,
          renderQueue: nativeStudioQueueBridge,
        }))
        const previousMediaSession = hostedStudioMediaSession
        hostedStudioMediaSession = nextMediaSession
        hostedStudioIdentity = request
        hostedStudioChapterContext = {
          projectId: request.projectId,
          chapterId: request.chapterId,
          revision: request.revision,
          plan: projection.plan,
          currentShotSlots: projection.currentShotSlots,
        }
        const expectedIdentity = {
          projectId: request.projectId,
          chapterId: request.chapterId,
          editingProjectId: projection.input.editingProjectId,
          editingRevision: request.revision,
          clips: projection.input.clips.map((clip) => ({ shotId: clip.shotId, src: urls[clip.shotId] ?? '' })),
        }
        hostedStudioProjectionWatcher = watchChapterStudioProjection({
          sourcePath: projection.entryPoint,
          expectedIdentity,
          getCurrentProject: async () => readEditingProjectSnapshot(request),
          onWriteback: async (result) => {
            await persistStudioEditingRevision(result.project)
            hostedStudioProjectionWatcher?.close()
            hostedStudioProjectionWatcher = null
          },
        })
        if (previousMediaSession) await hostedStudioMedia.revokeSession(previousMediaSession)
        return session
      } catch (error) {
        await hostedStudioMedia.revokeSession(nextMediaSession).catch(() => undefined)
        throw error
      }
    }
    return hostedStudio.ensureSession(request, buildMinimalRemotionStudioStartOptions({
      appsRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
      entryPoint: projection.entryPoint,
      renderQueue: nativeStudioQueueBridge,
    }))
  },
  closeSession: closeHostedStudioSession,
})

disposeRemotionRuntime = async () => {
  await remotionStudioIpc.dispose()
  if (hostedStudioIdentity) await closeHostedStudioSession(hostedStudioIdentity.projectId)
  else await hostedStudioMedia.close()
  remotionQueueIpc.dispose()
  remotionChapterManifestIpc.dispose()
  await remotionPreview.dispose()
  await remotionShotIpc.dispose()
  await remotionChapterRenderer.dispose()
  videoWorkflowIpc.dispose()
  depthIpc.dispose()
  imageGenIpc.dispose()
  upscaleIpc.dispose()
  seedvr2Ipc.dispose()
  mcpIpc.dispose()
  videoQcIpc.dispose()
  chapterQcIpc.dispose()
  audioGenIpc.dispose()
  sfxGenIpc.dispose()
  music3GenIpc.dispose()
  remotionRuntime.dispose()
}

registerStudioRenderIpcHandlers({
  getMediaRoot,
  resolveSourcePath: resolveStudioSourcePath,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
})

registerAssetLibraryIpcHandlers({
  getStorageBasePath,
  getMediaRoot,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
  isSourcePathAllowed: isStudioSourcePathAllowed,
  blessDialogPaths: blessedDialogPaths.bless,
})

async function runTtsRuntimeDiagnostics<T>(
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

// TTS 固定音色参考音频的路径解析:保留收紧前的原语义(绝对路径存在即读)。
// 依据 08-18 渲染层调用面审计:设置页「参考音频路径」是自由文本框,用户可
// 手输/持久化任意外部绝对路径;该链路只把音频字节发给 127.0.0.1 的本地
// sidecar,不外发网络,风险远低于 openPath/图床上传,收紧会打断音色克隆
// 核心流程。其余 IPC 仍走 resolveStudioSourcePath 的受管根守卫。
function resolveReferenceAudioSourcePath(sourcePath: string) {
  if (sourcePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), sourcePath)
  }
  if (sourcePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath)
  }
  if (sourcePath.startsWith('file://')) return sourcePath.replace('file://', '')
  return sourcePath
}

registerTtsIpcHandlers({
  controller: ttsRuntimeController,
  runDiagnostics: runTtsRuntimeDiagnostics,
  resolveReferenceAudioPath: resolveReferenceAudioSourcePath,
})

registerPrivilegedSchemes(protocol)

app.whenReady().then(async () => {
  if (isBackgroundSmoke && process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
    app.dock?.hide()
  }
  scheduleAutoClean()
  await stopLocalSidecars()
  await ensureStudioSkillsAvailableAtStartup()
  registerProtocolHandlers({
    protocol,
    getMediaRoot,
    getDataDir,
    getSkillsRoot,
    getAssetsRoot,
    getImageThumbDir: () => path.join(app.getPath('userData'), 'image-thumbs'),
  })
  
  createWindow()
})


export { blessedDialogPaths, getDataDir, getManagedSourceRoots, isStudioSourcePathAllowed, projectLocationStore, projectRootFor, readImageSource, storageManager } from "./main-paths";
