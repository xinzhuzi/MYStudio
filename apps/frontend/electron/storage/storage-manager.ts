import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { createBlessedPathRegistry } from "../security/managed-paths";
import { getStudioSkillStorageRoot, listStoredStudioSkillFiles } from "./studio-skills-storage";
import { ttsModelCacheDir } from "./model-dirs";

type StorageConfig = {
  basePath?: string;
  projectPath?: string;
  mediaPath?: string;
  autoCleanEnabled?: boolean;
  autoCleanDays?: number;
};

const DEFAULT_STORAGE_CONFIG: Required<StorageConfig> = {
  basePath: "",
  projectPath: "",
  mediaPath: "",
  autoCleanEnabled: false,
  autoCleanDays: 30,
};

type CreateStorageManagerOptions = {
  userDataPath: string;
  /** Chromium 会话数据根（app.getPath('sessionData')）；缺省回退 userData（旧布局）。 */
  sessionDataPath?: string;
  fileOps?: {
    cp?: typeof fs.promises.cp;
    remove?: typeof fs.promises.rm;
    unlink?: typeof fs.promises.unlink;
  };
};

type RootOptions = {
  ensure?: boolean;
};

type RegisterStorageIpcHandlersOptions = {
  getStudioManualsSourceRoot: () => string;
};

export function createStorageManager({ userDataPath, sessionDataPath = userDataPath, fileOps }: CreateStorageManagerOptions) {
  const storageConfigPath = path.join(userDataPath, "storage-config.json");
  let autoCleanInterval: NodeJS.Timeout | null = null;
  const ensureDir = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  };
  const loadStorageConfig = (): StorageConfig => {
    try {
      if (fs.existsSync(storageConfigPath)) {
        const parsed = JSON.parse(fs.readFileSync(storageConfigPath, "utf-8")) as StorageConfig;
        return { ...DEFAULT_STORAGE_CONFIG, ...parsed };
      }
    } catch (error) {
      console.warn("Failed to load storage config:", error);
    }
    return { ...DEFAULT_STORAGE_CONFIG };
  };
  let storageConfig = loadStorageConfig();
  const saveStorageConfig = () => {
    try {
      fs.writeFileSync(storageConfigPath, JSON.stringify(storageConfig, null, 2), "utf-8");
      return true;
    } catch (error) {
      console.warn("Failed to save storage config:", error);
      return false;
    }
  };
  const copy = fileOps?.cp ?? fs.promises.cp;
  const remove = fileOps?.remove ?? fs.promises.rm;
  const unlink = fileOps?.unlink ?? fs.promises.unlink;
  const normalizePath = (inputPath: string) => (
    path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath)
  );
  const isSubdirectory = (parentPath: string, childPath: string) => {
    const normalizedParent = path.resolve(parentPath).toLowerCase() + path.sep;
    const normalizedChild = path.resolve(childPath).toLowerCase() + path.sep;
    return normalizedChild.startsWith(normalizedParent);
  };
  const canonicalPath = (inputPath: string) => {
    const resolved = path.resolve(inputPath);
    try {
      const realpathSync = (fs as typeof fs & { realpathSync?: (value: string) => string }).realpathSync;
      return realpathSync ? realpathSync(resolved) : resolved;
    } catch {
      return resolved;
    }
  };
  const samePath = (left: string, right: string) => canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
  const containmentError = (source: string, target: string) => {
    const sourceCanonical = canonicalPath(source);
    const targetCanonical = canonicalPath(target);
    if (samePath(sourceCanonical, targetCanonical)) return "路径相同";
    if (isSubdirectory(sourceCanonical, targetCanonical)) return "目标路径不能是当前路径的子目录";
    if (isSubdirectory(targetCanonical, sourceCanonical)) return "当前路径不能是目标路径的子目录";
    return null;
  };
  const pathsConflict = (source: string, dest: string): string | null => {
    if (path.resolve(source).toLowerCase() === path.resolve(dest).toLowerCase()) return null;
    if (isSubdirectory(source, dest)) return "目标路径不能是当前路径的子目录";
    if (isSubdirectory(dest, source)) return "当前路径不能是目标路径的子目录";
    return null;
  };
  const getStorageBasePath = () => {
    const configured = storageConfig.basePath?.trim();
    if (configured) return normalizePath(configured);
    const legacyProject = storageConfig.projectPath?.trim();
    if (legacyProject) return path.dirname(normalizePath(legacyProject));
    return userDataPath;
  };
  const getProjectDataRoot = ({ ensure = true }: RootOptions = {}) => {
    const base = path.join(getStorageBasePath(), "projects");
    if (ensure) ensureDir(base);
    return base;
  };
  const getMediaRoot = ({ ensure = true }: RootOptions = {}) => {
    const base = path.join(getStorageBasePath(), "media");
    if (ensure) ensureDir(base);
    return base;
  };
  const getSkillsRoot = ({ ensure = true }: RootOptions = {}) => {
    const base = getStudioSkillStorageRoot(getStorageBasePath());
    if (ensure) ensureDir(base);
    return base;
  };
  const getAssetsRoot = ({ ensure = true }: RootOptions = {}) => {
    const base = path.join(getStorageBasePath(), "assets");
    if (ensure) ensureDir(base);
    return base;
  };
  const getPythonRuntimeDir = () => path.join(getStorageBasePath(), "python");
  const getModelCacheDir = () => ttsModelCacheDir(getStorageBasePath());
  const getCacheDirs = () => [
    path.join(sessionDataPath, "Cache"),
    path.join(sessionDataPath, "Code Cache"),
    path.join(sessionDataPath, "GPUCache"),
  ];
  const getDirectorySize = async (dirPath: string): Promise<number> => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      let total = 0;
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        total += entry.isDirectory()
          ? await getDirectorySize(fullPath)
          : (await fs.promises.stat(fullPath)).size;
      }
      return total;
    } catch {
      return 0;
    }
  };
  const copyDir = async (source: string, destination: string) => {
    ensureDir(destination);
    await copy(source, destination, { recursive: true, force: true });
  };
  const removeDir = (dirPath: string) => remove(dirPath, { recursive: true, force: true });
  const deleteOldFiles = async (dirPath: string, cutoffTime: number): Promise<number> => {
    let cleared = 0;
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          cleared += await deleteOldFiles(fullPath, cutoffTime);
          const remaining = await fs.promises.readdir(fullPath);
          if (remaining.length === 0) await fs.promises.rmdir(fullPath).catch(() => undefined);
        } else {
          const stat = await fs.promises.stat(fullPath);
          if (stat.mtimeMs < cutoffTime) {
            await fs.promises.unlink(fullPath).catch(() => undefined);
            cleared += stat.size;
          }
        }
      }
    } catch {
      // Ignore inaccessible cache entries.
    }
    return cleared;
  };
  const clearCache = async (olderThanDays?: number) => {
    const dirs = getCacheDirs();
    let cleared = 0;
    if (olderThanDays && olderThanDays > 0) {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      for (const dir of dirs) cleared += await deleteOldFiles(dir, cutoff);
      return cleared;
    }
    for (const dir of dirs) {
      cleared += await getDirectorySize(dir);
      await removeDir(dir).catch(() => undefined);
      ensureDir(dir);
    }
    return cleared;
  };
  const scheduleAutoClean = () => {
    if (autoCleanInterval) {
      clearInterval(autoCleanInterval);
      autoCleanInterval = null;
    }
    if (storageConfig.autoCleanEnabled) {
      const days = storageConfig.autoCleanDays || DEFAULT_STORAGE_CONFIG.autoCleanDays;
      clearCache(days).catch(() => undefined);
      autoCleanInterval = setInterval(() => clearCache(days).catch(() => undefined), 24 * 60 * 60 * 1000);
    }
  };
  const updateBasePath = (basePath: string) => {
    storageConfig.basePath = basePath;
    storageConfig.projectPath = "";
    storageConfig.mediaPath = "";
    if (!saveStorageConfig()) throw new Error("无法保存存储配置");
  };
  const captureStorageConfig = () => {
    const fileExists = fs.existsSync(storageConfigPath);
    return {
      value: { ...storageConfig },
      fileExists,
      fileContents: fileExists ? fs.readFileSync(storageConfigPath, "utf-8") : undefined,
    };
  };
  const restoreStorageConfig = (snapshot: ReturnType<typeof captureStorageConfig>) => {
    storageConfig = { ...snapshot.value };
    try {
      if (snapshot.fileExists) {
        fs.writeFileSync(storageConfigPath, snapshot.fileContents ?? "", "utf-8");
      } else if (fs.existsSync(storageConfigPath)) {
        fs.rmSync(storageConfigPath, { force: true });
      }
    } catch (error) {
      console.warn("Failed to restore storage config:", error);
    }
  };
  const createExportDir = (targetPath: string) => path.join(
    normalizePath(targetPath),
    `mystudio-data-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

  const registerIpcHandlers = ({ getStudioManualsSourceRoot }: RegisterStorageIpcHandlersOptions) => {
    // 存储高危操作(link/move/export/import)的目标路径必须来自本应用的原生
    // 目录选择器:select-directory 的结果在此短期「祝福」,未经对话框的路径
    // 一律拒绝——防止被攻破的渲染进程直改存储根/搬数据(与素材库同款守卫)。
    const blessedStorageDirs = createBlessedPathRegistry();
    const blessDialogDir = (dirPath: string) => {
      blessedStorageDirs.bless([normalizePath(dirPath)]);
    };
    const unblessedDirError = (rawPath: string): { success: false; error: string } | null => {
      if (!blessedStorageDirs.has(normalizePath(rawPath))) {
        return { success: false, error: "目录必须通过应用内的目录选择器选择后才能操作" };
      }
      return null;
    };
    const confirmImportDialog = async (source: string): Promise<boolean> => {
      const result = await dialog.showMessageBox({
        type: "warning",
        message: "确认导入数据?",
        detail: `导入将替换当前的 projects/、media/、assets/、skills/ 中与源目录重合的数据。\n\n源目录: ${source}\n现有数据会先备份,失败时自动回滚。`,
        buttons: ["取消", "确认导入"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1;
    };
    const validateDataDir = async (dirPath: string) => {
      try {
        if (!dirPath) return { valid: false, error: "路径不能为空" };
        const target = normalizePath(dirPath);
        if (!fs.existsSync(target)) return { valid: false, error: "目录不存在" };
        const projectsDir = path.join(target, "projects");
        const mediaDir = path.join(target, "media");
        const skillsDir = path.join(target, "skills");
        const assetsDir = path.join(target, "assets");
        let projectCount = 0;
        let mediaCount = 0;
        let skillCount = 0;
        let assetCount = 0;
        if (fs.existsSync(projectsDir)) {
          const files = await fs.promises.readdir(projectsDir);
          projectCount = files.filter((file) => file.endsWith(".json")).length;
          const perProjectDir = path.join(projectsDir, "_p");
          if (fs.existsSync(perProjectDir)) {
            const projectDirs = await fs.promises.readdir(perProjectDir, { withFileTypes: true });
            const dirCount = projectDirs.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
            if (dirCount > 0) projectCount = Math.max(projectCount, dirCount);
          }
        }
        if (fs.existsSync(mediaDir)) mediaCount = (await fs.promises.readdir(mediaDir)).length;
        if (fs.existsSync(skillsDir)) {
          skillCount = (await listStoredStudioSkillFiles({
            sourceRoot: getStudioManualsSourceRoot(),
            storageRoot: skillsDir,
          })).length;
        }
        if (fs.existsSync(assetsDir)) assetCount = (await fs.promises.readdir(assetsDir)).length;
        if (projectCount === 0 && mediaCount === 0 && skillCount === 0 && assetCount === 0) {
          return { valid: false, error: "该目录不包含有效的数据（需要 projects/、media/、assets/ 或 skills/ 子目录）" };
        }
        return { valid: true, projectCount, mediaCount, skillCount, assetCount };
      } catch (error) {
        return { valid: false, error: String(error) };
      }
    };
    ipcMain.handle("storage-get-paths", async () => ({
      basePath: getStorageBasePath(),
      projectPath: getProjectDataRoot(),
      mediaPath: getMediaRoot(),
      assetsPath: getAssetsRoot(),
      skillsPath: getSkillsRoot(),
      pythonRuntimeDir: getPythonRuntimeDir(),
      modelCacheDir: getModelCacheDir(),
      cachePath: path.join(sessionDataPath, "Cache"),
    }));
    ipcMain.handle("storage-select-directory", async (_event, defaultPath?: string) => {
      // Optional default open location (backward compatible): only forwarded to
      // the native dialog when it is an absolute path string.
      const options: { properties: ("openDirectory" | "createDirectory")[]; defaultPath?: string } = {
        properties: ["openDirectory", "createDirectory"],
      };
      if (typeof defaultPath === "string" && defaultPath.trim() && path.isAbsolute(defaultPath.trim())) {
        options.defaultPath = defaultPath.trim();
      }
      const result = await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      blessDialogDir(result.filePaths[0]);
      return result.filePaths[0];
    });
    ipcMain.handle("storage-validate-data-dir", async (_event, dirPath: string) => validateDataDir(dirPath));
    ipcMain.handle("storage-link-data", async (_event, dirPath: string) => {
      try {
        if (!dirPath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(dirPath);
        if (unblessed) return unblessed;
        const target = normalizePath(dirPath);
        if (!fs.existsSync(target)) return { success: false, error: "目录不存在" };
        if (!["projects", "media", "assets", "skills"].some((name) => fs.existsSync(path.join(target, name)))) {
          return { success: false, error: "该目录不包含有效的数据（需要 projects/、media/、assets/ 或 skills/ 子目录）" };
        }
        updateBasePath(target);
        return { success: true, path: target };
      } catch (error) {
        console.error("Failed to link data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-move-data", async (_event, newPath: string) => {
      try {
        if (!newPath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(newPath);
        if (unblessed) return unblessed;
        const target = normalizePath(newPath);
        const currentBase = getStorageBasePath();
        if (samePath(currentBase, target)) return { success: true, path: currentBase };
        const conflictError = containmentError(currentBase, target) ?? pathsConflict(currentBase, target);
        if (conflictError && conflictError !== "路径相同") return { success: false, error: conflictError };
        const targetProjectsDir = path.join(target, "projects");
        const targetMediaDir = path.join(target, "media");
        const targetAssetsDir = path.join(target, "assets");
        const targetSkillsDir = path.join(target, "skills");
        const currentProjectsDir = getProjectDataRoot({ ensure: false });
        const currentMediaDir = getMediaRoot({ ensure: false });
        const currentAssetsDir = getAssetsRoot({ ensure: false });
        const currentSkillsDir = getSkillsRoot({ ensure: false });
        const targetBackup = path.join(os.tmpdir(), `mystudio-move-backup-${Date.now()}`);
        const targetState = new Map<string, { existed: boolean; nonEmpty: boolean }>();
        const configSnapshot = captureStorageConfig();
        try {
          for (const destination of [targetProjectsDir, targetMediaDir, targetAssetsDir, targetSkillsDir]) {
            const existed = fs.existsSync(destination);
            const nonEmpty = existed && (await fs.promises.readdir(destination)).length > 0;
            targetState.set(destination, { existed, nonEmpty });
            if (nonEmpty) await copyDir(destination, path.join(targetBackup, path.basename(destination)));
          }
        } catch (snapshotError) {
          await removeDir(targetBackup).catch(() => undefined);
          throw snapshotError;
        }
        try {
        for (const [source, destination] of [
          [currentProjectsDir, targetProjectsDir],
          [currentMediaDir, targetMediaDir],
          [currentAssetsDir, targetAssetsDir],
          [currentSkillsDir, targetSkillsDir],
        ] as const) {
          if (!fs.existsSync(source)) continue;
          ensureDir(destination);
          for (const file of await fs.promises.readdir(source)) {
            await copy(path.join(source, file), path.join(destination, file), { recursive: true, force: true });
          }
        }
        updateBasePath(target);
        for (const currentDir of [currentProjectsDir, currentMediaDir, currentAssetsDir, currentSkillsDir]) {
          const insideUserData = samePath(userDataPath, currentDir) || isSubdirectory(userDataPath, currentDir);
          if (!insideUserData && fs.existsSync(currentDir)) await removeDir(currentDir);
        }
        await removeDir(targetBackup).catch(() => undefined);
        return { success: true, path: target };
        } catch (moveError) {
          for (const destination of [targetProjectsDir, targetMediaDir, targetAssetsDir, targetSkillsDir]) {
            await removeDir(destination).catch(() => undefined);
            const backup = path.join(targetBackup, path.basename(destination));
            const state = targetState.get(destination);
            if (state?.nonEmpty && fs.existsSync(backup)) await copyDir(backup, destination).catch(() => undefined);
            else if (state?.existed) ensureDir(destination);
          }
          restoreStorageConfig(configSnapshot);
          await removeDir(targetBackup).catch(() => undefined);
          throw moveError;
        }
      } catch (error) {
        console.error("Failed to move data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-export-data", async (_event, targetPath: string) => {
      let exportDir: string | undefined;
      try {
        if (!targetPath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(targetPath);
        if (unblessed) return unblessed;
        exportDir = createExportDir(targetPath);
        if (containmentError(getStorageBasePath(), exportDir)) return { success: false, error: "导出目录不能位于当前存储路径内或与其重叠" };
        await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
        await copyDir(getMediaRoot(), path.join(exportDir, "media"));
        await copyDir(getAssetsRoot(), path.join(exportDir, "assets"));
        await copyDir(getSkillsRoot(), path.join(exportDir, "skills"));
        return { success: true, path: exportDir };
      } catch (error) {
        if (exportDir) await removeDir(exportDir).catch(() => undefined);
        console.error("Failed to export data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-import-data", async (_event, sourcePath: string) => {
      try {
        if (!sourcePath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(sourcePath);
        if (unblessed) return unblessed;
        const source = normalizePath(sourcePath);
        // import 会先删除现有 projects/media/assets/skills 再拷入,破坏性最强,
        // 对话框选择之外再加一道原生确认,确保操作确经用户主动发起。
        if (!(await confirmImportDialog(source))) {
          return { success: false, error: "已取消导入" };
        }
        const sourceConflict = containmentError(source, getStorageBasePath());
        if (sourceConflict) return sourceConflict === "路径相同"
          ? { success: true }
          : { success: false, error: "导入源不能位于当前存储路径内或与其重叠" };
        const sources = {
          projects: path.join(source, "projects"),
          media: path.join(source, "media"),
          assets: path.join(source, "assets"),
          skills: path.join(source, "skills"),
        };
        const present = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, fs.existsSync(value)]));
        if (!present.projects && !present.media && !present.assets && !present.skills) {
          return { success: false, error: "源目录不包含有效数据（需要 projects/、media/、assets/ 或 skills/ 子目录）" };
        }
        const backupDir = path.join(os.tmpdir(), `mystudio-backup-${Date.now()}`);
        const targets = {
          projects: getProjectDataRoot({ ensure: false }),
          media: getMediaRoot({ ensure: false }),
          assets: getAssetsRoot({ ensure: false }),
          skills: getSkillsRoot({ ensure: false }),
        };
        const targetState = new Map<string, { existed: boolean; nonEmpty: boolean }>();
        try {
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            const existed = fs.existsSync(targets[key]);
            const nonEmpty = existed && (await fs.promises.readdir(targets[key])).length > 0;
            targetState.set(key, { existed, nonEmpty });
            if (existed && present[key] && nonEmpty) await copyDir(targets[key], path.join(backupDir, key));
          }
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            if (!present[key]) continue;
            await removeDir(targets[key]);
            await copyDir(sources[key], targets[key]);
          }
          const migrationFlagPath = path.join(targets.projects, "_p", "_migrated.json");
          if (fs.existsSync(migrationFlagPath)) await unlink(migrationFlagPath);
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Import failed, rolling back:", importError);
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            const backup = path.join(backupDir, key);
            await removeDir(targets[key]).catch(() => undefined);
            const state = targetState.get(key);
            if (state?.nonEmpty && fs.existsSync(backup)) await copyDir(backup, targets[key]).catch(() => undefined);
            else if (state?.existed) ensureDir(targets[key]);
          }
          await removeDir(backupDir).catch(() => undefined);
          throw importError;
        }
      } catch (error) {
        console.error("Failed to import data:", error);
        return { success: false, error: String(error) };
      }
    });

    ipcMain.handle("storage-validate-project-dir", async (_event, dirPath: string) => validateDataDir(dirPath));
    ipcMain.handle("storage-link-project-data", async (_event, dirPath: string) => {
      const unblessed = unblessedDirError(dirPath);
      if (unblessed) return unblessed;
      const basePath = path.dirname(normalizePath(dirPath));
      updateBasePath(basePath);
      return { success: true, path: basePath };
    });
    ipcMain.handle("storage-link-media-data", async (_event, dirPath: string) => {
      const unblessed = unblessedDirError(dirPath);
      if (unblessed) return unblessed;
      const basePath = path.dirname(normalizePath(dirPath));
      updateBasePath(basePath);
      return { success: true, path: basePath };
    });
    ipcMain.handle("storage-move-project-data", async () => ({ success: false, error: "请使用新的统一存储路径功能" }));
    ipcMain.handle("storage-move-media-data", async () => ({ success: false, error: "请使用新的统一存储路径功能" }));
    const legacyExport = async (targetPath: string) => {
      if (!targetPath) return { success: false, error: "路径不能为空" };
      const unblessed = unblessedDirError(targetPath);
      if (unblessed) return unblessed;
      const exportDir = createExportDir(targetPath);
      try {
        if (containmentError(getStorageBasePath(), exportDir)) return { success: false, error: "导出目录不能位于当前存储路径内或与其重叠" };
        await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
        await copyDir(getMediaRoot(), path.join(exportDir, "media"));
        return { success: true, path: exportDir };
      } catch (error) {
        await removeDir(exportDir).catch(() => undefined);
        throw error;
      }
    };
    ipcMain.handle("storage-export-project-data", async (_event, targetPath: string) => {
      try { return await legacyExport(targetPath); } catch (error) { return { success: false, error: String(error) }; }
    });
    ipcMain.handle("storage-export-media-data", async (_event, targetPath: string) => {
      try { return await legacyExport(targetPath); } catch (error) {
        console.error("Failed to export data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-import-project-data", async (_event, sourcePath: string) => {
      try {
        if (!sourcePath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(sourcePath);
        if (unblessed) return unblessed;
        if (!(await confirmImportDialog(normalizePath(sourcePath)))) {
          return { success: false, error: "已取消导入" };
        }
        const source = normalizePath(sourcePath);
        const projectsDir = path.join(source, "projects");
        const mediaDir = path.join(source, "media");
        const currentProjectsDir = getProjectDataRoot({ ensure: false });
        const currentMediaDir = getMediaRoot({ ensure: false });
        const currentStorageBase = path.resolve(getStorageBasePath());
        const sourceConflict = containmentError(source, currentStorageBase);
        if (sourceConflict) return sourceConflict === "路径相同"
          || samePath(source, currentProjectsDir)
          || samePath(source, currentMediaDir)
          ? { success: true }
          : { success: false, error: "导入源不能位于当前存储路径内或与其重叠" };
        const backupDir = path.join(os.tmpdir(), `mystudio-legacy-import-backup-${Date.now()}`);
        const targetState = new Map<string, { existed: boolean; nonEmpty: boolean }>();
        try {
          for (const [current, name] of [[currentProjectsDir, "projects"], [currentMediaDir, "media"]] as const) {
            const existed = fs.existsSync(current);
            const nonEmpty = existed && (await fs.promises.readdir(current)).length > 0;
            targetState.set(current, { existed, nonEmpty });
            if (nonEmpty) {
              await copyDir(current, path.join(backupDir, name));
            }
          }
          await removeDir(currentProjectsDir);
          await copyDir(fs.existsSync(projectsDir) ? projectsDir : source, currentProjectsDir);
          if (fs.existsSync(mediaDir)) {
            await removeDir(currentMediaDir);
            await copyDir(mediaDir, currentMediaDir);
          }
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Legacy import failed, rolling back:", importError);
          for (const [current, name] of [[currentProjectsDir, "projects"], [currentMediaDir, "media"]] as const) {
            const backup = path.join(backupDir, name);
            await removeDir(current).catch(() => undefined);
            const state = targetState.get(current);
            if (state?.nonEmpty && fs.existsSync(backup)) await copyDir(backup, current).catch(() => undefined);
            else if (state?.existed) ensureDir(current);
          }
          await removeDir(backupDir).catch(() => undefined);
          throw importError;
        }
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-import-media-data", async (_event, sourcePath: string) => {
      try {
        if (!sourcePath) return { success: false, error: "路径不能为空" };
        const unblessed = unblessedDirError(sourcePath);
        if (unblessed) return unblessed;
        if (!(await confirmImportDialog(normalizePath(sourcePath)))) {
          return { success: false, error: "已取消导入" };
        }
        const target = getMediaRoot({ ensure: false });
        const source = normalizePath(sourcePath);
        if (samePath(source, target)) return { success: true };
        if (containmentError(source, target)) return { success: false, error: "导入源不能位于当前媒体目录内或与其重叠" };
        const backupDir = path.join(os.tmpdir(), `mystudio-media-import-backup-${Date.now()}`);
        const targetExisted = fs.existsSync(target);
        const targetNonEmpty = targetExisted && (await fs.promises.readdir(target)).length > 0;
        try {
          if (targetNonEmpty) await copyDir(target, backupDir);
          await removeDir(target);
          await copyDir(source, target);
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Media import failed, rolling back:", importError);
          await removeDir(target).catch(() => undefined);
          if (targetNonEmpty && fs.existsSync(backupDir)) await copyDir(backupDir, target).catch(() => undefined);
          else if (targetExisted) ensureDir(target);
          await removeDir(backupDir).catch(() => undefined);
          throw importError;
        }
      } catch (error) {
        console.error("Failed to import media data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-get-cache-size", async () => {
      const details = await Promise.all(getCacheDirs().map(async (dirPath) => ({
        path: dirPath,
        size: await getDirectorySize(dirPath),
      })));
      return { total: details.reduce((sum, item) => sum + item.size, 0), details };
    });
    ipcMain.handle("storage-clear-cache", async (_event, options?: { olderThanDays?: number }) => {
      try {
        return { success: true, clearedBytes: await clearCache(options?.olderThanDays) };
      } catch (error) {
        console.error("Failed to clear cache:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-update-config", async (_event, config: {
      autoCleanEnabled?: boolean; autoCleanDays?: number;
    }) => {
      storageConfig = { ...storageConfig, ...config };
      saveStorageConfig();
      scheduleAutoClean();
      return true;
    });
  };

  return {
    getStorageBasePath,
    getProjectDataRoot,
    getMediaRoot,
    getSkillsRoot,
    scheduleAutoClean,
    registerIpcHandlers,
  };
}
