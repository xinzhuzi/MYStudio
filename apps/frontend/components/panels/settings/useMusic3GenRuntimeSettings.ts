import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Music3GenModelRow, Music3GenRuntimeStatus } from "@/types/music3-gen";

interface Music3GenBridge {
  status: () => Promise<Music3GenRuntimeStatus>;
  setup: () => Promise<Music3GenRuntimeStatus>;
  scanModel: () => Promise<{ models: Music3GenModelRow[] }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  generate: (payload: { prompt: string; seed?: number; seconds?: number; steps?: number; outputDir: string }) => Promise<{ status: string; outputPath?: string; code?: string; message?: string }>;
}

function getMusic3GenBridge(): Music3GenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { music3GenRuntime?: Music3GenBridge }).music3GenRuntime
    : undefined;
}

/** Settings hook for the MiniMax-Music3 engine (设置 → 本地配置 → 本地音乐生成·MiniMax 引擎). */
export function useMusic3GenRuntimeSettings() {
  const [status, setStatus] = useState<Music3GenRuntimeStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getMusic3GenBridge();
  const hasRuntime = Boolean(bridge);

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.status().then((next) => {
      if (cancelled) return;
      setStatus(next);
      if (next.downloadStatus === "downloading") {
        pollRef.current = window.setInterval(() => {
          bridge.status()
            .then((polled) => {
              setStatus(polled);
              if (polled.downloadStatus !== "downloading") stopPolling();
            })
            .catch(() => undefined);
        }, 1200);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bridge, stopPolling]);

  const setupRuntime = useCallback(async () => {
    if (!bridge) return;
    setIsSettingUp(true);
    try {
      const final = await bridge.setup();
      setStatus(final);
      if (final.setupStage === "failed") {
        toast.error(final.setupMessage || "MiniMax-Music3 运行时检查失败");
      } else {
        toast.success("MiniMax-Music3 运行时就绪");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "MiniMax-Music3 运行时检查失败");
    } finally {
      setIsSettingUp(false);
    }
  }, [bridge]);

  const startDownload = useCallback(async (model = "minimax-music3-mlx") => {
    if (!bridge) return;
    const result = await bridge.downloadModel(model);
    if (!result.accepted) {
      toast.error(result.message);
      return;
    }
    toast.info("MiniMax-Music3 开始下载(约 12 GB,自含运行时代码+权重)");
    stopPolling();
    pollRef.current = window.setInterval(() => {
      bridge.status()
        .then((polled) => {
          setStatus(polled);
          if (polled.downloadStatus !== "downloading") {
            stopPolling();
            if (polled.downloadStatus === "complete") toast.success("MiniMax-Music3 就绪");
            if (polled.downloadStatus === "error") toast.error(polled.downloadError || "模型下载失败");
          }
        })
        .catch(() => undefined);
    }, 1200);
  }, [bridge, stopPolling]);

  return { hasRuntime, status, isSettingUp, setupRuntime, startDownload, bridge };
}
