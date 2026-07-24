import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
  existsSync: vi.fn(() => true),
  openPath: vi.fn(async () => ""),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: { openPath: mocks.openPath },
}));

vi.mock("node:fs", () => ({ default: { existsSync: mocks.existsSync } }));

import { registerAppShellIpcHandlers } from "./app-shell-ipc";

describe("registerAppShellIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    registerAppShellIpcHandlers({ resolveSourcePath: (value) => `/resolved/${value}` });
  });

  it("opens DevTools for the sender window", async () => {
    const openDevTools = vi.fn();
    mocks.fromWebContents.mockReturnValue({ webContents: { openDevTools } });
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
});
