import { BrowserWindow } from "electron";

/**
 * Safe defaults for any MYStudio-owned login window. The upstream snapshot
 * currently hard-codes `contextIsolation: false`; it is read-only, so the
 * local integration does not expose those vendor windows to the renderer and
 * keeps this policy ready for the next vendor window factory migration.
 */
export const LOCAL_LOGIN_WINDOW_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export class LoginWindowClosedError extends Error {
  constructor() {
    super("登录窗口已关闭，授权未完成");
    this.name = "LoginWindowClosedError";
  }
}

type WindowLike = { readonly id: number };

export type LoginWindowCancellationOptions = {
  pollIntervalMs?: number;
  getWindows?: () => readonly WindowLike[];
};

type BrowserWindowLike = {
  webContents?: {
    isDestroyed?: () => boolean;
    openDevTools?: (...args: unknown[]) => unknown;
  };
};

type BrowserWindowConstructorLike = {
  prototype: {
    destroy: (this: BrowserWindowLike, ...args: unknown[]) => unknown;
  };
};

/**
 * One vendor snapshot calls `openDevTools()` immediately after destroying the
 * Douyin window. Guard that call only for the duration of the login operation
 * so a successful cookie/localStorage result cannot be followed by a destroyed
 * WebContents exception. This is intentionally a compatibility shim rather
 * than a vendor edit.
 */
export function withDestroyedWindowDevToolsGuard<T>(
  operation: () => Promise<T>,
  windowConstructor: BrowserWindowConstructorLike = BrowserWindow as unknown as BrowserWindowConstructorLike,
): Promise<T> {
  const prototype = windowConstructor.prototype;
  const originalDestroy = prototype.destroy;
  prototype.destroy = function guardedDestroy(this: BrowserWindowLike, ...args: unknown[]) {
    const webContents = this.webContents;
    const openDevTools = webContents?.openDevTools;
    if (webContents && openDevTools) {
      webContents.openDevTools = (...openArgs: unknown[]) => {
        if (webContents.isDestroyed?.()) return undefined;
        return openDevTools(...openArgs);
      };
    }
    return originalDestroy.apply(this, args);
  };

  return Promise.resolve()
    .then(operation)
    .finally(() => {
      prototype.destroy = originalDestroy;
    });
}

/**
 * Vendor login methods resolve only after polling their BrowserWindow. Race
 * them against the window disappearing so a user closing the window cannot
 * leave the renderer in an eternal "登录中" state.
 */
export function withLoginWindowCloseCancellation<T>(
  operation: () => Promise<T>,
  options: LoginWindowCancellationOptions = {},
): Promise<T> {
  const getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows());
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const before = new Set(getWindows().map((window) => window.id));
  let sawLoginWindow = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const cancellation = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      const hasNewWindow = getWindows().some((window) => !before.has(window.id));
      if (hasNewWindow) sawLoginWindow = true;
      if (sawLoginWindow && !getWindows().some((window) => !before.has(window.id))) {
        reject(new LoginWindowClosedError());
      }
    }, pollIntervalMs);
  });

  return Promise.race([operation(), cancellation]).finally(() => {
    if (timer) clearInterval(timer);
  });
}
