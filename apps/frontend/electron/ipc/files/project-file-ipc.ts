import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  createProjectFileUrl,
  resolveProjectFileUrl,
  resolveProjectScopedFilePath,
} from "../../storage/storage-paths";

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

type ProjectFileMovePayload = {
  projectId: string;
  fromRelative: string;
  toRelative: string;
};

type RegisterProjectFileIpcHandlersContext = {
  getDataDir: () => string;
  readImageSource: (source: string) => Promise<{ buffer: Buffer; mimeType: string }>;
  getMimeType: (filePath: string) => string;
};

/** Hard size cap for project-file-read-text preview: refuse files larger than this. */
const PREVIEW_HARD_LIMIT = 2 * 1024 * 1024; // 2MB
/** Soft truncation limit (in BYTES) for project-file-read-text preview. */
const PREVIEW_SOFT_LIMIT = 256 * 1024; // 256KB

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

  // 同项目内移动/改名(目录或文件),供产物中心「章节整理」等迁移场景使用。
  // 双路径均经 resolveProjectScopedFilePath 遏制校验;同盘 rename 不复制数据。
  ipcMain.handle("project-file-move", async (_event, payload: ProjectFileMovePayload) => {
    try {
      const fromPath = resolveProjectScopedFilePath(getDataDir(), payload.projectId, payload.fromRelative);
      const toPath = resolveProjectScopedFilePath(getDataDir(), payload.projectId, payload.toRelative);
      if (!fs.existsSync(fromPath)) {
        return { success: false, error: "源路径不存在" };
      }
      if (fs.existsSync(toPath)) {
        return { success: false, error: "目标路径已存在" };
      }
      fs.mkdirSync(path.dirname(toPath), { recursive: true });
      fs.renameSync(fromPath, toPath);
      return { success: true, url: createProjectFileUrl(payload.projectId, payload.toRelative) };
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

  // Read a (small, text) project file as UTF-8 for in-app content preview.
  // Guards: hard size cap (2MB), soft truncation (256KB) with a truncated flag,
  // and a NUL-byte heuristic to refuse binary content. The containment check
  // inside resolveProjectScopedFilePath already prevents path escape.
  ipcMain.handle("project-file-read-text", async (
    _event,
    payload: { projectId: string; relativePath: string },
  ) => {
    try {
      const filePath = resolveProjectScopedFilePath(
        getDataDir(),
        payload.projectId,
        payload.relativePath,
      );
      const stat = await fs.promises.stat(filePath);
      if (stat.size > PREVIEW_HARD_LIMIT) {
        return { success: false, error: "文件过大(超过 2MB),请使用外部编辑器打开" };
      }
      const data = await fs.promises.readFile(filePath);
      if (data.length > 0 && data.includes(0x00)) {
        return { success: false, error: "文件包含二进制内容,无法预览" };
      }
      // Truncate by BYTES so the "256KB" cap (and the UI text) matches
      // stat.size semantics. Slicing the Buffer at a UTF-8 boundary then
      // decoding is surrogate-safe: a partial multi-byte sequence decodes to
      // a replacement char at most, never a lone UTF-16 surrogate.
      const truncated = data.length > PREVIEW_SOFT_LIMIT;
      const fullText = (truncated ? data.subarray(0, PREVIEW_SOFT_LIMIT) : data).toString("utf-8");
      return {
        success: true,
        text: fullText,
        size: stat.size,
        mimeType: getMimeType(filePath),
        truncated,
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
