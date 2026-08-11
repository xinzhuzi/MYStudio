import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
const electronTypesSource = readFileSync(new URL("../../types/electron.d.ts", import.meta.url), "utf8");

describe("preload IPC surface", () => {
  it("does not expose raw ipcRenderer send/invoke to the renderer", () => {
    expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preloadSource).toContain("exposeInMainWorld('appEvents'");
  });

  it("passes update check options through the safe updater API", () => {
    expect(preloadSource).toContain("checkForUpdates: (options?: UpdateCheckOptions)");
    expect(preloadSource).toContain("ipcRenderer.invoke('app-updater-check', options)");
  });

  it("exposes the self-media IPC contract through a validated narrow facade", () => {
    expect(preloadSource).toContain("exposeInMainWorld('selfMedia'");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.listProviders)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.listAccounts, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.listTasks, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.configureProvider, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.startLogin, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.createTask, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.pollTask, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(SELF_MEDIA_IPC.cancelTask, request)");
    expect(preloadSource).toContain("ipcRenderer.on(SELF_MEDIA_IPC.progress, wrapped)");
    expect(preloadSource).toContain("decodeSelfMediaIpcReply");
    expect(preloadSource).toContain("decodeSelfMediaProgressEvent(payload)");
    expect(electronTypesSource).toContain("selfMedia?:");
    expect(electronTypesSource).toContain("onProgress: (listener: (progress: SelfMediaTaskProgressEvent) => void) => () => void");
  });

  it("exposes diagnostics logging through a narrow safe API", () => {
    expect(preloadSource).toContain("exposeInMainWorld('diagnosticsLog'");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-write', entry)");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-query', query)");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-get-info')");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-open-folder')");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-export-bundle')");
    expect(preloadSource).toContain("ipcRenderer.invoke('diagnostics-log-clear')");
    expect(electronTypesSource).toContain("diagnosticsLog?:");
    expect(electronTypesSource).toContain("openFolder: () => Promise<DiagnosticsLogOpenFolderResult>");
  });

  it("exposes fixed Remotion workspace runtime metadata through a validated facade", () => {
    expect(preloadSource).toContain("workspaceRuntime: async ()");
    expect(preloadSource).toContain("REMOTION_WORKSPACE_RUNTIME_CHANNEL");
    expect(preloadSource).toContain("validateRemotionWorkspaceRuntimeReply");
    expect(electronTypesSource).toContain("workspaceRuntime?: () => Promise<RemotionWorkspaceRuntimeReply>");
  });

  it("exposes image API requests through electronAPI without raw IPC", () => {
    expect(preloadSource).toContain("imageRequest: (payload: ImageRequestPayload): Promise<ImageRequestResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('api-image-request', payload)");
  });

  it("exposes narrow image storage APIs without raw IPC", () => {
    expect(preloadSource).toContain("exposeInMainWorld('imageStorage'");
    expect(preloadSource).toContain("saveImage: (url: string, category: string, filename: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('save-image', { url, category, filename })");
    expect(preloadSource).toContain("getImagePath: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('get-image-path', localPath)");
    expect(preloadSource).not.toContain("deleteImage: (localPath: string)");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('delete-image'");
    expect(preloadSource).toContain("moveImage: (localPath: string, category: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('move-image'");
    expect(preloadSource).toContain("readAsBase64: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('read-image-base64', localPath)");
    expect(preloadSource).toContain("getAbsolutePath: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('get-absolute-path', localPath)");
    expect(electronTypesSource).toContain("imageStorage?:");
    expect(electronTypesSource).toContain("saveImage: (url: string, category: string, filename: string)");
    expect(electronTypesSource).toContain("getImagePath: (localPath: string) => Promise<string | null>");
    expect(electronTypesSource).not.toContain("deleteImage: (localPath: string)");
    expect(electronTypesSource).toContain("moveImage: (localPath: string, category: string)");
    expect(electronTypesSource).toContain("readAsBase64: (localPath: string) => Promise<string | null>");
    expect(electronTypesSource).toContain("getAbsolutePath: (localPath: string) => Promise<string | null>");
  });

  it("exposes project-scoped binary file APIs without raw IPC", () => {
    expect(preloadSource).toContain("writeText: (key: string, value: string)");
    expect(preloadSource).toContain("writeBinary: (payload:");
    expect(preloadSource).toContain("saveImage: (payload:");
    expect(preloadSource).toContain("readAsBase64: (url: string)");
    expect(preloadSource).toContain("getAbsolutePath: (url: string)");
    expect(preloadSource).toContain("removeText: (key: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-write-text', key, value)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-write-binary', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-save-image', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-read-base64', url)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-get-absolute-path', url)");
    expect(preloadSource).toContain("ipcRenderer.invoke('project-file-remove-text', key)");
    expect(electronTypesSource).toContain("writeText: (key: string, value: string)");
    expect(electronTypesSource).toContain("writeBinary: (payload: { projectId: string; relativePath: string; bytes: ArrayBuffer })");
    expect(electronTypesSource).toContain("saveImage: (payload: { projectId: string; relativePath: string; source: string })");
    expect(electronTypesSource).toContain("readAsBase64: (url: string)");
    expect(electronTypesSource).toContain("getAbsolutePath: (url: string) => Promise<string | null>");
    expect(electronTypesSource).toContain("removeText: (key: string)");
  });

  it("keeps file storage mapped through named IPC channels", () => {
    expect(preloadSource).toContain("exposeInMainWorld('fileStorage'");
    expect(preloadSource).toContain("getItem: (key: string) => ipcRenderer.invoke('file-storage-get', key)");
    expect(preloadSource).toContain("setItem: (key: string, value: string) => ipcRenderer.invoke('file-storage-set', key, value)");
    expect(preloadSource).toContain("removeItem: (key: string) => ipcRenderer.invoke('file-storage-remove', key)");
    expect(preloadSource).toContain("renameItem: (fromKey: string, toKey: string) => ipcRenderer.invoke('file-storage-rename', fromKey, toKey)");
    expect(preloadSource).toContain("exists: (key: string) => ipcRenderer.invoke('file-storage-exists', key)");
    expect(preloadSource).toContain("listKeys: (prefix: string) => ipcRenderer.invoke('file-storage-list', prefix)");
    expect(preloadSource).toContain("listDirs: (prefix: string) => ipcRenderer.invoke('file-storage-list-dirs', prefix)");
    expect(preloadSource).toContain("removeDir: (prefix: string) => ipcRenderer.invoke('file-storage-remove-dir', prefix)");
    expect(electronTypesSource).toContain("fileStorage?:");
    expect(electronTypesSource).toContain("renameItem?: (fromKey: string, toKey: string)");
  });

  it("keeps skills and visual manuals behind narrow preload facades", () => {
    expect(preloadSource).toContain("exposeInMainWorld('studioSkills'");
    expect(preloadSource).toContain("list: () => ipcRenderer.invoke('studio-skill-list')");
    expect(preloadSource).toContain("readText: (relativePath: string) => ipcRenderer.invoke('studio-skill-read-text', relativePath)");
    expect(preloadSource).toContain("writeText: (relativePath: string, value: string) => ipcRenderer.invoke('studio-skill-write-text', relativePath, value)");
    expect(preloadSource).toContain("createText: (relativePath: string, value: string) => ipcRenderer.invoke('studio-skill-create-text', relativePath, value)");
    expect(preloadSource).toContain("deleteText: (relativePath: string) => ipcRenderer.invoke('studio-skill-delete-text', relativePath)");
    expect(preloadSource).toContain("restoreText: (relativePath: string) => ipcRenderer.invoke('studio-skill-restore-text', relativePath)");
    expect(preloadSource).toContain("exposeInMainWorld('studioVisualManuals'");
    expect(preloadSource).toContain("list: (options?: { refresh?: boolean }) => ipcRenderer.invoke('studio-visual-manual-list', options)");
    expect(preloadSource).toContain("read: (stylePath: string) => ipcRenderer.invoke('studio-visual-manual-read', stylePath)");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-visual-manual-write', stylePath, payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-visual-manual-write-images', stylePath, payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-visual-manual-create', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-visual-manual-duplicate', payload)");
    expect(electronTypesSource).toContain("studioSkills?:");
    expect(electronTypesSource).toContain("studioVisualManuals?:");
  });

  it("keeps native app, updater, smoke, and app-event facades explicit", () => {
    expect(preloadSource).toContain("exposeInMainWorld('appEvents'");
    expect(preloadSource).toContain("ipcRenderer.on('main-process-message', wrapped)");
    expect(preloadSource).toContain("ipcRenderer.removeListener('main-process-message', wrapped)");
    expect(preloadSource).toContain("exposeInMainWorld('mystudioSmoke'");
    expect(preloadSource).toContain("enabled: process.env.MYSTUDIO_SMOKE === '1'");
    expect(preloadSource).toContain("saveFileDialog: (options:");
    expect(preloadSource).toContain("ipcRenderer.invoke('save-file-dialog', options)");
    expect(preloadSource).toContain("openPath: (targetPath: string) => ipcRenderer.invoke('app-open-path', targetPath)");
    expect(preloadSource).toContain("showItemInFolder: (targetPath: string) => ipcRenderer.invoke('app-show-in-folder', targetPath)");
    expect(preloadSource).toContain("openDevTools: () => ipcRenderer.invoke('app-devtools-open')");
    expect(preloadSource).toContain("getCurrentVersion: () => ipcRenderer.invoke('app-updater-get-current-version')");
    expect(preloadSource).toContain("openExternalLink: (url: string) => ipcRenderer.invoke('app-updater-open-link', url)");
    expect(electronTypesSource).toContain("appEvents?:");
    expect(electronTypesSource).toContain("mystudioSmoke?:");
    expect(electronTypesSource).toContain("electronAPI?:");
    expect(electronTypesSource).toContain("saveFileDialog: (options:");
    expect(electronTypesSource).toContain("openPath: (targetPath: string)");
    expect(electronTypesSource).toContain("showItemInFolder: (targetPath: string)");
    expect(electronTypesSource).toContain("openDevTools: ()");
    expect(electronTypesSource).toContain("appUpdater?:");
    expect(electronTypesSource).toContain("getCurrentVersion: () => Promise<string>");
    expect(electronTypesSource).toContain("openExternalLink: (url: string)");
  });

  it("exposes only read-only studio media evidence", () => {
    const studioRendererBlock = preloadSource.slice(
      preloadSource.indexOf("exposeInMainWorld('studioRenderer'"),
      preloadSource.indexOf("function parseRemotionRuntimeStatus"),
    );
    expect(studioRendererBlock).toContain("probeMedia: (filePath: string)");
    expect(studioRendererBlock).not.toContain("renderTimeline");
    expect(studioRendererBlock).not.toContain("cancelTimelineRender");
    expect(studioRendererBlock).not.toContain("studio-timeline-render");
    expect(electronTypesSource).not.toContain("renderTimeline:");
    expect(electronTypesSource).not.toContain("cancelTimelineRender:");
  });

  it("exposes a validated Remotion browser runtime without raw download options", () => {
    expect(preloadSource).toContain("exposeInMainWorld('remotionRuntime'");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_RUNTIME_STATUS_CHANNEL)");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_RUNTIME_DOWNLOAD_CHANNEL, {})");
    expect(preloadSource).toContain("validateRemotionRuntimeStatusReply(value)");
    expect(preloadSource).toContain("validateRemotionRuntimeDownloadProgressEvent(payload)");
    expect(preloadSource).toContain("ipcRenderer.removeListener(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, wrapped)");
    expect(preloadSource).not.toContain("download: (options:");
    expect(electronTypesSource).toContain("remotionRuntime?:");
    expect(electronTypesSource).toContain("status: () => Promise<RemotionBrowserStatus>");
    expect(electronTypesSource).toContain("download: () => Promise<RemotionBrowserStatus>");
  });

  it("exposes a narrow validated Remotion browser runtime facade", () => {
    expect(preloadSource).toContain("exposeInMainWorld('remotionRuntime'");
    expect(preloadSource).toContain("REMOTION_RUNTIME_STATUS_CHANNEL");
    expect(preloadSource).toContain("REMOTION_RUNTIME_DOWNLOAD_CHANNEL");
    expect(preloadSource).toContain("validateRemotionRuntimeStatusReply");
    expect(preloadSource).toContain("validateRemotionRuntimeDownloadProgressEvent(payload)");
    expect(preloadSource).toContain("ipcRenderer.on(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, wrapped)");
    expect(preloadSource).toContain("ipcRenderer.removeListener(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, wrapped)");
    expect(electronTypesSource).toContain("remotionRuntime?:");
    expect(electronTypesSource).toContain("status: () => Promise<RemotionBrowserStatus>");
    expect(electronTypesSource).toContain("download: () => Promise<RemotionBrowserStatus>");
    expect(electronTypesSource).toContain("listener: (progress: RemotionBrowserDownloadProgress) => void");

    const runtimeTypeBlock = electronTypesSource.slice(
      electronTypesSource.indexOf("remotionRuntime?:"),
      electronTypesSource.indexOf("studioAssets?:"),
    );
    expect(runtimeTypeBlock).not.toContain("executablePath");
  });

  it("exposes validated Remotion preview sessions without paths or tokens", () => {
    expect(preloadSource).toContain("exposeInMainWorld('remotionPreview'");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_PREVIEW_CREATE_CHANNEL, { plan })");
    expect(preloadSource).toContain("validateRemotionPreviewCreateReply");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_PREVIEW_RELEASE_CHANNEL, { sessionId })");
    expect(preloadSource).toContain("validateRemotionPreviewReleaseReply");
    expect(electronTypesSource).toContain("remotionPreview?:");
    expect(electronTypesSource).toContain("create: (plan: TimelineRenderPlan)");
    expect(electronTypesSource).toContain("release: (sessionId: string)");

    const previewTypeBlock = electronTypesSource.slice(
      electronTypesSource.indexOf("remotionPreview?:"),
      electronTypesSource.indexOf("studioAssets?:"),
    );
    expect(previewTypeBlock).not.toContain("token");
    expect(previewTypeBlock).not.toContain("sourcePath");
  });

  it("exposes validated video-workflow chapter restore without filesystem access", () => {
    expect(preloadSource).toContain("exposeInMainWorld('videoWorkflowPlugins'");
    expect(preloadSource).toContain("ipcRenderer.invoke(VIDEO_WORKFLOW_UPDATE_CHANNEL, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL, request)");
    expect(electronTypesSource).toContain("update: (request: VideoWorkflowPluginActionRequestV1)");
    expect(preloadSource).toContain("validateVideoWorkflowChapterReadReply(value)");
    expect(electronTypesSource).toContain("readChapter: (request: VideoWorkflowChapterReadRequestV1)");
    const bridgeBlock = preloadSource.slice(
      preloadSource.indexOf("exposeInMainWorld('videoWorkflowPlugins'"),
      preloadSource.indexOf("exposeInMainWorld('remotionPreview'"),
    );
    expect(bridgeBlock).not.toContain("readFile");
    expect(bridgeBlock).not.toContain("artifactPath");
  });

  it("exposes the project-scoped chapter manifest and audio bridge without destination paths", () => {
    expect(preloadSource).toContain("exposeInMainWorld('remotionChapterManifest'");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL, scope)");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL, request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL, request)");
    expect(electronTypesSource).toContain("remotionChapterManifest?: RemotionChapterManifestBridge");
    const bridgeBlock = preloadSource.slice(
      preloadSource.indexOf("exposeInMainWorld('remotionChapterManifest'"),
      preloadSource.indexOf("exposeInMainWorld('remotionQueue'"),
    );
    expect(bridgeBlock).not.toContain("destinationPath");
    expect(bridgeBlock).not.toContain("outputPath");
  });

  it("does not expose legacy FFmpeg candidate or concat operations", () => {
    expect(preloadSource).not.toContain("studio-render-track-candidate");
    expect(preloadSource).not.toContain("studio-merge-episode");
    expect(electronTypesSource).not.toContain("renderTrackCandidate:");
    expect(electronTypesSource).not.toContain("mergeEpisode:");
  });

  it("keeps the storage manager facade mapped to the unified IPC channels", () => {
    expect(preloadSource).toContain("exposeInMainWorld('storageManager'");
    expect(preloadSource).toContain("getPaths: () => ipcRenderer.invoke('storage-get-paths')");
    expect(preloadSource).toContain("selectDirectory: () => ipcRenderer.invoke('storage-select-directory')");
    expect(preloadSource).toContain("validateDataDir: (dirPath: string) => ipcRenderer.invoke('storage-validate-data-dir', dirPath)");
    expect(preloadSource).toContain("moveData: (newPath: string) => ipcRenderer.invoke('storage-move-data', newPath)");
    expect(preloadSource).toContain("linkData: (dirPath: string) => ipcRenderer.invoke('storage-link-data', dirPath)");
    expect(preloadSource).toContain("exportData: (targetPath: string) => ipcRenderer.invoke('storage-export-data', targetPath)");
    expect(preloadSource).toContain("importData: (sourcePath: string) => ipcRenderer.invoke('storage-import-data', sourcePath)");
    expect(preloadSource).toContain("getCacheSize: () => ipcRenderer.invoke('storage-get-cache-size')");
    expect(preloadSource).toContain("clearCache: (options?: { olderThanDays?: number }) => ipcRenderer.invoke('storage-clear-cache', options)");
    expect(preloadSource).toContain("ipcRenderer.invoke('storage-update-config', config)");
    expect(electronTypesSource).toContain("storageManager?:");
    expect(electronTypesSource).toContain("getPaths: () => Promise<{\n        basePath: string;\n        projectPath: string;\n        mediaPath: string;\n        assetsPath: string;\n        skillsPath: string;\n        pythonRuntimeDir: string;\n        modelCacheDir: string;\n        cachePath: string;\n      }>;");
    expect(electronTypesSource).toContain("selectDirectory: () => Promise<string | null>");
    expect(electronTypesSource).toContain("validateDataDir: (dirPath: string)");
    expect(electronTypesSource).toContain("moveData: (newPath: string)");
    expect(electronTypesSource).toContain("linkData: (dirPath: string)");
    expect(electronTypesSource).toContain("exportData: (targetPath: string)");
    expect(electronTypesSource).toContain("importData: (sourcePath: string)");
    expect(electronTypesSource).toContain("getCacheSize: () => Promise<{ total: number; details: Array<{ path: string; size: number }> }>");
    expect(electronTypesSource).toContain("clearCache: (options?: { olderThanDays?: number })");
    expect(electronTypesSource).toContain("updateConfig: (config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) => Promise<boolean>");
  });
});
