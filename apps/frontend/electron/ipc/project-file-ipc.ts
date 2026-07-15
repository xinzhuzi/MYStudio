import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  createProjectFileUrl,
  resolveProjectFileUrl,
  resolveProjectScopedFilePath,
} from "../storage-paths";

type ProjectFileWriteBinaryPayload = {
  projectId: string;
  relativePath: string;
  bytes: ArrayBuffer | Uint8Array;
};

type ProjectFileSaveImagePayload = {
  projectId: string;
  relativePath: string;
  source: string;
};

type RegisterProjectFileIpcHandlersContext = {
  getDataDir: () => string;
  readImageSource: (source: string) => Promise<{ buffer: Buffer; mimeType: string }>;
  getMimeType: (filePath: string) => string;
};

function resolveProjectTextFilePath(dataRoot: string, key: string) {
  const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedKey || normalizedKey.includes("../") || normalizedKey.includes("..\\")) {
    throw new Error("Invalid project file key");
  }

  const targetPath = path.resolve(dataRoot, normalizedKey);
  const normalizedRoot = path.resolve(dataRoot);
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Project file key escapes storage root");
  }
  return targetPath;
}

function toProjectFileBuffer(bytes: ArrayBuffer | Uint8Array) {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function registerProjectFileIpcHandlers({
  getDataDir,
  readImageSource,
  getMimeType,
}: RegisterProjectFileIpcHandlersContext) {
  const writeProjectBinaryFile = async (
    payload: Omit<ProjectFileWriteBinaryPayload, "bytes">,
    buffer: Buffer,
  ) => {
    if (buffer.length === 0) {
      return { success: false, error: "项目文件为空" };
    }
    const filePath = resolveProjectScopedFilePath(getDataDir(), payload.projectId, payload.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    return {
      success: true,
      url: createProjectFileUrl(payload.projectId, payload.relativePath),
      filePath,
      size: buffer.length,
    };
  };

  ipcMain.handle("project-file-write-text", async (_event, key: string, value: string) => {
    try {
      const filePath = resolveProjectTextFilePath(getDataDir(), key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, value, "utf-8");
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("project-file-write-binary", async (_event, payload: ProjectFileWriteBinaryPayload) => {
    try {
      return await writeProjectBinaryFile(payload, toProjectFileBuffer(payload.bytes));
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("project-file-save-image", async (_event, payload: ProjectFileSaveImagePayload) => {
    try {
      const { buffer } = await readImageSource(payload.source);
      return await writeProjectBinaryFile(payload, buffer);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("project-file-read-base64", async (_event, projectFileUrl: string) => {
    try {
      const filePath = resolveProjectFileUrl(getDataDir(), projectFileUrl);
      const data = await fs.promises.readFile(filePath);
      return {
        success: true,
        base64: `data:${getMimeType(filePath)};base64,${data.toString("base64")}`,
        mimeType: getMimeType(filePath),
        size: data.length,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("project-file-get-absolute-path", async (_event, projectFileUrl: string) => {
    try {
      const filePath = resolveProjectFileUrl(getDataDir(), projectFileUrl);
      return fs.existsSync(filePath) ? filePath : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("project-file-remove-text", async (_event, key: string) => {
    try {
      const filePath = resolveProjectTextFilePath(getDataDir(), key);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
