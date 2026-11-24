/**
 * IPC 可信帧守卫——只接受本应用主窗口的调用,拒绝子框架/外部页面/非本应用窗口。
 * product-ipc.ts 与 self-media-ipc.ts 共享此守卫,消除代码重复。
 */
import { BrowserWindow } from "electron";

export function isTrustedSenderFrame(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event?.senderFrame;
  if (!frame || !event.sender || frame !== event.sender.mainFrame || !frame.url) return false;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return false;
  const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    try {
      return new URL(frame.url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(frame.url);
    return parsed.protocol === "file:" && parsed.pathname.endsWith("/renderer/index.html");
  } catch {
    return false;
  }
}
