import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, assetStorageMocks, blessedPaths } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  blessedPaths: new Set<string>(),
  assetStorageMocks: {
    addAsset: vi.fn(),
    addAssetImage: vi.fn(),
    batchMatchAssets: vi.fn(),
    deleteAsset: vi.fn(),
    getAsset: vi.fn(),
    getAssetByName: vi.fn(),
    importFromToonflow: vi.fn(() => 0),
    initAssetsStorage: vi.fn(),
    listAssets: vi.fn(async () => []),
    removeAssetImage: vi.fn(),
    renameAssetImage: vi.fn(),
    replaceAssetMainImage: vi.fn(),
    updateAsset: vi.fn(),
  },
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));
vi.mock("../../storage/studio-assets-storage", () => assetStorageMocks);

import { dialog } from "electron";
import { registerAssetLibraryIpcHandlers } from "./asset-library-ipc";

const isSourcePathAllowed = (sourceFilePath: string) => (
  sourceFilePath.startsWith("/data/") || sourceFilePath.startsWith("/media/") || blessedPaths.has(sourceFilePath)
);
const blessDialogPaths = (paths: readonly string[]) => paths.forEach((p) => blessedPaths.add(p));

beforeEach(() => {
  handlers.clear();
  blessedPaths.clear();
  vi.mocked(dialog.showOpenDialog).mockReset();
});

function registerHandlers() {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath: () => "/data",
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
    isSourcePathAllowed,
    blessDialogPaths,
  });
}

function registerHandlersWithStorageBase(getStorageBasePath: () => string) {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath,
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
    isSourcePathAllowed,
    blessDialogPaths,
  });
}

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!;
}

describe("registerAssetLibraryIpcHandlers", () => {
  it("registers every independent asset-library channel without eager storage initialization", () => {
    registerHandlers();
    expect([...handlers.keys()].sort()).toEqual([
      "assets:add", "assets:add-image", "assets:batch-match", "assets:delete", "assets:get",
      "assets:get-by-name", "assets:import-from-toonflow", "assets:list", "assets:read-image-data-url", "assets:remove-image",
      "assets:rename-image", "assets:replace-image", "assets:select-audio-file", "assets:select-image-file", "assets:select-image-files", "assets:update",
    ]);
    expect(assetStorageMocks.initAssetsStorage).not.toHaveBeenCalled();
  });

  it("reinitializes asset storage when the unified storage root changes", async () => {
    let storageBasePath = "/data";
    registerHandlersWithStorageBase(() => storageBasePath);

    await getHandler("assets:list")({}, { type: "role" });
    await getHandler("assets:list")({}, { type: "role" });
    storageBasePath = "/new-data";
    await getHandler("assets:list")({}, { type: "role" });

    expect(assetStorageMocks.initAssetsStorage).toHaveBeenCalledTimes(2);
    expect(assetStorageMocks.initAssetsStorage).toHaveBeenNthCalledWith(1, "/data");
    expect(assetStorageMocks.initAssetsStorage).toHaveBeenNthCalledWith(2, "/new-data");
  });

  it("returns null when the asset image picker is canceled", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getHandler("assets:select-image-file")({})).resolves.toBeNull();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile"],
    }));
  });

  it("returns the selected audio file from the audio picker", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/media/dialogue.wav"],
    });

    await expect(getHandler("assets:select-audio-file")({})).resolves.toBe("/media/dialogue.wav");
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/media",
      properties: ["openFile"],
      filters: [{ name: "音频", extensions: ["aac", "flac", "m4a", "mp3", "ogg", "wav"] }],
    }));
  });

  it("returns every selected image from the multi-select picker", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/media/one.png", "/media/two.webp"],
    });

    await expect(getHandler("assets:select-image-files")({})).resolves.toEqual([
      "/media/one.png",
      "/media/two.webp",
    ]);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile", "multiSelections"],
    }));
  });

  it("returns an empty list when the multi-select picker is canceled", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getHandler("assets:select-image-files")({})).resolves.toEqual([]);
  });

  it("blesses picker results so later asset writes accept them", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/Users/x/Desktop/pick.png"],
    });

    await expect(getHandler("assets:select-image-file")({})).resolves.toBe("/Users/x/Desktop/pick.png");
    expect(blessedPaths.has("/Users/x/Desktop/pick.png")).toBe(true);
  });

  it("rejects asset source paths outside managed roots", async () => {
    registerHandlers();

    await expect(getHandler("assets:add-image")({}, {
      assetId: "a1", imageName: "main", sourceFilePath: "/Users/x/.ssh/id_rsa",
    })).rejects.toThrow(/不在应用允许的目录范围内/);
    await expect(getHandler("assets:replace-image")({}, {
      assetId: "a1", sourceFilePath: "/etc/passwd",
    })).rejects.toThrow(/不在应用允许的目录范围内/);
    await expect(getHandler("assets:add")({}, {
      type: "role", name: "r1", sourceFilePath: "/Users/x/.ssh/id_rsa",
    })).rejects.toThrow(/不在应用允许的目录范围内/);

    expect(assetStorageMocks.addAssetImage).not.toHaveBeenCalled();
    expect(assetStorageMocks.replaceAssetMainImage).not.toHaveBeenCalled();
    expect(assetStorageMocks.addAsset).not.toHaveBeenCalled();
  });

  it("accepts managed-root and dialog-blessed source paths", async () => {
    registerHandlers();
    assetStorageMocks.addAssetImage.mockReturnValueOnce({ id: "a1" });
    assetStorageMocks.replaceAssetMainImage.mockReturnValueOnce({ id: "a1" });
    blessDialogPaths(["/Users/x/Desktop/pick.png"]);

    await expect(getHandler("assets:add-image")({}, {
      assetId: "a1", imageName: "main", sourceFilePath: "/media/studio-assets/shot.png",
    })).resolves.toBeDefined();
    await expect(getHandler("assets:replace-image")({}, {
      assetId: "a1", sourceFilePath: "/Users/x/Desktop/pick.png",
    })).resolves.toBeDefined();

    expect(assetStorageMocks.addAssetImage).toHaveBeenCalledTimes(1);
    expect(assetStorageMocks.replaceAssetMainImage).toHaveBeenCalledTimes(1);
  });
});
