import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, existsSync, mkdirSync, readdir, rm, cp } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn((..._args: unknown[]) => false),
  mkdirSync: vi.fn(),
  readdir: vi.fn(async (..._args: unknown[]) => [] as string[]),
  rm: vi.fn(async (..._args: unknown[]) => undefined),
  cp: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    emit: vi.fn(() => true),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
  },
}));
vi.mock("node:fs", () => ({
  default: {
    existsSync,
    mkdirSync,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: { readdir, rm, cp },
  },
}));

import { createStorageManager } from "./storage-manager";

describe("createStorageManager", () => {
  beforeEach(() => {
    handlers.clear();
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
    readdir.mockReset();
    readdir.mockResolvedValue([]);
    rm.mockReset();
    cp.mockReset();
  });

  it("keeps default paths project-scoped and registers the complete storage channel set", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    expect(await handlers.get("storage-get-paths")?.()).toEqual({
      basePath: "/user-data",
      projectPath: "/user-data/projects",
      mediaPath: "/user-data/media",
      skillsPath: "/user-data/skills",
      cachePath: "/user-data/Cache",
    });
    expect(handlers.size).toBe(19);
  });

  it("returns the unified validation response from the legacy project channel", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await expect(handlers.get("storage-validate-project-dir")?.(null, "")).resolves.toEqual({
      valid: false,
      error: "路径不能为空",
    });
  });

  it("preserves explicit error and legacy response contracts", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await expect(handlers.get("storage-link-data")?.(null, "")).resolves.toEqual({
      success: false,
      error: "路径不能为空",
    });
    await expect(handlers.get("storage-move-project-data")?.()).resolves.toEqual({
      success: false,
      error: "请使用新的统一存储路径功能",
    });
  });

  it("returns the boolean result for storage configuration updates", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await expect(handlers.get("storage-update-config")?.(null, {
      autoCleanEnabled: false,
      autoCleanDays: 14,
    })).resolves.toBe(true);
  });

  it("returns counts for a valid data directory and rejects an empty data root", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    existsSync.mockImplementation((candidate?: unknown) => (
      candidate === "/data" || candidate === "/data/projects" || candidate === "/data/media"
    ));
    readdir.mockImplementation(async (candidate?: unknown) => (
      candidate === "/data/projects" ? ["project.json", "README.md"] : ["cover.png"]
    ));

    await expect(handlers.get("storage-validate-data-dir")?.(null, "/data")).resolves.toEqual({
      valid: true,
      projectCount: 1,
      mediaCount: 1,
      skillCount: 0,
    });

    existsSync.mockImplementation((candidate?: unknown) => candidate === "/empty");
    await expect(handlers.get("storage-link-data")?.(null, "/empty")).resolves.toEqual({
      success: false,
      error: "该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）",
    });
  });

  it("does not destroy data when a legacy import points at the active storage root", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await expect(handlers.get("storage-import-project-data")?.(null, "/user-data/")).resolves.toEqual({
      success: true,
    });
    await expect(handlers.get("storage-import-project-data")?.(null, "/user-data/projects/")).resolves.toEqual({
      success: true,
    });
    expect(rm).not.toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
  });
});
