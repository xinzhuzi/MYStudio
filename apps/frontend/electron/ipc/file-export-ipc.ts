import fs from "node:fs";
import { dialog, ipcMain } from "electron";
import { resolveLocalMediaPath, resolveProjectFileUrl } from "../storage-paths";

type RegisterFileExportIpcHandlersContext = {
  getDataDir: () => string;
  getMediaRoot: () => string;
};

export function registerFileExportIpcHandlers({
  getDataDir,
  getMediaRoot,
}: RegisterFileExportIpcHandlersContext) {
  ipcMain.handle("save-file-dialog", async (
    _event,
    { localPath, defaultPath, filters }: {
      localPath: string;
      defaultPath: string;
      filters: { name: string; extensions: string[] }[];
    },
  ) => {
    try {
      let sourcePath: string | null;
      if (localPath.startsWith("project-file://")) {
        sourcePath = resolveProjectFileUrl(getDataDir(), localPath);
      } else if (localPath.startsWith("local-image://") || localPath.startsWith("local-video://")) {
        sourcePath = resolveLocalMediaPath(getMediaRoot(), localPath);
      } else if (localPath.startsWith("file://")) {
        sourcePath = localPath.replace("file://", "");
      } else {
        sourcePath = localPath;
      }
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, error: "Source file not found" };
      }
      const result = await dialog.showSaveDialog({ defaultPath, filters });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      fs.copyFileSync(sourcePath, result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error("Failed to save file:", error);
      return { success: false, error: String(error) };
    }
  });
}
