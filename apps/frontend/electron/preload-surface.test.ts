import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
const electronTypesSource = readFileSync(new URL("../types/electron.d.ts", import.meta.url), "utf8");

describe("preload IPC surface", () => {
  it("does not expose raw ipcRenderer send/invoke to the renderer", () => {
    expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preloadSource).toContain("exposeInMainWorld('appEvents'");
  });

  it("passes update check options through the safe updater API", () => {
    expect(preloadSource).toContain("checkForUpdates: (options?: UpdateCheckOptions)");
    expect(preloadSource).toContain("ipcRenderer.invoke('app-updater-check', options)");
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
    expect(preloadSource).toContain("deleteImage: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('delete-image', localPath)");
    expect(preloadSource).toContain("moveImage: (localPath: string, category: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('move-image'");
    expect(preloadSource).toContain("readAsBase64: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('read-image-base64', localPath)");
    expect(preloadSource).toContain("getAbsolutePath: (localPath: string)");
    expect(preloadSource).toContain("ipcRenderer.invoke('get-absolute-path', localPath)");
    expect(electronTypesSource).toContain("imageStorage?:");
    expect(electronTypesSource).toContain("saveImage: (url: string, category: string, filename: string)");
    expect(electronTypesSource).toContain("getImagePath: (localPath: string) => Promise<string | null>");
    expect(electronTypesSource).toContain("deleteImage: (localPath: string) => Promise<boolean>");
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
    expect(preloadSource).toContain("openDevTools: () => ipcRenderer.invoke('app-devtools-open')");
    expect(preloadSource).toContain("getCurrentVersion: () => ipcRenderer.invoke('app-updater-get-current-version')");
    expect(preloadSource).toContain("openExternalLink: (url: string) => ipcRenderer.invoke('app-updater-open-link', url)");
    expect(electronTypesSource).toContain("appEvents?:");
    expect(electronTypesSource).toContain("mystudioSmoke?:");
    expect(electronTypesSource).toContain("electronAPI?:");
    expect(electronTypesSource).toContain("saveFileDialog: (options:");
    expect(electronTypesSource).toContain("openPath: (targetPath: string)");
    expect(electronTypesSource).toContain("openDevTools: ()");
    expect(electronTypesSource).toContain("appUpdater?:");
    expect(electronTypesSource).toContain("getCurrentVersion: () => Promise<string>");
    expect(electronTypesSource).toContain("openExternalLink: (url: string)");
  });

  it("exposes typed timeline render, cancellation and progress without raw execution fields", () => {
    expect(preloadSource).toContain("renderTimeline: (plan: TimelineRenderPlan): Promise<TimelineRenderResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-timeline-render', plan)");
    expect(preloadSource).toContain("cancelTimelineRender: (jobId: string): Promise<TimelineRenderCancelResult>");
    expect(preloadSource).toContain("ipcRenderer.invoke('studio-timeline-render-cancel', jobId)");
    expect(preloadSource).toContain("ipcRenderer.on('studio-timeline-render-progress', wrapped)");
    expect(preloadSource).not.toContain("renderTimeline: (args:");
    expect(preloadSource).not.toContain("renderTimeline: (outputPath:");
    expect(preloadSource).not.toContain("renderTimeline: (filterGraph:");
  });

  it("keeps studio renderer inputs aligned with the shared render plans", () => {
    expect(preloadSource).toContain(
      "renderTrackCandidate: (plan: TrackRenderPlan) => ipcRenderer.invoke('studio-render-track-candidate', plan)",
    );
    expect(preloadSource).toContain(
      "mergeEpisode: (plan: EpisodeMergePlan) => ipcRenderer.invoke('studio-merge-episode', plan)",
    );
    expect(preloadSource).not.toContain("renderTrackCandidate: (plan: unknown)");
    expect(preloadSource).not.toContain("mergeEpisode: (plan: unknown)");
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
    expect(electronTypesSource).toContain("getPaths: () => Promise<{ basePath: string; projectPath: string; mediaPath: string; skillsPath: string; cachePath: string }>");
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
