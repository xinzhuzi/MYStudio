import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AudioGenModelRow, AudioGenRuntimeStatus } from "@/types/audio-gen";

interface AudioGenBridge {
  status: () => Promise<AudioGenRuntimeStatus>;
  setup: () => Promise<AudioGenRuntimeStatus>;
  scanModel: () => Promise<{ models: AudioGenModelRow[] }>;
  downloadModel: () => Promise<{ accepted: boolean; message: string }>;
  generate: (payload: { prompt: string; seconds?: number; outputDir: string }) => Promise<{ status: string; outputPath?: string; code?: string; message?: string }>;
}

function getAudioGenBridge(): AudioGenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { audioGenRuntime?: AudioGenBridge }).audioGenRuntime
    : undefined;
}

/** Settings hook for the local music generation sidecar (设置 → 本地配置 → 本地音乐生成). */
export function useAudioGenRuntimeSettings() {
  const [status, setStatus] = useState<AudioGenRuntimeStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getAudioGenBridge();
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
        }, 800);
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
        toast.error(final.setupMessage || "本地音乐生成运行时检查失败");
      } else {
        toast.success("本地音乐生成运行时已就绪");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "本地音乐生成运行时检查失败");
    } finally {
      setIsSettingUp(false);
    }
  }, [bridge]);

  const startDownload = useCallback(async () => {
    if (!bridge) return;
    const result = await bridge.downloadModel();
    if (!result.accepted) {
      toast.error(result.message);
      return;
    }
    toast.info("MusicGen 模型开始下载");
    stopPolling();
    pollRef.current = window.setInterval(() => {
      bridge.status()
        .then((polled) => {
          setStatus(polled);
          if (polled.downloadStatus !== "downloading") {
            stopPolling();
            if (polled.downloadStatus === "complete") toast.success("MusicGen 模型下载完成");
            if (polled.downloadStatus === "error") toast.error(polled.downloadError || "模型下载失败");
          }
        })
        .catch(() => undefined);
    }, 800);
  }, [bridge, stopPolling]);

  return { hasRuntime, status, isSettingUp, isGenerating, setIsGenerating, setupRuntime, startDownload, bridge };
}
