import { describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));

import { registerAssetLibraryIpcHandlers } from "./asset-library-ipc";

describe("registerAssetLibraryIpcHandlers", () => {
  it("registers every independent asset-library channel without eager storage initialization", () => {
    registerAssetLibraryIpcHandlers({
      getStorageBasePath: () => "/data",
      getMediaRoot: () => "/media",
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog: vi.fn(),
    });
    expect([...handlers.keys()].sort()).toEqual([
      "assets:add", "assets:add-image", "assets:batch-match", "assets:delete", "assets:get",
      "assets:get-by-name", "assets:import-from-toonflow", "assets:list", "assets:remove-image",
      "assets:rename-image", "assets:replace-image", "assets:select-image-file", "assets:update",
    ]);
  });
});
