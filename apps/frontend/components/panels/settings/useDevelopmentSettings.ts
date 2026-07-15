import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import type { DiagnosticsLogInfo } from "@/types/diagnostics";

export function useDevelopmentSettings() {
  const settings = useAppSettingsStore((state) => state.developmentSettings);
  const setSettings = useAppSettingsStore((state) => state.setDevelopmentSettings);
  const [isOpeningDevTools, setIsOpeningDevTools] = useState(false);
  const [diagnosticsInfo, setDiagnosticsInfo] = useState<DiagnosticsLogInfo | null>(null);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [isClearingDiagnostics, setIsClearingDiagnostics] = useState(false);
  const hasDevTools = typeof window !== "undefined" && !!window.electronAPI?.openDevTools;
  const hasDiagnostics = typeof window !== "undefined" && !!window.diagnosticsLog;

  const refreshDiagnostics = useCallback(async () => {
    if (!window.diagnosticsLog) return;
    setIsDiagnosticsLoading(true);
    try {
      setDiagnosticsInfo(await window.diagnosticsLog.getInfo());
    } catch (error) {
      console.error("[DevelopmentSettings] Failed to load diagnostics info:", error);
    } finally {
      setIsDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasDiagnostics) void refreshDiagnostics();
  }, [hasDiagnostics, refreshDiagnostics]);

  const openDevTools = useCallback(async () => {
    if (!window.electronAPI?.openDevTools) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    setIsOpeningDevTools(true);
    try {
      const result = await window.electronAPI.openDevTools();
      result.success ? toast.success("控制台已打开") : toast.error(result.error || "打开控制台失败");
    } catch (error) {
      console.error("[DevelopmentSettings] Failed to open DevTools:", error);
      toast.error("打开控制台失败");
    } finally {
      setIsOpeningDevTools(false);
    }
  }, []);

  const openDiagnosticsFolder = useCallback(async () => {
    if (!window.diagnosticsLog) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    const result = await window.diagnosticsLog.openFolder();
    result.success ? toast.success("日志文件夹已打开") : toast.error(result.error || "打开日志文件夹失败");
  }, []);

  const exportDiagnostics = useCallback(async () => {
    if (!window.diagnosticsLog) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    setIsExportingDiagnostics(true);
    try {
      const result = await window.diagnosticsLog.exportBundle();
      if (result.success) {
        toast.success("诊断包已导出");
        await refreshDiagnostics();
      } else {
        toast.error(result.error || "导出诊断包失败");
      }
    } finally {
      setIsExportingDiagnostics(false);
    }
  }, [refreshDiagnostics]);

  const clearDiagnostics = useCallback(async () => {
    if (!window.diagnosticsLog) {
      toast.error("请在桌面应用中使用此功能");
      return;
    }
    if (!window.confirm("清理诊断日志？这不会影响项目资产和配置。")) return;
    setIsClearingDiagnostics(true);
    try {
      const result = await window.diagnosticsLog.clear();
      if (result.success) {
        toast.success(`已清理 ${result.removedFiles} 个日志文件`);
        await refreshDiagnostics();
      } else {
        toast.error(result.error || "清理诊断日志失败");
      }
    } finally {
      setIsClearingDiagnostics(false);
    }
  }, [refreshDiagnostics]);

  return {
    settings,
    setSettings,
    hasDevTools,
    isOpeningDevTools,
    openDevTools,
    hasDiagnostics,
    diagnosticsInfo,
    isDiagnosticsLoading,
    isExportingDiagnostics,
    isClearingDiagnostics,
    refreshDiagnostics,
    openDiagnosticsFolder,
    exportDiagnostics,
    clearDiagnostics,
  };
}
