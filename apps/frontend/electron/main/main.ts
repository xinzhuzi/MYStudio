// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, protocol, shell, utilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import crypto from 'node:crypto'
import packageMetadata from '../../../package.json'
import { createDiagnosticsLogService } from '../diagnostics/diagnostics-log'
import { configureSidecarLogCapture } from '../diagnostics/sidecar-log-capture'
import { createTtsRuntimeController } from '../tts/tts-runtime'
import {
  ensureStudioSkillsSynced,
 
 
} from '../storage/studio-skills-storage'
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
  resolveProjectRootPath,
  resolveProjectScopedFilePath,
  setProjectLocationResolver,
  isPathInsideRoot,
} from '../storage/storage-paths'
import { createBlessedPathRegistry, isPathInsideAnyRoot } from '../security/managed-paths'
import { registerProjectFileIpcHandlers } from '../ipc/files/project-file-ipc'
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
  createReadyRemotionChapterSceneJob,
} from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import { layoutChapterVisualClipTimings } from '@rendering/plugins/remotion/composition/build-composition-props'
import {
  planSceneSegmentFrameRanges,
  sanitizeSceneSegmentName,
} from '@/lib/studio/remotion/scene-segments'
import type {
  RemotionQueueEnqueueChapterScenesReply,
  RemotionQueueEnqueueChapterScenesReplySegment,
  RemotionQueueEnqueueChapterScenesRequest,
} from '@rendering/plugins/remotion/queue/remotion-queue-ipc'
import {
  createRemotionQueueFilePersistence,
  migrateQueueEventsFileIfNeeded,
  RemotionRenderQueue,
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
import { createVideoWorkflowRuntimeManager } from '@rendering/plugins/video-workflow/video-workflow-runtime-manager'
import { selectSharedVideoToolchain } from '@rendering/plugins/video-workflow/video-workflow-runtime'
import type {
  RemotionChapterGateInputV1,
  RemotionChapterGateResult,
  VideoUseChapterRunV1,
} from '@rendering/contracts/video-workflow'
import type { VideoWorkflowChapterRunRequestV1 } from '../rendering/contracts/video-workflow-ipc'
import { createStorageManager } from '../storage/storage-manager'
import { createProjectLocationStore } from '../storage/project-locations'
import { createDefaultProjectMoveEngine } from '../storage/project-move-engine'
import { registerProjectFolderIpcHandlers } from '../ipc/projects/project-folder-ipc'
import { parseProjectFileUrl, resolveDataFilePath } from '../storage/storage-paths'
import { readStudioWorkflowStore } from '../storage/studio-workflow-store-io'
import { validateEditingProject } from '../../lib/studio/editing/validation'
import type { RemotionCurrentSlotV1 } from '../../types/remotion-workspace'
import { compileTimelineRenderPlan } from '../../lib/studio/editing/timeline-render-compiler'
import { mergeShotFxEditingEffects } from '../../lib/studio/remotion/shot-fx-decisions'
import { applyWorkflowConfigToRenderSettings, type WorkflowConfigProjectionInput } from '../../lib/studio/remotion/workflow-config-projection'
import {
  buildMinimalRemotionStudioStartOptions,
  RemotionStudioRenderQueueBridge,
  generateChapterStudioProjection,
  RemotionStudioService,
  resolveProjectFixedStudioEntryPoint,
  type RemotionStudioChapterRenderContext,
} from '@rendering/plugins/remotion/studio'
import {
  createReadyRemotionChapterJob,
} from '@rendering/plugins/remotion/studio'
import { watchChapterStudioProjection } from '@rendering/plugins/remotion/studio'
import {
  readRemotionCurrentShotSlot,
  readRemotionCurrentShotSlotsFromWorkspace,
  resolveRemotionCurrentSlotOutputPath,
} from '../../lib/studio/remotion/remotion-current-slot'
import { MediaBridgeServer } from '@rendering/plugins/remotion/media-bridge/media-bridge-server'
import { buildMediaUrlMap } from '@rendering/plugins/remotion/media-bridge/media-bridge-source-map'
import { createImageSourceReader } from '../media/image-source'
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
const storageManager = createStorageManager({ userDataPath: app.getPath('userData'), sessionDataPath: app.getPath('sessionData') })
const {
  getStorageBasePath,
  getProjectDataRoot,
  getMediaRoot,
  getSkillsRoot,
  getAssetsRoot,
  scheduleAutoClean,
} = storageManager

// 每项目外部位置表(主进程解析权威):<userData>/project-locations.json。
// resolver 必须先于任何 IPC handler 首次调用就位——所有 `_p/<pid>` 前缀的
// 路径解析(file-storage / artifact / project-file / image-source)据此重定向;
// 未注册位置的项目行为与 legacy 完全一致。
const projectLocationStore = createProjectLocationStore({
  userDataPath: app.getPath('userData'),
  getProjectsDataRoot: () => getProjectDataRoot({ ensure: false }),
})
setProjectLocationResolver(projectLocationStore.get)

// ==================== File Storage for App Data ====================
const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}
// resolver-aware 项目根:外部位置项目 → <location>;legacy → <dataRoot>/_p/<pid>。
const projectRootFor = (projectId: string) => resolveProjectRootPath(getDataDir(), projectId)

// ===== IPC 路径原语的受管根守卫(安全加固 H-2/H-3)=====
// 渲染进程提供的绝对路径只有两类可信:位于应用受管目录内,或刚由主进程
// 原生对话框选出(短期「祝福」)。其余绝对路径一律拒绝,防止被攻破的
// renderer 把 fs/shell/ffprobe 当任意读写原语。协议分支(project-file:///
// local-image://)自带 realpath 级根约束,不经此守卫。
const blessedDialogPaths = createBlessedPathRegistry()
const getManagedSourceRoots = (): string[] => {
  const roots = [
    getDataDir(),
    getMediaRoot(),
    app.getPath('userData'),
    // 存储基地址可被用户 link 到外部目录:python 运行时/assets 库/projects/media/
    // skills 及深度/超分模型的默认缓存都在它之下,必须整体受管。
    getStorageBasePath(),
    ...Object.values(projectLocationStore.all()),
    ttsRuntimeController.getModelCacheDir(),
    // 深度/超分模型缓存目录可由用户配置为任意外部绝对路径(设置页「打开目录」等入口)。
    depthRuntimeController.getModelCacheDir(),
    upscaleRuntimeController.getModelCacheDir(),
  ]
  return Array.from(new Set(roots.filter((root) => typeof root === 'string' && root.trim() !== '')))
}
const isStudioSourcePathAllowed = (targetPath: string): boolean => (
  isPathInsideAnyRoot(getManagedSourceRoots(), targetPath) || blessedDialogPaths.has(targetPath)
)

const readImageSource = createImageSourceReader({ getDataDir, getMediaRoot, getAssetsRoot, isAbsoluteImageSourceAllowed: isStudioSourcePathAllowed })

// Storage/media orchestration delegates registerLocalMediaIpcHandlers, image-host, and file-storage.
registerStorageMediaIpcHandlers({
  getDataDir,
  getMediaRoot,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
  readImageSource,
})

function getStudioManualsSourceRoot() {
  // APP_ROOT is apps/ in electron-vite out layout (out/main -> ../..).
  // Seed lives at apps/frontend/assets/studio-manuals (not legacy src/assets).
  // Packaged builds ship the same tree via extraResources -> resources/studio-manuals.
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '../..')
  const candidates = [
    path.join(appRoot, 'frontend', 'assets', 'studio-manuals'),
    path.join(app.getAppPath(), 'frontend', 'assets', 'studio-manuals'),
    path.join(process.resourcesPath, 'studio-manuals'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function getToonflowRuntimeStudioManualsSourceRoot() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'toonflow', 'data', 'skills')
}

function getStudioManualsFallbackSourceRoots() {
  const primaryRoot = path.resolve(getStudioManualsSourceRoot())
  return [getToonflowRuntimeStudioManualsSourceRoot()]
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => candidate !== primaryRoot && fs.existsSync(candidate))
}

function getStudioSkillSyncOptions() {
  return {
    sourceRoot: getStudioManualsSourceRoot(),
    fallbackSourceRoots: getStudioManualsFallbackSourceRoots(),
    storageRoot: getSkillsRoot(),
  }
}

async function ensureStudioSkillsAvailableAtStartup() {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions())
  } catch (error) {
    console.warn('Failed to sync studio skills at startup:', error)
  }
}

registerSourceMemoryIpcHandlers({ getDataDir })
registerProjectFileIpcHandlers({
  getDataDir,
  readImageSource,
  getMimeType,
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

function resolveStudioSourcePath(sourcePath: string) {
  if (sourcePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), sourcePath)
  }
  if (sourcePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath)
  }
  if (sourcePath.startsWith('file://')) {
    const filePath = sourcePath.replace('file://', '')
    assertStudioSourcePathAllowed(filePath)
    return filePath
  }
  if (path.isAbsolute(sourcePath)) {
    assertStudioSourcePathAllowed(sourcePath)
    return sourcePath
  }
  return sourcePath
}

function assertStudioSourcePathAllowed(filePath: string) {
  if (!isStudioSourcePathAllowed(filePath)) {
    throw new Error(`路径不在应用管理的目录范围内，已拒绝访问: ${filePath}`)
  }
}

// macOS may expose the same inode as /var and /private/var; prefer realpath
// identity while retaining lexical resolution for paths that do not exist yet.
function pathsEquivalent(left: string, right: string): boolean {
  const resolveReal = (value: string) => {
    const macAlias = value.replace(/^\/private\/var(?:\/|$)/, '/var/')
    try {
      return fs.realpathSync.native(macAlias)
    } catch {
      return path.resolve(macAlias)
    }
  }
  return resolveReal(left) === resolveReal(right)
}

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
  modelCacheDir: () => ttsRuntimeController.getModelCacheDir(),
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
const evaluateVideoWorkflowChapterGate = async (input: RemotionChapterGateInputV1): Promise<RemotionChapterGateResult> => {
  // Remotion's inputSha256 identifies the final ChapterVideo job, while the
  // video-use artifact is keyed by the earlier StoryboardShot/TTS input. Read
  // the persisted artifact and pass that second fingerprint explicitly so a
  // valid post-review revision is not rejected merely because the two stages
  // hash different payloads.
  const artifacts = await videoWorkflowChapterService.readArtifacts(input)
  const videoUseInputSha256 = artifacts.success
    ? artifacts.value.videoUseArtifact?.evidence.inputSha256
    : undefined
  return videoWorkflowChapterService.evaluateGate({ ...input, videoUseInputSha256 })
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
  modelCacheDir: () => ttsRuntimeController.getModelCacheDir(),
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
const upscaleIpc = registerUpscaleIpcHandlers({ controller: upscaleRuntimeController })
// 非阻塞启动期刷新:冷启动后 status() 即反映真实运行时/模型状态,超分动作的
// precheck(节点按钮/分镜 tile)无需用户先访问设置页。
void upscaleRuntimeController.refresh()

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
  modelCacheDir: () => ttsRuntimeController.getModelCacheDir(),
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
  modelCacheDir: () => ttsRuntimeController.getModelCacheDir(),
})
const sfxGenIpc = registerSfxGenIpcHandlers({
  controller: sfxGenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
})

// MiniMax-Music3 (MLX) whole-song BGM engine (08-19-minimax-music3-engine) —
// self-contained repo snapshot, native --seed; explicit download (~12 GB).
const music3GenRuntimeController = createMusic3GenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => ttsRuntimeController.getModelCacheDir(),
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

async function loadChapterStudioProjection(request: { projectId: string; chapterId: string; revision: number }) {
  const editingPath = resolveDataFilePath(getDataDir(), `_p/${request.projectId}/editing`)
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.promises.readFile(editingPath, 'utf8'))
  } catch {
    throw new Error('当前项目缺少可验证的 editing 持久化状态')
  }
  const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed
  if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) {
    throw new Error('editing 持久化状态结构无效')
  }
  const editingProjectId = state.currentEditingProjectIdByEpisode[request.chapterId]
  const rawProject = typeof editingProjectId === 'string' ? state.editingProjects[editingProjectId] : undefined
  const project = validateEditingProject(rawProject)
  if (!project.success || project.value.projectId !== request.projectId || project.value.episodeId !== request.chapterId || project.value.revision !== request.revision) {
    throw new Error('当前章节 editing revision 不存在或与 Studio identity 不一致')
  }
  const plan = compileTimelineRenderPlan(project.value, {
    jobId: `studio-${request.projectId}-${request.chapterId}-r${request.revision}`,
    createdAt: project.value.updatedAt,
  })
  if (!plan.success) throw new Error(`当前章节无法编译为 Studio projection: ${plan.issues[0]?.message ?? '未知错误'}`)
  // 2D 镜头语言/特效走 plan.effects 正门（video-use 编排 → Remotion 合成消费）：
  // 合并 shotFx 决策（AI 提示 > 关键词 > 镜序轮换），章节渲染身份哈希含
  // plan.effects → 运镜变化自动失效缓存。幂等：前缀识别旧 shotFx 条目并替换。
  // chapterGrade/subtitleSfxEnabled/atmosphereMode/subtitleFont（导演定调四字段）
  // 经 workflowConfig 注水——实现收敛在 applyWorkflowConfigToRenderSettings
  // （08-20 修复：subtitleFont 曾只有注释承诺无实现，设置页选择从不进 plan）。
  const shotFxStoryboards = (() => {
    try {
      const store = readStudioWorkflowStore(getDataDir(), request.projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; prompt?: string; line?: string; shotFx?: { motion?: unknown } }>
      plan.value.renderSettings = applyWorkflowConfigToRenderSettings(
        plan.value.renderSettings,
        store?.state?.workflowConfig as WorkflowConfigProjectionInput | undefined,
      )
      return storyboards.filter((storyboard) => storyboard.episodeId === request.chapterId)
    } catch { /* store 缺失 → 仅规则轮换运镜 */ }
    return []
  })()
  const shotFx = mergeShotFxEditingEffects(plan.value.effects, {
    planClips: plan.value.clips,
    storyboards: shotFxStoryboards,
    ...(plan.value.renderSettings.chapterGrade ? { chapterGrade: plan.value.renderSettings.chapterGrade } : {}),
    ...(plan.value.renderSettings.atmosphereMode ? { atmosphereMode: plan.value.renderSettings.atmosphereMode } : {}),
  })
  plan.value.effects = shotFx.effects
  const visualClips = plan.value.clips.filter((clip) => clip.trackKind === 'video' || clip.trackKind === 'image')
  if (visualClips.length === 0) throw new Error('当前章节缺少合法 current shot 输出')
  const remotionWorkspaceRoot = path.join(projectRootFor(request.projectId), 'remotion')
  // Applying an accepted video-use artifact may replace individual EDL clip
  // sources with byte-tracked derived MP4s. Resolve that gate before building
  // the Studio projection so preview and formal ChapterVideo share the same
  // source selection rules.
  const projectionGate = await evaluateVideoWorkflowChapterGate({
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    inputSha256: '0'.repeat(64),
  })
  if (projectionGate.accepted && projectionGate.mode === 'flat-shot-mp4') {
    if (visualClips.length !== 1) throw new Error('flat-shot-mp4 Studio projection 必须只有一个视觉片段')
    const clip = visualClips[0]!
    if (clip.source.kind !== 'storyboardVideo') throw new Error(`flat-shot-mp4 Studio projection 视觉片段类型无效: ${clip.id}`)
    const sourcePath = clip.source.path?.trim()
    const gatePath = projectionGate.videoUseFlatShotMp4Path
    const gateSha256 = projectionGate.videoUseFlatShotMp4Sha256
    if (!sourcePath || !path.isAbsolute(sourcePath) || !gatePath || !gateSha256 || !pathsEquivalent(sourcePath, gatePath)) {
      throw new Error(`flat-shot-mp4 Studio source 与 video-use clean MP4 不一致: ${clip.id}`)
    }
    if (clip.source.evidence.sourceFingerprint !== projectionGate.videoUseArtifactSha256) {
      throw new Error(`flat-shot-mp4 Studio source 未绑定当前 video-use artifact: ${clip.id}`)
    }
    const stat = await fs.promises.stat(sourcePath).catch(() => undefined)
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`flat-shot-mp4 clean MP4 不存在或为空: ${sourcePath}`)
    const sourceSha256 = crypto.createHash('sha256').update(await fs.promises.readFile(sourcePath)).digest('hex')
    if (sourceSha256 !== gateSha256) throw new Error(`flat-shot-mp4 clean MP4 SHA-256 已漂移: ${sourcePath}`)
    const currentShotSlots = await readRemotionCurrentShotSlotsFromWorkspace(remotionWorkspaceRoot, request.projectId, request.chapterId)
    const fps = plan.value.renderSettings.fps
    const durationInFrames = Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000))
    const flatClipId = clip.id
    return {
      entryPoint: resolveProjectFixedStudioEntryPoint(
        path.join(app.getPath('userData'), 'remotion-studio'),
        request.projectId,
      ),
      sources: [{ clipId: flatClipId, absolutePath: sourcePath }],
      input: {
        schemaVersion: 1 as const,
        projectId: request.projectId,
        chapterId: request.chapterId,
        editingProjectId: project.value.id,
        editingRevision: request.revision,
        width: plan.value.renderSettings.width,
        height: plan.value.renderSettings.height,
        fps,
        durationInFrames,
        clips: [{
          shotId: flatClipId,
          src: '',
          durationInFrames,
          trimBeforeFrames: Math.max(0, Math.floor((clip.trimStartUs * fps) / 1_000_000)),
          crop: { x: 0, y: 0, width: plan.value.renderSettings.width, height: plan.value.renderSettings.height },
          transform: clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
          volume: clip.muted ? 0 : clip.volume,
          subtitle: '',
        }],
      },
      plan: plan.value,
      currentShotSlots,
    }
  }
  const currentShotSlots: RemotionCurrentSlotV1[] = []
  const sourcePathByShotId = new Map<string, string>()
  for (const clip of visualClips) {
    const storyboardId = clip.source.evidence.storyboardId
    const shotRevision = clip.source.evidence.outputVersion
    if (clip.source.kind !== 'storyboardVideo' || !storyboardId || typeof shotRevision !== 'number' || !Number.isInteger(shotRevision) || shotRevision <= 0) {
      throw new Error(`当前章节镜头不是 Remotion current StoryboardShot: ${clip.id}`)
    }
    const verifiedShotRevision = shotRevision
    if (!clip.source.evidence.remotionJobId || !clip.source.evidence.remotionEvidenceSha256 || !clip.source.evidence.remotionInputHash) {
      throw new Error(`当前章节镜头不是可验证的 Remotion current shot: ${clip.id}`)
    }
    const slotResult = await readRemotionCurrentShotSlot(remotionWorkspaceRoot, request.projectId, {
      kind: 'shot', chapterId: request.chapterId, shotId: storyboardId, shotRevision: verifiedShotRevision,
    })
    if (!slotResult.success) {
      throw new Error(`当前章节镜头 current slot 无效: ${clip.id}: ${slotResult.issues.map((issue) => issue.message).join('；')}`)
    }
    const slot = slotResult.value
    const slotOutputPath = resolveRemotionCurrentSlotOutputPath(remotionWorkspaceRoot, slot)
    const requestedSourcePath = clip.source.path?.trim()
    let projectedSourcePath = slotOutputPath
    if (requestedSourcePath && requestedSourcePath !== slot.outputPath) {
      const resolvedRequestedPath = requestedSourcePath.startsWith('project-file://')
        ? resolveStudioSourcePath(requestedSourcePath)
        : path.isAbsolute(requestedSourcePath) ? requestedSourcePath : undefined
      if (!resolvedRequestedPath) {
        throw new Error(`当前章节镜头 source.path 不是可解析的绝对路径或 project-file URL: ${clip.id}`)
      }
      if (!pathsEquivalent(resolvedRequestedPath, slotOutputPath)) {
        if (!projectionGate.accepted || projectionGate.mode !== 'editable-edl') {
          throw new Error(`当前章节镜头派生输入未通过 video-use gate: ${clip.id}`)
        }
        if (clip.source.evidence.sourceFingerprint !== projectionGate.videoUseArtifactSha256) {
          throw new Error(`当前章节镜头派生输入未绑定当前 video-use artifact: ${clip.id}`)
        }
        const derived = projectionGate.videoUseDerivedInputs?.find((entry) =>
          pathsEquivalent(entry.derivedPath, resolvedRequestedPath),
        )
        if (!derived) {
          throw new Error(`当前章节镜头缺少可追溯派生输入 evidence: ${clip.id}`)
        }
        const stat = await fs.promises.stat(resolvedRequestedPath)
        if (!stat.isFile() || stat.size <= 0) {
          throw new Error(`当前章节镜头派生输入不存在或为空: ${clip.id}`)
        }
        projectedSourcePath = resolvedRequestedPath
      }
    }
    const sourcePathBound = pathsEquivalent(projectedSourcePath, slotOutputPath)
      || (projectionGate.accepted
        && projectionGate.mode === 'editable-edl'
        && clip.source.evidence.sourceFingerprint === projectionGate.videoUseArtifactSha256
        && projectionGate.videoUseDerivedInputs?.some((entry) =>
          pathsEquivalent(entry.derivedPath, projectedSourcePath),
        ) === true)
    if (!sourcePathBound
      || clip.source.evidence.remotionJobId !== slot.job.jobId
      || clip.source.evidence.remotionEvidenceSha256 !== slot.evidence.sha256
      || clip.source.evidence.remotionInputHash !== slot.job.inputHash
      || slot.evidence.compositionId !== 'StoryboardShot'
      || slot.evidence.renderer.requested !== 'remotion'
      || slot.evidence.renderer.actual !== 'remotion') {
      throw new Error(`当前章节镜头与 Remotion current slot identity 不一致: ${clip.id}`)
    }
    if (currentShotSlots.some((candidate) => candidate.target.kind === 'shot' && candidate.target.shotId === storyboardId)) {
      throw new Error(`当前章节重复绑定 Remotion shot: ${storyboardId}`)
    }
    sourcePathByShotId.set(storyboardId, projectedSourcePath)
    currentShotSlots.push(slot)
  }
  const fps = plan.value.renderSettings.fps
  const clipFrames = (clip: (typeof visualClips)[number]) => Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000))
  const transitionByFromClipId = new Map(
    (project.value.transitions ?? [])
      .filter((transition) => typeof transition.fromClipId === 'string')
      .map((transition) => [transition.fromClipId as string, transition]),
  )
  // Studio projection 只表达 cut / fade；EDL 的装饰性转场（crossfade/flash 等）
  // 按时长折叠为 fade 重叠，cut 与无转场保持硬切，时长钳制不得覆盖相邻镜。
  const studioTransitions: Array<{ type: 'cut'; durationInFrames: 0 } | { type: 'fade'; durationInFrames: number } | undefined> = visualClips.map((clip, index) => {
    if (index === visualClips.length - 1) return undefined
    const transition = transitionByFromClipId.get(clip.id)
    const requested = transition && transition.effectId !== 'cut' && Number.isFinite(transition.durationUs)
      ? Math.floor((transition.durationUs * fps) / 1_000_000)
      : 0
    const cap = Math.min(clipFrames(clip), clipFrames(visualClips[index + 1]!)) - 1
    const fadeFrames = Math.min(requested, Math.max(0, cap))
    return fadeFrames > 0 ? { type: 'fade' as const, durationInFrames: fadeFrames } : { type: 'cut' as const, durationInFrames: 0 }
  })
  const durationInFrames = studioTransitions.reduce(
    (total, transition, index) => total + clipFrames(visualClips[index]!) - (transition?.type === 'fade' ? transition.durationInFrames : 0),
    0,
  )
  const currentShotSlotById = new Map(
    currentShotSlots.map((slot) => [slot.target.kind === 'shot' ? slot.target.shotId : '', slot] as const),
  )
  return {
    entryPoint: resolveProjectFixedStudioEntryPoint(
      path.join(app.getPath('userData'), 'remotion-studio'),
      request.projectId,
    ),
    sources: visualClips.map((clip) => {
      const shotId = clip.source.evidence.storyboardId
      const slot = shotId ? currentShotSlotById.get(shotId) : undefined
      if (!shotId || !slot || slot.target.kind !== 'shot') {
        throw new Error(`当前章节镜头缺少合法 current slot: ${clip.id}`)
      }
      const absolutePath = sourcePathByShotId.get(shotId)
      if (!absolutePath) {
        throw new Error(`当前章节镜头缺少已解析的 Studio source path: ${shotId}`)
      }
      return {
        clipId: shotId,
        absolutePath,
      }
    }),
    input: {
      schemaVersion: 1 as const,
      projectId: request.projectId,
      chapterId: request.chapterId,
      editingProjectId: project.value.id,
      editingRevision: request.revision,
      width: plan.value.renderSettings.width,
      height: plan.value.renderSettings.height,
      fps,
      durationInFrames,
      clips: visualClips.map((clip, index) => ({
        shotId: clip.source.evidence.storyboardId!,
        src: '',
        durationInFrames: clipFrames(clip),
        trimBeforeFrames: Math.max(0, Math.floor((clip.trimStartUs * fps) / 1_000_000)),
        crop: { x: 0, y: 0, width: plan.value.renderSettings.width, height: plan.value.renderSettings.height },
        transform: clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        volume: clip.muted ? 0 : clip.volume,
        subtitle: plan.value.clips.find((candidate) => candidate.trackKind === 'text'
          && candidate.source.evidence.storyboardId === clip.source.evidence.storyboardId)?.source.text ?? '',
        ...(studioTransitions[index] ? { transitionAfter: studioTransitions[index] } : {}),
      })),
    },
    plan: plan.value,
    currentShotSlots,
  }
}

async function readEditingProjectSnapshot(request: { projectId: string; chapterId: string }): Promise<import('../../types/editing').EditingProjectV1 | undefined> {
  try {
    const editingPath = resolveDataFilePath(getDataDir(), `_p/${request.projectId}/editing`)
    const parsed = JSON.parse(await fs.promises.readFile(editingPath, 'utf8')) as unknown
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed
    if (!isRecord(state) || !isRecord(state.editingProjects) || !isRecord(state.currentEditingProjectIdByEpisode)) return undefined
    const id = state.currentEditingProjectIdByEpisode[request.chapterId]
    const result = validateEditingProject(typeof id === 'string' ? state.editingProjects[id] : undefined)
    return result.success && result.value.projectId === request.projectId && result.value.episodeId === request.chapterId
      ? result.value
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Queue state schedules new work. Persisted current triples restore verified
 * outputs after restart without treating volatile queue state as render proof.
 */
async function readRemotionCurrentShotSlots(scope: { projectId: string; chapterId: string }): Promise<RemotionCurrentSlotV1[]> {
  const workspaceRoot = path.join(projectRootFor(scope.projectId), 'remotion')
  return readRemotionCurrentShotSlotsFromWorkspace(workspaceRoot, scope.projectId, scope.chapterId)
}

/**
 * 按场分段导出入队服务（渲染域 IPC → 本函数）：复用章级 projection 编译器
 * 拿同一 plan/slots，场结构由渲染域从分镜表原文推导后随请求传入，这里只做
 * 「分镜→渲染计划片段」的结构校验与帧分区。产物落项目 Remotion workspace
 * `jobs/chapter/<chapterId>/scenes/`，不走 current slot、不触发章级 QC。
 */
async function enqueueChapterSceneSegments(
  request: RemotionQueueEnqueueChapterScenesRequest,
): Promise<RemotionQueueEnqueueChapterScenesReply> {
  try {
    // function 声明可早于模块级守卫被调用，这里自行收窄（模块级已有同款 throw）。
    const resolvedRemotionVersion = remotionVersion
    if (typeof resolvedRemotionVersion !== "string") {
      return { accepted: false, message: "package.json 必须声明精确 Remotion 版本" }
    }
    const browser = await remotionRuntime.controller.probeStatus()
    if (browser.status.state !== 'ready') {
      return { accepted: false, message: `Remotion Headless Shell 未就绪: ${browser.status.message ?? browser.status.state}` }
    }
    const projection = await loadChapterStudioProjection({
      projectId: request.projectId,
      chapterId: request.chapterId,
      revision: request.editingRevision,
    })
    const plan = projection.plan
    const currentShotSlots = [...projection.currentShotSlots]
    const layout = layoutChapterVisualClipTimings(plan)
    const framePlan = planSceneSegmentFrameRanges({
      clips: layout.clips,
      durationInFrames: layout.durationInFrames,
      scenes: request.segments.map((segment) => ({
        sceneNo: segment.sceneNo,
        sceneName: segment.sceneName,
        storyboardIds: segment.storyboardIds,
      })),
    })
    if (!framePlan.success) {
      return { accepted: false, message: `按场分段校验失败：${framePlan.issues.join('；')}` }
    }
    const chapterManifest = await remotionChapterManifestService.read(request.projectId, request.chapterId)
    if (!chapterManifest) return { accepted: false, message: '当前章节缺少 RemotionChapterManifestV2' }
    const manifest = JSON.parse(await fs.promises.readFile(path.join(remotionBundlePath, 'manifest.json'), 'utf8')) as {
      contentHash?: unknown;
      templateVersion?: unknown;
    }
    if (typeof manifest.contentHash !== 'string' || typeof manifest.templateVersion !== 'string') {
      return { accepted: false, message: 'Remotion bundle manifest 缺少 template/content hash' }
    }
    const layerWorkspaceRoot = path.join(projectRootFor(request.projectId), 'remotion')
    const workspaceRoot = layerWorkspaceRoot
    const replySegments: RemotionQueueEnqueueChapterScenesReplySegment[] = []
    for (let index = 0; index < framePlan.segments.length; index += 1) {
      const segment = framePlan.segments[index]!
      const sceneRequest = request.segments.find((candidate) => candidate.sceneNo === segment.sceneNo)
      if (!sceneRequest) return { accepted: false, message: `场 ${segment.sceneNo} 缺少请求参数` }
      const outputRelativePath = `jobs/chapter/${request.chapterId}/scenes/Sc${String(segment.sceneNo).padStart(2, '0')}_${sanitizeSceneSegmentName(segment.sceneName)}.mp4`
      const job = await createReadyRemotionChapterSceneJob({
        plan,
        currentShotSlots,
        chapterManifest,
        bundleContentHash: manifest.contentHash,
        templateVersion: manifest.templateVersion,
        remotionVersion: resolvedRemotionVersion,
        layerWorkspaceRoot,
        sceneSegment: {
          sceneNo: segment.sceneNo,
          sceneName: sceneRequest.sceneName,
          storyboardIds: sceneRequest.storyboardIds,
          frameRange: [segment.startFrame, segment.endFrame],
          outputRelativePath,
        },
      })
      const result = await remotionQueue.enqueueChapterScene({
        kind: 'chapter-scene',
        job,
        dependencyJobIds: currentShotSlots.map((slot) => slot.job.jobId),
        plan,
        currentShotSlots,
        sceneSegment: {
          sceneNo: segment.sceneNo,
          sceneName: sceneRequest.sceneName,
          storyboardIds: sceneRequest.storyboardIds,
          frameRange: [segment.startFrame, segment.endFrame],
          outputRelativePath,
        },
      })
      if (!result.accepted) {
        if (result.reason === 'duplicate-active' || result.reason === 'already-succeeded') {
          replySegments.push({
            sceneNo: segment.sceneNo,
            jobId: result.job.jobId,
            outputRelativePath,
            outputAbsolutePath: path.join(workspaceRoot, outputRelativePath),
            frameRange: [segment.startFrame, segment.endFrame],
          })
          continue
        }
        return { accepted: false, message: 'message' in result ? result.message : `场 ${segment.sceneNo} 入队被拒绝: ${result.reason}` }
      }
      replySegments.push({
        sceneNo: segment.sceneNo,
        jobId: result.job.jobId,
        outputRelativePath,
        outputAbsolutePath: path.join(workspaceRoot, outputRelativePath),
        frameRange: [segment.startFrame, segment.endFrame],
      })
    }
    return { accepted: true, segments: replySegments }
  } catch (error) {
    return { accepted: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
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
  })
  
  createWindow()
})
