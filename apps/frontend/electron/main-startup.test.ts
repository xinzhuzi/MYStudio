import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("main process startup", () => {
  it("does not auto-start the TTS backend when the app becomes ready", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("protocol.handle('local-image'"),
    );

    expect(readyBlock).not.toContain("ttsRuntimeController.start()");
  });

  it("does not initialize the independent asset library before asset IPC is used", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("protocol.handle('local-image'"),
    );
    const diagnosticsBlock = mainSource.slice(
      mainSource.indexOf("let assetDiagnosticsQueue"),
      mainSource.indexOf("ipcMain.handle('assets:list'"),
    );

    expect(readyBlock).not.toContain("assetsStorage.initAssetsStorage");
    expect(diagnosticsBlock).toContain("function ensureAssetsStorageReady()");
    expect(diagnosticsBlock).toContain("assetsStorage.initAssetsStorage(getStorageBasePath())");
    expect(diagnosticsBlock).toContain("ensureAssetsStorageReady()");
  });

  it("keeps the window hidden on a dark background until the first render is ready", () => {
    const windowBlock = mainSource.slice(
      mainSource.indexOf("win = new BrowserWindow"),
      mainSource.indexOf("// Open external links in system browser"),
    );

    expect(windowBlock).toContain("show: false");
    expect(windowBlock).toContain("backgroundColor: '#17191c'");
    expect(windowBlock).toContain("ready-to-show");
    expect(windowBlock).toContain("did-finish-load");
    expect(windowBlock).toContain("showWindow()");
  });

  it("keeps automatic update checks quiet while preserving manual check errors", () => {
    const updaterBlock = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('app-updater-check'"),
      mainSource.indexOf("ipcMain.handle('app-updater-open-link'"),
    );

    expect(updaterBlock).toContain("options?: UpdateCheckOptions");
    expect(updaterBlock).toContain("if (!options?.silent)");
    expect(updaterBlock).toContain("console.error('Failed to check updates:'");
  });

  it("registers project-file protocol for project-scoped workflow assets", () => {
    expect(mainSource).toContain("scheme: 'project-file'");
    expect(mainSource).toContain("protocol.handle('project-file'");
    expect(mainSource).toContain("ipcMain.handle('project-file-write-binary'");
    expect(mainSource).toContain("ipcMain.handle('project-file-save-image'");
    expect(mainSource).toContain("ipcMain.handle('project-file-read-base64'");
    expect(mainSource).toContain("ipcMain.handle('project-file-get-absolute-path'");
  });

  it("registers diagnostics log IPC and renderer process event capture", () => {
    expect(mainSource).toContain("createDiagnosticsLogService");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-write'");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-query'");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-get-info'");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-open-folder'");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-export-bundle'");
    expect(mainSource).toContain("ipcMain.handle('diagnostics-log-clear'");
    expect(mainSource).toContain("win.webContents.on('console-message'");
    expect(mainSource).toContain("win.webContents.on('render-process-gone'");
    expect(mainSource).toContain("win.on('unresponsive'");
  });

  it("reuses renderer operation ids for API model test diagnostics", () => {
    const handlerBlock = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('api-model-test'"),
      mainSource.indexOf("ipcMain.handle('api-text-completion'"),
    );

    expect(handlerBlock).toContain("payload.operationId?.trim() || createDiagnosticsOperationId('model-test')");
    expect(handlerBlock).toContain("Model test IPC started");
    expect(handlerBlock).toContain("endpointFamily: 'model-test'");
    expect(handlerBlock).toContain("timeoutMs: getModelTestTimeoutMs(payload.type)");
  });

  it("registers a main-process image API request proxy with diagnostics", () => {
    expect(mainSource).toContain("ipcMain.handle('api-image-request'");
    expect(mainSource).toContain("Image request IPC started");
    expect(mainSource).toContain("endpointFamily: payload.endpointFamily");
    expect(mainSource).toContain("fetcher: fetch as typeof fetch");
  });

  it("opens asset image selection from the resolved media image directory by default", () => {
    const handlerBlock = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('assets:select-image-file'"),
      mainSource.indexOf("ipcMain.handle('assets:import-from-toonflow'"),
    );

    expect(handlerBlock).toContain("defaultPath: getAssetImagePickerDefaultPath(getMediaRoot())");
  });

  it("serializes asset library IPC operations before touching the sqlite database", () => {
    const diagnosticsBlock = mainSource.slice(
      mainSource.indexOf("let assetDiagnosticsQueue"),
      mainSource.indexOf("ipcMain.handle('assets:list'"),
    );

    expect(diagnosticsBlock).toContain("let assetDiagnosticsQueue: Promise<void> = Promise.resolve()");
    expect(diagnosticsBlock).toContain("const previous = assetDiagnosticsQueue.catch(() => undefined)");
    expect(diagnosticsBlock).toContain("assetDiagnosticsQueue = queuedRun.then(() => undefined, () => undefined)");
    expect(diagnosticsBlock).toContain("queuedMs");
    expect(diagnosticsBlock).toContain("durationMs");
  });

  it("registers local media file move IPC for category moves", () => {
    const handlerBlock = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('move-image'"),
      mainSource.indexOf("ipcMain.handle('read-image-base64'"),
    );

    expect(handlerBlock).toContain("resolveLocalMediaPath(getMediaRoot(), localPath)");
    expect(handlerBlock).toContain("getImagesDir(category)");
    expect(handlerBlock).toContain("localPath: `local-image://${category}/");
  });
});
