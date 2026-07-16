import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const protocolSource = readFileSync(new URL("./register-protocol-handlers.ts", import.meta.url), "utf8");
const diagnosticsIpcSource = readFileSync(new URL("./ipc/diagnostics-ipc.ts", import.meta.url), "utf8");
const appUpdaterIpcSource = readFileSync(new URL("./ipc/app-updater-ipc.ts", import.meta.url), "utf8");
const projectFileIpcSource = readFileSync(new URL("./ipc/project-file-ipc.ts", import.meta.url), "utf8");
const localMediaIpcSource = readFileSync(new URL("./ipc/local-media-ipc.ts", import.meta.url), "utf8");
const apiRequestIpcSource = readFileSync(new URL("./ipc/api-request-ipc.ts", import.meta.url), "utf8");
const assetLibraryIpcSource = readFileSync(new URL("./ipc/asset-library-ipc.ts", import.meta.url), "utf8");

describe("main process startup", () => {
  it("does not auto-start the TTS backend when the app becomes ready", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("  registerProtocolHandlers({"),
    );

    expect(readyBlock).not.toContain("ttsRuntimeController.start()");
  });

  it("does not initialize the independent asset library before asset IPC is used", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("  registerProtocolHandlers({"),
    );
    expect(readyBlock).not.toContain("assetsStorage.initAssetsStorage");
    expect(mainSource).toContain("registerAssetLibraryIpcHandlers");
    expect(assetLibraryIpcSource).toContain("const ensureAssetsStorageReady = () =>");
    expect(assetLibraryIpcSource).toContain("assetsStorage.initAssetsStorage(getStorageBasePath())");
    expect(assetLibraryIpcSource).toContain("ensureAssetsStorageReady()");
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

  it("keeps background smoke hidden, unfocused, and unthrottled", () => {
    const windowBlock = mainSource.slice(
      mainSource.indexOf("win = new BrowserWindow"),
      mainSource.indexOf("// Open external links in system browser"),
    );
    const secondInstanceBlock = mainSource.slice(
      mainSource.indexOf("app.on('second-instance'"),
      mainSource.indexOf("app.on('window-all-closed'"),
    );
    const activateBlock = mainSource.slice(
      mainSource.indexOf("app.on('activate'"),
      mainSource.indexOf("// ==================== Storage Config"),
    );
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("  registerProtocolHandlers({"),
    );

    expect(mainSource).toContain(
      "const isBackgroundSmoke = process.env.MYSTUDIO_SMOKE_BACKGROUND === '1'",
    );
    expect(windowBlock).toContain("backgroundThrottling: !isBackgroundSmoke");
    expect(windowBlock).toContain(
      "if (isBackgroundSmoke || !win || win.isDestroyed() || hasShownWindow) return",
    );
    expect(secondInstanceBlock).toContain("if (isBackgroundSmoke) return");
    expect(activateBlock).toContain("if (isBackgroundSmoke) return");
    expect(readyBlock).toContain("app.setActivationPolicy('accessory')");
    expect(readyBlock).toContain("app.dock.hide()");
  });

  it("keeps automatic update checks quiet while preserving manual check errors", () => {
    expect(mainSource).toContain("registerAppUpdaterIpcHandlers");
    expect(appUpdaterIpcSource).toContain("options?: UpdateCheckOptions");
    expect(appUpdaterIpcSource).toContain("if (!options?.silent)");
    expect(appUpdaterIpcSource).toContain('console.error("Failed to check updates:"');
  });

  it("registers project-file protocol for project-scoped workflow assets", () => {
    expect(mainSource).toContain("registerPrivilegedSchemes(protocol)");
    expect(mainSource).toContain("registerProtocolHandlers({");
    expect(protocolSource).toContain('"project-file"');
    expect(protocolSource).toContain('protocol.handle("project-file"');
    expect(mainSource).toContain("registerProjectFileIpcHandlers");
    expect(projectFileIpcSource).toContain('ipcMain.handle("project-file-write-binary"');
    expect(projectFileIpcSource).toContain('ipcMain.handle("project-file-save-image"');
    expect(projectFileIpcSource).toContain('ipcMain.handle("project-file-read-base64"');
    expect(projectFileIpcSource).toContain('ipcMain.handle("project-file-get-absolute-path"');
  });

  it("registers diagnostics log IPC and renderer process event capture", () => {
    expect(mainSource).toContain("createDiagnosticsLogService");
    expect(mainSource).toContain("registerDiagnosticsIpcHandlers");
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-write"');
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-query"');
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-get-info"');
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-open-folder"');
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-export-bundle"');
    expect(diagnosticsIpcSource).toContain('ipcMain.handle("diagnostics-log-clear"');
    expect(mainSource).toContain("win.webContents.on('console-message'");
    expect(mainSource).toContain("win.webContents.on('render-process-gone'");
    expect(mainSource).toContain("win.on('unresponsive'");
  });

  it("reuses renderer operation ids for API model test diagnostics", () => {
    const handlerBlock = apiRequestIpcSource.slice(
      apiRequestIpcSource.indexOf('ipcMain.handle("api-model-test"'),
      apiRequestIpcSource.indexOf('ipcMain.handle("api-text-completion"'),
    );

    expect(handlerBlock).toContain('payload.operationId?.trim() || createOperationId("model-test")');
    expect(handlerBlock).toContain("Model test IPC started");
    expect(handlerBlock).toContain('endpointFamily: "model-test"');
    expect(handlerBlock).toContain("timeoutMs: getModelTestTimeoutMs(payload.type)");
  });

  it("falls back from empty AI SDK text streams to the HTTP stream path", () => {
    const handlerBlock = apiRequestIpcSource.slice(
      apiRequestIpcSource.indexOf('ipcMain.handle("api-text-completion-stream"'),
    );

    expect(handlerBlock).toContain("if (fullText.trim())");
    expect(handlerBlock).toContain("AI SDK text stream returned empty, falling back to HTTP");
    expect(handlerBlock).toContain("runTextCompletionStreamRequest");
  });

  it("uses the requested text model before provider defaults in AI SDK text calls", () => {
    const textHandlerBlock = apiRequestIpcSource.slice(
      apiRequestIpcSource.indexOf('ipcMain.handle("api-text-completion"'),
      apiRequestIpcSource.indexOf('ipcMain.handle("api-text-completion-stream"'),
    );
    const streamHandlerBlock = apiRequestIpcSource.slice(
      apiRequestIpcSource.indexOf('ipcMain.handle("api-text-completion-stream"'),
    );

    expect(textHandlerBlock).toContain('const textModel = payload.model || provider.model?.[0] || ""');
    expect(streamHandlerBlock).toContain('const textModel = args.payload.model || provider.model?.[0] || ""');
    expect(textHandlerBlock).not.toContain('model: provider.model?.[0] || payload.model || ""');
    expect(streamHandlerBlock).not.toContain('model: provider.model?.[0] || args.payload.model || ""');
  });

  it("registers a main-process image API request proxy with diagnostics", () => {
    expect(mainSource).toContain("registerApiRequestIpcHandlers");
    expect(apiRequestIpcSource).toContain('ipcMain.handle("api-image-request"');
    expect(apiRequestIpcSource).toContain("Image request IPC started");
    expect(apiRequestIpcSource).toContain("endpointFamily: payload.endpointFamily");
    expect(apiRequestIpcSource).toContain("fetcher: fetch as typeof fetch");
  });

  it("opens asset image selection from the resolved media image directory by default", () => {
    const handlerBlock = assetLibraryIpcSource.slice(
      assetLibraryIpcSource.indexOf('ipcMain.handle("assets:select-image-file"'),
      assetLibraryIpcSource.indexOf('ipcMain.handle("assets:import-from-toonflow"'),
    );

    expect(handlerBlock).toContain("defaultPath: getAssetImagePickerDefaultPath(getMediaRoot())");
  });

  it("serializes asset library IPC operations before touching the sqlite database", () => {
    const diagnosticsBlock = assetLibraryIpcSource.slice(
      assetLibraryIpcSource.indexOf("let assetDiagnosticsQueue"),
      assetLibraryIpcSource.indexOf('ipcMain.handle("assets:list"'),
    );

    expect(diagnosticsBlock).toContain("let assetDiagnosticsQueue: Promise<void> = Promise.resolve()");
    expect(diagnosticsBlock).toContain("const previous = assetDiagnosticsQueue.catch(() => undefined)");
    expect(diagnosticsBlock).toContain("assetDiagnosticsQueue = queuedRun.then(() => undefined, () => undefined)");
    expect(diagnosticsBlock).toContain("queuedMs");
    expect(diagnosticsBlock).toContain("durationMs");
  });

  it("registers local media file move IPC for category moves", () => {
    expect(mainSource).toContain("registerLocalMediaIpcHandlers");
    expect(localMediaIpcSource).toContain("resolveLocalMediaPath(getMediaRoot(), localPath)");
    expect(localMediaIpcSource).toContain("getImagesDir(getMediaRoot(), category)");
    expect(localMediaIpcSource).toContain("localPath: `local-image://${category}/");
  });
});
