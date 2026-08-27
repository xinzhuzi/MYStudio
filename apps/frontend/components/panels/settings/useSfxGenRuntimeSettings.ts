import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SfxGenModelRow, SfxGenRuntimeStatus } from "@/types/sfx-gen";

interface SfxGenBridge {
  status: () => Promise<SfxGenRuntimeStatus>;
  setup: () => Promise<SfxGenRuntimeStatus>;
  scanModel: () => Promise<{ models: SfxGenModelRow[] }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  generate: (payload: { prompt: string; seed?: number; seconds?: number; model?: string; outputDir: string }) => Promise<{ status: string; outputPath?: string; code?: string; message?: string }>;
}

function getSfxGenBridge(): SfxGenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { sfxGenRuntime?: SfxGenBridge }).sfxGenRuntime
    : undefined;
}

/** Settings hook for the local sfx generation sidecar (设置 → 本地配置 → 本地音效生成). */
export function useSfxGenRuntimeSettings() {
  const [status, setStatus] = useState<SfxGenRuntimeStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getSfxGenBridge();
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
      // 挂载即静默体检:idle 时自动跑一次运行时检查(对齐深度/超分等区块的挂载
      // 自动探测),否则「未检查」会一直挂到用户手动点按钮(08-28 修)。
      if (next.setupStage === "idle") {
        bridge.setup()
          .then((final) => { if (!cancelled) setStatus(final); })
          .catch(() => undefined);
      }
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
        toast.error(final.setupMessage || "本地音效生成运行时检查失败");
      } else {
        toast.success("本地音效生成运行时已就绪");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "本地音效生成运行时检查失败");
    } finally {
      setIsSettingUp(false);
    }
  }, [bridge]);

  const startDownload = useCallback(async (model = "sfx-musicgen-small") => {
    if (!bridge) return;
    const result = await bridge.downloadModel(model);
    if (!result.accepted) {
      toast.error(result.message);
      return;
    }
    toast.info("音效模型开始下载(与本地音乐生成共用缓存,已下载则直接复用)");
    stopPolling();
    pollRef.current = window.setInterval(() => {
      bridge.status()
        .then((polled) => {
          setStatus(polled);
          if (polled.downloadStatus !== "downloading") {
            stopPolling();
            if (polled.downloadStatus === "complete") toast.success("音效模型就绪");
            if (polled.downloadStatus === "error") toast.error(polled.downloadError || "模型下载失败");
          }
        })
        .catch(() => undefined);
    }, 800);
  }, [bridge, stopPolling]);

  return { hasRuntime, status, isSettingUp, setupRuntime, startDownload, bridge };
}
