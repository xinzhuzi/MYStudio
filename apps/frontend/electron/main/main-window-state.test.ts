import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const electronMock = vi.hoisted(() => ({
  app: { getPath: vi.fn() },
  screen: {
    getAllDisplays: vi.fn(),
    getPrimaryDisplay: vi.fn(),
  },
}));

vi.mock("electron", () => electronMock);

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  loadRestoredWindowState,
  trackWindowState,
} from "./main-window-state";

const DISPLAY = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
};
const SECOND_DISPLAY = {
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1920, y: 25, width: 2560, height: 1415 },
};

let userDataDir: string;

function stateFilePath(): string {
  return path.join(userDataDir, "window-state.json");
}

function writeStateFile(state: unknown): void {
  writeFileSync(stateFilePath(), JSON.stringify(state));
}

function createFakeWindow(initial: { x: number; y: number; width: number; height: number }) {
  const win = new EventEmitter() as unknown as BrowserWindow & {
    setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
    setMaximized: (maximized: boolean) => void;
  };
  let bounds = { ...initial };
  let maximized = false;
  Object.assign(win, {
    getBounds: () => ({ ...bounds }),
    isMaximized: () => maximized,
    isMinimized: () => false,
    isFullScreen: () => false,
    isDestroyed: () => false,
    setWindowBounds: (next: typeof bounds) => {
      bounds = { ...next };
      win.emit("resize");
      win.emit("move");
    },
    setMaximized: (next: boolean) => {
      maximized = next;
      win.emit("resize");
    },
  });
  return win;
}

describe("loadRestoredWindowState", () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "mystudio-window-state-"));
    electronMock.app.getPath.mockReturnValue(userDataDir);
    electronMock.screen.getAllDisplays.mockReturnValue([DISPLAY]);
    electronMock.screen.getPrimaryDisplay.mockReturnValue(DISPLAY);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("无状态文件时回退默认(不恢复任何几何)", () => {
    expect(loadRestoredWindowState()).toEqual({ bounds: null, isMaximized: false });
  });

  it("JSON 损坏时静默回退默认", () => {
    writeFileSync(stateFilePath(), "{ not json");
    expect(loadRestoredWindowState()).toEqual({ bounds: null, isMaximized: false });
  });

  it("显示器内的完整 bounds 原样恢复", () => {
    writeStateFile({ x: 120, y: 80, width: 1400, height: 900, isMaximized: false });
    expect(loadRestoredWindowState()).toEqual({
      bounds: { x: 120, y: 80, width: 1400, height: 900 },
      isMaximized: false,
    });
  });

  it("多显示器时任一块显示器内的窗口均有效", () => {
    electronMock.screen.getAllDisplays.mockReturnValue([DISPLAY, SECOND_DISPLAY]);
    writeStateFile({ x: 2000, y: 100, width: 1400, height: 900, isMaximized: false });
    expect(loadRestoredWindowState().bounds).toEqual({ x: 2000, y: 100, width: 1400, height: 900 });
  });

  it("显示器被拔走(整窗在所有屏外)时丢弃 bounds 仅保留最大化标记", () => {
    writeStateFile({ x: 5000, y: 100, width: 1400, height: 900, isMaximized: true });
    expect(loadRestoredWindowState()).toEqual({ bounds: null, isMaximized: true });
  });

  it("半截出屏的 bounds 判为无效", () => {
    writeStateFile({ x: -200, y: 80, width: 1400, height: 900, isMaximized: false });
    expect(loadRestoredWindowState().bounds).toBeNull();
  });

  it("非整数或非正尺寸判为无效", () => {
    writeStateFile({ x: 100, y: 80.5, width: 1400, height: 900, isMaximized: false });
    expect(loadRestoredWindowState().bounds).toBeNull();
    writeStateFile({ x: 100, y: 80, width: 0, height: 900, isMaximized: false });
    expect(loadRestoredWindowState().bounds).toBeNull();
  });
});

describe("trackWindowState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    userDataDir = mkdtempSync(path.join(tmpdir(), "mystudio-window-state-"));
    electronMock.app.getPath.mockReturnValue(userDataDir);
    electronMock.screen.getAllDisplays.mockReturnValue([DISPLAY]);
    electronMock.screen.getPrimaryDisplay.mockReturnValue(DISPLAY);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("缩放窗口后关闭:新几何落盘并可再次恢复", () => {
    const win = createFakeWindow({ x: 100, y: 100, width: 1400, height: 900 });
    trackWindowState(win as BrowserWindow);

    win.setWindowBounds({ x: 260, y: 120, width: 1600, height: 940 });
    vi.advanceTimersByTime(150);
    win.emit("close");
    win.emit("closed");

    const restored = loadRestoredWindowState();
    expect(restored).toEqual({
      bounds: { x: 260, y: 120, width: 1600, height: 940 },
      isMaximized: false,
    });
  });

  it("最大化态关闭:保留 normal bounds 并落盘最大化标记", () => {
    const win = createFakeWindow({ x: 260, y: 120, width: 1400, height: 900 });
    trackWindowState(win as BrowserWindow);

    // 窗口先以 normal 态被采样入内存,之后用户最大化
    win.emit("move");
    vi.advanceTimersByTime(150);
    win.setMaximized(true);
    vi.advanceTimersByTime(150);
    win.emit("close");
    win.emit("closed");

    const restored = loadRestoredWindowState();
    expect(restored).toEqual({
      bounds: { x: 260, y: 120, width: 1400, height: 900 },
      isMaximized: true,
    });
  });

  it("启动即最大化且全程未缩放:用居中默认尺寸兜底,不把全屏 bounds 当正常尺寸存", () => {
    const maximizedBounds = { ...DISPLAY.workArea };
    const win = createFakeWindow(maximizedBounds);
    (win as unknown as { isMaximized: () => boolean }).isMaximized = () => true;
    trackWindowState(win as BrowserWindow);

    win.emit("close");
    win.emit("closed");

    const restored = loadRestoredWindowState();
    expect(restored.isMaximized).toBe(true);
    expect(restored.bounds).toEqual({
      x: Math.floor((DISPLAY.workArea.width - DEFAULT_WINDOW_WIDTH) / 2),
      y: DISPLAY.workArea.y + Math.floor((DISPLAY.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2),
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });
  });

  it("会话内先最大化再还原:最终 normal bounds 覆盖最大化标记", () => {
    const win = createFakeWindow({ x: 260, y: 120, width: 1400, height: 900 });
    trackWindowState(win as BrowserWindow);

    win.setMaximized(true);
    vi.advanceTimersByTime(150);
    win.setMaximized(false);
    vi.advanceTimersByTime(150);
    win.emit("close");
    win.emit("closed");

    expect(loadRestoredWindowState().isMaximized).toBe(false);
  });

  it("防抖窗口内立即关闭:close 同步采样,几何不丢", () => {
    const win = createFakeWindow({ x: 100, y: 100, width: 1400, height: 900 });
    trackWindowState(win as BrowserWindow);

    win.setWindowBounds({ x: 300, y: 120, width: 1500, height: 940 });
    win.emit("close");
    win.emit("closed");

    expect(loadRestoredWindowState().bounds).toEqual({ x: 300, y: 120, width: 1500, height: 940 });
  });
});
