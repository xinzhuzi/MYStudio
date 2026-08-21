import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  checkRegistryDepsInstalled,
  downloadRegistryDeps,
  getRegistryDepsDir,
} from "../../rendering/plugins/hyperframes/registry-deps";

type RegisterAppShellIpcHandlersContext = {
  resolveSourcePath: (targetPath: string) => string;
};

/**
 * shell.openPath 会用系统默认应用打开文件;对可执行/可托管执行的扩展名,
 * 这等于把主机代码执行交给被打开的文件。此类扩展一律拒绝(reveal in folder
 * 不受影响——只定位不执行)。
 */
const BLOCKED_OPEN_EXTENSIONS = new Set([
  ".app", ".command", ".terminal", ".shellscript", ".workflow", ".webloc", ".jar",
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".lnk", ".hta", ".vbs",
]);

export function isBlockedOpenExtension(filePath: string): boolean {
  return BLOCKED_OPEN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function registerAppShellIpcHandlers({ resolveSourcePath }: RegisterAppShellIpcHandlersContext) {
  ipcMain.handle("app-devtools-open", async (event): Promise<{ success: boolean; error?: string }> => {
    // 生产构建默认禁用 DevTools 入口(渲染层攻破后 DevTools 是现成的调试/
    // 注入面);诊断需要时以 MYSTUDIO_ENABLE_DEVTOOLS=1 启动显式放行。
    if (app.isPackaged && process.env.MYSTUDIO_ENABLE_DEVTOOLS !== "1") {
      return { success: false, error: "开发者工具仅开发环境可用" };
    }
    try {
      const targetWindow = BrowserWindow.fromWebContents(event.sender);
      if (!targetWindow) return { success: false, error: "未找到当前窗口" };
      targetWindow.webContents.openDevTools({ mode: "detach" });
      return { success: true };
    } catch (error) {
      console.error("Failed to open DevTools:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("app-open-path", async (
    _event,
    targetPath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (typeof targetPath !== "string" || !targetPath.trim() || targetPath.includes("\0")) {
      return { success: false, error: "无效文件路径" };
    }
    try {
      const resolvedPath = resolveSourcePath(targetPath);
      if (!fs.existsSync(resolvedPath)) return { success: false, error: "文件不存在" };
      if (isBlockedOpenExtension(resolvedPath)) {
        return { success: false, error: `出于安全考虑，不能通过本入口打开可执行文件 (${path.extname(resolvedPath)})` };
      }
      const error = await shell.openPath(resolvedPath);
      return error ? { success: false, error } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // HyperFrames Registry 特效依赖(08-21):检查+下载
  ipcMain.handle("hy-registry-deps-check", async (): Promise<{ installed: boolean; installedCount: number; totalCount: number }> => {
    try {
      return checkRegistryDepsInstalled(getRegistryDepsDir(app.getPath("userData")));
    } catch {
      return { installed: false, installedCount: 0, totalCount: 0 };
    }
  });

  ipcMain.handle("hy-registry-deps-download", async (): Promise<{ success: boolean; downloaded: number; failed: string[] }> => {
    try {
      return await downloadRegistryDeps(getRegistryDepsDir(app.getPath("userData")));
    } catch (error) {
      return { success: false, downloaded: 0, failed: [error instanceof Error ? error.message : String(error)] };
    }
  });

  // Reveal a file in the OS file manager (Finder on macOS, Explorer on Win,
  // default on Linux). Unlike app-open-path (which opens the file with its
  // default app), this opens the containing folder and highlights the file.
  ipcMain.handle("app-show-in-folder", async (
    _event,
    targetPath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (typeof targetPath !== "string" || !targetPath.trim() || targetPath.includes("\0")) {
      return { success: false, error: "无效文件路径" };
    }
    try {
      const resolvedPath = resolveSourcePath(targetPath);
      if (!fs.existsSync(resolvedPath)) return { success: false, error: "文件不存在" };
      shell.showItemInFolder(resolvedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
