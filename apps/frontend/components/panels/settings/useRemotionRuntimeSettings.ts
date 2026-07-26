import { useCallback, useEffect, useState } from "react";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import type { RemotionBrowserDownloadProgress, RemotionBrowserStatus } from "@rendering/contracts/remotion-browser-status";
import type { TimelineRendererId } from "@rendering/contracts/timeline-renderer";

export function useRemotionRuntimeSettings() {
  const renderer = useAppSettingsStore((state) => state.renderingSettings.renderer);
  const setRenderingSettings = useAppSettingsStore((state) => state.setRenderingSettings);
  const [status, setStatus] = useState<RemotionBrowserStatus>();
  const [progress, setProgress] = useState<RemotionBrowserDownloadProgress>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const runtimeAvailable = typeof window !== "undefined" && Boolean(window.remotionRuntime);

  const refreshStatus = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (!bridge) return;
    try {
      setError(undefined);
      setStatus(await bridge.status());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (!bridge) return undefined;
    const unsubscribe = bridge.onDownloadProgress((next) => {
      setProgress(next);
      if (next.phase === "failed") setError(next.message ?? "Headless Shell 下载失败");
      if (next.phase === "completed") void refreshStatus();
    });
    void refreshStatus();
    return unsubscribe;
  }, [refreshStatus]);

  const selectRenderer = useCallback((next: TimelineRendererId) => {
    setRenderingSettings({ renderer: next });
  }, [setRenderingSettings]);

  const downloadBrowser = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (!bridge || isLoading) return;
    setIsLoading(true);
    setError(undefined);
    setProgress({ phase: "starting", ratio: 0, remotionVersion: status?.remotionVersion ?? "4.0.499" });
    try {
      setStatus(await bridge.download());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, status?.remotionVersion]);

  return {
    renderer,
    status,
    progress,
    error,
    isLoading,
    runtimeAvailable,
    selectRenderer,
    refreshStatus,
    downloadBrowser,
  };
}
