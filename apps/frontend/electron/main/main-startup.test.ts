import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./main-paths.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./main-chapter-projection.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./main-diagnostics.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./main-hosted-studio.ts", import.meta.url), "utf8")
  + readFileSync(new URL("../ipc/media/storage-media-ipc.ts", import.meta.url), "utf8");
const mainDir = path.dirname(fileURLToPath(import.meta.url));
/** Source: apps/frontend/electron/main → apps/ is ../../../ ; APP_ROOT in built main is also apps/. */
const appsRootFromSource = path.resolve(mainDir, "../../..");
/** Dev seed candidate: APP_ROOT/frontend/assets/studio-manuals */
const frontendStudioManualsSeed = path.join(appsRootFromSource, "frontend", "assets", "studio-manuals");
const protocolSource = readFileSync(new URL("../runtime/register-protocol-handlers.ts", import.meta.url), "utf8");
const chromiumDataDirSource = readFileSync(new URL("../runtime/chromium-data-dir.ts", import.meta.url), "utf8");
const diagnosticsIpcSource = readFileSync(new URL("../ipc/diagnostics/diagnostics-ipc.ts", import.meta.url), "utf8");
const appUpdaterIpcSource = readFileSync(new URL("../ipc/app/app-updater-ipc.ts", import.meta.url), "utf8");
const projectFileIpcSource = readFileSync(new URL("../ipc/files/project-file-ipc.ts", import.meta.url), "utf8");
const localMediaIpcSource = readFileSync(new URL("../ipc/media/local-media-ipc.ts", import.meta.url), "utf8");
const apiRequestIpcSource = readFileSync(new URL("../ipc/ai/api-request-ipc.ts", import.meta.url), "utf8");
const assetLibraryIpcSource = readFileSync(new URL("../ipc/assets/asset-library-ipc.ts", import.meta.url), "utf8");

describe("main process startup", () => {
  it("routes generation runtimes to their model families instead of TTS cache", () => {
    expect(mainSource).toContain("modelCacheDir: () => audioModelCacheDir(getStorageBasePath())");
    expect(mainSource).toContain("modelCacheDir: () => sfxModelCacheDir(getStorageBasePath())");
    expect(mainSource).toContain("modelCacheDir: () => music3ModelCacheDir(getStorageBasePath())");
    expect(mainSource).not.toContain("modelCacheDir: () => ttsRuntimeController.getModelCacheDir()");
  });

  it("consolidates Chromium session data under <userData>/Chromium before the single-instance lock", () => {
    const setPathIndex = mainSource.indexOf("app.setPath('sessionData'");
    const lockIndex = mainSource.indexOf("requestSingleInstanceLock()");

    expect(setPathIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(setPathIndex);
    expect(mainSource.indexOf("ensureChromiumDataDir({ userDataPath: app.getPath('userData') })")).toBeGreaterThan(-1);
    // The cache stats/cleanup IPC must follow the redirected session root, not userData.
    expect(mainSource).toContain("sessionDataPath: app.getPath('sessionData')");
    // The migration manifest is an allow-list; app-managed roots must stay out of it.
    for (const appManaged of ["projects", "media", "TTS", "python", "logs", "skills", "assets"]) {
      expect(chromiumDataDirSource, `chromium-data-dir must not claim app-managed root: ${appManaged}`).not.toContain(`"${appManaged}"`);
    }
  });

  it("does not auto-start the TTS backend when the app becomes ready", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("  registerProtocolHandlers({"),
    );

    expect(readyBlock).not.toContain("ttsRuntimeController.start()");
  });

  it("keeps Remotion IPC registered during startup and disposes it only in lifecycle cleanup", () => {
    const readyBlock = mainSource.slice(mainSource.indexOf("app.whenReady().then"));
    const windowAllClosedBlock = mainSource.slice(
      mainSource.indexOf("app.on('window-all-closed'"),
      mainSource.indexOf("app.on('before-quit'"),
    );
    const beforeQuitBlock = mainSource.slice(
      mainSource.indexOf("app.on('before-quit'"),
      mainSource.indexOf("app.on('activate'"),
    );

    expect(readyBlock).toContain("await stopLocalSidecars()");
    expect(readyBlock).not.toContain("await stopAllLocalServices()");
    expect(windowAllClosedBlock).toContain("stopLocalServices: stopLocalSidecars");
    expect(beforeQuitBlock).toContain("stopLocalServices: stopAllLocalServices");
    expect(mainSource).toContain("disposeRemotionRuntime?.()");
    expect(mainSource).toContain("package.json 必须声明精确 Remotion 版本");
    expect(mainSource).not.toContain("?? '4.0.499'");
  });

  it("pins the Remotion render worker to the managed runtime and compositor directories", () => {
    expect(mainSource).toContain("resolveRemotionRuntimeDir(remotionUserDataDir)");
    expect(mainSource).toContain("binariesDirectory: remotionBinariesDirectory");
    expect(mainSource).toContain("workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs')");
  });

  it("uses extraResources backend sources instead of an app.asar cwd when packaged", () => {
    expect(mainSource).toContain("const videoWorkflowBackendRoot = app.isPackaged");
    expect(mainSource).toContain("path.join(process.resourcesPath, 'backend')");
    expect(mainSource).toContain("path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'backend')");
  });

  it("binds flat-shot projection to the accepted artifact and clean MP4 SHA", () => {
    const flatProjectionBlock = mainSource.slice(
      mainSource.indexOf("projectionGate.mode === 'flat-shot-mp4'"),
      mainSource.indexOf("const currentShotSlots: RemotionCurrentSlotV1[] = []"),
    );
    expect(flatProjectionBlock).toContain("videoUseFlatShotMp4Sha256");
    expect(flatProjectionBlock).toContain("clip.source.evidence.sourceFingerprint !== projectionGate.videoUseArtifactSha256");
    expect(flatProjectionBlock).toContain("crypto.createHash('sha256')");
    expect(flatProjectionBlock).toContain("flat-shot-mp4 clean MP4 SHA-256 已漂移");
  });

  it("does not initialize the independent asset library before asset IPC is used", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("  registerProtocolHandlers({"),
    );
    expect(readyBlock).not.toContain("assetsStorage.initAssetsStorage");
    expect(mainSource).toContain("registerAssetLibraryIpcHandlers");
    expect(assetLibraryIpcSource).toContain("const ensureAssetsStorageReady = () =>");
    expect(assetLibraryIpcSource).toContain("const storageBasePath = getStorageBasePath()");
    expect(assetLibraryIpcSource).toContain("assetsStorage.initAssetsStorage(storageBasePath)");
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
    expect(readyBlock).toContain("app.dock?.hide()");
  });

  it("keeps the renderer isolated from Node integration", () => {
    const windowBlock = mainSource.slice(
      mainSource.indexOf("win = new BrowserWindow"),
      mainSource.indexOf("// Open external links in system browser"),
    );

    expect(windowBlock).toContain("sandbox: true");
    expect(windowBlock).toContain("contextIsolation: true");
    expect(windowBlock).toContain("nodeIntegration: false");
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
    expect(handlerBlock).toContain('ipcMain.handle("assets:select-image-files"');
    expect(handlerBlock).toContain('properties: ["openFile", "multiSelections"]');
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

  it("resolves studio skill seed from frontend/assets, not legacy src/assets", () => {
    const manualsBlock = mainSource.slice(
      mainSource.indexOf("function getStudioManualsSourceRoot"),
      mainSource.indexOf("function getToonflowRuntimeStudioManualsSourceRoot"),
    );

    expect(manualsBlock).toContain("path.join(appRoot, 'frontend', 'assets', 'studio-manuals')");
    expect(manualsBlock).toContain("path.join(app.getAppPath(), 'frontend', 'assets', 'studio-manuals')");
    expect(manualsBlock).toContain("path.join(process.resourcesPath, 'studio-manuals')");
    expect(manualsBlock).not.toContain("'src', 'assets', 'studio-manuals'");
    expect(manualsBlock).not.toContain("src/assets/studio-manuals");
    expect(mainSource).toContain("ensureStudioSkillsSynced(getStudioSkillSyncOptions())");
    expect(mainSource).toContain("sourceRoot: getStudioManualsSourceRoot()");
    expect(mainSource).toContain("storageRoot: getSkillsRoot()");

    // Real on-disk seed that APP_ROOT/frontend/assets/studio-manuals must hit in dev
    // (APP_ROOT = apps/; source tree seed is apps/frontend/assets/studio-manuals).
    expect(existsSync(frontendStudioManualsSeed), frontendStudioManualsSeed).toBe(true);
    expect(existsSync(path.join(appsRootFromSource, "src", "assets", "studio-manuals"))).toBe(false);
    expect(
      existsSync(path.join(frontendStudioManualsSeed, "script_execution_skeleton.md")),
      "bundled agent skill seed markdown",
    ).toBe(true);
  });
});
