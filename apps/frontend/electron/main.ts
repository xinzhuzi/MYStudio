// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import packageMetadata from '../../package.json'
import { createDiagnosticsLogService } from './diagnostics-log'
import { createTtsRuntimeController } from './tts-runtime'
import {
  ensureStudioSkillsSynced,
  getStudioSkillStorageRoot,
  listStoredStudioSkillFiles,
} from './studio-skills-storage'
import {
  listStudioRuntimeAssets,
  resolveToonflowAssetPath,
} from './studio-runtime-assets'
import { observedFetch } from '../lib/diagnostics/network'
import type { DiagnosticsLogEntryInput } from '../types/diagnostics'
import type { AvailableUpdateInfo, UpdateManifest } from '../types/update'
import {
  createBeforeQuitCleanup,
  createWindowAllClosedHandler,
  shouldCreateWindowOnActivate,
  shouldCreateWindowOnSecondInstance,
} from './app-lifecycle'
import { registerTtsIpcHandlers } from './ipc/tts-ipc'
import { registerDiagnosticsIpcHandlers } from './ipc/diagnostics-ipc'
import { registerFileStorageIpcHandlers } from './ipc/file-storage-ipc'
import { registerAppUpdaterIpcHandlers } from './ipc/app-updater-ipc'
import {
  parseLocalMediaPath,
  resolveLocalMediaPath,
  resolveProjectFileUrl,
} from './storage-paths'
import { registerProjectFileIpcHandlers } from './ipc/project-file-ipc'
import { registerLocalMediaIpcHandlers } from './ipc/local-media-ipc'
import { registerImageHostIpcHandlers } from './ipc/image-host-ipc'
import { registerStudioContentIpcHandlers } from './ipc/studio-content-ipc'
import { registerAppShellIpcHandlers } from './ipc/app-shell-ipc'
import { registerApiRequestIpcHandlers } from './ipc/api-request-ipc'
import { registerFileExportIpcHandlers } from './ipc/file-export-ipc'
import { registerAssetLibraryIpcHandlers } from './ipc/asset-library-ipc'
import { registerStudioRenderIpcHandlers } from './ipc/studio-render-ipc'
import { createStorageManager } from './storage-manager'

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
}

const packageUpdateConfig = (packageMetadata as PackageMetadata).updateConfig ?? {}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeExternalUrl(value?: string) {
  if (!isNonEmptyString(value)) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

function normalizeVersionParts(version: string) {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const match = part.match(/\d+/)
      return match ? Number(match[0]) : 0
    })
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersionParts(left)
  const rightParts = normalizeVersionParts(right)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
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
  if (!isNonEmptyString(rawManifest.version)) {
    throw new Error('版本清单缺少有效的 version 字段')
  }

  return {
    version: rawManifest.version.trim(),
    releaseNotes: isNonEmptyString(rawManifest.releaseNotes)
      ? rawManifest.releaseNotes.trim()
      : isNonEmptyString(rawManifest.notes)
        ? rawManifest.notes.trim()
        : undefined,
    publishedAt: isNonEmptyString(rawManifest.publishedAt)
      ? rawManifest.publishedAt.trim()
      : undefined,
    githubUrl: sanitizeExternalUrl(rawManifest.githubUrl) ?? getDefaultGithubUrl(),
    baiduUrl: sanitizeExternalUrl(rawManifest.baiduUrl) ?? getDefaultBaiduUrl(),
    baiduCode: isNonEmptyString(rawManifest.baiduCode)
      ? rawManifest.baiduCode.trim()
      : getDefaultBaiduCode(),
  } satisfies UpdateManifest
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
  stopLocalServices: stopLocalSidecars,
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

function isHttpUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://')
}

function getMimeTypeFromExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
  }
  return mimeTypes[extension] || 'image/png'
}

function parseDataUrl(dataUrl: string): { buffer: Buffer, mimeType: string } | null {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s)
  if (!matches) return null
  const mimeType = matches[1] || 'image/png'
  const buffer = Buffer.from(matches[2], 'base64')
  if (buffer.length === 0) return null
  return { buffer, mimeType }
}

function resolveImageSourcePath(imagePath: string): string | null {
  if (imagePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), imagePath)
  }

  if (imagePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), imagePath)
  }

  if (imagePath.startsWith('file://')) {
    return imagePath.replace(/^file:\/\/\/?/, '')
  }

  if (path.isAbsolute(imagePath)) {
    return imagePath
  }

  return null
}

async function fetchBuffer(url: string, timeoutMs: number = 45000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'image/*, */*;q=0.8',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length === 0) {
      throw new Error('获取到的图片为空')
    }

    return {
      buffer,
      mimeType: response.headers.get('content-type') || 'image/png',
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readImageSource(imageData: string): Promise<{ buffer: Buffer, mimeType: string }> {
  if (isHttpUrl(imageData)) {
    return fetchBuffer(imageData)
  }

  const parsedDataUrl = parseDataUrl(imageData)
  if (parsedDataUrl) {
    return parsedDataUrl
  }

  const resolvedPath = resolveImageSourcePath(imageData)
  if (resolvedPath) {
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('本地图片不存在')
    }
    const buffer = fs.readFileSync(resolvedPath)
    if (buffer.length === 0) {
      throw new Error('本地图片为空文件')
    }
    return {
      buffer,
      mimeType: getMimeTypeFromExtension(resolvedPath),
    }
  }

  const rawBuffer = Buffer.from(imageData, 'base64')
  if (rawBuffer.length === 0) {
    throw new Error('图片数据无效')
  }
  return {
    buffer: rawBuffer,
    mimeType: 'image/png',
  }
}

registerLocalMediaIpcHandlers({ getMediaRoot })
registerImageHostIpcHandlers({
  createOperationId: () => createDiagnosticsOperationId('image-host'),
  writeDiagnosticsLog,
  readImageSource,
})

// ==================== File Storage for App Data ====================
const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

registerFileStorageIpcHandlers({ getDataDir })

function getStudioManualsSourceRoot() {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '../..')
  const candidates = [
    path.join(appRoot, 'src', 'assets', 'studio-manuals'),
    path.join(app.getAppPath(), 'src', 'assets', 'studio-manuals'),
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

// Register custom protocol for local images
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-image',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    }
  },
  {
    scheme: 'project-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    }
  },
  {
    scheme: 'studio-skill',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    }
  },
  {
    scheme: 'toonflow-asset',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    }
  },
])

app.whenReady().then(async () => {
  if (isBackgroundSmoke && process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
    app.dock.hide()
  }
  scheduleAutoClean()
  await stopLocalSidecars()
  await ensureStudioSkillsAvailableAtStartup()
  // Handle local-image:// protocol
  protocol.handle('local-image', async (request) => {
    try {
      // URL format: local-image://category/filename
      const filePath = resolveLocalMediaPath(getMediaRoot(), request.url)
      
      // Read file directly
      const data = fs.readFileSync(filePath)
      
      // Determine MIME type based on extension
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        // Images
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        // Videos
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        // Audio
        '.wav': 'audio/wav',
        '.wave': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
      }
      const mimeType = mimeTypes[ext] || 'application/octet-stream'
      
      return new Response(data, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error) {
      console.error('Failed to load local image:', error)
      return new Response('Image not found', { status: 404 })
    }
  })

  protocol.handle('project-file', async (request) => {
    try {
      const filePath = resolveProjectFileUrl(getDataDir(), request.url)
      const data = fs.readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': getMimeType(filePath) },
      })
    } catch (error) {
      console.error('Failed to load project file:', error)
      return new Response('File not found', { status: 404 })
    }
  })

  protocol.handle('studio-skill', async (request) => {
    try {
      const url = new URL(request.url)
      const relativePath = [
        url.hostname,
        ...url.pathname.split('/').filter(Boolean),
      ].map((part) => decodeURIComponent(part)).join('/')
      const skillsRoot = path.resolve(getSkillsRoot())
      const filePath = path.resolve(skillsRoot, relativePath)
      if (filePath !== skillsRoot && !filePath.startsWith(skillsRoot + path.sep)) {
        throw new Error('Studio skill file path escapes storage root')
      }

      const data = fs.readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': getMimeType(filePath) },
      })
    } catch (error) {
      console.error('Failed to load studio skill file:', error)
      return new Response('File not found', { status: 404 })
    }
  })

  protocol.handle('toonflow-asset', async (request) => {
    try {
      const filePath = resolveToonflowAssetPath(request.url)
      const data = fs.readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': getMimeType(filePath) },
      })
    } catch (error) {
      console.error('Failed to load Toonflow asset:', error)
      return new Response('File not found', { status: 404 })
    }
  })
  
  createWindow()
})

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}
