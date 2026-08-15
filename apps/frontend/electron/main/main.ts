// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, protocol, net, shell, utilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import packageMetadata from '../../../package.json'
import { createDiagnosticsLogService } from '../diagnostics/diagnostics-log'
import { createTtsRuntimeController } from '../tts/tts-runtime'
import {
  ensureStudioSkillsSynced,
 
 
} from '../storage/studio-skills-storage'
import {
 
} from '../storage/studio-runtime-assets'
import { observedFetch } from '../../lib/diagnostics/network'
import type { DiagnosticsLogEntryInput } from '../../types/diagnostics'
import type { AvailableUpdateInfo, UpdateManifest } from '../../types/update'
import {
  compareVersions,
  isNonEmptyString,
  normalizeUpdateManifest,
  sanitizeExternalUrl,
} from '../runtime/update-policy'
import {
  getUpdateManifestUrl, getDefaultGithubUrl, getDefaultBaiduUrl, getDefaultBaiduCode,
 
  makeStudioSkillFileUrl,
} from './main-utils'
import {
  createBeforeQuitCleanup,
  createWindowAllClosedHandler,
  shouldCreateWindowOnActivate,
  shouldCreateWindowOnSecondInstance,
} from '../runtime/app-lifecycle'
import { registerTtsIpcHandlers } from '../ipc/tts/tts-ipc'
import { registerSelfMediaIpcHandlers } from '../ipc/self-media/self-media-ipc'
import { createCredentialVault } from '../aitoearn/credential-vault'
import { createAitoearnLocalPlatformBridge } from '../aitoearn/providers/aitoearn-local/platform-bridge'
import { createOfficialPlatformTransports } from '../aitoearn/providers/aitoearn-local/platforms/official/transports'
import { registerDiagnosticsIpcHandlers } from '../ipc/diagnostics/diagnostics-ipc'
import { registerStorageMediaIpcHandlers } from '../ipc/media/storage-media-ipc'
import { registerAppUpdaterIpcHandlers } from '../ipc/app/app-updater-ipc'
import {
 
  resolveLocalMediaPath,
 
  resolveProjectFileUrl,
  resolveProjectRootPath,
  setProjectLocationResolver,
} from '../storage/storage-paths'
import { registerProjectFileIpcHandlers } from '../ipc/files/project-file-ipc'
import { configureArtifactManagementIpc } from '../ipc/files/artifact-management-ipc'
import { withFileStorageMutationLock } from '../ipc/files/file-storage-ipc'
import { registerStudioContentIpcHandlers } from '../ipc/assets/studio-content-ipc'
import { registerAppShellIpcHandlers } from '../ipc/app/app-shell-ipc'
import { registerApiRequestIpcHandlers } from '../ipc/ai/api-request-ipc'
import { registerFileExportIpcHandlers } from '../ipc/files/file-export-ipc'
import { registerAssetLibraryIpcHandlers } from '../ipc/assets/asset-library-ipc'
import { probeStudioMediaEvidence, registerStudioRenderIpcHandlers } from '../ipc/studio/studio-render-ipc'
import { registerRemotionRuntimeIpcHandlers } from '../ipc/studio/remotion-runtime-ipc'
import { registerVideoWorkflowIpcHandlers } from '../ipc/studio/video-workflow-ipc'
import { registerRemotionPreviewIpcHandlers } from '../ipc/studio/remotion-preview-ipc'
import { registerRemotionShotIpcHandlers } from '../ipc/studio/remotion-shot-ipc'
import { registerRemotionQueueIpcHandlers } from '../ipc/studio/remotion-queue-ipc'
import { registerRemotionChapterManifestIpcHandlers } from '../ipc/studio/remotion-chapter-manifest-ipc'
import { registerRemotionStudioIpcHandlers, REMOTION_STUDIO_EDITING_UPDATED_EVENT } from '../ipc/studio/remotion-studio-ipc'
import { RemotionShotRenderer } from '@rendering/plugins/remotion/renderer/remotion-shot-renderer'
import type { CinematicCameraPreset } from '@rendering/plugins/remotion/composition/composition-props'
import { RemotionChapterRenderer } from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import {
  createRemotionQueueFilePersistence,
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
import { createAudioGenRuntimeController } from '@rendering/plugins/audio_gen/audio-gen-runtime-controller'
import { registerAudioGenIpcHandlers } from '../ipc/studio/audio-gen-ipc'
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
import { resolveDataFilePath } from '../storage/storage-paths'
import { validateEditingProject } from '../../lib/studio/editing/validation'
import type { RemotionCurrentSlotV1 } from '../../types/remotion-workspace'
import { compileTimelineRenderPlan } from '../../lib/studio/editing/timeline-render-compiler'
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

function createDiagnosticsOperationId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

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

async function fetchUpdateManifest() {
  const manifestUrl = getUpdateManifestUrl(packageUpdateConfig)
  if (!manifestUrl) {
    throw new Error('未配置版本清单地址')
  }

  const requestUrl = new URL(manifestUrl)
  requestUrl.searchParams.set('_ts', Date.now().toString())

  const response = await net.fetch(requestUrl.toString())
  if (!response.ok) {
    throw new Error(`版本清单请求失败 (${response.status})`)
  }

  const rawManifest = await response.json() as Partial<UpdateManifest>
  return normalizeUpdateManifest(rawManifest, {
    githubUrl: getDefaultGithubUrl(packageUpdateConfig),
    baiduUrl: getDefaultBaiduUrl(packageUpdateConfig),
    baiduCode: getDefaultBaiduCode(packageUpdateConfig),
  })
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

  win.webContents.on('will-navigate', (event, url) => {
    // Allow navigating to the app itself (dev server or local file)
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return
    if (url.startsWith('file://')) return
    // Block and open externally
    event.preventDefault()
    shell.openExternal(url)
  })

  win.webContents.on('will-frame-navigate', (details) => {
    const { url, isMainFrame } = details
    if (!isMainFrame && hostedStudio.isNavigationAllowed(url)) return
    if (isMainFrame && ((VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) || url.startsWith('file://'))) return
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
const readImageSource = createImageSourceReader({ getDataDir, getMediaRoot })

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
  if (sourcePath.startsWith('file://')) return sourcePath.replace('file://', '')
  if (sourcePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), sourcePath)
  }
  if (sourcePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath)
  }
  return sourcePath
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
const hyperFramesAdapter = createHyperFramesAdapter({
  storageBasePath: getStorageBasePath,
  workspaceRootForProject: videoWorkflowWorkspaceRootForProject,
  workerPath: path.join(MAIN_DIST, 'hyperframes-worker.cjs'),
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
})
const buildManagedVideoUseChapterRun = (request: VideoWorkflowChapterRunRequestV1): VideoUseChapterRunV1 => {
  const paths = videoUseAdapter.paths
  const now = Date.now()
  const packageLockSha256 = fs.existsSync(paths.videoUseLockPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(paths.videoUseLockPath)).digest('hex')
    : '0'.repeat(64)
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

// Depth estimation adapter — enables cinematic 3D mode in shot rendering.
// Reuses the same managed Python 3.12 as TTS/video-use. When present and the
// shot's visual is an image, RemotionShotRenderer calls estimateDepth() before
// projecting composition props and injects CinematicConfig onto the visual clip.
const depthAdapter = createDepthAdapter({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})

// Depth runtime controller — settings-facing lifecycle (设置 → 本地配置 → 深度估计模型).
// Model downloads are explicit and user-triggered; inference never downloads.
// The model cache dir is self-managed at <storageBase>/DeepModel (config.json),
// mirroring the TTS model-dir feature set — no TTS cache fallback.
const depthRuntimeController = createDepthRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})
const depthIpc = registerDepthIpcHandlers({
  controller: depthRuntimeController,
  getDataRoot: getDataDir,
  getDiagnosticsDir: () => path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
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
  emitProgress: () => undefined,
  videoWorkflowGate: evaluateVideoWorkflowChapterGate,
})
const remotionShotIpc = registerRemotionShotIpcHandlers(remotionShotRenderer)
const remotionQueue = new RemotionRenderQueue({
  persistence: createRemotionQueueFilePersistence(path.join(getDataDir(), '_remotion', 'queue')),
  executor: {
    render: remotionShotRenderer.render.bind(remotionShotRenderer),
    renderChapter: remotionChapterRenderer.render.bind(remotionChapterRenderer),
    cancel: (jobId) => {
      const shot = remotionShotRenderer.cancel(jobId)
      if (shot.success) return shot
      return remotionChapterRenderer.cancel(jobId)
    },
  },
})
const remotionQueueIpc = registerRemotionQueueIpcHandlers(remotionQueue, {
  getCurrentShotSlots: readRemotionCurrentShotSlots,
})
let hostedStudioChapterContext: RemotionStudioChapterRenderContext | null = null
const nativeStudioQueueBridge = new RemotionStudioRenderQueueBridge({
  getContext: () => hostedStudioChapterContext ?? undefined,
  enqueueChapter: async ({ context }) => {
    const browser = await remotionRuntime.controller.probeStatus()
    if (browser.status.state !== 'ready') {
      return { accepted: false, message: `Remotion Headless Shell 未就绪: ${browser.status.message ?? browser.status.state}` }
    }
    const manifest = JSON.parse(await fs.promises.readFile(path.join(remotionBundlePath, 'manifest.json'), 'utf8')) as {
      contentHash?: unknown;
      templateVersion?: unknown;
    }
    if (typeof manifest.contentHash !== 'string' || typeof manifest.templateVersion !== 'string') {
      return { accepted: false, message: 'Remotion bundle manifest 缺少 template/content hash' }
    }
    const chapterManifest = await remotionChapterManifestService.read(context.projectId, context.chapterId)
    if (!chapterManifest) return { accepted: false, message: '当前章节缺少 RemotionChapterManifestV2' }
    const job = await createReadyRemotionChapterJob({
      plan: context.plan,
      currentShotSlots: context.currentShotSlots,
      chapterManifest,
      bundleContentHash: manifest.contentHash,
      templateVersion: manifest.templateVersion,
      remotionVersion,
    })
    const gate = await evaluateVideoWorkflowChapterGate({
      projectId: context.projectId,
      chapterId: context.chapterId,
      revision: context.revision,
      inputSha256: job.inputHash,
    })
    if (!gate.accepted) {
      return { accepted: false, message: `视频工作流章节 gate blocked: ${gate.code} ${gate.message}` }
    }
    const result = await remotionQueue.enqueueChapter({
      kind: 'chapter',
      job,
      dependencyJobIds: context.currentShotSlots.map((slot) => slot.job.jobId),
      plan: context.plan,
      currentShotSlots: [...context.currentShotSlots],
    })
    if (!result.accepted) {
      return { accepted: false, message: 'message' in result ? result.message : `ChapterVideo 队列拒绝: ${result.reason}` }
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
  const durationInFrames = visualClips.reduce((total, clip) => total + Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000)), 0)
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
      clips: visualClips.map((clip) => ({
        shotId: clip.source.evidence.storyboardId!,
        src: '',
        durationInFrames: Math.max(1, Math.ceil((clip.durationUs * fps) / 1_000_000)),
        trimBeforeFrames: Math.max(0, Math.floor((clip.trimStartUs * fps) / 1_000_000)),
        crop: { x: 0, y: 0, width: plan.value.renderSettings.width, height: plan.value.renderSettings.height },
        transform: clip.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        volume: clip.muted ? 0 : clip.volume,
        subtitle: plan.value.clips.find((candidate) => candidate.trackKind === 'text'
          && candidate.source.evidence.storyboardId === clip.source.evidence.storyboardId)?.source.text ?? '',
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
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(REMOTION_STUDIO_EDITING_UPDATED_EVENT, {
          projectId: project.projectId,
          chapterId: project.episodeId,
          revision: project.revision,
        })
      }
    }
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
  audioGenIpc.dispose()
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

registerTtsIpcHandlers({
  controller: ttsRuntimeController,
  runDiagnostics: runTtsRuntimeDiagnostics,
  resolveSourcePath: resolveStudioSourcePath,
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
  })
  
  createWindow()
})
