import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
  isPackaged: false,
  existsSync: vi.fn(() => true),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { get isPackaged() { return mocks.isPackaged; } },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: { openPath: mocks.openPath, showItemInFolder: mocks.showItemInFolder },
}));

vi.mock("node:fs", () => ({ default: { existsSync: mocks.existsSync } }));

import { registerAppShellIpcHandlers } from "./app-shell-ipc";

describe("registerAppShellIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.isPackaged = false;
    delete process.env.MYSTUDIO_ENABLE_DEVTOOLS;
    registerAppShellIpcHandlers({ resolveSourcePath: (value) => `/resolved/${value}` });
  });

  it("opens DevTools for the sender window in development builds", async () => {
    const openDevTools = vi.fn();
    mocks.fromWebContents.mockReturnValue({ webContents: { openDevTools } });
    await expect(mocks.handlers.get("app-devtools-open")?.({ sender: {} })).resolves.toEqual({ success: true });
    expect(openDevTools).toHaveBeenCalledWith({ mode: "detach" });
  });

  it("refuses DevTools in packaged builds unless the escape hatch is set", async () => {
    mocks.isPackaged = true;
    const openDevTools = vi.fn();
    mocks.fromWebContents.mockReturnValue({ webContents: { openDevTools } });
    await expect(mocks.handlers.get("app-devtools-open")?.({ sender: {} })).resolves.toEqual({
      success: false,
      error: "开发者工具仅开发环境可用",
    });
    expect(openDevTools).not.toHaveBeenCalled();

    process.env.MYSTUDIO_ENABLE_DEVTOOLS = "1";
    await expect(mocks.handlers.get("app-devtools-open")?.({ sender: {} })).resolves.toEqual({ success: true });
    expect(openDevTools).toHaveBeenCalledWith({ mode: "detach" });
  });

  it("validates and resolves paths before opening them", async () => {
    await expect(mocks.handlers.get("app-open-path")?.({}, "manual.pdf")).resolves.toEqual({ success: true });
    expect(mocks.openPath).toHaveBeenCalledWith("/resolved/manual.pdf");
    await expect(mocks.handlers.get("app-open-path")?.({}, "\0unsafe")).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });
  });

  it("rejects blank and non-string paths before resolving them", async () => {
    await expect(mocks.handlers.get("app-open-path")?.({}, "")).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });
    await expect(mocks.handlers.get("app-open-path")?.({}, "   ")).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });
    await expect(mocks.handlers.get("app-open-path")?.({}, 42)).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });

    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("returns the current file-missing and shell-open errors", async () => {
    mocks.existsSync.mockReturnValueOnce(false);

    await expect(mocks.handlers.get("app-open-path")?.({}, "missing.pdf")).resolves.toEqual({
      success: false,
      error: "文件不存在",
    });
    expect(mocks.openPath).not.toHaveBeenCalled();

    mocks.openPath.mockResolvedValueOnce("open failed");
    await expect(mocks.handlers.get("app-open-path")?.({}, "blocked.pdf")).resolves.toEqual({
      success: false,
      error: "open failed",
    });
  });

  it("refuses to open executable file types but still reveals them in folder", async () => {
    await expect(mocks.handlers.get("app-open-path")?.({}, "evil.command")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("可执行文件"),
    });
    await expect(mocks.handlers.get("app-open-path")?.({}, "evil.APP")).resolves.toMatchObject({
      success: false,
    });
    await expect(mocks.handlers.get("app-open-path")?.({}, "malware.bat")).resolves.toMatchObject({
      success: false,
    });
    expect(mocks.openPath).not.toHaveBeenCalled();

    await expect(mocks.handlers.get("app-show-in-folder")?.({}, "evil.command")).resolves.toEqual({ success: true });
    expect(mocks.showItemInFolder).toHaveBeenCalledWith("/resolved/evil.command");
  });

  it("stringifies resolver failures without changing the open-path contract", async () => {
    mocks.handlers.clear();
    registerAppShellIpcHandlers({
      resolveSourcePath: () => {
        throw new Error("resolver failed");
      },
    });

    await expect(mocks.handlers.get("app-open-path")?.({}, "manual.pdf")).resolves.toEqual({
      success: false,
      error: "resolver failed",
    });
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("reveals a file in the OS file manager via app-show-in-folder", async () => {
    await expect(mocks.handlers.get("app-show-in-folder")?.({}, "shot.png")).resolves.toEqual({ success: true });
    expect(mocks.showItemInFolder).toHaveBeenCalledWith("/resolved/shot.png");
  });

  it("validates app-show-in-folder paths with the same rules as open-path", async () => {
    await expect(mocks.handlers.get("app-show-in-folder")?.({}, "\0unsafe")).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });
    await expect(mocks.handlers.get("app-show-in-folder")?.({}, "")).resolves.toEqual({
      success: false,
      error: "无效文件路径",
    });
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();

    mocks.existsSync.mockReturnValueOnce(false);
    await expect(mocks.handlers.get("app-show-in-folder")?.({}, "missing.png")).resolves.toEqual({
      success: false,
      error: "文件不存在",
    });
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });
});
