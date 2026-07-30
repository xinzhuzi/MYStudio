import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import {
  LOCAL_LOGIN_WINDOW_PREFERENCES,
  LoginWindowClosedError,
  withDestroyedWindowDevToolsGuard,
  withLoginWindowCloseCancellation,
} from "./login-window";

describe("local login window compatibility", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("defines secure defaults for MYStudio-owned login windows", () => {
    expect(LOCAL_LOGIN_WINDOW_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it("rejects a vendor login promise when its newly-created window closes", async () => {
    vi.useFakeTimers();
    let windows: readonly { id: number }[] = [{ id: 1 }];
    const pending = withLoginWindowCloseCancellation(
      () => new Promise<never>(() => undefined),
      { pollIntervalMs: 10, getWindows: () => windows },
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(LoginWindowClosedError);

    windows = [{ id: 1 }, { id: 2 }];
    await vi.advanceTimersByTimeAsync(10);
    windows = [{ id: 1 }];
    await vi.advanceTimersByTimeAsync(10);

    await rejection;
  });

  it("preserves a successful vendor result before the window disappears", async () => {
    vi.useFakeTimers();
    let windows: readonly { id: number }[] = [{ id: 1 }];
    const result = withLoginWindowCloseCancellation(
      async () => "authorized",
      { pollIntervalMs: 10, getWindows: () => windows },
    );

    await expect(result).resolves.toBe("authorized");
    windows = [{ id: 1 }];
  });

  it("guards the destroyed-window DevTools call used by the Douyin snapshot", async () => {
    const openDevTools = vi.fn();
    const originalDestroy = vi.fn(function destroy(this: { webContents: { isDestroyed: () => boolean } }) {
      return this.webContents.isDestroyed();
    });
    const windowConstructor = { prototype: { destroy: originalDestroy } };
    const window = {
      webContents: {
        isDestroyed: () => true,
        openDevTools,
      },
    };

    await expect(withDestroyedWindowDevToolsGuard(async () => {
      windowConstructor.prototype.destroy.call(window);
      window.webContents.openDevTools();
      return "authorized";
    }, windowConstructor)).resolves.toBe("authorized");
    expect(originalDestroy).toHaveBeenCalledOnce();
    expect(openDevTools).not.toHaveBeenCalled();
    expect(windowConstructor.prototype.destroy).toBe(originalDestroy);
  });
});
