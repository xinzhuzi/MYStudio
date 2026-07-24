import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  readdir: vi.fn(),
  removeDirectory: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
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
    promises: {
      readdir: mocks.readdir,
      rm: mocks.removeDirectory,
    },
    readFileSync: mocks.readFileSync,
    renameSync: mocks.renameSync,
    unlinkSync: mocks.unlinkSync,
    writeFileSync: mocks.writeFileSync,
  },
}));

import { registerFileStorageIpcHandlers } from "./file-storage-ipc";

describe("registerFileStorageIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    registerFileStorageIpcHandlers({ getDataDir: () => "/data" });
  });

  it("registers the established file-storage channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "file-storage-exists",
      "file-storage-get",
      "file-storage-list",
      "file-storage-list-dirs",
      "file-storage-remove",
      "file-storage-remove-dir",
      "file-storage-rename",
      "file-storage-set",
    ]);
  });

  it("reads and writes only normalized storage-key paths", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("stored value");

    await expect(mocks.handlers.get("file-storage-get")?.({}, "projects/scene")).resolves.toBe("stored value");
    await expect(mocks.handlers.get("file-storage-set")?.({}, "projects/scene", "next value")).resolves.toBe(true);
    expect(mocks.readFileSync).toHaveBeenCalledWith("/data/projects/scene.json", "utf-8");
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/data/projects", { recursive: true });
    expect(mocks.writeFileSync).toHaveBeenCalledWith("/data/projects/scene.json", "next value", "utf-8");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(mocks.handlers.get("file-storage-set")?.({}, "../outside", "blocked")).resolves.toBe(false);
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("does not rename when the source is missing or the target already exists", async () => {
    mocks.existsSync.mockReturnValueOnce(false);
    await expect(mocks.handlers.get("file-storage-rename")?.({}, "projects/from", "projects/to")).resolves.toBe(false);

    mocks.existsSync.mockReset();
    mocks.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
    await expect(mocks.handlers.get("file-storage-rename")?.({}, "projects/from", "projects/to")).resolves.toBe(false);

    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.renameSync).not.toHaveBeenCalled();
  });

  it("returns stable absence results when a storage directory is missing", async () => {
    await expect(mocks.handlers.get("file-storage-exists")?.({}, "projects/scene")).resolves.toBe(false);
    await expect(mocks.handlers.get("file-storage-remove")?.({}, "projects/scene")).resolves.toBe(true);
    await expect(mocks.handlers.get("file-storage-list")?.({}, "projects")).resolves.toEqual([]);
    await expect(mocks.handlers.get("file-storage-list-dirs")?.({}, "projects")).resolves.toEqual([]);
    await expect(mocks.handlers.get("file-storage-remove-dir")?.({}, "projects")).resolves.toBe(true);
    expect(mocks.readdir).not.toHaveBeenCalled();
    expect(mocks.removeDirectory).not.toHaveBeenCalled();
  });
});
