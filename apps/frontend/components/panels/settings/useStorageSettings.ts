import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useSceneStore } from "@/stores/library/scene-store";
import type { AvailableUpdateInfo } from "@/types/update";
import packageJson from "../../../../package.json";
import { clearPersistedRendererCaches } from "./storage-cache-utils";

export function formatStorageBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

export function useStorageSettings() {
  const {
    resourceSharing,
    storagePaths,
    cacheSettings,
    updateSettings,
    setResourceSharing,
    setStoragePaths,
    setCacheSettings,
    setUpdateSettings,
  } = useAppSettingsStore();
  const { activeProjectId } = useProjectStore();
  const { assignProjectToUnscoped: assignCharactersToProject } = useCharacterLibraryStore();
  const { assignProjectToUnscoped: assignScenesToProject } = useSceneStore();
  const { assignProjectToUnscoped: assignMediaToProject } = useMediaStore();
  const [cacheSize, setCacheSize] = useState(0);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const storageManager = getStorageManagerBridge();
  const hasStorageManager = !!storageManager;
  const hasAppUpdater = typeof window !== "undefined" && !!window.appUpdater;

  const refreshCacheSize = useCallback(async () => {
    if (!storageManager) return;
    setIsCacheLoading(true);
    try {
      const result = await storageManager.getCacheSize();
      setCacheSize(result.total || 0);
    } catch (error) {
      console.error("Failed to get cache size:", error);
    } finally {
      setIsCacheLoading(false);
    }
  }, [storageManager]);

  useEffect(() => {
    if (!hasStorageManager) return;
    storageManager?.getPaths()
      .then((paths) => {
        if (paths.basePath) setStoragePaths({ basePath: paths.basePath });
      })
      .catch(() => {});
    void refreshCacheSize();
  }, [hasStorageManager, refreshCacheSize, setStoragePaths, storageManager]);

  useEffect(() => {
    if (!hasStorageManager || !storageManager) return;
    void storageManager.updateConfig({
      autoCleanEnabled: cacheSettings.autoCleanEnabled,
      autoCleanDays: cacheSettings.autoCleanDays,
    });
  }, [cacheSettings.autoCleanDays, cacheSettings.autoCleanEnabled, hasStorageManager, storageManager]);

  useEffect(() => {
    let cancelled = false;
    void window.appUpdater?.getCurrentVersion?.()
      .then((version) => {
        if (!cancelled && version) setAppVersion(version);
      })
      .catch((error) => console.warn("[StorageSettings] Failed to load app version:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadWithFreshCaches = useCallback((message: string) => {
    clearPersistedRendererCaches();
    toast.success(message);
    window.setTimeout(() => window.location.reload(), 500);
  }, []);

  const toggleShareCharacters = useCallback(async (checked: boolean) => {
    setResourceSharing({ shareCharacters: checked });
    if (!checked && activeProjectId) assignCharactersToProject(activeProjectId);
    try { await useCharacterLibraryStore.persist.rehydrate(); } catch {}
  }, [activeProjectId, assignCharactersToProject, setResourceSharing]);

  const toggleShareScenes = useCallback(async (checked: boolean) => {
    setResourceSharing({ shareScenes: checked });
    if (!checked && activeProjectId) assignScenesToProject(activeProjectId);
    try { await useSceneStore.persist.rehydrate(); } catch {}
  }, [activeProjectId, assignScenesToProject, setResourceSharing]);

  const toggleShareMedia = useCallback(async (checked: boolean) => {
    setResourceSharing({ shareMedia: checked });
    if (!checked && activeProjectId) assignMediaToProject(activeProjectId);
    try { await useMediaStore.persist.rehydrate(); } catch {}
  }, [activeProjectId, assignMediaToProject, setResourceSharing]);

  const selectStoragePath = useCallback(async () => {
    if (!storageManager) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    const dir = await storageManager.selectDirectory();
    if (!dir) return;
    const result = await storageManager.moveData(dir);
    if (!result.success) {
      toast.error(`移动失败: ${result.error || "未知错误"}`);
      return;
    }
    setStoragePaths({ basePath: result.path || dir });
    reloadWithFreshCaches("存储位置已更新，正在刷新...");
  }, [reloadWithFreshCaches, setStoragePaths, storageManager]);

  const exportData = useCallback(async () => {
    if (!storageManager) return;
    const dir = await storageManager.selectDirectory();
    if (!dir) return;
    const result = await storageManager.exportData(dir);
    result.success ? toast.success("数据已导出") : toast.error(`导出失败: ${result.error || "未知错误"}`);
  }, [storageManager]);

  const importData = useCallback(async () => {
    if (!storageManager) return;
    const dir = await storageManager.selectDirectory();
    if (!dir || !window.confirm("导入会按来源中存在的目录类别覆盖当前 projects/media/assets/skills 数据，是否继续？")) return;
    const result = await storageManager.importData(dir);
    if (!result.success) {
      toast.error(`导入失败: ${result.error || "未知错误"}`);
      return;
    }
    reloadWithFreshCaches("数据已导入，正在刷新...");
  }, [reloadWithFreshCaches, storageManager]);

  const linkData = useCallback(async () => {
    if (!storageManager) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    const dir = await storageManager.selectDirectory();
    if (!dir) return;
    const validation = await storageManager.validateDataDir(dir);
    if (!validation.valid) {
      toast.error(validation.error || "无效的数据目录");
      return;
    }
    const message = `检测到 ${validation.projectCount || 0} 个项目文件，${validation.mediaCount || 0} 个素材文件，${validation.assetCount || 0} 个资产库条目，${validation.skillCount || 0} 个技能文件。\n\n是否指向此目录？操作后建议重启应用。`;
    if (!window.confirm(message)) return;
    const result = await storageManager.linkData(dir);
    if (!result.success) {
      toast.error(`操作失败: ${result.error || "未知错误"}`);
      return;
    }
    setStoragePaths({ basePath: result.path || dir });
    reloadWithFreshCaches("已指向数据目录，正在刷新...");
  }, [reloadWithFreshCaches, setStoragePaths, storageManager]);

  const clearCache = useCallback(async () => {
    if (!storageManager) return;
    setIsClearingCache(true);
    try {
      const result = await storageManager.clearCache();
      if (result.success) {
        toast.success("缓存已清理");
        await refreshCacheSize();
      } else {
        toast.error(`清理失败: ${result.error || "未知错误"}`);
      }
    } finally {
      setIsClearingCache(false);
    }
  }, [refreshCacheSize, storageManager]);

  const checkForUpdates = useCallback(async () => {
    if (!window.appUpdater) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    setIsCheckingForUpdates(true);
    try {
      const result = await window.appUpdater.checkForUpdates();
      if (!result.success) {
        toast.error(`检查更新失败: ${result.error || "未知错误"}`);
      } else if (result.hasUpdate && result.update) {
        setAvailableUpdate(result.update);
        setUpdateDialogOpen(true);
      } else {
        setAvailableUpdate(null);
        toast.success(`当前已是最新版本 v${result.currentVersion}`);
      }
    } catch (error) {
      console.error("[StorageSettings] Failed to check updates:", error);
      toast.error("检查更新失败，请稍后重试");
    } finally {
      setIsCheckingForUpdates(false);
    }
  }, []);

  const clearIgnoredVersion = useCallback(() => {
    setUpdateSettings({ ignoredVersion: "" });
    toast.success("已恢复更新提醒");
  }, [setUpdateSettings]);

  const ignoreVersion = useCallback((version: string) => {
    setUpdateSettings({ ignoredVersion: version });
    setAvailableUpdate(null);
  }, [setUpdateSettings]);

  return {
    resourceSharing,
    storagePaths,
    cacheSettings,
    updateSettings,
    setCacheSettings,
    setUpdateSettings,
    cacheSize,
    appVersion,
    hasStorageManager,
    hasAppUpdater,
    isCacheLoading,
    isClearingCache,
    isCheckingForUpdates,
    updateDialogOpen,
    setUpdateDialogOpen,
    availableUpdate,
    refreshCacheSize,
    toggleShareCharacters,
    toggleShareScenes,
    toggleShareMedia,
    selectStoragePath,
    exportData,
    importData,
    linkData,
    clearCache,
    checkForUpdates,
    clearIgnoredVersion,
    ignoreVersion,
  };
}
