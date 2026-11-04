"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVideoQcRuntimeBridge,
  type VideoQcModelRowPayload,
  type VideoQcRuntimeStatusPayload,
} from "@/lib/bridge/video-qc-runtime";

const POLL_INTERVAL_MS = 500;

/**
 * 视频评分模型(video_qc)运行时 hook — 镜像 useUpscaleRuntimeSettings 的
 * 轮询/动作形状。下载中每 500ms 轮询状态,完成/出错停轮询并 toast。
 *
 * `models` 是 Python 侧 `VIDEO_QC_MODELS` 的真源快照(DOVER + 1102 起的人脸 YuNet),
 * 每模型独立显示「已下载」——共享下载槽位只表示「此刻在传哪个」,不代表所有模型的态。
 */
export function useVideoQcRuntimeSettings() {
  const bridge = getVideoQcRuntimeBridge();
  const [status, setStatus] = useState<VideoQcRuntimeStatusPayload | null>(null);
  const [models, setModels] = useState<VideoQcModelRowPayload[]>([]);
  const [isProbing, setIsProbing] = useState(bridge !== undefined);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const scanModels = useCallback(async () => {
    if (!bridge) return;
    try {
      const inventory = await bridge.scanModel();
      setModels(inventory.models);
    } catch {
      // 清单读不到保持上一帧,不掩盖运行时状态
    }
  }, [bridge]);

  const refreshStatus = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.status();
      setStatus(next);
      if (next.downloadStatus !== "downloading") {
        setIsDownloading(false);
        stopPolling();
        await scanModels();
      }
    } catch {
      // 轮询失败保持上一帧状态
    }
  }, [bridge, scanModels, stopPolling]);

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
    void scanModels();
    return stopPolling;
  }, [bridge, scanModels, stopPolling]);

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
    await scanModels();
    return next;
  }, [bridge, scanModels]);

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
    models,
    isProbing,
    isDownloading,
    setup,
    refresh,
    downloadModel,
    scanModels,
    setModelCacheDir,
    deleteModel,
  };
}
