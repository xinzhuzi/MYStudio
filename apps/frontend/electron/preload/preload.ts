import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron'
// c6ece0e 拆分后 vite 构建入口仍只有本文件:不引回 runtime 侧,其 29 个桥
// (ttsRuntime/studioAssets/mystudioSmoke/imageGenRuntime 生命周期等)整体缺席
// 打包产物。两侧桥名零交集,side-effect 装配安全。
import './preload-runtime'
import type { ModelTestRequest, ModelTestResult } from '../../lib/ai/model-test'
import type { TextCompletionRequest, TextCompletionResult } from '../../lib/ai/text-completion'
import type { ImageRequestPayload, ImageRequestResult } from '../../types/api-image-request'
import type { DiagnosticsLogEntryInput, DiagnosticsLogQuery } from '../../types/diagnostics'
import type { StudioVisualManualCreatePayload, StudioVisualManualImagesWritePayload, StudioVisualManualWritePayload } from '../../types/studio-visual-manual'
import type { UpdateCheckOptions } from '../../types/update'

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

contextBridge.exposeInMainWorld('sourceMemory', {
  build: (projectId: string) => ipcRenderer.invoke('source-memory-build', projectId),
  search: (projectId: string, query: string, limit?: number) =>
    ipcRenderer.invoke('source-memory-search', projectId, query, limit),
  status: (projectId: string) => ipcRenderer.invoke('source-memory-status', projectId),
  stageRecords: (projectId: string, buildId: string, records: unknown[]) =>
    ipcRenderer.invoke('source-memory-stage-records', projectId, buildId, records),
  commitBuild: (projectId: string, payload: { buildId: string; coverage?: Array<{ sourcePath: string; anchor: string; ok: boolean }> }) =>
    ipcRenderer.invoke('source-memory-commit-build', projectId, payload),
  rebuildIndex: (projectId: string) => ipcRenderer.invoke('source-memory-rebuild-index', projectId),
})

contextBridge.exposeInMainWorld('projectFiles', {
  writeText: (key: string, value: string) => ipcRenderer.invoke('project-file-write-text', key, value),
  writeBinary: (payload: { projectId: string; relativePath: string; bytes: ArrayBuffer }) =>
    ipcRenderer.invoke('project-file-write-binary', payload),
  saveImage: (payload: { projectId: string; relativePath: string; source: string }) =>
    ipcRenderer.invoke('project-file-save-image', payload),
  readAsBase64: (url: string) => ipcRenderer.invoke('project-file-read-base64', url),
  readText: (payload: { projectId: string; relativePath: string }) =>
    ipcRenderer.invoke('project-file-read-text', payload),
  list: (payload: { projectId: string; relativePath: string }) =>
    ipcRenderer.invoke('project-file-list', payload),
  getAbsolutePath: (url: string) => ipcRenderer.invoke('project-file-get-absolute-path', url),
  move: (payload: { projectId: string; fromRelative: string; toRelative: string }) =>
    ipcRenderer.invoke('project-file-move', payload),
  removeText: (key: string) => ipcRenderer.invoke('project-file-remove-text', key),
})

// Image header size probing — dimensions only, never transfers image data
// (resolution badges must not pull multi-MB originals into the renderer).
contextBridge.exposeInMainWorld('imageProbe', {
  size: (url: string) => ipcRenderer.invoke('image-probe-size', url),
})

// Per-project external folder lifecycle (create/rename/remove/status + phase-2 move/import).
// Move progress is pushed main→renderer on 'project-folder-move-progress' (one
// payload per project move); the wrapper style mirrors selfMedia.onProgress.
type ProjectFolderMoveProgressPayload = {
  projectId: string
  phase: 'copying' | 'verifying' | 'finalizing'
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
}

contextBridge.exposeInMainWorld('projectFolder', {
  prepare: (projectId: string, parentDir: string, projectName: string) =>
    ipcRenderer.invoke('project-folder-prepare', projectId, parentDir, projectName),
  rename: (projectId: string, newName: string) =>
    ipcRenderer.invoke('project-folder-rename', projectId, newName),
  remove: (projectId: string) => ipcRenderer.invoke('project-folder-remove', projectId),
  status: (projectId: string) => ipcRenderer.invoke('project-folder-status', projectId),
  copyNovel: (sourceProjectId: string, targetProjectId: string) =>
    ipcRenderer.invoke('project-folder-copy-novel', sourceProjectId, targetProjectId),
  move: (projectId: string, projectName: string, targetParentDir: string) =>
    ipcRenderer.invoke('project-folder-move', projectId, projectName, targetParentDir),
  cancelMove: (projectId: string) =>
    ipcRenderer.invoke('project-folder-move-cancel', projectId),
  importFolder: (folderPath: string) =>
    ipcRenderer.invoke('project-folder-import', folderPath),
  onMoveProgress(listener: (progress: ProjectFolderMoveProgressPayload) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: ProjectFolderMoveProgressPayload) => listener(payload)
    ipcRenderer.on('project-folder-move-progress', wrapped)
    return () => ipcRenderer.removeListener('project-folder-move-progress', wrapped)
  },
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
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('storage-select-directory', defaultPath),
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
  showItemInFolder: (targetPath: string) => ipcRenderer.invoke('app-show-in-folder', targetPath),
  openDevTools: () => ipcRenderer.invoke('app-devtools-open'),
  hyperFramesRegistryDepsCheck: (): Promise<{ installed: boolean; installedCount: number; totalCount: number }> =>
    ipcRenderer.invoke('hy-registry-deps-check'),
  hyperFramesRegistryDepsDownload: (): Promise<{ success: boolean; downloaded: number; failed: string[] }> =>
    ipcRenderer.invoke('hy-registry-deps-download'),
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
  probeMedia: (filePath: string) => ipcRenderer.invoke('studio-probe-media-evidence', filePath),
})

