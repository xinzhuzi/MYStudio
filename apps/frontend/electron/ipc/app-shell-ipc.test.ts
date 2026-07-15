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
});
