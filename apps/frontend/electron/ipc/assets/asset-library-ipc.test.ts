import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, assetStorageMocks } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
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

beforeEach(() => {
  handlers.clear();
  vi.mocked(dialog.showOpenDialog).mockReset();
});

function registerHandlers() {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath: () => "/data",
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
  });
}

function registerHandlersWithStorageBase(getStorageBasePath: () => string) {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath,
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
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
      "assets:get-by-name", "assets:import-from-toonflow", "assets:list", "assets:remove-image",
      "assets:rename-image", "assets:replace-image", "assets:select-image-file", "assets:select-image-files", "assets:update",
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
});
