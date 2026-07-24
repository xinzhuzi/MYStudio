import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));

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
      "assets:rename-image", "assets:replace-image", "assets:select-image-file", "assets:update",
    ]);
  });

  it("returns null when the asset image picker is canceled", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getHandler("assets:select-image-file")({})).resolves.toBeNull();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile"],
    }));
  });
});
