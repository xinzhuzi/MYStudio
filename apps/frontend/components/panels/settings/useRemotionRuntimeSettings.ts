import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import type { RemotionBrowserDownloadProgress, RemotionBrowserStatus } from "@rendering/contracts/remotion-browser-status";
import type { TimelineRendererId } from "@rendering/contracts/timeline-renderer";

export type RemotionRuntimeVerificationState =
  | "checking"
  | "ready"
  | "needs-download"
  | "error";

type RuntimeOperation = "status" | "verify" | "download";

function getVerificationDetails(status: RemotionBrowserStatus): {
  state: Exclude<RemotionRuntimeVerificationState, "checking">;
  message: string;
} {
  switch (status.state) {
    case "ready":
      return {
        state: "ready",
        message: `验证通过：Headless Shell 可执行文件与 Remotion ${status.remotionVersion} 的缓存版本匹配，无需重新下载。`,
      };
    case "not-installed":
      return {
        state: "needs-download",
        message: "验证结果：未检测到与当前 Remotion 版本匹配的 Headless Shell 可执行文件或缓存，可以下载。",
      };
    case "update-required":
      return {
        state: "needs-download",
        message: status.preparedForRemotionVersion
          ? `验证结果：Headless Shell 缓存对应 Remotion ${status.preparedForRemotionVersion}，当前版本 ${status.remotionVersion} 需要手动更新。`
          : `验证结果：Headless Shell 缓存与当前 Remotion ${status.remotionVersion} 不匹配，需要手动更新。`,
      };
    case "error":
      return {
        state: "error",
        message: "验证失败：无法确认 Headless Shell 可执行文件或缓存，可以重新验证或重试下载。",
      };
  }
}

function getCaughtMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function useRemotionRuntimeSettings() {
  const renderer = useAppSettingsStore((state) => state.renderingSettings.renderer);
  const setRenderingSettings = useAppSettingsStore((state) => state.setRenderingSettings);
  const [status, setStatus] = useState<RemotionBrowserStatus>();
  const [progress, setProgress] = useState<RemotionBrowserDownloadProgress>();
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string>();
  const [verificationState, setVerificationState] = useState<RemotionRuntimeVerificationState>("checking");
  const [verificationMessage, setVerificationMessage] = useState("正在验证 Headless Shell 可执行文件和缓存...");
  const operationRef = useRef<RuntimeOperation | undefined>(undefined);
  const mountedRef = useRef(true);
  const runtimeAvailable = typeof window !== "undefined" && Boolean(window.remotionRuntime);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyStatus = useCallback((next: RemotionBrowserStatus) => {
    if (!mountedRef.current) return;
    setStatus(next);
    const details = getVerificationDetails(next);
    setVerificationState(details.state);
    setVerificationMessage(details.message);
    setError(next.state === "error" ? next.message ?? "Headless Shell 状态检查失败" : undefined);
  }, []);

  const probeStatus = useCallback(async (operation: "status" | "verify") => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (!bridge || operationRef.current) return undefined;
    operationRef.current = operation;
    if (operation === "verify") {
      setIsVerifying(true);
    } else {
      setIsCheckingStatus(true);
    }
    try {
      setError(undefined);
      const next = await bridge.status();
      applyStatus(next);
      return next;
    } catch (caught) {
      if (mountedRef.current) {
        const message = getCaughtMessage(caught);
        setStatus(undefined);
        setVerificationState("error");
        setVerificationMessage("状态检查失败：无法确认 Headless Shell 可执行文件或缓存，可以重新验证或重试下载。");
        setError(message);
      }
      return undefined;
    } finally {
      operationRef.current = undefined;
      if (mountedRef.current) {
        if (operation === "verify") {
          setIsVerifying(false);
        } else {
          setIsCheckingStatus(false);
        }
      }
    }
  }, [applyStatus]);

  const refreshStatus = useCallback(async () => {
    await probeStatus("status");
  }, [probeStatus]);

  const verifyBrowser = useCallback(async () => {
    await probeStatus("verify");
  }, [probeStatus]);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (!bridge) return undefined;
    const unsubscribe = bridge.onDownloadProgress((next) => {
      if (!mountedRef.current) return;
      setProgress(next);
      if (next.phase === "failed") {
        const message = next.message ?? "Headless Shell 下载失败";
        setVerificationState("error");
        setVerificationMessage("下载未完成：Headless Shell 没有安装成功，可以重试下载或重新验证。");
        setError(message);
      }
      if (next.phase === "completed") {
        setError(undefined);
        const completedStatus = {
          state: "ready",
          remotionVersion: next.remotionVersion,
          preparedForRemotionVersion: next.remotionVersion,
        } satisfies RemotionBrowserStatus;
        setStatus(completedStatus);
        setVerificationState("ready");
        setVerificationMessage(`安装完成：Headless Shell 已准备好用于 Remotion ${next.remotionVersion}。`);
      }
    });
    void refreshStatus();
    return unsubscribe;
  }, [refreshStatus]);

  const selectRenderer = useCallback((next: TimelineRendererId) => {
    setRenderingSettings({ renderer: next });
  }, [setRenderingSettings]);

  const downloadBrowser = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
    if (
      !bridge
      || operationRef.current
      || isLoading
      || verificationState === "ready"
      || (verificationState === "checking" && !error)
    ) return;
    operationRef.current = "download";
    setIsLoading(true);
    setError(undefined);
    setVerificationMessage("正在下载官方 Headless Shell，请稍候...");
    setProgress({ phase: "starting", ratio: 0, remotionVersion: status?.remotionVersion ?? "4.0.499" });
    try {
      const next = await bridge.download();
      applyStatus(next);
    } catch (caught) {
      if (mountedRef.current) {
        const message = getCaughtMessage(caught);
        setVerificationState("error");
        setVerificationMessage("下载未完成：Headless Shell 没有安装成功，可以重试下载或重新验证。");
        setError(message);
      }
    } finally {
      operationRef.current = undefined;
      if (mountedRef.current) setIsLoading(false);
    }
  }, [applyStatus, error, isLoading, status?.remotionVersion, verificationState]);

  const canDownload = verificationState === "needs-download" || verificationState === "error";
  const isBusy = isLoading || isCheckingStatus || isVerifying;

  return {
    renderer,
    status,
    progress,
    error,
    isLoading,
    isCheckingStatus,
    isVerifying,
    isBusy,
    runtimeAvailable,
    canDownload,
    verificationState,
    verificationMessage,
    selectRenderer,
    refreshStatus,
    verifyBrowser,
    downloadBrowser,
  };
}
