import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  const windows: any[] = [];
  class MockEmitter {
    listeners = new Map<string, Listener[]>();
    on(name: string, listener: Listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); return this; }
    once(name: string, listener: Listener) { return this.on(name, listener); }
    emit(name: string, ...args: any[]) { for (const listener of this.listeners.get(name) ?? []) listener(...args); }
  }
  class MockBrowserWindow extends MockEmitter {
    options: any;
    destroyed = false;
    webContents = Object.assign(new MockEmitter(), { setWindowOpenHandler: vi.fn() });
    loadURL = vi.fn(async () => undefined);
    show = vi.fn();
    constructor(options: any) { super(); this.options = options; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; this.emit("closed"); }
  }
  return { BrowserWindow: MockBrowserWindow, windows };
});

vi.mock("electron", () => electron);

import { openOAuthAuthorizationWindow } from "./oauth-window";

describe("official platform OAuth window", () => {
  beforeEach(() => {
    electron.windows.length = 0;
    vi.clearAllMocks();
  });

  it("uses an isolated sandbox and resolves only the validated callback", async () => {
    const result = openOAuthAuthorizationWindow({
      platformId: "twitter",
      authorizationUrl: "https://x.test/oauth",
      redirectUri: "https://localhost/mystudio/oauth",
      expectedState: "state-1",
    });
    const window = electron.windows[0];
    expect(window.options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
    const event = { preventDefault: vi.fn() };
    window.webContents.emit("will-redirect", event, "https://localhost/mystudio/oauth?state=state-1&code=code-1");
    await expect(result).resolves.toMatchObject({ search: "?state=state-1&code=code-1" });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched state and closes the window", async () => {
    const result = openOAuthAuthorizationWindow({
      platformId: "youtube",
      authorizationUrl: "https://accounts.test/oauth",
      redirectUri: "https://localhost/mystudio/oauth",
      expectedState: "state-1",
    });
    const window = electron.windows[0];
    window.webContents.emit("will-navigate", { preventDefault: vi.fn() }, "https://localhost/mystudio/oauth?state=wrong&code=code-1");
    await expect(result).rejects.toThrow("state 校验失败");
    expect(window.destroyed).toBe(true);
  });
});
