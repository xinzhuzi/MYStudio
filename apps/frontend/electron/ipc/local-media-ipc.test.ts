import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 3 })),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from("image")),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
    statSync: mocks.statSync,
    unlinkSync: mocks.unlinkSync,
    readFileSync: mocks.readFileSync,
    renameSync: mocks.renameSync,
    copyFileSync: mocks.copyFileSync,
    createWriteStream: vi.fn(),
  },
}));

import { registerLocalMediaIpcHandlers } from "./local-media-ipc";

describe("registerLocalMediaIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    registerLocalMediaIpcHandlers({ getMediaRoot: () => "/media" });
  });

  it("registers the established local media channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "delete-image",
      "get-absolute-path",
      "get-image-path",
      "move-image",
      "read-image-base64",
      "save-image",
    ]);
  });

  it("decodes data URLs into a category-scoped local image", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "data:image/png;base64,aW1hZ2U=",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({
      success: true,
      localPath: "local-image://storyboards/1000_.png",
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      "/media/storyboards/1000_.png",
      Buffer.from("image"),
    );
  });

  it("rejects an unsafe move category without changing files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(mocks.handlers.get("move-image")?.({}, {
      localPath: "local-image://storyboards/frame.png",
      category: "../outside",
    })).resolves.toEqual({ success: false, error: "Error: Invalid media category" });
    expect(mocks.renameSync).not.toHaveBeenCalled();
  });
});
