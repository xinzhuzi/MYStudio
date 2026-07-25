import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(() => true),
  copyFileSync: vi.fn(),
  showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "/exports/video.mp4" })),
}));

vi.mock("electron", () => ({
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));
vi.mock("node:fs", () => ({ default: { existsSync: mocks.existsSync, copyFileSync: mocks.copyFileSync } }));

import { registerFileExportIpcHandlers } from "./file-export-ipc";
const { handlers } = mocks;

describe("registerFileExportIpcHandlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    registerFileExportIpcHandlers({ getDataDir: () => "/data", getMediaRoot: () => "/media" });
  });

  it("resolves project files and copies the selected export", async () => {
    await expect(handlers.get("save-file-dialog")?.({}, {
      localPath: "project-file://project-a/videos/final.mp4",
      defaultPath: "final.mp4",
      filters: [{ name: "Video", extensions: ["mp4"] }],
    })).resolves.toEqual({ success: true, filePath: "/exports/video.mp4" });
    expect(mocks.copyFileSync).toHaveBeenCalledWith(
      "/data/_p/project-a/videos/final.mp4",
      "/exports/video.mp4",
    );
  });

  it("preserves the canceled result", async () => {
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: "" });
    await expect(handlers.get("save-file-dialog")?.({}, {
      localPath: "/tmp/video.mp4",
      defaultPath: "video.mp4",
      filters: [],
    })).resolves.toEqual({ success: false, canceled: true });
  });
});
