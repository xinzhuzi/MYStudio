// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { ipcRenderer, contextBridge } from 'electron'
import type { ModelTestRequest, ModelTestResult } from '../lib/api-manager/model-test'
import type { TextCompletionRequest, TextCompletionResult } from '../lib/api-manager/text-completion'
import type { StudioVisualManualCreatePayload, StudioVisualManualImagesWritePayload, StudioVisualManualWritePayload } from '../types/studio-visual-manual'
import type { TtsRuntimeCommandResult, TtsRuntimeStatus } from '../types/tts'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Image storage API
contextBridge.exposeInMainWorld('imageStorage', {
  // Save image from URL to local storage
  saveImage: (url: string, category: string, filename: string) => 
    ipcRenderer.invoke('save-image', { url, category, filename }),
  
  // Get actual file path for a local-image:// URL
  getImagePath: (localPath: string) => 
    ipcRenderer.invoke('get-image-path', localPath),
  
  // Delete a locally stored image
  deleteImage: (localPath: string) => 
    ipcRenderer.invoke('delete-image', localPath),
  
  // Read local image as base64 (for AI API calls like video generation)
  readAsBase64: (localPath: string) => 
    ipcRenderer.invoke('read-image-base64', localPath),
  
  // Get absolute file path (for local video generation tools like FFmpeg)
  getAbsolutePath: (localPath: string) => 
    ipcRenderer.invoke('get-absolute-path', localPath),
})

// File storage API for app data (unlimited size)
contextBridge.exposeInMainWorld('fileStorage', {
  getItem: (key: string) => ipcRenderer.invoke('file-storage-get', key),
  setItem: (key: string, value: string) => ipcRenderer.invoke('file-storage-set', key, value),
  removeItem: (key: string) => ipcRenderer.invoke('file-storage-remove', key),
  exists: (key: string) => ipcRenderer.invoke('file-storage-exists', key),
  listKeys: (prefix: string) => ipcRenderer.invoke('file-storage-list', prefix),
  listDirs: (prefix: string) => ipcRenderer.invoke('file-storage-list-dirs', prefix),
  removeDir: (prefix: string) => ipcRenderer.invoke('file-storage-remove-dir', prefix),
})

contextBridge.exposeInMainWorld('projectFiles', {
  writeText: (key: string, value: string) => ipcRenderer.invoke('project-file-write-text', key, value),
  removeText: (key: string) => ipcRenderer.invoke('project-file-remove-text', key),
})

contextBridge.exposeInMainWorld('studioSkills', {
  list: () => ipcRenderer.invoke('studio-skill-list'),
  readText: (relativePath: string) => ipcRenderer.invoke('studio-skill-read-text', relativePath),
  writeText: (relativePath: string, value: string) => ipcRenderer.invoke('studio-skill-write-text', relativePath, value),
  createText: (relativePath: string, value: string) => ipcRenderer.invoke('studio-skill-create-text', relativePath, value),
  deleteText: (relativePath: string) => ipcRenderer.invoke('studio-skill-delete-text', relativePath),
  restoreText: (relativePath: string) => ipcRenderer.invoke('studio-skill-restore-text', relativePath),
})

contextBridge.exposeInMainWorld('studioVisualManuals', {
  list: () => ipcRenderer.invoke('studio-visual-manual-list'),
  read: (stylePath: string) => ipcRenderer.invoke('studio-visual-manual-read', stylePath),
  write: (stylePath: string, payload: StudioVisualManualWritePayload) =>
    ipcRenderer.invoke('studio-visual-manual-write', stylePath, payload),
  writeImages: (stylePath: string, payload: StudioVisualManualImagesWritePayload) =>
    ipcRenderer.invoke('studio-visual-manual-write-images', stylePath, payload),
  create: (payload: StudioVisualManualCreatePayload) =>
    ipcRenderer.invoke('studio-visual-manual-create', payload),
  duplicate: (payload: { sourceStylePath: string; name: string; stylePath: string; projectId?: string }) =>
    ipcRenderer.invoke('studio-visual-manual-duplicate', payload),
})
// Storage manager API for paths, cache, import/export
contextBridge.exposeInMainWorld('storageManager', {
  getPaths: () => ipcRenderer.invoke('storage-get-paths'),
  selectDirectory: () => ipcRenderer.invoke('storage-select-directory'),
  // Unified storage operations (single base path)
  validateDataDir: (dirPath: string) => ipcRenderer.invoke('storage-validate-data-dir', dirPath),
  moveData: (newPath: string) => ipcRenderer.invoke('storage-move-data', newPath),
  linkData: (dirPath: string) => ipcRenderer.invoke('storage-link-data', dirPath),
  exportData: (targetPath: string) => ipcRenderer.invoke('storage-export-data', targetPath),
  importData: (sourcePath: string) => ipcRenderer.invoke('storage-import-data', sourcePath),
  // Cache
  getCacheSize: () => ipcRenderer.invoke('storage-get-cache-size'),
  clearCache: (options?: { olderThanDays?: number }) => ipcRenderer.invoke('storage-clear-cache', options),
  updateConfig: (config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) =>
    ipcRenderer.invoke('storage-update-config', config),
})

// Electron API for native features
contextBridge.exposeInMainWorld('electronAPI', {
  saveFileDialog: (options: { localPath: string, defaultPath: string, filters: { name: string, extensions: string[] }[] }) =>
    ipcRenderer.invoke('save-file-dialog', options),
  openPath: (targetPath: string) => ipcRenderer.invoke('app-open-path', targetPath),
  openDevTools: () => ipcRenderer.invoke('app-devtools-open'),
  testModel: (payload: ModelTestRequest): Promise<ModelTestResult> => ipcRenderer.invoke('api-model-test', payload),
  textCompletion: (payload: TextCompletionRequest): Promise<TextCompletionResult> => ipcRenderer.invoke('api-text-completion', payload),
})

contextBridge.exposeInMainWorld('appUpdater', {
  getCurrentVersion: () => ipcRenderer.invoke('app-updater-get-current-version'),
  checkForUpdates: () => ipcRenderer.invoke('app-updater-check'),
  openExternalLink: (url: string) => ipcRenderer.invoke('app-updater-open-link', url),
})

contextBridge.exposeInMainWorld('imageHostUploader', {
  upload: (payload: {
    provider: {
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
    apiKey: string
    imageData: string
    options?: {
      name?: string
      expiration?: number
    }
  }) => ipcRenderer.invoke('image-host-upload', payload),
})

contextBridge.exposeInMainWorld('studioRenderer', {
  renderTrackCandidate: (plan: unknown) => ipcRenderer.invoke('studio-render-track-candidate', plan),
  mergeEpisode: (plan: unknown) => ipcRenderer.invoke('studio-merge-episode', plan),
})

contextBridge.exposeInMainWorld('studioAssets', {
  saveMaterial: (payload: { name: string; bytes: ArrayBuffer }) => ipcRenderer.invoke('studio-save-material', payload),
  list: (payload: unknown) => ipcRenderer.invoke('assets:list', payload),
  get: (id: string) => ipcRenderer.invoke('assets:get', id),
  update: (payload: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke('assets:update', payload),
  addImage: (payload: { assetId: string; imageName: string; sourceFilePath: string }) => ipcRenderer.invoke('assets:add-image', payload),
  removeImage: (payload: { assetId: string; imageFilePath: string }) => ipcRenderer.invoke('assets:remove-image', payload),
  renameImage: (payload: { assetId: string; imageFilePath: string; newName: string }) => ipcRenderer.invoke('assets:rename-image', payload),
  selectImageFile: () => ipcRenderer.invoke('assets:select-image-file'),
  importFromToonflow: (payload: { type: string }) => ipcRenderer.invoke('assets:import-from-toonflow', payload),
})

contextBridge.exposeInMainWorld('ttsRuntime', {
  status: (): Promise<TtsRuntimeStatus> => ipcRenderer.invoke('tts-runtime-status'),
  start: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-start'),
  stop: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-stop'),
  setModelCacheDir: (dirPath: string): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-set-model-cache-dir', dirPath),
  request: (payload: { method: string; path: string; body?: unknown }): Promise<unknown> =>
    ipcRenderer.invoke('tts-runtime-request', payload),
})
