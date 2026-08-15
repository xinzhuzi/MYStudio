import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import type { ProjectLocationStore } from "../../storage/project-locations";

/**
 * Per-project external folder IPC (task 08-15-project-folder-choice).
 *
 * The main process owns the location table (project-locations.json); the
 * renderer registry's `location` field is display-only. All four channels are
 * string literals registered in the main-ipc-contract whitelist.
 */

export type ProjectFolderPrepareResult =
  | { ok: true; location: string }
  | { ok: false; code: "CONFLICT" | "PARENT_INVALID" | "NOT_WRITABLE" | "NESTED"; message: string };

export type ProjectFolderRenameResult =
  | { ok: true; location: string }
  | { ok: false; code: "NO_LOCATION" | "MISSING_DIR" | "CONFLICT" | "RENAME_FAILED"; message: string };

export type ProjectFolderRemoveResult =
  | { ok: true; removed: boolean; message?: string }
  | { ok: false; message: string };

export type ProjectFolderStatusResult = { location?: string; exists: boolean };

export type ProjectFolderBridge = {
  prepare: (projectId: string, parentDir: string, projectName: string) => Promise<ProjectFolderPrepareResult>;
  rename: (projectId: string, newName: string) => Promise<ProjectFolderRenameResult>;
  remove: (projectId: string) => Promise<ProjectFolderRemoveResult>;
  status: (projectId: string) => Promise<ProjectFolderStatusResult>;
};

type RegisterProjectFolderIpcHandlersContext = {
  locationStore: ProjectLocationStore;
  /** Application projects data root; external locations may not live inside it. */
  getProjectsDataRoot: () => string;
};

// Stripping control characters from user-provided folder names is intentional.
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

function isValidProjectId(projectId: unknown): projectId is string {
  return (
    typeof projectId === "string" &&
    projectId.length > 0 &&
    !projectId.includes("/") &&
    !projectId.includes("\\") &&
    !projectId.includes("\0")
  );
}

/** Strip filename-illegal characters and surrounding whitespace/dots; fall back to 项目-<pid 前 8 位>. */
export function sanitizeProjectFolderName(projectName: string, projectId: string): string {
  const cleaned = projectName
    .replace(INVALID_NAME_CHARS, "")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim();
  return cleaned || `项目-${projectId.slice(0, 8)}`;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function containsPath(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase();
  const normalizedChild = path.resolve(child).toLowerCase();
  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerProjectFolderIpcHandlers({
  locationStore,
  getProjectsDataRoot,
}: RegisterProjectFolderIpcHandlersContext): void {
  ipcMain.handle("project-folder-prepare", async (_event, projectId: string, parentDir: string, projectName: string): Promise<ProjectFolderPrepareResult> => {
      if (!isValidProjectId(projectId)) {
        return { ok: false, code: "PARENT_INVALID", message: "项目 ID 无效" };
      }
      if (typeof parentDir !== "string" || !parentDir.trim() || !path.isAbsolute(parentDir.trim())) {
        return { ok: false, code: "PARENT_INVALID", message: "父目录无效：必须是绝对路径" };
      }
      const parent = path.resolve(parentDir.trim());
      let parentStat: fs.Stats;
      try {
        parentStat = fs.statSync(parent);
      } catch {
        return { ok: false, code: "PARENT_INVALID", message: `父目录不存在：${parent}` };
      }
      if (!parentStat.isDirectory()) {
        return { ok: false, code: "PARENT_INVALID", message: `父目录不是文件夹：${parent}` };
      }
      try {
        fs.accessSync(parent, fs.constants.W_OK);
      } catch {
        return { ok: false, code: "NOT_WRITABLE", message: `父目录不可写：${parent}` };
      }

      const folderName = sanitizeProjectFolderName(
        typeof projectName === "string" ? projectName : "",
        projectId,
      );
      const target = path.join(parent, folderName);

      const dataRoot = getProjectsDataRoot();
      if (containsPath(dataRoot, target) || containsPath(target, dataRoot)) {
        return { ok: false, code: "NESTED", message: "项目位置不能位于应用数据目录内部或包含应用数据目录" };
      }
      for (const [otherPid, otherDir] of Object.entries(locationStore.all())) {
        if (otherPid === projectId) continue;
        if (samePath(otherDir, target)) {
          return { ok: false, code: "NESTED", message: `目标文件夹已被项目 ${otherPid} 注册` };
        }
        if (containsPath(otherDir, target) || containsPath(target, otherDir)) {
          return { ok: false, code: "NESTED", message: `目标文件夹与项目 ${otherPid} 的位置存在嵌套` };
        }
      }

      try {
        const targetStat = fs.statSync(target);
        if (!targetStat.isDirectory()) {
          return { ok: false, code: "CONFLICT", message: `目标位置已被文件占用：${target}` };
        }
        // Empty directories are reused as-is; non-empty ones conflict.
        if (fs.readdirSync(target).length > 0) {
          return { ok: false, code: "CONFLICT", message: `文件夹已存在且非空：${target}` };
        }
      } catch {
        // Target does not exist yet — that is the normal creation path.
      }

      try {
        fs.mkdirSync(target, { recursive: true });
      } catch (error) {
        return { ok: false, code: "NOT_WRITABLE", message: `创建项目文件夹失败：${errorMessage(error)}` };
      }
      try {
        locationStore.set(projectId, target);
      } catch (error) {
        return { ok: false, code: "NESTED", message: errorMessage(error) };
      }
      return { ok: true, location: target };
    },
  );

  ipcMain.handle("project-folder-rename", async (_event, projectId: string, newName: string): Promise<ProjectFolderRenameResult> => {
      if (!isValidProjectId(projectId)) {
        return { ok: false, code: "NO_LOCATION", message: "项目 ID 无效" };
      }
      const location = locationStore.get(projectId);
      if (!location) {
        return { ok: false, code: "NO_LOCATION", message: "项目未注册外部位置，请在列表中直接重命名" };
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(location);
      } catch {
        return { ok: false, code: "MISSING_DIR", message: `项目文件夹不存在：${location}` };
      }
      if (!stat.isDirectory()) {
        return { ok: false, code: "MISSING_DIR", message: `项目位置不是文件夹：${location}` };
      }
      if (typeof newName !== "string" || !newName.trim()) {
        return { ok: false, code: "RENAME_FAILED", message: "新名称无效" };
      }
      const target = path.join(path.dirname(location), sanitizeProjectFolderName(newName, projectId));
      // macOS default volumes are case-insensitive: compare lowercased paths.
      if (path.resolve(target).toLowerCase() !== path.resolve(location).toLowerCase() && fs.existsSync(target)) {
        return { ok: false, code: "CONFLICT", message: `目标文件夹已存在：${target}` };
      }
      try {
        fs.renameSync(location, target);
      } catch (error) {
        return { ok: false, code: "RENAME_FAILED", message: `重命名失败：${errorMessage(error)}` };
      }
      try {
        locationStore.set(projectId, target);
      } catch (error) {
        // Folder rename succeeded but the authority table rejected the update:
        // roll the folder back so table and disk stay consistent.
        try {
          fs.renameSync(target, location);
        } catch {
          // Best effort — surface the table error either way.
        }
        return { ok: false, code: "RENAME_FAILED", message: `位置表更新失败：${errorMessage(error)}` };
      }
      return { ok: true, location: target };
    },
  );

  ipcMain.handle("project-folder-remove", async (_event, projectId: string): Promise<ProjectFolderRemoveResult> => {
    if (!isValidProjectId(projectId)) {
      return { ok: false, message: "项目 ID 无效" };
    }
    const location = locationStore.get(projectId);
    if (!location) return { ok: true, removed: false };
    try {
      if (fs.existsSync(location)) {
        await fs.promises.rm(location, { recursive: true, force: true });
      }
    } catch (error) {
      return { ok: false, message: `删除项目文件夹失败：${errorMessage(error)}` };
    }
    try {
      locationStore.delete(projectId);
    } catch (error) {
      return { ok: false, message: `注销项目位置失败：${errorMessage(error)}` };
    }
    return { ok: true, removed: true };
  });

  ipcMain.handle("project-folder-status", async (_event, projectId: string): Promise<ProjectFolderStatusResult> => {
    if (!isValidProjectId(projectId)) return { exists: true };
    const location = locationStore.get(projectId);
    if (!location) return { exists: true };
    try {
      return { location, exists: fs.statSync(location).isDirectory() };
    } catch {
      return { location, exists: false };
    }
  });
}
