// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import packageMetadata from '../../package.json'
import { createTtsRuntimeController } from './tts-runtime'
import {
  createStoredStudioSkillFile,
  deleteStoredStudioSkillFile,
  ensureStudioSkillsSynced,
  getStudioSkillStorageRoot,
  listStoredStudioSkillFiles,
  readStoredStudioSkillText,
  resolveStoredStudioSkillPath,
  writeStoredStudioSkillText,
} from './studio-skills-storage'
import {
  createStoredVisualManual,
  listStoredVisualManuals,
  readStoredVisualManual,
  writeStoredVisualManual,
} from './studio-visual-manuals-storage'
import { runModelTestRequest, type ModelTestRequest, type ModelTestResult } from '../lib/api-manager/model-test'
import { runTextCompletionRequest, type TextCompletionRequest, type TextCompletionResult } from '../lib/api-manager/text-completion'
import type { StudioVisualManualCreatePayload, StudioVisualManualWritePayload } from '../types/studio-visual-manual'
import type { EpisodeMergePlan, TrackRenderInput, TrackRenderPlan } from '../types/studio'
import type { AvailableUpdateInfo, OpenExternalResult, UpdateCheckResult, UpdateManifest } from '../types/update'

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
const RENDERER_INDEX_HTML = path.join('src', 'renderer', 'index.html')

process.env.VITE_PUBLIC = RENDERER_DIST

let win: BrowserWindow | null
const execFileAsync = promisify(execFile)

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
type StudioSaveMaterialPayload = {
  name: string
  bytes: ArrayBuffer | Uint8Array
}

const ttsRuntimeController = createTtsRuntimeController({
  appRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
  userDataPath: app.getPath('userData'),
})

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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
// ==================== Storage Config ====================
type StorageConfig = {
  // Single base path for all data (projects + media)
  basePath?: string
  // Legacy fields (for migration)
  projectPath?: string
  mediaPath?: string
  autoCleanEnabled?: boolean
  autoCleanDays?: number
}

const DEFAULT_STORAGE_CONFIG: Required<StorageConfig> = {
  basePath: '',
  projectPath: '',
  mediaPath: '',
  autoCleanEnabled: false,
  autoCleanDays: 30,
}

const storageConfigPath = path.join(app.getPath('userData'), 'storage-config.json')
let storageConfig: StorageConfig = loadStorageConfig()
let autoCleanInterval: NodeJS.Timeout | null = null

function loadStorageConfig(): StorageConfig {
  try {
    if (fs.existsSync(storageConfigPath)) {
      const raw = fs.readFileSync(storageConfigPath, 'utf-8')
      const parsed = JSON.parse(raw) as StorageConfig
      return { ...DEFAULT_STORAGE_CONFIG, ...parsed }
    }
  } catch (error) {
    console.warn('Failed to load storage config:', error)
  }
  return { ...DEFAULT_STORAGE_CONFIG }
}

function saveStorageConfig() {
  try {
    fs.writeFileSync(storageConfigPath, JSON.stringify(storageConfig, null, 2), 'utf-8')
  } catch (error) {
    console.warn('Failed to save storage config:', error)
  }
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizePath(inputPath: string) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath)
}

// Check if childPath is inside parentPath (subdirectory)
function isSubdirectory(parentPath: string, childPath: string): boolean {
  const normalizedParent = path.resolve(parentPath).toLowerCase() + path.sep
  const normalizedChild = path.resolve(childPath).toLowerCase() + path.sep
  return normalizedChild.startsWith(normalizedParent)
}

// Check if two paths are the same or one contains the other
function pathsConflict(source: string, dest: string): string | null {
  const normalizedSource = path.resolve(source).toLowerCase()
  const normalizedDest = path.resolve(dest).toLowerCase()
  
  if (normalizedSource === normalizedDest) {
    return null // Same path is OK, handled elsewhere
  }
  if (isSubdirectory(source, dest)) {
    return '目标路径不能是当前路径的子目录'
  }
  if (isSubdirectory(dest, source)) {
    return '当前路径不能是目标路径的子目录'
  }
  return null
}

// Get the base storage path (contains both projects and media)
function getStorageBasePath() {
  // Check new basePath first, then fall back to legacy projectPath parent
  const configured = storageConfig.basePath?.trim()
  if (configured) {
    return normalizePath(configured)
  }
  // Legacy migration: if projectPath exists, use its parent
  const legacyProject = storageConfig.projectPath?.trim()
  if (legacyProject) {
    return path.dirname(normalizePath(legacyProject))
  }
  return app.getPath('userData')
}

function getProjectDataRoot() {
  const base = path.join(getStorageBasePath(), 'projects')
  ensureDir(base)
  return base
}

function getMediaRoot() {
  const base = path.join(getStorageBasePath(), 'media')
  ensureDir(base)
  return base
}

function getSkillsRoot() {
  const base = getStudioSkillStorageRoot(getStorageBasePath())
  ensureDir(base)
  return base
}

function getCacheDirs() {
  const userData = app.getPath('userData')
  return [
    path.join(userData, 'Cache'),
    path.join(userData, 'Code Cache'),
    path.join(userData, 'GPUCache'),
  ]
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath)
      } else {
        const stat = await fs.promises.stat(fullPath)
        total += stat.size
      }
    }
    return total
  } catch {
    return 0
  }
}

async function copyDir(source: string, destination: string) {
  ensureDir(destination)
  await fs.promises.cp(source, destination, { recursive: true, force: true })
}

async function removeDir(dirPath: string) {
  await fs.promises.rm(dirPath, { recursive: true, force: true })
}

async function deleteOldFiles(dirPath: string, cutoffTime: number): Promise<number> {
  let cleared = 0
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        cleared += await deleteOldFiles(fullPath, cutoffTime)
        const remaining = await fs.promises.readdir(fullPath)
        if (remaining.length === 0) {
          await fs.promises.rmdir(fullPath).catch(() => {})
        }
      } else {
        const stat = await fs.promises.stat(fullPath)
        if (stat.mtimeMs < cutoffTime) {
          await fs.promises.unlink(fullPath).catch(() => {})
          cleared += stat.size
        }
      }
    }
  } catch {
    // ignore
  }
  return cleared
}

function scheduleAutoClean() {
  if (autoCleanInterval) {
    clearInterval(autoCleanInterval)
    autoCleanInterval = null
  }
  if (storageConfig.autoCleanEnabled) {
    const days = storageConfig.autoCleanDays || DEFAULT_STORAGE_CONFIG.autoCleanDays
    clearCache(days).catch(() => {})
    autoCleanInterval = setInterval(() => {
      clearCache(days).catch(() => {})
    }, 24 * 60 * 60 * 1000)
  }
}

async function clearCache(olderThanDays?: number): Promise<number> {
  const dirs = getCacheDirs()
  let cleared = 0
  if (olderThanDays && olderThanDays > 0) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    for (const dir of dirs) {
      cleared += await deleteOldFiles(dir, cutoff)
    }
    return cleared
  }
  for (const dir of dirs) {
    cleared += await getDirectorySize(dir)
    await removeDir(dir).catch(() => {})
    ensureDir(dir)
  }
  return cleared
}

// Get user data path for storing images
const getImagesDir = (subDir: string) => {
  const imagesDir = path.join(getMediaRoot(), subDir)
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }
  return imagesDir
}

// Download image from URL and save to local file
const downloadImage = (url: string, filePath: string, maxRedirects: number = 5): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(filePath)
    
    protocol.get(url, (response) => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        file.close()
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath, maxRedirects - 1).then(resolve).catch(reject)
          return
        }
      }
      
      if (status !== 200) {
        file.close()
        fs.unlink(filePath, () => {})
        reject(new Error(`Failed to download: ${status}`))
        return
      }
      
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      file.close()
      fs.unlink(filePath, () => {})
      reject(err)
    })
  })
}

type ImageHostUploadProvider = {
  name: string
  platform: string
  baseUrl?: string
  uploadPath?: string
  apiKeyParam?: string
  apiKeyHeader?: string
  apiKeyFormField?: string
  expirationParam?: string
  imageField?: string
  imagePayloadType?: 'base64' | 'file'
  nameField?: string
  staticFormFields?: Record<string, string>
  responseUrlField?: string
  responseDeleteUrlField?: string
}

type ImageHostUploadOptions = {
  name?: string
  expiration?: number
}

type ImageHostUploadRequest = {
  provider: ImageHostUploadProvider
  apiKey: string
  imageData: string
  options?: ImageHostUploadOptions
}

type ImageHostUploadResponse = {
  success: boolean
  url?: string
  deleteUrl?: string
  error?: string
}

function isHttpUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://')
}

function resolveImageHostUploadUrl(provider: ImageHostUploadProvider) {
  const uploadPath = (provider.uploadPath || '').trim()
  if (uploadPath && isHttpUrl(uploadPath)) {
    return uploadPath
  }
  const baseUrl = (provider.baseUrl || '').trim().replace(/\/*$/, '')
  if (!baseUrl && !uploadPath) return ''
  if (!baseUrl && uploadPath) return ''
  if (!uploadPath) return baseUrl
  const normalizedPath = uploadPath.startsWith('/') ? uploadPath : `/${uploadPath}`
  return `${baseUrl}${normalizedPath}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getByPath(obj: unknown, objectPath?: string): unknown {
  if (!isRecord(obj) || !objectPath) return undefined
  return objectPath.split('.').reduce<unknown>((acc, key) => {
    if (!isRecord(acc)) return undefined
    return acc[key]
  }, obj)
}

function extractFirstHttpUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i)
  return match?.[0]
}

function getExtensionFromMimeType(mimeType?: string) {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/bmp':
      return 'bmp'
    case 'image/avif':
      return 'avif'
    case 'image/png':
    default:
      return 'png'
  }
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
  const localImageMatch = imagePath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (localImageMatch) {
    const [, category, filename] = localImageMatch
    return path.join(getMediaRoot(), category, decodeURIComponent(filename))
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

async function toUploadFilePayload(imageData: string, name?: string) {
  const { buffer, mimeType } = await readImageSource(imageData)
  const baseName = (name || 'upload').trim() || 'upload'
  const hasExtension = /\.[a-z0-9]{2,8}$/i.test(baseName)
  const filename = hasExtension ? baseName : `${baseName}.${getExtensionFromMimeType(mimeType)}`
  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
    mimeType,
  }
}

async function toBase64Payload(imageData: string) {
  if (imageData.startsWith('data:')) {
    const parsed = parseDataUrl(imageData)
    if (!parsed) {
      throw new Error('图片数据无效')
    }
    return parsed.buffer.toString('base64')
  }

  if (isHttpUrl(imageData) || imageData.startsWith('local-image://') || imageData.startsWith('file://') || path.isAbsolute(imageData)) {
    const { buffer } = await readImageSource(imageData)
    return buffer.toString('base64')
  }

  return imageData
}

async function uploadImageHostFromMain({
  provider,
  apiKey,
  imageData,
  options,
}: ImageHostUploadRequest): Promise<ImageHostUploadResponse> {
  try {
    const uploadUrl = resolveImageHostUploadUrl(provider)
    if (!uploadUrl) {
      return { success: false, error: '图床上传地址未配置' }
    }

    const fieldName = provider.imageField || 'image'
    const nameField = provider.nameField || 'name'
    const payloadType = provider.imagePayloadType || 'base64'
    const staticFormFields = provider.staticFormFields || {}

    const formData = new FormData()
    Object.entries(staticFormFields).forEach(([key, value]) => {
      formData.append(key, value)
    })
    if (provider.apiKeyFormField && apiKey) {
      formData.append(provider.apiKeyFormField, apiKey)
    }

    if (payloadType === 'file') {
      const { blob, filename } = await toUploadFilePayload(imageData, options?.name)
      formData.append(fieldName, blob, filename)
    } else {
      const base64Data = await toBase64Payload(imageData)
      formData.append(fieldName, base64Data)
    }

    if (options?.name) {
      formData.append(nameField, options.name)
    }

    const url = new URL(uploadUrl)
    if (provider.apiKeyParam && apiKey) {
      url.searchParams.set(provider.apiKeyParam, apiKey)
    }
    if (provider.expirationParam && options?.expiration) {
      url.searchParams.set(provider.expirationParam, String(options.expiration))
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    }
    if (provider.apiKeyHeader && apiKey) {
      headers[provider.apiKeyHeader] = apiKey
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      })

      const text = await response.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }

      if (!response.ok) {
        const errorMessage = getByPath(data, 'error.message')
        const messageField = getByPath(data, 'message')
        const message = typeof errorMessage === 'string'
          ? errorMessage
          : typeof messageField === 'string'
            ? messageField
            : text || `上传失败: ${response.status}`
        return { success: false, error: message }
      }

      const urlField = getByPath(data, provider.responseUrlField || 'url')
      const deleteField = getByPath(data, provider.responseDeleteUrlField || 'delete_url')
      const trimmedText = text.trim()
      const extractedTextUrl = extractFirstHttpUrl(trimmedText)

      if (urlField) {
        return {
          success: true,
          url: typeof urlField === 'string' ? urlField : String(urlField),
          deleteUrl: deleteField ? (typeof deleteField === 'string' ? deleteField : String(deleteField)) : undefined,
        }
      }

      if (extractedTextUrl) {
        return { success: true, url: extractedTextUrl }
      }

      console.warn('[ImageHost/Main] Upload succeeded but no URL was detected in the response', {
        provider: provider.name,
        platform: provider.platform,
        responsePreview: trimmedText.substring(0, 200),
      })
      return { success: false, error: `图床 ${provider.name} 上传成功但未返回 URL` }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: '上传超时，请稍后重试' }
      }
      return { success: false, error: error instanceof Error ? error.message : '上传失败' }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '上传失败' }
  }
}

// IPC handlers for image management
ipcMain.handle('save-image', async (_event, { url, category, filename }) => {
  try {
    const imagesDir = getImagesDir(category)
    const ext = path.extname(filename) || '.png'
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`
    const filePath = path.join(imagesDir, safeName)
    
    // data: URL — 直接解码 base64 写入文件（canvas 切割产物）
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:[^;]+;base64,(.+)$/s)
      if (!matches) {
        return { success: false, error: 'Invalid data URL format' }
      }
      const buffer = Buffer.from(matches[1], 'base64')
      if (buffer.length === 0) {
        return { success: false, error: 'Decoded base64 data is empty (0 bytes)' }
      }
      fs.writeFileSync(filePath, buffer)
    } else {
      await downloadImage(url, filePath)
    }
    
    // Validate file was written successfully with non-zero size
    const stat = fs.statSync(filePath)
    if (stat.size === 0) {
      fs.unlinkSync(filePath) // Clean up empty file
      return { success: false, error: 'Saved file is 0 bytes' }
    }
    
    // Return local path that can be used in the app
    return { success: true, localPath: `local-image://${category}/${safeName}` }
  } catch (error) {
    console.error('Failed to save image:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('get-image-path', async (_event, localPath: string) => {
  // Convert local-image://category/filename to actual file path
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return null
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, filename)
  
  if (fs.existsSync(filePath)) {
    // Windows: file:///H:/path/to/file.png (三斜杠 + 正斜杠)
    return `file:///${filePath.replace(/\\/g, '/')}`
  }
  return null
})

ipcMain.handle('delete-image', async (_event, localPath: string) => {
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return false
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, filename)
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
})

// Read local image as base64 (for AI API calls)
ipcMain.handle('read-image-base64', async (_event, localPath: string) => {
  try {
    let filePath: string
    
    // Handle local-image:// protocol
    const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
    if (match) {
      const [, category, filename] = match
      filePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (localPath.startsWith('file://')) {
      filePath = localPath.replace('file://', '')
    } else {
      filePath = localPath
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    
    const data = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    const base64 = `data:${mimeType};base64,${data.toString('base64')}`
    
    return { success: true, base64, mimeType, size: data.length }
  } catch (error) {
    console.error('Failed to read image:', error)
    return { success: false, error: String(error) }
  }
})

// Get absolute file path for a local-image:// URL
ipcMain.handle('get-absolute-path', async (_event, localPath: string) => {
  const match = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
  if (!match) return null
  
  const [, category, filename] = match
  const filePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
  
  if (fs.existsSync(filePath)) {
    return filePath
  }
  return null
})

ipcMain.handle('image-host-upload', async (_event, payload: ImageHostUploadRequest) => {
  return uploadImageHostFromMain(payload)
})

// ==================== File Storage for App Data ====================
const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

ipcMain.handle('file-storage-get', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return data
    }
    return null
  } catch (error) {
    console.error('Failed to read file storage:', error)
    return null
  }
})

ipcMain.handle('file-storage-set', async (_event, key: string, value: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    // Ensure parent directory exists (supports nested keys like _p/xxx/script)
    const parentDir = path.dirname(filePath)
    ensureDir(parentDir)
    fs.writeFileSync(filePath, value, 'utf-8')
    console.log(`Saved to file: ${filePath} (${Math.round(value.length / 1024)}KB)`)
    return true
  } catch (error) {
    console.error('Failed to write file storage:', error)
    return false
  }
})

ipcMain.handle('file-storage-remove', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch (error) {
    console.error('Failed to remove file storage:', error)
    return false
  }
})

// Check if a storage key exists
ipcMain.handle('file-storage-exists', async (_event, key: string) => {
  try {
    const filePath = path.join(getDataDir(), `${key}.json`)
    return fs.existsSync(filePath)
  } catch {
    return false
  }
})

// List sub-directories under a directory prefix (used to discover project IDs under _p/)
ipcMain.handle('file-storage-list-dirs', async (_event, prefix: string) => {
  try {
    const dirPath = path.join(getDataDir(), prefix)
    if (!fs.existsSync(dirPath)) return []
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_migrated')
      .map(e => e.name)
  } catch {
    return []
  }
})

// List all JSON keys under a directory prefix
ipcMain.handle('file-storage-list', async (_event, prefix: string) => {
  try {
    const dirPath = path.join(getDataDir(), prefix)
    if (!fs.existsSync(dirPath)) return []
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(e => `${prefix}/${e.name.replace('.json', '')}`)
  } catch {
    return []
  }
})

// Remove an entire directory (for project deletion)
ipcMain.handle('file-storage-remove-dir', async (_event, prefix: string) => {
  try {
    const dirPath = path.join(getDataDir(), prefix)
    if (fs.existsSync(dirPath)) {
      await fs.promises.rm(dirPath, { recursive: true, force: true })
    }
    return true
  } catch (error) {
    console.error('Failed to remove directory:', error)
    return false
  }
})

function resolveProjectFilePath(key: string) {
  const dataRoot = getDataDir()
  const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedKey || normalizedKey.includes('../') || normalizedKey.includes('..\\')) {
    throw new Error('Invalid project file key')
  }

  const targetPath = path.resolve(dataRoot, normalizedKey)
  const normalizedRoot = path.resolve(dataRoot)
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error('Project file key escapes storage root')
  }

  return targetPath
}

function getStudioManualsSourceRoot() {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '../..')
  const candidates = [
    path.join(appRoot, 'src', 'assets', 'studio-manuals'),
    path.join(app.getAppPath(), 'src', 'assets', 'studio-manuals'),
    path.join(process.resourcesPath, 'studio-manuals'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function encodePathForProtocol(relativePath: string) {
  return relativePath.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function makeStudioSkillFileUrl(relativePath: string) {
  return `studio-skill://${encodePathForProtocol(relativePath)}`
}

ipcMain.handle('project-file-write-text', async (_event, key: string, value: string) => {
  try {
    const filePath = resolveProjectFilePath(key)
    ensureDir(path.dirname(filePath))
    await fs.promises.writeFile(filePath, value, 'utf-8')
    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('project-file-remove-text', async (_event, key: string) => {
  try {
    const filePath = resolveProjectFilePath(key)
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-skill-list', async () => {
  try {
    return await listStoredStudioSkillFiles({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
    })
  } catch (error) {
    console.warn('Failed to list studio skills:', error)
    return []
  }
})

ipcMain.handle('studio-skill-read-text', async (_event, relativePath: string) => {
  try {
    const skillsRoot = getSkillsRoot()
    await ensureStudioSkillsSynced({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: skillsRoot,
    })
    const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath)
    const content = await readStoredStudioSkillText(skillsRoot, relativePath)
    const filePath = targetPath
    return { success: true, content, filePath, storagePath: filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-skill-write-text', async (_event, relativePath: string, value: string) => {
  try {
    const skillsRoot = getSkillsRoot()
    await ensureStudioSkillsSynced({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: skillsRoot,
    })
    const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath)
    const stat = await writeStoredStudioSkillText(skillsRoot, relativePath, value)
    const filePath = targetPath
    return { success: true, filePath, storagePath: filePath, updatedAt: stat.mtimeMs }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-skill-create-text', async (_event, relativePath: string, value: string) => {
  try {
    const skillsRoot = getSkillsRoot()
    await ensureStudioSkillsSynced({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: skillsRoot,
    })
    const created = await createStoredStudioSkillFile(skillsRoot, relativePath, value)
    return { success: true, ...created }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-skill-delete-text', async (_event, relativePath: string) => {
  try {
    const deleted = await deleteStoredStudioSkillFile(getSkillsRoot(), relativePath)
    return { success: true, deleted }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-visual-manual-list', async () => {
  try {
    return await listStoredVisualManuals({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
      makeFileUrl: makeStudioSkillFileUrl,
    })
  } catch (error) {
    console.warn('Failed to list studio visual manuals:', error)
    return []
  }
})

ipcMain.handle('studio-visual-manual-read', async (_event, stylePath: string) => {
  try {
    const manual = await readStoredVisualManual({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
      makeFileUrl: makeStudioSkillFileUrl,
    }, stylePath)
    return { success: true, manual }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-visual-manual-write', async (_event, stylePath: string, payload: StudioVisualManualWritePayload) => {
  try {
    await ensureStudioSkillsSynced({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
    })
    await writeStoredVisualManual(getSkillsRoot(), stylePath, payload)
    const manual = await readStoredVisualManual({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
      makeFileUrl: makeStudioSkillFileUrl,
    }, stylePath)
    return { success: true, manual }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('studio-visual-manual-create', async (_event, payload: StudioVisualManualCreatePayload) => {
  try {
    await ensureStudioSkillsSynced({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
    })
    const stylePath = await createStoredVisualManual(getSkillsRoot(), payload)
    const manual = await readStoredVisualManual({
      sourceRoot: getStudioManualsSourceRoot(),
      storageRoot: getSkillsRoot(),
      makeFileUrl: makeStudioSkillFileUrl,
    }, stylePath)
    return { success: true, manual }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})
// ==================== Storage Manager ====================
ipcMain.handle('storage-get-paths', async () => {
  return {
    basePath: getStorageBasePath(),
    projectPath: getProjectDataRoot(),
    mediaPath: getMediaRoot(),
    skillsPath: getSkillsRoot(),
    cachePath: path.join(app.getPath('userData'), 'Cache'),
  }
})

ipcMain.handle('storage-select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

// Validate if a directory contains valid data (projects/, media/, or skills/)
ipcMain.handle('storage-validate-data-dir', async (_event, dirPath: string) => {
  try {
    if (!dirPath) return { valid: false, error: '路径不能为空' }
    const target = normalizePath(dirPath)
    if (!fs.existsSync(target)) return { valid: false, error: '目录不存在' }
    
    // Check for projects/ subfolder with .json files or _p/ per-project dirs
    const projectsDir = path.join(target, 'projects')
    const mediaDir = path.join(target, 'media')
    const skillsDir = path.join(target, 'skills')
    
    let projectCount = 0
    let mediaCount = 0
    let skillCount = 0
    
    if (fs.existsSync(projectsDir)) {
      const files = await fs.promises.readdir(projectsDir)
      // Count root .json files (global stores)
      projectCount = files.filter(f => f.endsWith('.json')).length
      // Also count per-project directories under _p/
      const perProjectDir = path.join(projectsDir, '_p')
      if (fs.existsSync(perProjectDir)) {
        const projectDirs = await fs.promises.readdir(perProjectDir, { withFileTypes: true })
        const dirCount = projectDirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).length
        if (dirCount > 0) projectCount = Math.max(projectCount, dirCount)
      }
    }
    
    if (fs.existsSync(mediaDir)) {
      const entries = await fs.promises.readdir(mediaDir)
      mediaCount = entries.length
    }

    if (fs.existsSync(skillsDir)) {
      const skillFiles = await listStoredStudioSkillFiles({
        sourceRoot: getStudioManualsSourceRoot(),
        storageRoot: skillsDir,
      })
      skillCount = skillFiles.length
    }
    
    if (projectCount === 0 && mediaCount === 0 && skillCount === 0) {
      return { valid: false, error: '该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）' }
    }
    
    return { valid: true, projectCount, mediaCount, skillCount }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
})

// Link to existing data directory (no data movement)
ipcMain.handle('storage-link-data', async (_event, dirPath: string) => {
  try {
    if (!dirPath) return { success: false, error: '路径不能为空' }
    const target = normalizePath(dirPath)
    if (!fs.existsSync(target)) return { success: false, error: '目录不存在' }
    
    // Validate it has data
    const projectsDir = path.join(target, 'projects')
    const mediaDir = path.join(target, 'media')
    const skillsDir = path.join(target, 'skills')
    
    const hasProjects = fs.existsSync(projectsDir)
    const hasMedia = fs.existsSync(mediaDir)
    const hasSkills = fs.existsSync(skillsDir)
    
    if (!hasProjects && !hasMedia && !hasSkills) {
      return { success: false, error: '该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）' }
    }
    
    // Update config to point to this directory
    storageConfig.basePath = target
    storageConfig.projectPath = '' // Clear legacy
    storageConfig.mediaPath = ''   // Clear legacy
    saveStorageConfig()
    return { success: true, path: target }
  } catch (error) {
    console.error('Failed to link data:', error)
    return { success: false, error: String(error) }
  }
})

// Move all data to new location (single operation)
ipcMain.handle('storage-move-data', async (_event, newPath: string) => {
  try {
    if (!newPath) return { success: false, error: '路径不能为空' }
    const target = normalizePath(newPath)
    const currentBase = getStorageBasePath()
    
    if (currentBase === target) return { success: true, path: currentBase }
    
    // Check for path conflicts
    const conflictError = pathsConflict(currentBase, target)
    if (conflictError) {
      return { success: false, error: conflictError }
    }
    
    // Ensure target directories exist
    const targetProjectsDir = path.join(target, 'projects')
    const targetMediaDir = path.join(target, 'media')
    const targetSkillsDir = path.join(target, 'skills')
    ensureDir(targetProjectsDir)
    ensureDir(targetMediaDir)
    ensureDir(targetSkillsDir)
    
    // Move projects
    const currentProjectsDir = getProjectDataRoot()
    if (fs.existsSync(currentProjectsDir)) {
      const files = await fs.promises.readdir(currentProjectsDir)
      for (const file of files) {
        const src = path.join(currentProjectsDir, file)
        const dest = path.join(targetProjectsDir, file)
        await fs.promises.cp(src, dest, { recursive: true, force: true })
      }
    }
    
    // Move media
    const currentMediaDir = getMediaRoot()
    if (fs.existsSync(currentMediaDir)) {
      const files = await fs.promises.readdir(currentMediaDir)
      for (const file of files) {
        const src = path.join(currentMediaDir, file)
        const dest = path.join(targetMediaDir, file)
        await fs.promises.cp(src, dest, { recursive: true, force: true })
      }
    }

    const currentSkillsDir = getSkillsRoot()
    if (fs.existsSync(currentSkillsDir)) {
      const files = await fs.promises.readdir(currentSkillsDir)
      for (const file of files) {
        const src = path.join(currentSkillsDir, file)
        const dest = path.join(targetSkillsDir, file)
        await fs.promises.cp(src, dest, { recursive: true, force: true })
      }
    }
    
    // Update config
    storageConfig.basePath = target
    storageConfig.projectPath = '' // Clear legacy
    storageConfig.mediaPath = ''   // Clear legacy
    saveStorageConfig()
    
    // Clean up old directories (only if different from userData)
    const userData = app.getPath('userData')
    if (!currentProjectsDir.startsWith(userData)) {
      await removeDir(currentProjectsDir).catch(() => {})
    }
    if (!currentMediaDir.startsWith(userData)) {
      await removeDir(currentMediaDir).catch(() => {})
    }
    if (!currentSkillsDir.startsWith(userData)) {
      await removeDir(currentSkillsDir).catch(() => {})
    }
    
    return { success: true, path: target }
  } catch (error) {
    console.error('Failed to move data:', error)
    return { success: false, error: String(error) }
  }
})

// Export all data
ipcMain.handle('storage-export-data', async (_event, targetPath: string) => {
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `moyin-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    
    // Create export structure
    const exportProjectsDir = path.join(exportDir, 'projects')
    const exportMediaDir = path.join(exportDir, 'media')
    const exportSkillsDir = path.join(exportDir, 'skills')
    ensureDir(exportProjectsDir)
    ensureDir(exportMediaDir)
    ensureDir(exportSkillsDir)
    
    // Copy projects
    await copyDir(getProjectDataRoot(), exportProjectsDir)
    // Copy media
    await copyDir(getMediaRoot(), exportMediaDir)
    // Copy editable skill copies
    await copyDir(getSkillsRoot(), exportSkillsDir)
    
    return { success: true, path: exportDir }
  } catch (error) {
    console.error('Failed to export data:', error)
    return { success: false, error: String(error) }
  }
})

// Import all data (with backup for safety)
ipcMain.handle('storage-import-data', async (_event, sourcePath: string) => {
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const source = normalizePath(sourcePath)
    
    const sourceProjectsDir = path.join(source, 'projects')
    const sourceMediaDir = path.join(source, 'media')
    const sourceSkillsDir = path.join(source, 'skills')
    
    // Validate source has data
    const hasProjects = fs.existsSync(sourceProjectsDir)
    const hasMedia = fs.existsSync(sourceMediaDir)
    const hasSkills = fs.existsSync(sourceSkillsDir)
    if (!hasProjects && !hasMedia && !hasSkills) {
      return { success: false, error: '源目录不包含有效数据（需要 projects/、media/ 或 skills/ 子目录）' }
    }
    
    // Create temporary backup for rollback
    const backupDir = path.join(os.tmpdir(), `moyin-backup-${Date.now()}`)
    const currentProjectsDir = getProjectDataRoot()
    const currentMediaDir = getMediaRoot()
    const currentSkillsDir = getSkillsRoot()
    
    try {
      // Backup existing data
      if (hasProjects && fs.existsSync(currentProjectsDir)) {
        const files = await fs.promises.readdir(currentProjectsDir)
        if (files.length > 0) {
          await copyDir(currentProjectsDir, path.join(backupDir, 'projects'))
        }
      }
      if (hasMedia && fs.existsSync(currentMediaDir)) {
        const files = await fs.promises.readdir(currentMediaDir)
        if (files.length > 0) {
          await copyDir(currentMediaDir, path.join(backupDir, 'media'))
        }
      }
      if (hasSkills && fs.existsSync(currentSkillsDir)) {
        const files = await fs.promises.readdir(currentSkillsDir)
        if (files.length > 0) {
          await copyDir(currentSkillsDir, path.join(backupDir, 'skills'))
        }
      }
      
      // Import new data
      if (hasProjects) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(sourceProjectsDir, currentProjectsDir)
      }
      if (hasMedia) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(sourceMediaDir, currentMediaDir)
      }
      if (hasSkills) {
        await removeDir(currentSkillsDir).catch(() => {})
        await copyDir(sourceSkillsDir, currentSkillsDir)
      }
      
      // Clear migration flag so migration re-evaluates imported data on next startup
      const migrationFlagPath = path.join(currentProjectsDir, '_p', '_migrated.json')
      if (fs.existsSync(migrationFlagPath)) {
        fs.unlinkSync(migrationFlagPath)
        console.log('Cleared migration flag for re-evaluation after import')
      }
      
      // Success - clean up backup
      await removeDir(backupDir).catch(() => {})
      return { success: true }
    } catch (importError) {
      // Rollback: restore from backup
      console.error('Import failed, rolling back:', importError)
      const backupProjectsDir = path.join(backupDir, 'projects')
      const backupMediaDir = path.join(backupDir, 'media')
      const backupSkillsDir = path.join(backupDir, 'skills')
      
      if (fs.existsSync(backupProjectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(backupProjectsDir, currentProjectsDir).catch(() => {})
      }
      if (fs.existsSync(backupMediaDir)) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(backupMediaDir, currentMediaDir).catch(() => {})
      }
      if (fs.existsSync(backupSkillsDir)) {
        await removeDir(currentSkillsDir).catch(() => {})
        await copyDir(backupSkillsDir, currentSkillsDir).catch(() => {})
      }
      await removeDir(backupDir).catch(() => {})
      
      throw importError
    }
  } catch (error) {
    console.error('Failed to import data:', error)
    return { success: false, error: String(error) }
  }
})

// Legacy handlers (kept for backward compatibility but redirect to new ones)
ipcMain.handle('storage-validate-project-dir', async (_event, dirPath: string) => {
  // Redirect to new unified handler
  return ipcMain.emit('storage-validate-data-dir', null, dirPath)
})

ipcMain.handle('storage-link-project-data', async (_event, dirPath: string) => {
  // For legacy: assume dirPath is the projects folder, use parent as base
  const target = normalizePath(dirPath)
  const basePath = path.dirname(target)
  storageConfig.basePath = basePath
  storageConfig.projectPath = ''
  storageConfig.mediaPath = ''
  saveStorageConfig()
  return { success: true, path: basePath }
})

ipcMain.handle('storage-link-media-data', async (_event, dirPath: string) => {
  // For legacy: assume dirPath is the media folder, use parent as base
  const target = normalizePath(dirPath)
  const basePath = path.dirname(target)
  storageConfig.basePath = basePath
  storageConfig.projectPath = ''
  storageConfig.mediaPath = ''
  saveStorageConfig()
  return { success: true, path: basePath }
})

ipcMain.handle('storage-move-project-data', async () => {
  return { success: false, error: '请使用新的统一存储路径功能' }
})
ipcMain.handle('storage-move-media-data', async () => {
  return { success: false, error: '请使用新的统一存储路径功能' }
})

ipcMain.handle('storage-export-project-data', async (_event, targetPath: string) => {
  // Redirect to unified export
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `moyin-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    ensureDir(path.join(exportDir, 'projects'))
    ensureDir(path.join(exportDir, 'media'))
    await copyDir(getProjectDataRoot(), path.join(exportDir, 'projects'))
    await copyDir(getMediaRoot(), path.join(exportDir, 'media'))
    return { success: true, path: exportDir }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-import-project-data', async (_event, sourcePath: string) => {
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const source = normalizePath(sourcePath)
    const projectsDir = path.join(source, 'projects')
    const mediaDir = path.join(source, 'media')

    const currentProjectsDir = getProjectDataRoot()
    const currentMediaDir = getMediaRoot()
    const backupDir = path.join(os.tmpdir(), `moyin-legacy-import-backup-${Date.now()}`)

    try {
      if (fs.existsSync(currentProjectsDir)) {
        const files = await fs.promises.readdir(currentProjectsDir)
        if (files.length > 0) {
          await copyDir(currentProjectsDir, path.join(backupDir, 'projects'))
        }
      }
      if (fs.existsSync(currentMediaDir)) {
        const files = await fs.promises.readdir(currentMediaDir)
        if (files.length > 0) {
          await copyDir(currentMediaDir, path.join(backupDir, 'media'))
        }
      }

      if (fs.existsSync(projectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(projectsDir, currentProjectsDir)
      } else {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(source, currentProjectsDir)
      }

      if (fs.existsSync(mediaDir)) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(mediaDir, currentMediaDir)
      }

      await removeDir(backupDir).catch(() => {})
      return { success: true }
    } catch (importError) {
      console.error('Legacy import failed, rolling back:', importError)
      const backupProjectsDir = path.join(backupDir, 'projects')
      const backupMediaDir = path.join(backupDir, 'media')

      if (fs.existsSync(backupProjectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {})
        await copyDir(backupProjectsDir, currentProjectsDir).catch(() => {})
      }
      if (fs.existsSync(backupMediaDir)) {
        await removeDir(currentMediaDir).catch(() => {})
        await copyDir(backupMediaDir, currentMediaDir).catch(() => {})
      }
      await removeDir(backupDir).catch(() => {})

      throw importError
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-export-media-data', async (_event, targetPath: string) => {
  // Legacy: redirect to unified export
  try {
    if (!targetPath) return { success: false, error: '路径不能为空' }
    const exportDir = path.join(
      normalizePath(targetPath),
      `moyin-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    ensureDir(path.join(exportDir, 'projects'))
    ensureDir(path.join(exportDir, 'media'))
    await copyDir(getProjectDataRoot(), path.join(exportDir, 'projects'))
    await copyDir(getMediaRoot(), path.join(exportDir, 'media'))
    return { success: true, path: exportDir }
  } catch (error) {
    console.error('Failed to export data:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-import-media-data', async (_event, sourcePath: string) => {
  try {
    if (!sourcePath) return { success: false, error: '路径不能为空' }
    const target = getMediaRoot()
    const source = normalizePath(sourcePath)
    if (source === target) return { success: true }

    const backupDir = path.join(os.tmpdir(), `moyin-media-import-backup-${Date.now()}`)

    try {
      if (fs.existsSync(target)) {
        const files = await fs.promises.readdir(target)
        if (files.length > 0) {
          await copyDir(target, backupDir)
        }
      }

      await removeDir(target)
      await copyDir(source, target)

      await removeDir(backupDir).catch(() => {})
      return { success: true }
    } catch (importError) {
      console.error('Media import failed, rolling back:', importError)
      if (fs.existsSync(backupDir)) {
        await removeDir(target).catch(() => {})
        await copyDir(backupDir, target).catch(() => {})
      }
      await removeDir(backupDir).catch(() => {})
      throw importError
    }
  } catch (error) {
    console.error('Failed to import media data:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-get-cache-size', async () => {
  const dirs = getCacheDirs()
  const details = await Promise.all(
    dirs.map(async (dirPath) => ({
      path: dirPath,
      size: await getDirectorySize(dirPath),
    }))
  )
  const total = details.reduce((sum, item) => sum + item.size, 0)
  return { total, details }
})

ipcMain.handle('storage-clear-cache', async (_event, options?: { olderThanDays?: number }) => {
  try {
    const clearedBytes = await clearCache(options?.olderThanDays)
    return { success: true, clearedBytes }
  } catch (error) {
    console.error('Failed to clear cache:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('storage-update-config', async (_event, config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) => {
  storageConfig = { ...storageConfig, ...config }
  saveStorageConfig()
  scheduleAutoClean()
  return true
})

ipcMain.handle('app-updater-get-current-version', async () => {
  return app.getVersion()
})

ipcMain.handle('app-updater-check', async (): Promise<UpdateCheckResult> => {
  const currentVersion = app.getVersion()
  try {
    const update = await resolveAvailableUpdate(currentVersion)
    return {
      success: true,
      currentVersion,
      hasUpdate: !!update,
      update,
    }
  } catch (error) {
    console.error('Failed to check updates:', error)
    return {
      success: false,
      currentVersion,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

ipcMain.handle('app-updater-open-link', async (_event, url: string): Promise<OpenExternalResult> => {
  const safeUrl = sanitizeExternalUrl(url)
  if (!safeUrl) {
    return { success: false, error: '无效下载链接' }
  }

  try {
    await shell.openExternal(safeUrl)
    return { success: true }
  } catch (error) {
    console.error('Failed to open external link:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

ipcMain.handle('app-devtools-open', async (event): Promise<{ success: boolean; error?: string }> => {
  try {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (!targetWindow) {
      return { success: false, error: '未找到当前窗口' }
    }

    targetWindow.webContents.openDevTools({ mode: 'detach' })
    return { success: true }
  } catch (error) {
    console.error('Failed to open DevTools:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

ipcMain.handle('app-open-path', async (_event, targetPath: string): Promise<{ success: boolean; error?: string }> => {
  if (!isNonEmptyString(targetPath) || targetPath.includes('\0')) {
    return { success: false, error: '无效文件路径' }
  }

  try {
    const resolvedPath = resolveStudioSourcePath(targetPath)
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '文件不存在' }
    }
    const error = await shell.openPath(resolvedPath)
    return error ? { success: false, error } : { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('api-model-test', async (_event, payload: ModelTestRequest): Promise<ModelTestResult> => {
  return runModelTestRequest(payload, fetch)
})

ipcMain.handle('api-text-completion', async (_event, payload: TextCompletionRequest): Promise<TextCompletionResult> => {
  return runTextCompletionRequest(payload, fetch)
})

// ==================== File Export (Save Dialog) ====================
ipcMain.handle('save-file-dialog', async (_event, { localPath, defaultPath, filters }: { localPath: string, defaultPath: string, filters: { name: string, extensions: string[] }[] }) => {
  try {
    // Resolve the source file path
    let sourcePath: string | null = null
    
    // Handle local-image:// and local-video:// protocols
    const imageMatch = localPath.match(/^local-image:\/\/(.+)\/(.+)$/)
    const videoMatch = localPath.match(/^local-video:\/\/(.+)\/(.+)$/)
    
    if (imageMatch) {
      const [, category, filename] = imageMatch
      sourcePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (videoMatch) {
      const [, category, filename] = videoMatch
      sourcePath = path.join(getMediaRoot(), category, decodeURIComponent(filename))
    } else if (localPath.startsWith('file://')) {
      sourcePath = localPath.replace('file://', '')
    } else {
      sourcePath = localPath
    }
    
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { success: false, error: 'Source file not found' }
    }
    
    // Show save dialog
    const result = await dialog.showSaveDialog({
      defaultPath: defaultPath,
      filters: filters,
    })
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    
    // Copy file to destination
    fs.copyFileSync(sourcePath, result.filePath)
    
    return { success: true, filePath: result.filePath }
  } catch (error) {
    console.error('Failed to save file:', error)
    return { success: false, error: String(error) }
  }
})

// ==================== Manying Studio Local FFmpeg Renderer ====================
function getStudioRenderRoot() {
  const base = path.join(getMediaRoot(), 'studio-render')
  ensureDir(base)
  return base
}

function getStudioAssetsRoot() {
  const base = path.join(getMediaRoot(), 'studio-assets')
  ensureDir(base)
  return base
}

function createStudioRenderName(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}.mp4`
}

function sanitizeStudioFilename(name: string) {
  const ext = path.extname(name).toLowerCase() || '.bin'
  const base = path.basename(name, ext)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'material'
  return `${base}-${crypto.randomUUID()}${ext}`
}

function resolveStudioSourcePath(sourcePath: string) {
  if (sourcePath.startsWith('file://')) return sourcePath.replace('file://', '')
  const localMatch = sourcePath.match(/^local-image:\/\/([^/]+)\/(.+)$/)
  if (localMatch) {
    return path.join(getMediaRoot(), localMatch[1], decodeURIComponent(localMatch[2]))
  }
  return sourcePath
}

function ensureReadableStudioSource(sourcePath: string) {
  const resolved = resolveStudioSourcePath(sourcePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`素材不存在: ${sourcePath}`)
  }
  return resolved
}

function srtTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const h = Math.floor(safeSeconds / 3600)
  const m = Math.floor((safeSeconds % 3600) / 60)
  const s = Math.floor(safeSeconds % 60)
  const ms = Math.floor((safeSeconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function escapeSubtitlePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

async function assertFfmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { maxBuffer: 1024 * 1024 })
  } catch {
    throw new Error('未找到本地 ffmpeg，请先安装 ffmpeg 并确保命令行可访问')
  }
}

async function renderStudioSegment(input: TrackRenderInput, outputPath: string) {
  const sourcePath = ensureReadableStudioSource(input.sourcePath)
  const duration = Math.max(0.2, Number(input.duration) || 5)
  const videoFilter = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p'

  if (input.sourceKind === 'image') {
    await execFileAsync('ffmpeg', [
      '-loop', '1',
      '-t', String(duration),
      '-i', sourcePath,
      '-f', 'lavfi',
      '-t', String(duration),
      '-i', 'anullsrc=r=44100:cl=stereo',
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-y', outputPath,
    ], { maxBuffer: 50 * 1024 * 1024 })
    return
  }

  await execFileAsync('ffmpeg', [
    '-i', sourcePath,
    '-f', 'lavfi',
    '-t', String(duration),
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-t', String(duration),
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-y', outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 })
}

async function concatStudioVideos(inputs: string[], outputPath: string, tmpDir: string) {
  const listPath = path.join(tmpDir, 'concat.txt')
  const listContent = inputs
    .map((filePath) => `file '${resolveStudioSourcePath(filePath).replace(/'/g, "'\\''")}'`)
    .join('\n')
  await fs.promises.writeFile(listPath, listContent, 'utf-8')
  await execFileAsync('ffmpeg', [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-fflags', '+genpts',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 })
}

async function burnStudioSubtitle(inputPath: string, outputPath: string, subtitleText: string, duration: number, tmpDir: string) {
  const srtPath = path.join(tmpDir, 'subtitle.srt')
  const content = `1\n${srtTime(0.2)} --> ${srtTime(Math.max(0.3, duration - 0.2))}\n${subtitleText}\n\n`
  await fs.promises.writeFile(srtPath, content, 'utf-8')
  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-vf', `subtitles='${escapeSubtitlePath(srtPath)}':force_style='FontSize=24,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,Outline=2,Alignment=2'`,
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 })
}

ipcMain.handle('studio-render-track-candidate', async (_event, plan: TrackRenderPlan) => {
  const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto.randomUUID()}`)
  await fs.promises.mkdir(tmpDir, { recursive: true })

  try {
    await assertFfmpegAvailable()
    if (!plan.inputs.length) throw new Error('没有可渲染的 track 输入素材')

    const outputName = createStudioRenderName('track')
    const outputPath = path.join(getStudioRenderRoot(), outputName)
    const segmentPaths: string[] = []

    for (const [index, input] of plan.inputs.entries()) {
      const segmentPath = path.join(tmpDir, `segment-${String(index + 1).padStart(3, '0')}.mp4`)
      await renderStudioSegment(input, segmentPath)
      segmentPaths.push(segmentPath)
    }

    const rawPath = path.join(tmpDir, 'raw.mp4')
    if (segmentPaths.length === 1) {
      await fs.promises.copyFile(segmentPaths[0], rawPath)
    } else {
      await concatStudioVideos(segmentPaths, rawPath, tmpDir)
    }

    if (plan.subtitleText?.trim()) {
      await burnStudioSubtitle(rawPath, outputPath, plan.subtitleText.trim(), plan.duration, tmpDir)
    } else {
      await fs.promises.copyFile(rawPath, outputPath)
    }

    return {
      success: true,
      filePath: outputPath,
      previewUrl: `local-image://studio-render/${outputName}`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
})

ipcMain.handle('studio-save-material', async (_event, payload: StudioSaveMaterialPayload) => {
  try {
    const filename = sanitizeStudioFilename(payload.name)
    const filePath = path.join(getStudioAssetsRoot(), filename)
    const buffer = Buffer.from(payload.bytes instanceof Uint8Array ? payload.bytes : new Uint8Array(payload.bytes))

    if (buffer.length === 0) {
      return { success: false, error: '素材文件为空' }
    }

    await fs.promises.writeFile(filePath, buffer)
    return {
      success: true,
      localPath: `local-image://studio-assets/${filename}`,
      filePath,
      size: buffer.length,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('tts-runtime-status', async () => ttsRuntimeController.status())

ipcMain.handle('tts-runtime-start', async () => ttsRuntimeController.start())

ipcMain.handle('tts-runtime-stop', async () => ttsRuntimeController.stop())

ipcMain.handle('tts-runtime-request', async (_event, payload: { method: string; path: string; body?: unknown }) => (
  ttsRuntimeController.request(payload.method, payload.path, payload.body)
))

ipcMain.handle('studio-merge-episode', async (_event, plan: EpisodeMergePlan) => {
  const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto.randomUUID()}`)
  await fs.promises.mkdir(tmpDir, { recursive: true })

  try {
    await assertFfmpegAvailable()
    if (!plan.inputs.length) throw new Error('没有可拼接的视频输入')
    plan.inputs.forEach(ensureReadableStudioSource)

    const outputName = createStudioRenderName('episode')
    const outputPath = path.join(getStudioRenderRoot(), outputName)
    await concatStudioVideos(plan.inputs, outputPath, tmpDir)

    return {
      success: true,
      filePath: outputPath,
      previewUrl: `local-image://studio-render/${outputName}`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
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
    scheme: 'studio-skill',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    }
  },
])

app.whenReady().then(() => {
  scheduleAutoClean()
  // Handle local-image:// protocol
  protocol.handle('local-image', async (request) => {
    try {
      // URL format: local-image://category/filename
      const url = new URL(request.url)
      const category = url.hostname
      const filename = decodeURIComponent(url.pathname.slice(1)) // Remove leading / and decode
      const filePath = path.join(getMediaRoot(), category, filename)
      
      // Read file directly
      const data = fs.readFileSync(filePath)
      
      // Determine MIME type based on extension
      const ext = path.extname(filename).toLowerCase()
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
