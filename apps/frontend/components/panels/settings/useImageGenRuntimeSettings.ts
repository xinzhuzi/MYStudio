import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageGenModelRow, ImageGenRuntimeStatus } from "@/types/image-gen";

interface ImageGenBridge {
  status: () => Promise<ImageGenRuntimeStatus>;
  setup: () => Promise<ImageGenRuntimeStatus>;
  stop: () => Promise<ImageGenRuntimeStatus>;
  scanModel: () => Promise<{ models: ImageGenModelRow[] }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  setActiveModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
}

function getImageGenBridge(): ImageGenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { imageGenRuntime?: ImageGenBridge }).imageGenRuntime
    : undefined;
}

const POLL_INTERVAL_MS = 800;

/** Settings hook for the local image generation sidecar (设置 → 本地配置 → 本地图片生成). */
export function useImageGenRuntimeSettings() {
  const [status, setStatus] = useState<ImageGenRuntimeStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getImageGenBridge();
  const hasRuntime = Boolean(bridge);

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      bridge?.status()
        .then((next) => {
          setStatus(next);
          const downloading = Object.values(next.downloadStatus).some((s) => s === "downloading");
          if (!downloading) stopPolling();
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
  }, [bridge, stopPolling]);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.status()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (Object.values(next.downloadStatus).some((s) => s === "downloading")) {
          startPolling();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bridge, startPolling, stopPolling]);

  const setupRuntime = useCallback(async () => {
    if (!bridge) return;
    setIsSettingUp(true);
    try {
      const final = await bridge.setup();
      setStatus(final);
      if (final.setupStage === "failed") {
        toast.error(final.setupMessage || "本地图片服务启动失败");
      } else {
        toast.success("本地图片生成服务已就绪");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "本地图片服务启动失败");
    } finally {
      setIsSettingUp(false);
    }
  }, [bridge]);

  const startDownload = useCallback(async (modelName: string) => {
    if (!bridge) return;
    const result = await bridge.downloadModel(modelName);
    if (!result.accepted) {
      toast.error(result.message);
      return;
    }
    toast.info(`模型 ${modelName} 开始下载`);
    startPolling();
  }, [bridge, startPolling]);

  const selectModel = useCallback(async (modelName: string) => {
    if (!bridge) return;
    const result = await bridge.setActiveModel(modelName);
    if (result.accepted) {
      setStatus((previous) => (previous ? { ...previous, activeModel: modelName } : previous));
      toast.success(`已切换生图模型: ${modelName}`);
    } else {
      toast.error(result.message);
    }
  }, [bridge]);

  return { hasRuntime, status, isSettingUp, setupRuntime, startDownload, selectModel };
}
