import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  MoveCancelledError,
  createDefaultProjectMoveEngine,
  type ProjectMoveEngine,
  type ProjectMoveMode,
} from "../../storage/project-move-engine";
import type { ProjectLocationStore } from "../../storage/project-locations";
import { resolveProjectRootPath } from "../../storage/storage-paths";

/**
 * Per-project external folder IPC (task 08-15-project-folder-choice, extended
 * by 08-15-project-location-phase2 with move/cancel/import).
 *
 * The main process owns the location table (project-locations.json); the
 * renderer registry's `location` field is display-only. All channels are
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

export type ProjectFolderMoveResult =
  | { ok: true; location: string; mode: ProjectMoveMode }
  | {
      ok: false;
      code:
        | "MISSING_DIR"
        | "PARENT_INVALID"
        | "NOT_WRITABLE"
        | "CONFLICT"
        | "NESTED"
        | "CANCELLED"
        | "MOVE_FAILED";
      message?: string;
    };

export type ProjectFolderMoveCancelResult = { ok: true; cancelled: boolean };

export type ProjectFolderImportResult =
  | { ok: true; project: { id: string; name: string; location: string } }
  | {
      ok: false;
      code: "INVALID_PATH" | "NOT_A_PROJECT" | "ALREADY_REGISTERED" | "NESTED" | "IMPORT_FAILED";
      message: string;
      existingProjectId?: string;
    };

export type ProjectFolderBridge = {
  prepare: (projectId: string, parentDir: string, projectName: string) => Promise<ProjectFolderPrepareResult>;
  rename: (projectId: string, newName: string) => Promise<ProjectFolderRenameResult>;
  remove: (projectId: string) => Promise<ProjectFolderRemoveResult>;
  status: (projectId: string) => Promise<ProjectFolderStatusResult>;
  move: (projectId: string, projectName: string, targetParentDir: string) => Promise<ProjectFolderMoveResult>;
  cancelMove: (projectId: string) => Promise<ProjectFolderMoveCancelResult>;
  importFolder: (folderPath: string) => Promise<ProjectFolderImportResult>;
};

/** Main → renderer progress channel for in-flight moves (not an invoke channel). */
export const PROJECT_FOLDER_MOVE_PROGRESS_CHANNEL = "project-folder-move-progress";

type RegisterProjectFolderIpcHandlersContext = {
  locationStore: ProjectLocationStore;
  /** Application projects data root; external locations may not live inside it. */
  getProjectsDataRoot: () => string;
  /** Test injection point for the move engine; defaults to the real filesystem engine. */
  createMoveEngine?: () => ProjectMoveEngine;
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

/**
 * Realpath-normalize a path for comparison purposes: existing segments resolve
 * through symlinks; missing tail segments ride on the nearest existing ancestor
 * (same semantics as storage-paths.ts canonicalPath, kept private here because
 * storage-paths does not export it). Prevents symlinked folders from bypassing
 * the nesting/duplicate guards below.
 */
function canonicalPath(input: string): string {
  const unresolved: string[] = [];
  let current = path.resolve(input);
  while (true) {
    try {
      const resolved = fs.realpathSync(current);
      return path.join(resolved, ...unresolved);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(input);
      unresolved.unshift(path.basename(current));
      current = parent;
    }
  }
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
}

function containsPath(parent: string, child: string): boolean {
  const normalizedParent = canonicalPath(parent).toLowerCase();
  const normalizedChild = canonicalPath(child).toLowerCase();
  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Parse a persisted store file and return its `state` object (or the root when unwrapped). */
function readStoreState(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as
      | ({ state?: Record<string, unknown> } & Record<string, unknown>)
      | null;
    const state = (parsed?.state ?? parsed) as Record<string, unknown> | null;
    return state && typeof state === "object" && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
}

function projectRecordFor(state: Record<string, unknown> | null, projectId: string): Record<string, unknown> | null {
  const projects = state?.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return null;
  const record = (projects as Record<string, unknown>)[projectId];
  return record && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>) : null;
}

/** OQ1: the pid is the first key of `state.projects` in script.json (fallback director.json). */
function extractProjectIdFromFile(filePath: string): string | null {
  const state = readStoreState(filePath);
  if (!state) return null;
  const projects = state.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return null;
  const firstKey = Object.keys(projects as Record<string, unknown>)[0];
  return firstKey || null;
}

/**
 * Rename `state.projects[oldPid]` → `[newPid]` and replace `state.activeProjectId`
 * in every parseable `*.json` under the imported folder (recursive), mirroring the
 * renderer-side rewriteProjectScopedPayload: only those two spots change. Parse
 * failures and untouched files keep their bytes exactly.
 */
function rewriteProjectIdsInPlace(rootDir: string, oldPid: string, newPid: string): void {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      rewriteProjectIdsInPlace(fullPath, oldPid, newPid);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch {
      continue; // Not valid JSON — leave the file byte-for-byte as-is.
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as { state?: Record<string, unknown> } & Record<string, unknown>;
    const state = (record.state ?? record) as Record<string, unknown>;
    let changed = false;
    if (state.activeProjectId === oldPid) {
      state.activeProjectId = newPid;
      changed = true;
    }
    const projects = state.projects;
    if (
      projects &&
      typeof projects === "object" &&
      !Array.isArray(projects) &&
      Object.prototype.hasOwnProperty.call(projects, oldPid)
    ) {
      const projectRecord = projects as Record<string, unknown>;
      projectRecord[newPid] = projectRecord[oldPid];
      delete projectRecord[oldPid];
      changed = true;
    }
    if (changed) fs.writeFileSync(fullPath, JSON.stringify(parsed), "utf-8");
  }
}

/** Name derivation aligned with recoverProjectFromDisk: title → screenplay preview → folder name. */
function deriveImportProjectName(folder: string, projectId: string): string {
  const scriptProject = projectRecordFor(readStoreState(path.join(folder, "script.json")), projectId);
  const title = scriptProject?.title;
  if (typeof title === "string" && title.trim()) return title.trim();

  const directorProject = projectRecordFor(readStoreState(path.join(folder, "director.json")), projectId);
  const screenplay = directorProject?.screenplay;
  if (typeof screenplay === "string" && screenplay.trim()) {
    const preview = screenplay.substring(0, 20).replace(/\n/g, " ").trim();
    if (preview) return `${preview}...`;
  }

  const base = path.basename(folder);
  if (base && base !== path.sep) return base;
  return "导入的项目";
}

export function registerProjectFolderIpcHandlers({
  locationStore,
  getProjectsDataRoot,
  createMoveEngine = () => createDefaultProjectMoveEngine(),
}: RegisterProjectFolderIpcHandlersContext): void {
  // In-flight move abort registry (key = projectId); drives move-cancel.
  const activeMoveControllers = new Map<string, AbortController>();
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

  ipcMain.handle("project-folder-move", async (event, projectId: string, projectName: string, targetParentDir: string): Promise<ProjectFolderMoveResult> => {
    if (!isValidProjectId(projectId)) {
      return { ok: false, code: "MISSING_DIR", message: "项目 ID 无效" };
    }
    if (activeMoveControllers.has(projectId)) {
      return { ok: false, code: "MOVE_FAILED", message: "该项目已有正在进行的移动任务" };
    }
    // Registered location, or the legacy <dataRoot>/_p/<pid> slot — legacy
    // projects are movable too (source resolution mirrors projectRootFor).
    const sourceDir = locationStore.get(projectId) ?? resolveProjectRootPath(getProjectsDataRoot(), projectId);
    let sourceStat: fs.Stats;
    try {
      sourceStat = fs.statSync(sourceDir);
    } catch {
      return { ok: false, code: "MISSING_DIR", message: `项目文件夹不存在：${sourceDir}` };
    }
    if (!sourceStat.isDirectory()) {
      return { ok: false, code: "MISSING_DIR", message: `项目位置不是文件夹：${sourceDir}` };
    }
    if (typeof targetParentDir !== "string" || !targetParentDir.trim() || !path.isAbsolute(targetParentDir.trim())) {
      return { ok: false, code: "PARENT_INVALID", message: "父目录无效：必须是绝对路径" };
    }
    const parent = path.resolve(targetParentDir.trim());
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

    const targetDir = path.join(
      parent,
      sanitizeProjectFolderName(typeof projectName === "string" ? projectName : "", projectId),
    );

    const dataRoot = getProjectsDataRoot();
    if (containsPath(dataRoot, targetDir) || containsPath(targetDir, dataRoot)) {
      return { ok: false, code: "NESTED", message: "项目位置不能位于应用数据目录内部或包含应用数据目录" };
    }
    // Moving a folder into its own subtree would make the engine's final
    // source cleanup delete the freshly copied target — reject outright.
    if (!samePath(sourceDir, targetDir) && containsPath(sourceDir, targetDir)) {
      return { ok: false, code: "NESTED", message: "目标文件夹不能位于源文件夹内部" };
    }
    for (const [otherPid, otherDir] of Object.entries(locationStore.all())) {
      if (otherPid === projectId) continue;
      if (samePath(otherDir, targetDir)) {
        return { ok: false, code: "NESTED", message: `目标文件夹已被项目 ${otherPid} 注册` };
      }
      if (containsPath(otherDir, targetDir) || containsPath(targetDir, otherDir)) {
        return { ok: false, code: "NESTED", message: `目标文件夹与项目 ${otherPid} 的位置存在嵌套` };
      }
    }
    // Existing non-empty targets conflict (case-insensitive comparison).
    // The source itself is excluded so case-only/no-op moves stay allowed;
    // existing empty directories are fine — rename replaces them.
    if (!samePath(sourceDir, targetDir)) {
      try {
        const targetStat = fs.statSync(targetDir);
        if (!targetStat.isDirectory()) {
          return { ok: false, code: "CONFLICT", message: `目标位置已被文件占用：${targetDir}` };
        }
        if (fs.readdirSync(targetDir).length > 0) {
          return { ok: false, code: "CONFLICT", message: `文件夹已存在且非空：${targetDir}` };
        }
      } catch {
        // Target does not exist yet — the normal move path.
      }
    }

    const controller = new AbortController();
    activeMoveControllers.set(projectId, controller);
    try {
      const mode = await createMoveEngine().move({
        sourceDir,
        targetDir,
        signal: controller.signal,
        onProgress: (progress) => {
          event.sender.send(PROJECT_FOLDER_MOVE_PROGRESS_CHANNEL, { projectId, ...progress });
        },
      });
      try {
        locationStore.set(projectId, targetDir);
      } catch (error) {
        return { ok: false, code: "MOVE_FAILED", message: `位置表更新失败：${errorMessage(error)}` };
      }
      return { ok: true, location: targetDir, mode };
    } catch (error) {
      if (error instanceof MoveCancelledError) {
        return { ok: false, code: "CANCELLED" };
      }
      return { ok: false, code: "MOVE_FAILED", message: `移动项目文件夹失败：${errorMessage(error)}` };
    } finally {
      activeMoveControllers.delete(projectId);
    }
  });

  ipcMain.handle("project-folder-move-cancel", async (_event, projectId: string): Promise<ProjectFolderMoveCancelResult> => {
    if (!isValidProjectId(projectId)) return { ok: true, cancelled: false };
    const controller = activeMoveControllers.get(projectId);
    if (!controller) return { ok: true, cancelled: false };
    controller.abort();
    return { ok: true, cancelled: true };
  });

  ipcMain.handle("project-folder-import", async (_event, folderPath: string): Promise<ProjectFolderImportResult> => {
    if (typeof folderPath !== "string" || !folderPath.trim() || !path.isAbsolute(folderPath.trim())) {
      return { ok: false, code: "INVALID_PATH", message: "路径无效：必须是绝对路径" };
    }
    const folder = path.resolve(folderPath.trim());
    let folderStat: fs.Stats;
    try {
      folderStat = fs.statSync(folder);
    } catch {
      return { ok: false, code: "INVALID_PATH", message: `文件夹不存在：${folder}` };
    }
    if (!folderStat.isDirectory()) {
      return { ok: false, code: "INVALID_PATH", message: `路径不是文件夹：${folder}` };
    }
    const hasScript = isRegularFile(path.join(folder, "script.json"));
    const hasDirector = isRegularFile(path.join(folder, "director.json"));
    if (!hasScript && !hasDirector) {
      return { ok: false, code: "NOT_A_PROJECT", message: "文件夹不是 MYStudio 项目：缺少 script.json 或 director.json" };
    }

    // realpathSync de-ambiguation (folder exists here) for all comparisons below.
    const normalizedFolder = canonicalPath(folder);
    const dataRoot = getProjectsDataRoot();
    const allLocations = locationStore.all();

    for (const [existingPid, existingDir] of Object.entries(allLocations)) {
      if (samePath(existingDir, normalizedFolder)) {
        return {
          ok: false,
          code: "ALREADY_REGISTERED",
          message: `文件夹已被项目 ${existingPid} 注册`,
          existingProjectId: existingPid,
        };
      }
    }
    if (containsPath(dataRoot, normalizedFolder) || containsPath(normalizedFolder, dataRoot)) {
      return { ok: false, code: "NESTED", message: "项目位置不能位于应用数据目录内部或包含应用数据目录" };
    }
    for (const [otherPid, otherDir] of Object.entries(allLocations)) {
      if (containsPath(otherDir, normalizedFolder) || containsPath(normalizedFolder, otherDir)) {
        return { ok: false, code: "NESTED", message: `文件夹与项目 ${otherPid} 的位置存在嵌套` };
      }
    }

    // OQ1 id strategy: reuse the extracted pid when it is free; otherwise
    // mint a new UUID and rewrite the project-scoped keys in place.
    let extractedPid = hasScript ? extractProjectIdFromFile(path.join(folder, "script.json")) : null;
    if (!extractedPid && hasDirector) {
      extractedPid = extractProjectIdFromFile(path.join(folder, "director.json"));
    }
    if (extractedPid && !isValidProjectId(extractedPid)) extractedPid = null;

    const isPidTaken = (candidatePid: string): boolean => {
      if (locationStore.get(candidatePid) !== undefined) return true;
      try {
        // Legacy projects own their id via the <dataRoot>/_p/<pid> slot.
        return fs.existsSync(resolveProjectRootPath(dataRoot, candidatePid));
      } catch {
        return true;
      }
    };
    const projectId = extractedPid && !isPidTaken(extractedPid) ? extractedPid : randomUUID();
    if (extractedPid && projectId !== extractedPid) {
      try {
        rewriteProjectIdsInPlace(normalizedFolder, extractedPid, projectId);
      } catch (error) {
        return { ok: false, code: "IMPORT_FAILED", message: `重写项目数据失败：${errorMessage(error)}` };
      }
    }

    const name = deriveImportProjectName(normalizedFolder, projectId);
    try {
      locationStore.set(projectId, normalizedFolder);
    } catch (error) {
      return { ok: false, code: "IMPORT_FAILED", message: `注册项目位置失败：${errorMessage(error)}` };
    }
    // The renderer-side registry entry is added by the renderer (importProject).
    return { ok: true, project: { id: projectId, name, location: normalizedFolder } };
  });
}
