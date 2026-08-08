import fs from "node:fs";
import { BrowserWindow, ipcMain, shell } from "electron";

type RegisterAppShellIpcHandlersContext = {
  resolveSourcePath: (targetPath: string) => string;
};

export function registerAppShellIpcHandlers({ resolveSourcePath }: RegisterAppShellIpcHandlersContext) {
  ipcMain.handle("app-devtools-open", async (event): Promise<{ success: boolean; error?: string }> => {
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
      const error = await shell.openPath(resolvedPath);
      return error ? { success: false, error } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
