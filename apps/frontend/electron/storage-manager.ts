import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { getStudioSkillStorageRoot, listStoredStudioSkillFiles } from "./studio-skills-storage";

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
};

type RegisterStorageIpcHandlersOptions = {
  getStudioManualsSourceRoot: () => string;
};

export function createStorageManager({ userDataPath }: CreateStorageManagerOptions) {
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
    } catch (error) {
      console.warn("Failed to save storage config:", error);
    }
  };
  const normalizePath = (inputPath: string) => (
    path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath)
  );
  const isSubdirectory = (parentPath: string, childPath: string) => {
    const normalizedParent = path.resolve(parentPath).toLowerCase() + path.sep;
    const normalizedChild = path.resolve(childPath).toLowerCase() + path.sep;
    return normalizedChild.startsWith(normalizedParent);
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
  const getProjectDataRoot = () => {
    const base = path.join(getStorageBasePath(), "projects");
    ensureDir(base);
    return base;
  };
  const getMediaRoot = () => {
    const base = path.join(getStorageBasePath(), "media");
    ensureDir(base);
    return base;
  };
  const getSkillsRoot = () => {
    const base = getStudioSkillStorageRoot(getStorageBasePath());
    ensureDir(base);
    return base;
  };
  const getCacheDirs = () => [
    path.join(userDataPath, "Cache"),
    path.join(userDataPath, "Code Cache"),
    path.join(userDataPath, "GPUCache"),
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
    await fs.promises.cp(source, destination, { recursive: true, force: true });
  };
  const removeDir = (dirPath: string) => fs.promises.rm(dirPath, { recursive: true, force: true });
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
    saveStorageConfig();
  };
  const createExportDir = (targetPath: string) => path.join(
    normalizePath(targetPath),
    `mystudio-data-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

  const registerIpcHandlers = ({ getStudioManualsSourceRoot }: RegisterStorageIpcHandlersOptions) => {
    const validateDataDir = async (dirPath: string) => {
      try {
        if (!dirPath) return { valid: false, error: "路径不能为空" };
        const target = normalizePath(dirPath);
        if (!fs.existsSync(target)) return { valid: false, error: "目录不存在" };
        const projectsDir = path.join(target, "projects");
        const mediaDir = path.join(target, "media");
        const skillsDir = path.join(target, "skills");
        let projectCount = 0;
        let mediaCount = 0;
        let skillCount = 0;
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
        if (projectCount === 0 && mediaCount === 0 && skillCount === 0) {
          return { valid: false, error: "该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）" };
        }
        return { valid: true, projectCount, mediaCount, skillCount };
      } catch (error) {
        return { valid: false, error: String(error) };
      }
    };
    ipcMain.handle("storage-get-paths", async () => ({
      basePath: getStorageBasePath(),
      projectPath: getProjectDataRoot(),
      mediaPath: getMediaRoot(),
      skillsPath: getSkillsRoot(),
      cachePath: path.join(userDataPath, "Cache"),
    }));
    ipcMain.handle("storage-select-directory", async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
    });
    ipcMain.handle("storage-validate-data-dir", async (_event, dirPath: string) => validateDataDir(dirPath));
    ipcMain.handle("storage-link-data", async (_event, dirPath: string) => {
      try {
        if (!dirPath) return { success: false, error: "路径不能为空" };
        const target = normalizePath(dirPath);
        if (!fs.existsSync(target)) return { success: false, error: "目录不存在" };
        if (!["projects", "media", "skills"].some((name) => fs.existsSync(path.join(target, name)))) {
          return { success: false, error: "该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）" };
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
        const target = normalizePath(newPath);
        const currentBase = getStorageBasePath();
        if (currentBase === target) return { success: true, path: currentBase };
        const conflictError = pathsConflict(currentBase, target);
        if (conflictError) return { success: false, error: conflictError };
        const targetProjectsDir = path.join(target, "projects");
        const targetMediaDir = path.join(target, "media");
        const targetSkillsDir = path.join(target, "skills");
        [targetProjectsDir, targetMediaDir, targetSkillsDir].forEach(ensureDir);
        const currentProjectsDir = getProjectDataRoot();
        const currentMediaDir = getMediaRoot();
        const currentSkillsDir = getSkillsRoot();
        for (const [source, destination] of [
          [currentProjectsDir, targetProjectsDir],
          [currentMediaDir, targetMediaDir],
          [currentSkillsDir, targetSkillsDir],
        ] as const) {
          if (!fs.existsSync(source)) continue;
          for (const file of await fs.promises.readdir(source)) {
            await fs.promises.cp(path.join(source, file), path.join(destination, file), { recursive: true, force: true });
          }
        }
        updateBasePath(target);
        for (const currentDir of [currentProjectsDir, currentMediaDir, currentSkillsDir]) {
          if (!currentDir.startsWith(userDataPath)) await removeDir(currentDir).catch(() => undefined);
        }
        return { success: true, path: target };
      } catch (error) {
        console.error("Failed to move data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-export-data", async (_event, targetPath: string) => {
      try {
        if (!targetPath) return { success: false, error: "路径不能为空" };
        const exportDir = createExportDir(targetPath);
        await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
        await copyDir(getMediaRoot(), path.join(exportDir, "media"));
        await copyDir(getSkillsRoot(), path.join(exportDir, "skills"));
        return { success: true, path: exportDir };
      } catch (error) {
        console.error("Failed to export data:", error);
        return { success: false, error: String(error) };
      }
    });
    ipcMain.handle("storage-import-data", async (_event, sourcePath: string) => {
      try {
        if (!sourcePath) return { success: false, error: "路径不能为空" };
        const source = normalizePath(sourcePath);
        const sources = {
          projects: path.join(source, "projects"),
          media: path.join(source, "media"),
          skills: path.join(source, "skills"),
        };
        const present = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, fs.existsSync(value)]));
        if (!present.projects && !present.media && !present.skills) {
          return { success: false, error: "源目录不包含有效数据（需要 projects/、media/ 或 skills/ 子目录）" };
        }
        const backupDir = path.join(os.tmpdir(), `mystudio-backup-${Date.now()}`);
        const targets = { projects: getProjectDataRoot(), media: getMediaRoot(), skills: getSkillsRoot() };
        try {
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            if (!present[key] || !fs.existsSync(targets[key])) continue;
            if ((await fs.promises.readdir(targets[key])).length > 0) {
              await copyDir(targets[key], path.join(backupDir, key));
            }
          }
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            if (!present[key]) continue;
            await removeDir(targets[key]).catch(() => undefined);
            await copyDir(sources[key], targets[key]);
          }
          const migrationFlagPath = path.join(targets.projects, "_p", "_migrated.json");
          if (fs.existsSync(migrationFlagPath)) fs.unlinkSync(migrationFlagPath);
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Import failed, rolling back:", importError);
          for (const key of Object.keys(sources) as Array<keyof typeof sources>) {
            const backup = path.join(backupDir, key);
            if (!fs.existsSync(backup)) continue;
            await removeDir(targets[key]).catch(() => undefined);
            await copyDir(backup, targets[key]).catch(() => undefined);
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
      const basePath = path.dirname(normalizePath(dirPath));
      updateBasePath(basePath);
      return { success: true, path: basePath };
    });
    ipcMain.handle("storage-link-media-data", async (_event, dirPath: string) => {
      const basePath = path.dirname(normalizePath(dirPath));
      updateBasePath(basePath);
      return { success: true, path: basePath };
    });
    ipcMain.handle("storage-move-project-data", async () => ({ success: false, error: "请使用新的统一存储路径功能" }));
    ipcMain.handle("storage-move-media-data", async () => ({ success: false, error: "请使用新的统一存储路径功能" }));
    const legacyExport = async (targetPath: string) => {
      if (!targetPath) return { success: false, error: "路径不能为空" };
      const exportDir = createExportDir(targetPath);
      await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
      await copyDir(getMediaRoot(), path.join(exportDir, "media"));
      return { success: true, path: exportDir };
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
        const source = normalizePath(sourcePath);
        const projectsDir = path.join(source, "projects");
        const mediaDir = path.join(source, "media");
        const currentProjectsDir = getProjectDataRoot();
        const currentMediaDir = getMediaRoot();
        const currentStorageBase = path.resolve(getStorageBasePath());
        const sourceResolved = path.resolve(source);
        if ([currentStorageBase, path.resolve(currentProjectsDir), path.resolve(currentMediaDir)].includes(sourceResolved)) {
          return { success: true };
        }
        const backupDir = path.join(os.tmpdir(), `mystudio-legacy-import-backup-${Date.now()}`);
        try {
          for (const [current, name] of [[currentProjectsDir, "projects"], [currentMediaDir, "media"]] as const) {
            if (fs.existsSync(current) && (await fs.promises.readdir(current)).length > 0) {
              await copyDir(current, path.join(backupDir, name));
            }
          }
          await removeDir(currentProjectsDir).catch(() => undefined);
          await copyDir(fs.existsSync(projectsDir) ? projectsDir : source, currentProjectsDir);
          if (fs.existsSync(mediaDir)) {
            await removeDir(currentMediaDir).catch(() => undefined);
            await copyDir(mediaDir, currentMediaDir);
          }
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Legacy import failed, rolling back:", importError);
          for (const [current, name] of [[currentProjectsDir, "projects"], [currentMediaDir, "media"]] as const) {
            const backup = path.join(backupDir, name);
            if (!fs.existsSync(backup)) continue;
            await removeDir(current).catch(() => undefined);
            await copyDir(backup, current).catch(() => undefined);
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
        const target = getMediaRoot();
        const source = normalizePath(sourcePath);
        if (source === target) return { success: true };
        const backupDir = path.join(os.tmpdir(), `mystudio-media-import-backup-${Date.now()}`);
        try {
          if (fs.existsSync(target) && (await fs.promises.readdir(target)).length > 0) await copyDir(target, backupDir);
          await removeDir(target);
          await copyDir(source, target);
          await removeDir(backupDir).catch(() => undefined);
          return { success: true };
        } catch (importError) {
          console.error("Media import failed, rolling back:", importError);
          if (fs.existsSync(backupDir)) {
            await removeDir(target).catch(() => undefined);
            await copyDir(backupDir, target).catch(() => undefined);
          }
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
