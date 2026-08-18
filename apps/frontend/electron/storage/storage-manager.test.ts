import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, existsSync, mkdirSync, readdir, rm, cp, readFileSync, writeFileSync, rmSync, showOpenDialog, showMessageBox } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn((..._args: unknown[]) => false),
  mkdirSync: vi.fn(),
  readdir: vi.fn(async (..._args: unknown[]) => [] as string[]),
  rm: vi.fn(async (..._args: unknown[]) => undefined),
  cp: vi.fn(async (..._args: unknown[]) => undefined),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  showMessageBox: vi.fn(async () => ({ response: 1 })),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog, showMessageBox },
  ipcMain: {
    emit: vi.fn(() => true),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
  },
}));
vi.mock("node:fs", () => ({
  default: {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
    promises: { readdir, rm, cp },
  },
}));

import { createStorageManager } from "./storage-manager";

/** 模拟用户经原生目录选择器选中 dir(守卫要求高危操作的路径必须来自对话框)。 */
async function selectDirViaDialog(dir: string) {
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] });
  await handlers.get("storage-select-directory")?.(null, undefined);
}

describe("createStorageManager", () => {
  beforeEach(() => {
    handlers.clear();
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
    mkdirSync.mockReset();
    readdir.mockReset();
    readdir.mockResolvedValue([]);
    rm.mockReset();
    rm.mockResolvedValue(undefined);
    cp.mockReset();
    cp.mockResolvedValue(undefined);
    readFileSync.mockReset();
    readFileSync.mockReturnValue(undefined);
    writeFileSync.mockReset();
    writeFileSync.mockImplementation(() => undefined);
    rmSync.mockReset();
  });

  it("keeps default paths project-scoped and registers the complete storage channel set", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    expect(await handlers.get("storage-get-paths")?.()).toEqual({
      basePath: "/user-data",
      projectPath: "/user-data/projects",
      mediaPath: "/user-data/media",
      assetsPath: "/user-data/assets",
      skillsPath: "/user-data/skills",
      pythonRuntimeDir: "/user-data/python",
      modelCacheDir: "/user-data/TTS/model",
      cachePath: "/user-data/Cache",
    });
    expect(handlers.size).toBe(19);
  });

  it("routes cache stats and cleanup through the Chromium session-data root when provided", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data", sessionDataPath: "/user-data/Chromium" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await expect(handlers.get("storage-get-paths")?.()).resolves.toMatchObject({
      cachePath: "/user-data/Chromium/Cache",
    });

    readdir.mockResolvedValue([]);
    await expect(handlers.get("storage-get-cache-size")?.()).resolves.toEqual({
      total: 0,
      details: [
        { path: "/user-data/Chromium/Cache", size: 0 },
        { path: "/user-data/Chromium/Code Cache", size: 0 },
        { path: "/user-data/Chromium/GPUCache", size: 0 },
      ],
    });

    await expect(handlers.get("storage-clear-cache")?.()).resolves.toEqual({ success: true, clearedBytes: 0 });
    expect(rm).toHaveBeenCalledWith("/user-data/Chromium/Cache", { recursive: true, force: true });
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
      assetCount: 0,
    });

    existsSync.mockImplementation((candidate?: unknown) => candidate === "/empty");
    await selectDirViaDialog("/empty");
    await expect(handlers.get("storage-link-data")?.(null, "/empty")).resolves.toEqual({
      success: false,
      error: "该目录不包含有效的数据（需要 projects/、media/、assets/ 或 skills/ 子目录）",
    });
  });

  it("recognizes an existing assets library as unified storage data", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    existsSync.mockImplementation((candidate?: unknown) => candidate === "/assets-only" || candidate === "/assets-only/assets");
    readdir.mockResolvedValue(["assets.db", "files"]);

    await expect(handlers.get("storage-validate-data-dir")?.(null, "/assets-only")).resolves.toEqual({
      valid: true,
      projectCount: 0,
      mediaCount: 0,
      skillCount: 0,
      assetCount: 2,
    });
  });

  it("includes assets in move and export operations", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    existsSync.mockImplementation((candidate?: unknown) => (
      candidate === "/user-data/assets" || candidate === "/user-data/projects" || candidate === "/user-data/media" || candidate === "/user-data/skills"
    ));
    readdir.mockResolvedValue(["entry"]);

    await selectDirViaDialog("/new-data");
    await expect(handlers.get("storage-move-data")?.(null, "/new-data")).resolves.toEqual({
      success: true,
      path: "/new-data",
    });
    expect(cp).toHaveBeenCalledWith("/user-data/assets/entry", "/new-data/assets/entry", { recursive: true, force: true });

    cp.mockClear();
    await selectDirViaDialog("/backup");
    await expect(handlers.get("storage-export-data")?.(null, "/backup")).resolves.toMatchObject({ success: true });
    expect(cp).toHaveBeenCalledWith("/new-data/assets", expect.stringMatching(/\/assets$/), { recursive: true, force: true });
  });

  it("imports the assets category with the same category-level replacement flow", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    existsSync.mockImplementation((candidate?: unknown) => (
      candidate === "/incoming/assets" || candidate === "/user-data/assets"
    ));
    readdir.mockResolvedValue([]);

    await selectDirViaDialog("/incoming");
    await expect(handlers.get("storage-import-data")?.(null, "/incoming")).resolves.toEqual({ success: true });
    expect(rm).toHaveBeenCalledWith("/user-data/assets", { recursive: true, force: true });
    expect(cp).toHaveBeenCalledWith("/incoming/assets", "/user-data/assets", { recursive: true, force: true });
  });

  it("does not destroy data when a legacy import points at the active storage root", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await selectDirViaDialog("/user-data/");
    await expect(handlers.get("storage-import-project-data")?.(null, "/user-data/")).resolves.toEqual({
      success: true,
    });
    await selectDirViaDialog("/user-data/projects/");
    await expect(handlers.get("storage-import-project-data")?.(null, "/user-data/projects/")).resolves.toEqual({
      success: true,
    });
    expect(rm).not.toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
  });

  it("rolls back a partial unified import when the injected copy fails", async () => {
    const copyFailure = vi.fn(async () => { throw new Error("copy failed"); });
    const remove = vi.fn(async () => undefined);
    const manager = createStorageManager({
      userDataPath: "/user-data",
      fileOps: { cp: copyFailure, remove },
    });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    existsSync.mockImplementation((candidate?: unknown) => candidate === "/incoming/assets");
    await selectDirViaDialog("/incoming");

    await expect(handlers.get("storage-import-data")?.(null, "/incoming")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("copy failed"),
    });
    expect(remove).toHaveBeenCalledWith("/user-data/assets", { recursive: true, force: true });
  });

  it("cleans an incomplete export when a later category copy fails", async () => {
    let copyCount = 0;
    const copy = vi.fn(async () => {
      copyCount += 1;
      if (copyCount === 2) throw new Error("export copy failed");
    });
    const remove = vi.fn(async () => undefined);
    const manager = createStorageManager({ userDataPath: "/user-data", fileOps: { cp: copy, remove } });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });

    await selectDirViaDialog("/backup");
    await expect(handlers.get("storage-export-data")?.(null, "/backup")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("export copy failed"),
    });
    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/^\/backup\/mystudio-data-/), { recursive: true, force: true });
  });

  it("keeps the old storage config when a move cannot persist its new root", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    existsSync.mockImplementation((candidate?: unknown) => (
      candidate === "/user-data/storage-config.json"
      || candidate === "/user-data/projects"
      || candidate === "/user-data/projects/entry"
    ));
    readFileSync.mockReturnValue('{"basePath":""}');
    readdir.mockResolvedValue(["entry"]);
    writeFileSync.mockImplementation(() => { throw new Error("config write failed"); });

    await selectDirViaDialog("/new-data");
    await expect(handlers.get("storage-move-data")?.(null, "/new-data")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("无法保存存储配置"),
    });
    expect(manager.getStorageBasePath()).toBe("/user-data");
    expect(mkdirSync).not.toHaveBeenCalledWith("/new-data/assets", { recursive: true });
  });

  it("refuses storage operations on directories that never went through the picker", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    existsSync.mockReturnValue(true);

    for (const channel of ["storage-link-data", "storage-move-data", "storage-export-data", "storage-import-data"]) {
      await expect(handlers.get(channel)?.(null, "/attacker-chosen-dir")).resolves.toEqual({
        success: false,
        error: "目录必须通过应用内的目录选择器选择后才能操作",
      });
    }
    await expect(handlers.get("storage-link-project-data")?.(null, "/attacker/projects")).resolves.toMatchObject({
      success: false,
    });
    expect(cp).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it("returns null without blessing when the directory picker is canceled", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    await expect(handlers.get("storage-select-directory")?.(null, undefined)).resolves.toBeNull();
    await expect(handlers.get("storage-link-data")?.(null, "/anywhere")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("目录选择器"),
    });
  });

  it("aborts the import when the native confirmation dialog is dismissed", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    existsSync.mockImplementation((candidate?: unknown) => candidate === "/incoming/assets");
    showMessageBox.mockClear();
    showMessageBox.mockResolvedValueOnce({ response: 0 });

    await selectDirViaDialog("/incoming");
    await expect(handlers.get("storage-import-data")?.(null, "/incoming")).resolves.toEqual({
      success: false,
      error: "已取消导入",
    });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(rm).not.toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
  });
});
