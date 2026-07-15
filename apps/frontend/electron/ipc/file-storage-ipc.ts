import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import { resolveDataDirPath, resolveDataFilePath } from "../storage-paths";

type RegisterFileStorageIpcHandlersContext = {
  getDataDir: () => string;
};

export function registerFileStorageIpcHandlers({ getDataDir }: RegisterFileStorageIpcHandlersContext) {
  ipcMain.handle("file-storage-get", async (_event, key: string) => {
    try {
      const filePath = resolveDataFilePath(getDataDir(), key);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
    } catch (error) {
      console.error("Failed to read file storage:", error);
      return null;
    }
  });
  ipcMain.handle("file-storage-set", async (_event, key: string, value: string) => {
    try {
      const filePath = resolveDataFilePath(getDataDir(), key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, value, "utf-8");
      console.log(`Saved to file: ${filePath} (${Math.round(value.length / 1024)}KB)`);
      return true;
    } catch (error) {
      console.error("Failed to write file storage:", error);
      return false;
    }
  });
  ipcMain.handle("file-storage-remove", async (_event, key: string) => {
    try {
      const filePath = resolveDataFilePath(getDataDir(), key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error("Failed to remove file storage:", error);
      return false;
    }
  });
  ipcMain.handle("file-storage-rename", async (_event, fromKey: string, toKey: string) => {
    try {
      const fromPath = resolveDataFilePath(getDataDir(), fromKey);
      const toPath = resolveDataFilePath(getDataDir(), toKey);
      if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return false;
      fs.mkdirSync(path.dirname(toPath), { recursive: true });
      fs.renameSync(fromPath, toPath);
      return true;
    } catch (error) {
      console.error("Failed to rename file storage:", error);
      return false;
    }
  });
  ipcMain.handle("file-storage-exists", async (_event, key: string) => {
    try {
      return fs.existsSync(resolveDataFilePath(getDataDir(), key));
    } catch {
      return false;
    }
  });
  ipcMain.handle("file-storage-list-dirs", async (_event, prefix: string) => {
    try {
      const dirPath = resolveDataDirPath(getDataDir(), prefix);
      if (!fs.existsSync(dirPath)) return [];
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "_migrated")
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  });
  ipcMain.handle("file-storage-list", async (_event, prefix: string) => {
    try {
      const dirPath = resolveDataDirPath(getDataDir(), prefix);
      if (!fs.existsSync(dirPath)) return [];
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => `${prefix}/${entry.name.replace(".json", "")}`);
    } catch {
      return [];
    }
  });
  ipcMain.handle("file-storage-remove-dir", async (_event, prefix: string) => {
    try {
      const dirPath = resolveDataDirPath(getDataDir(), prefix);
      if (fs.existsSync(dirPath)) await fs.promises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error("Failed to remove directory:", error);
      return false;
    }
  });
}
