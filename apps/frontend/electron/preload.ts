// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron'
import type { ModelTestRequest, ModelTestResult } from '../lib/api-manager/model-test'
import type { TextCompletionRequest, TextCompletionResult } from '../lib/api-manager/text-completion'
import type { ImageRequestPayload, ImageRequestResult } from '../types/api-image-request'
import type { DiagnosticsLogEntryInput, DiagnosticsLogQuery } from '../types/diagnostics'
import type {
  TimelineRenderCancelResult,
  TimelineRenderPlan,
  TimelineRenderProgress,
  TimelineRenderResult,
} from '../types/editing'
import type { StudioVisualManualCreatePayload, StudioVisualManualImagesWritePayload, StudioVisualManualWritePayload } from '../types/studio-visual-manual'
import type { TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeStatus } from '../types/tts'
import type { UpdateCheckOptions } from '../types/update'

contextBridge.exposeInMainWorld('appEvents', {
  onMainProcessMessage(listener: (message: string) => void) {
    const wrapped = (_event: IpcRendererEvent, message: string) => listener(message)
    ipcRenderer.on('main-process-message', wrapped)
    return () => ipcRenderer.removeListener('main-process-message', wrapped)
  },
})

contextBridge.exposeInMainWorld('mystudioSmoke', {
  enabled: process.env.MYSTUDIO_SMOKE === '1',
  userDataDir: process.argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? '',
})

contextBridge.exposeInMainWorld('diagnosticsLog', {
  write: (entry: DiagnosticsLogEntryInput) => ipcRenderer.invoke('diagnostics-log-write', entry),
  query: (query?: DiagnosticsLogQuery) => ipcRenderer.invoke('diagnostics-log-query', query),
  getInfo: () => ipcRenderer.invoke('diagnostics-log-get-info'),
  openFolder: () => ipcRenderer.invoke('diagnostics-log-open-folder'),
  exportBundle: () => ipcRenderer.invoke('diagnostics-log-export-bundle'),
  clear: () => ipcRenderer.invoke('diagnostics-log-clear'),
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

  // Move a local media file into another storage category
  moveImage: (localPath: string, category: string) =>
    ipcRenderer.invoke('move-image', { localPath, category }),
  
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
  renameItem: (fromKey: string, toKey: string) => ipcRenderer.invoke('file-storage-rename', fromKey, toKey),
  exists: (key: string) => ipcRenderer.invoke('file-storage-exists', key),
  listKeys: (prefix: string) => ipcRenderer.invoke('file-storage-list', prefix),
  listDirs: (prefix: string) => ipcRenderer.invoke('file-storage-list-dirs', prefix),
  removeDir: (prefix: string) => ipcRenderer.invoke('file-storage-remove-dir', prefix),
})

contextBridge.exposeInMainWorld('projectFiles', {
  writeText: (key: string, value: string) => ipcRenderer.invoke('project-file-write-text', key, value),
  writeBinary: (payload: { projectId: string; relativePath: string; bytes: ArrayBuffer }) =>
    ipcRenderer.invoke('project-file-write-binary', payload),
  saveImage: (payload: { projectId: string; relativePath: string; source: string }) =>
    ipcRenderer.invoke('project-file-save-image', payload),
  readAsBase64: (url: string) => ipcRenderer.invoke('project-file-read-base64', url),
  getAbsolutePath: (url: string) => ipcRenderer.invoke('project-file-get-absolute-path', url),
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
  list: (options?: { refresh?: boolean }) => ipcRenderer.invoke('studio-visual-manual-list', options),
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
  imageRequest: (payload: ImageRequestPayload): Promise<ImageRequestResult> => ipcRenderer.invoke('api-image-request', payload),
  textCompletionStream: (payload: TextCompletionRequest, onChunk: (delta: string) => void): Promise<TextCompletionResult> => {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = `api-text-stream:${streamId}`
    const listener = (_event: IpcRendererEvent, delta: string) => onChunk(delta)
    ipcRenderer.on(channel, listener)
    return ipcRenderer.invoke('api-text-completion-stream', { payload, streamId }).finally(() => {
      ipcRenderer.removeListener(channel, listener)
    })
  },
})

contextBridge.exposeInMainWorld('appUpdater', {
  getCurrentVersion: () => ipcRenderer.invoke('app-updater-get-current-version'),
  checkForUpdates: (options?: UpdateCheckOptions) => ipcRenderer.invoke('app-updater-check', options),
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
  probeMedia: (filePath: string) => ipcRenderer.invoke('studio-probe-media-evidence', filePath),
  renderTimeline: (plan: TimelineRenderPlan): Promise<TimelineRenderResult> =>
    ipcRenderer.invoke('studio-timeline-render', plan),
  cancelTimelineRender: (jobId: string): Promise<TimelineRenderCancelResult> =>
    ipcRenderer.invoke('studio-timeline-render-cancel', jobId),
  onTimelineRenderProgress(listener: (progress: TimelineRenderProgress) => void) {
    const wrapped = (_event: IpcRendererEvent, progress: TimelineRenderProgress) => listener(progress)
    ipcRenderer.on('studio-timeline-render-progress', wrapped)
    return () => ipcRenderer.removeListener('studio-timeline-render-progress', wrapped)
  },
})

contextBridge.exposeInMainWorld('studioAssets', {
  saveMaterial: (payload: { name: string; bytes: ArrayBuffer }) => ipcRenderer.invoke('studio-save-material', payload),
  list: (payload: unknown) => ipcRenderer.invoke('assets:list', payload),
  get: (id: string) => ipcRenderer.invoke('assets:get', id),
  update: (payload: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke('assets:update', payload),
  delete: (id: string) => ipcRenderer.invoke('assets:delete', id),
  add: (payload: { type: string; name: string; sourceFilePath?: string; description?: string; prompt?: string; setting?: string }) => ipcRenderer.invoke('assets:add', payload),
  addImage: (payload: { assetId: string; imageName: string; sourceFilePath: string }) => ipcRenderer.invoke('assets:add-image', payload),
  replaceImage: (payload: { assetId: string; sourceFilePath: string }) => ipcRenderer.invoke('assets:replace-image', payload),
  removeImage: (payload: { assetId: string; imageFilePath: string }) => ipcRenderer.invoke('assets:remove-image', payload),
  renameImage: (payload: { assetId: string; imageFilePath: string; newName: string }) => ipcRenderer.invoke('assets:rename-image', payload),
  selectImageFile: () => ipcRenderer.invoke('assets:select-image-file'),
  importFromToonflow: (payload: { type: string }) => ipcRenderer.invoke('assets:import-from-toonflow', payload),
  getByName: (payload: { type: string; name: string }) => ipcRenderer.invoke('assets:get-by-name', payload),
  batchMatch: (payload: { type: string; names: string[] }) => ipcRenderer.invoke('assets:batch-match', payload),
})

contextBridge.exposeInMainWorld('ttsRuntime', {
  status: (): Promise<TtsRuntimeStatus> => ipcRenderer.invoke('tts-runtime-status'),
  start: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-start'),
  setup: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-setup'),
  stop: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-stop'),
  getConfig: (): Promise<TtsRuntimeConfig> => ipcRenderer.invoke('tts-runtime-get-config'),
  setConfig: (config: Partial<TtsRuntimeConfig>): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-set-config', config),
  setModelCacheDir: (dirPath: string): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-set-model-cache-dir', dirPath),
  request: (payload: { method: string; path: string; body?: unknown }): Promise<unknown> =>
    ipcRenderer.invoke('tts-runtime-request', payload),
  requestBytes: (payload: { method: string; path: string; body?: unknown }): Promise<{ data: ArrayBuffer; mimeType?: string }> =>
    ipcRenderer.invoke('tts-runtime-request-bytes', payload),
  requestFormData: (payload: { path: string; audioFilePath: string; referenceText?: string }): Promise<unknown> =>
    ipcRenderer.invoke('tts-runtime-request-formdata', payload),
  resolveReferenceAudioPath: (audioPath: string): Promise<string | null> =>
    ipcRenderer.invoke('tts-reference-audio-resolve', audioPath),
})
