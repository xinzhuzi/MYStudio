"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoQcRuntimeBridge, type VideoQcRuntimeStatusPayload } from "@/lib/bridge/video-qc-runtime";

const POLL_INTERVAL_MS = 500;

/**
 * 视频评分模型(video_qc)运行时 hook — 镜像 useUpscaleRuntimeSettings 的
 * 轮询/动作形状。下载中每 500ms 轮询状态,完成/出错停轮询并 toast。
 */
export function useVideoQcRuntimeSettings() {
  const bridge = getVideoQcRuntimeBridge();
  const [status, setStatus] = useState<VideoQcRuntimeStatusPayload | null>(null);
  const [isProbing, setIsProbing] = useState(bridge !== undefined);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.status();
      setStatus(next);
      if (next.downloadStatus !== "downloading") {
        setIsDownloading(false);
        stopPolling();
      }
    } catch {
      // 轮询失败保持上一帧状态
    }
  }, [bridge, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(() => {
      void refreshStatus();
    }, POLL_INTERVAL_MS);
  }, [refreshStatus]);

  useEffect(() => {
    if (!bridge) {
      setIsProbing(false);
      return;
    }
    void (async () => {
      try {
        setStatus(await bridge.probe());
      } finally {
        setIsProbing(false);
      }
    })();
    return stopPolling;
  }, [bridge, stopPolling]);

  const setup = useCallback(async (): Promise<VideoQcRuntimeStatusPayload | undefined> => {
    if (!bridge) return undefined;
    const next = await bridge.setup();
    setStatus(next);
    return next;
  }, [bridge]);

  const refresh = useCallback(async (): Promise<VideoQcRuntimeStatusPayload | undefined> => {
    if (!bridge) return undefined;
    const next = await bridge.refresh();
    setStatus(next);
    return next;
  }, [bridge]);

  const downloadModel = useCallback(async (model: string) => {
    if (!bridge) return;
    const result = await bridge.downloadModel(model);
    if (result.accepted) {
      setIsDownloading(true);
      startPolling();
    }
    return result;
  }, [bridge, startPolling]);

  const setModelCacheDir = useCallback(async (dirPath: string) => {
    if (!bridge) return { success: false, error: "桥不可用" };
    const result = await bridge.setModelCacheDir(dirPath);
    await refreshStatus();
    return result;
  }, [bridge, refreshStatus]);

  const deleteModel = useCallback(async (model: string) => {
    if (!bridge) return { success: false, error: "桥不可用" };
    const result = await bridge.deleteModel(model);
    await refreshStatus();
    return result;
  }, [bridge, refreshStatus]);

  return {
    hasBridge: bridge !== undefined,
    status,
    isProbing,
    isDownloading,
    setup,
    refresh,
    downloadModel,
    setModelCacheDir,
    deleteModel,
  };
}
