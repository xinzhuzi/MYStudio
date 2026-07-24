"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("appEvents", {
  onMainProcessMessage(listener) {
    const wrapped = (_event, message) => listener(message);
    electron.ipcRenderer.on("main-process-message", wrapped);
    return () => electron.ipcRenderer.removeListener("main-process-message", wrapped);
  }
});
electron.contextBridge.exposeInMainWorld("mystudioSmoke", {
  enabled: process.env.MYSTUDIO_SMOKE === "1",
  userDataDir: process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length) ?? ""
});
electron.contextBridge.exposeInMainWorld("diagnosticsLog", {
  write: (entry) => electron.ipcRenderer.invoke("diagnostics-log-write", entry),
  query: (query) => electron.ipcRenderer.invoke("diagnostics-log-query", query),
  getInfo: () => electron.ipcRenderer.invoke("diagnostics-log-get-info"),
  openFolder: () => electron.ipcRenderer.invoke("diagnostics-log-open-folder"),
  exportBundle: () => electron.ipcRenderer.invoke("diagnostics-log-export-bundle"),
  clear: () => electron.ipcRenderer.invoke("diagnostics-log-clear")
});
electron.contextBridge.exposeInMainWorld("imageStorage", {
  // Save image from URL to local storage
  saveImage: (url, category, filename) => electron.ipcRenderer.invoke("save-image", { url, category, filename }),
  // Get actual file path for a local-image:// URL
  getImagePath: (localPath) => electron.ipcRenderer.invoke("get-image-path", localPath),
  // Delete a locally stored image
  deleteImage: (localPath) => electron.ipcRenderer.invoke("delete-image", localPath),
  // Move a local media file into another storage category
  moveImage: (localPath, category) => electron.ipcRenderer.invoke("move-image", { localPath, category }),
  // Read local image as base64 (for AI API calls like video generation)
  readAsBase64: (localPath) => electron.ipcRenderer.invoke("read-image-base64", localPath),
  // Get absolute file path (for local video generation tools like FFmpeg)
  getAbsolutePath: (localPath) => electron.ipcRenderer.invoke("get-absolute-path", localPath)
});
electron.contextBridge.exposeInMainWorld("fileStorage", {
  getItem: (key) => electron.ipcRenderer.invoke("file-storage-get", key),
  setItem: (key, value) => electron.ipcRenderer.invoke("file-storage-set", key, value),
  removeItem: (key) => electron.ipcRenderer.invoke("file-storage-remove", key),
  renameItem: (fromKey, toKey) => electron.ipcRenderer.invoke("file-storage-rename", fromKey, toKey),
  exists: (key) => electron.ipcRenderer.invoke("file-storage-exists", key),
  listKeys: (prefix) => electron.ipcRenderer.invoke("file-storage-list", prefix),
  listDirs: (prefix) => electron.ipcRenderer.invoke("file-storage-list-dirs", prefix),
  removeDir: (prefix) => electron.ipcRenderer.invoke("file-storage-remove-dir", prefix)
});
electron.contextBridge.exposeInMainWorld("projectFiles", {
  writeText: (key, value) => electron.ipcRenderer.invoke("project-file-write-text", key, value),
  writeBinary: (payload) => electron.ipcRenderer.invoke("project-file-write-binary", payload),
  saveImage: (payload) => electron.ipcRenderer.invoke("project-file-save-image", payload),
  readAsBase64: (url) => electron.ipcRenderer.invoke("project-file-read-base64", url),
  getAbsolutePath: (url) => electron.ipcRenderer.invoke("project-file-get-absolute-path", url),
  removeText: (key) => electron.ipcRenderer.invoke("project-file-remove-text", key)
});
electron.contextBridge.exposeInMainWorld("studioSkills", {
  list: () => electron.ipcRenderer.invoke("studio-skill-list"),
  readText: (relativePath) => electron.ipcRenderer.invoke("studio-skill-read-text", relativePath),
  writeText: (relativePath, value) => electron.ipcRenderer.invoke("studio-skill-write-text", relativePath, value),
  createText: (relativePath, value) => electron.ipcRenderer.invoke("studio-skill-create-text", relativePath, value),
  deleteText: (relativePath) => electron.ipcRenderer.invoke("studio-skill-delete-text", relativePath),
  restoreText: (relativePath) => electron.ipcRenderer.invoke("studio-skill-restore-text", relativePath)
});
electron.contextBridge.exposeInMainWorld("studioVisualManuals", {
  list: (options) => electron.ipcRenderer.invoke("studio-visual-manual-list", options),
  read: (stylePath) => electron.ipcRenderer.invoke("studio-visual-manual-read", stylePath),
  write: (stylePath, payload) => electron.ipcRenderer.invoke("studio-visual-manual-write", stylePath, payload),
  writeImages: (stylePath, payload) => electron.ipcRenderer.invoke("studio-visual-manual-write-images", stylePath, payload),
  create: (payload) => electron.ipcRenderer.invoke("studio-visual-manual-create", payload),
  duplicate: (payload) => electron.ipcRenderer.invoke("studio-visual-manual-duplicate", payload)
});
electron.contextBridge.exposeInMainWorld("storageManager", {
  getPaths: () => electron.ipcRenderer.invoke("storage-get-paths"),
  selectDirectory: () => electron.ipcRenderer.invoke("storage-select-directory"),
  // Unified storage operations (single base path)
  validateDataDir: (dirPath) => electron.ipcRenderer.invoke("storage-validate-data-dir", dirPath),
  moveData: (newPath) => electron.ipcRenderer.invoke("storage-move-data", newPath),
  linkData: (dirPath) => electron.ipcRenderer.invoke("storage-link-data", dirPath),
  exportData: (targetPath) => electron.ipcRenderer.invoke("storage-export-data", targetPath),
  importData: (sourcePath) => electron.ipcRenderer.invoke("storage-import-data", sourcePath),
  // Cache
  getCacheSize: () => electron.ipcRenderer.invoke("storage-get-cache-size"),
  clearCache: (options) => electron.ipcRenderer.invoke("storage-clear-cache", options),
  updateConfig: (config) => electron.ipcRenderer.invoke("storage-update-config", config)
});
electron.contextBridge.exposeInMainWorld("electronAPI", {
  saveFileDialog: (options) => electron.ipcRenderer.invoke("save-file-dialog", options),
  openPath: (targetPath) => electron.ipcRenderer.invoke("app-open-path", targetPath),
  openDevTools: () => electron.ipcRenderer.invoke("app-devtools-open"),
  testModel: (payload) => electron.ipcRenderer.invoke("api-model-test", payload),
  textCompletion: (payload) => electron.ipcRenderer.invoke("api-text-completion", payload),
  imageRequest: (payload) => electron.ipcRenderer.invoke("api-image-request", payload),
  textCompletionStream: (payload, onChunk) => {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = `api-text-stream:${streamId}`;
    const listener = (_event, delta) => onChunk(delta);
    electron.ipcRenderer.on(channel, listener);
    return electron.ipcRenderer.invoke("api-text-completion-stream", { payload, streamId }).finally(() => {
      electron.ipcRenderer.removeListener(channel, listener);
    });
  }
});
electron.contextBridge.exposeInMainWorld("appUpdater", {
  getCurrentVersion: () => electron.ipcRenderer.invoke("app-updater-get-current-version"),
  checkForUpdates: (options) => electron.ipcRenderer.invoke("app-updater-check", options),
  openExternalLink: (url) => electron.ipcRenderer.invoke("app-updater-open-link", url)
});
electron.contextBridge.exposeInMainWorld("imageHostUploader", {
  upload: (payload) => electron.ipcRenderer.invoke("image-host-upload", payload)
});
electron.contextBridge.exposeInMainWorld("studioRenderer", {
  renderTrackCandidate: (plan) => electron.ipcRenderer.invoke("studio-render-track-candidate", plan),
  mergeEpisode: (plan) => electron.ipcRenderer.invoke("studio-merge-episode", plan),
  probeMedia: (filePath) => electron.ipcRenderer.invoke("studio-probe-media-evidence", filePath),
  renderTimeline: (plan) => electron.ipcRenderer.invoke("studio-timeline-render", plan),
  cancelTimelineRender: (jobId) => electron.ipcRenderer.invoke("studio-timeline-render-cancel", jobId),
  onTimelineRenderProgress(listener) {
    const wrapped = (_event, progress) => listener(progress);
    electron.ipcRenderer.on("studio-timeline-render-progress", wrapped);
    return () => electron.ipcRenderer.removeListener("studio-timeline-render-progress", wrapped);
  }
});
electron.contextBridge.exposeInMainWorld("studioAssets", {
  saveMaterial: (payload) => electron.ipcRenderer.invoke("studio-save-material", payload),
  list: (payload) => electron.ipcRenderer.invoke("assets:list", payload),
  get: (id) => electron.ipcRenderer.invoke("assets:get", id),
  update: (payload) => electron.ipcRenderer.invoke("assets:update", payload),
  delete: (id) => electron.ipcRenderer.invoke("assets:delete", id),
  add: (payload) => electron.ipcRenderer.invoke("assets:add", payload),
  addImage: (payload) => electron.ipcRenderer.invoke("assets:add-image", payload),
  replaceImage: (payload) => electron.ipcRenderer.invoke("assets:replace-image", payload),
  removeImage: (payload) => electron.ipcRenderer.invoke("assets:remove-image", payload),
  renameImage: (payload) => electron.ipcRenderer.invoke("assets:rename-image", payload),
  selectImageFile: () => electron.ipcRenderer.invoke("assets:select-image-file"),
  importFromToonflow: (payload) => electron.ipcRenderer.invoke("assets:import-from-toonflow", payload),
  getByName: (payload) => electron.ipcRenderer.invoke("assets:get-by-name", payload),
  batchMatch: (payload) => electron.ipcRenderer.invoke("assets:batch-match", payload)
});
electron.contextBridge.exposeInMainWorld("ttsRuntime", {
  status: () => electron.ipcRenderer.invoke("tts-runtime-status"),
  start: () => electron.ipcRenderer.invoke("tts-runtime-start"),
  setup: () => electron.ipcRenderer.invoke("tts-runtime-setup"),
  stop: () => electron.ipcRenderer.invoke("tts-runtime-stop"),
  getConfig: () => electron.ipcRenderer.invoke("tts-runtime-get-config"),
  setConfig: (config) => electron.ipcRenderer.invoke("tts-runtime-set-config", config),
  setModelCacheDir: (dirPath) => electron.ipcRenderer.invoke("tts-runtime-set-model-cache-dir", dirPath),
  request: (payload) => electron.ipcRenderer.invoke("tts-runtime-request", payload),
  requestBytes: (payload) => electron.ipcRenderer.invoke("tts-runtime-request-bytes", payload),
  requestFormData: (payload) => electron.ipcRenderer.invoke("tts-runtime-request-formdata", payload),
  resolveReferenceAudioPath: (audioPath) => electron.ipcRenderer.invoke("tts-reference-audio-resolve", audioPath)
});
