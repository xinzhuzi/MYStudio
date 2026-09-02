import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  applyStoreLayoutScope,
  createProjectFileUrl,
  redirectProjectScopedKey,
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

type ProjectFileDeletePayload = {
  projectId: string;
  relativePath: string;
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

  // `_p/{pid}/` 虚拟键与 file-storage 通道同规则重定向（外部位置直达项目目录、
  // legacy userData/_p 回退）+ store 布局 v1（白名单段收进 <项目根>/store/）——
  // 08-18 修复：文本通道此前漏接 store 布局，studio-workflow/README.md 会落旧位置
  const scope = applyStoreLayoutScope(dataRoot, redirectProjectScopedKey(dataRoot, normalizedKey));
  const targetPath = path.resolve(scope.root, scope.rest);
  const normalizedRoot = path.resolve(scope.root);
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

  // 删除项目内单个文件(生成记录「清理完毕」链的物理删除通道)。
  // 仅文件:rm 不带 recursive,目录必然 reject=天然防呆;force=true 对
  // 已不存在的文件幂等成功(手动清理过/重复删除均不报错)。
  ipcMain.handle("project-file-delete", async (_event, payload: ProjectFileDeletePayload) => {
    try {
      const filePath = resolveProjectScopedFilePath(getDataDir(), payload.projectId, payload.relativePath);
      await fs.promises.rm(filePath, { force: true });
      return { success: true };
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

  // 项目技能目录列举:供手册目录合并发现 <项目根>/skills 下的手册文件(项目侧真源)。
  // 只列文件、限 skills/ 前缀、深度与数量封顶,复用 resolveProjectScopedFilePath 的项目根包含校验。
  ipcMain.handle("project-file-list", async (
    _event,
    payload: { projectId: string; relativePath: string },
  ) => {
    try {
      const dirPath = resolveProjectScopedFilePath(
        getDataDir(),
        payload.projectId,
        payload.relativePath,
      );
      const stat = await fs.promises.stat(dirPath).catch(() => null);
      if (!stat?.isDirectory()) {
        return { success: true, files: [] as string[] };
      }
      const files: string[] = [];
      const queue: string[] = [dirPath];
      let visited = 0;
      while (queue.length > 0 && files.length < 2000 && visited < 4000) {
        const current = queue.shift()!;
        visited += 1;
        const entries = await fs.promises.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "__MACOSX" || entry.name === "node_modules") continue;
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            queue.push(full);
          } else if (entry.isFile()) {
            files.push(path.relative(dirPath, full).replace(/\\/g, "/"));
          }
        }
      }
      return { success: true, files };
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
