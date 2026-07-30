import { BrowserWindow } from "electron";
import type { PlatformId } from "../platform-types";
import { assertOAuthCallback } from "./oauth-state";

export interface OAuthWindowRequest {
  platformId: PlatformId;
  authorizationUrl: string;
  redirectUri: string;
  expectedState: string;
  timeoutMs?: number;
  parent?: BrowserWindow;
}

function isRedirectTarget(value: string, redirectUri: string): boolean {
  try {
    const target = new URL(value);
    const redirect = new URL(redirectUri);
    return target.origin === redirect.origin && target.pathname === redirect.pathname;
  } catch {
    return false;
  }
}

export function openOAuthAuthorizationWindow(request: OAuthWindowRequest): Promise<URL> {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      width: 860,
      height: 760,
      show: false,
      autoHideMenuBar: true,
      title: `${request.platformId} 授权`,
      ...(request.parent ? { parent: request.parent } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: `mystudio-self-media-oauth-${request.platformId}`,
      },
    });
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("OAuth 授权超时")), request.timeoutMs ?? 5 * 60_000);

    const finish = (error?: Error, callback?: URL) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!window.isDestroyed()) window.close();
      if (error) reject(error);
      else if (callback) resolve(callback);
      else reject(new Error("OAuth 授权未完成"));
    };
    const capture = (event: { preventDefault: () => void }, url: string) => {
      if (!isRedirectTarget(url, request.redirectUri)) return;
      event.preventDefault();
      try {
        finish(undefined, assertOAuthCallback(url, request.redirectUri, request.expectedState));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-redirect", capture);
    window.webContents.on("will-navigate", capture);
    window.once("ready-to-show", () => window.show());
    window.once("closed", () => finish(new Error("OAuth 授权窗口已关闭")));
    void window.loadURL(request.authorizationUrl).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
