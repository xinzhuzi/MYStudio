// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, utilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import packageMetadata from '../../../package.json'
import { createDiagnosticsLogService } from '../diagnostics/diagnostics-log'
import { createTtsRuntimeController } from '../tts/tts-runtime'
import {
  ensureStudioSkillsSynced,
  getStudioSkillStorageRoot,
  listStoredStudioSkillFiles,
} from '../storage/studio-skills-storage'
import {
  listStudioRuntimeAssets,
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
  parseLocalMediaPath,
  resolveLocalMediaPath,
  resolveProjectScopedFilePath,
  resolveProjectFileUrl,
} from '../storage/storage-paths'
import { registerProjectFileIpcHandlers } from '../ipc/files/project-file-ipc'
import { withFileStorageMutationLock } from '../ipc/files/file-storage-ipc'
import { registerStudioContentIpcHandlers } from '../ipc/assets/studio-content-ipc'
import { registerAppShellIpcHandlers } from '../ipc/app/app-shell-ipc'
import { registerApiRequestIpcHandlers } from '../ipc/ai/api-request-ipc'
import { registerFileExportIpcHandlers } from '../ipc/files/file-export-ipc'
import { registerAssetLibraryIpcHandlers } from '../ipc/assets/asset-library-ipc'
import { registerStudioRenderIpcHandlers } from '../ipc/studio/studio-render-ipc'
import { registerRemotionRuntimeIpcHandlers } from '../ipc/studio/remotion-runtime-ipc'
import { registerRemotionPreviewIpcHandlers } from '../ipc/studio/remotion-preview-ipc'
import { registerRemotionShotIpcHandlers } from '../ipc/studio/remotion-shot-ipc'
import { registerRemotionQueueIpcHandlers } from '../ipc/studio/remotion-queue-ipc'
import { registerRemotionStudioIpcHandlers, REMOTION_STUDIO_EDITING_UPDATED_EVENT } from '../ipc/studio/remotion-studio-ipc'
import { RemotionShotRenderer } from '@rendering/plugins/remotion/renderer/remotion-shot-renderer'
import { RemotionChapterRenderer } from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import {
  createRemotionQueueFilePersistence,
  RemotionRenderQueue,
} from '@rendering/plugins/remotion/queue/remotion-render-queue'
import { resolveRemotionRuntimeDir } from '@rendering/plugins/remotion/browser/remotion-runtime-manifest'
import { createStorageManager } from '../storage/storage-manager'
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

let win: BrowserWindow | null
const hasSingleInstanceLock = app.requestSingleInstanceLock()
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

function getUpdateManifestUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.manifestUrl)
}

function getDefaultGithubUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.defaultGithubUrl)
}

function getDefaultBaiduUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.defaultBaiduUrl)
}

function getDefaultBaiduCode() {
  return isNonEmptyString(packageUpdateConfig.defaultBaiduCode)
    ? packageUpdateConfig.defaultBaiduCode.trim()
    : undefined
}

async function fetchUpdateManifest() {
  const manifestUrl = getUpdateManifestUrl()
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
    githubUrl: getDefaultGithubUrl(),
    baiduUrl: getDefaultBaiduUrl(),
    baiduCode: getDefaultBaiduCode(),
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
const storageManager = createStorageManager({ userDataPath: app.getPath('userData') })
const {
  getStorageBasePath,
  getProjectDataRoot,
  getMediaRoot,
  getSkillsRoot,
  scheduleAutoClean,
} = storageManager

// ==================== File Storage for App Data ====================
const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}
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

function encodePathForProtocol(relativePath: string) {
  return relativePath.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function makeStudioSkillFileUrl(relativePath: string) {
  return `studio-skill://${encodePathForProtocol(relativePath)}`
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

registerStudioContentIpcHandlers({
  getSkillsRoot,
  getStudioSkillSyncOptions,
  makeStudioSkillFileUrl,
})
storageManager.registerIpcHandlers({ getStudioManualsSourceRoot })

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
const remotionRuntime = registerRemotionRuntimeIpcHandlers({
  userDataDir: remotionUserDataDir,
  remotionVersion,
  workerPath: path.join(MAIN_DIST, 'remotion-browser-worker.cjs'),
  bundlePath: remotionBundlePath,
})
const remotionPreview = registerRemotionPreviewIpcHandlers({
  resolveSourcePath: resolveStudioSourcePath,
})
const remotionRuntimeDir = resolveRemotionRuntimeDir(remotionUserDataDir)
const remotionBinariesDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules/@remotion/compositor-darwin-arm64')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'node_modules/@remotion/compositor-darwin-arm64')
const remotionShotRenderer = new RemotionShotRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(getDataDir(), "_p", projectId, "remotion"),
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  emitProgress: () => undefined,
})
const remotionChapterRenderer = new RemotionChapterRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(getDataDir(), "_p", projectId, "remotion"),
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  emitProgress: () => undefined,
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
const remotionQueueIpc = registerRemotionQueueIpcHandlers(remotionQueue)
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
    const job = await createReadyRemotionChapterJob({
      plan: context.plan,
      currentShotSlots: context.currentShotSlots,
      chapterAudioClipIds: context.chapterAudioClipIds,
      bundleContentHash: manifest.contentHash,
      templateVersion: manifest.templateVersion,
      remotionVersion,
    })
    const result = await remotionQueue.enqueueChapter({
      kind: 'chapter',
      job,
      dependencyJobIds: context.currentShotSlots.map((slot) => slot.job.jobId),
      plan: context.plan,
      currentShotSlots: [...context.currentShotSlots],
      chapterAudioClipIds: [...context.chapterAudioClipIds],
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
  const remotionWorkspaceRoot = path.join(getDataDir(), '_p', request.projectId, 'remotion')
  const currentShotSlots: RemotionCurrentSlotV1[] = []
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
    if (clip.source.path !== slot.outputPath
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
      return {
        clipId: shotId,
        absolutePath: resolveRemotionCurrentSlotOutputPath(remotionWorkspaceRoot, slot),
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
    chapterAudioClipIds: plan.value.clips
      .filter((clip) => clip.trackKind === 'voice' || clip.trackKind === 'bgm' || clip.trackKind === 'sfx')
      .map((clip) => clip.id),
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
          chapterAudioClipIds: projection.chapterAudioClipIds,
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
  await remotionPreview.dispose()
  await remotionShotIpc.dispose()
  await remotionChapterRenderer.dispose()
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
    app.dock.hide()
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
