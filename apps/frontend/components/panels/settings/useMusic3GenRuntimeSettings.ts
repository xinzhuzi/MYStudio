import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Music3GenModelRow, Music3GenRuntimeStatus } from "@/types/music3-gen";

interface Music3GenBridge {
  status: () => Promise<Music3GenRuntimeStatus>;
  setup: () => Promise<Music3GenRuntimeStatus>;
  scanModel: () => Promise<{ models: Music3GenModelRow[] }>;
  downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
  configure: (payload: { weightsDir?: string; binaryPath?: string; port?: number; preferredEngine?: "pocket" | "mlxserv" }) => Promise<unknown>;
  installMlxServeBinary?: () => Promise<{ installed: boolean; path?: string; error?: string }>;
  installWeights?: () => Promise<{ accepted: boolean; message: string }>;
  generate: (payload: { prompt: string; seed?: number; seconds?: number; steps?: number; engine?: "pocket" | "mlxserv"; outputDir: string }) => Promise<{ status: string; outputPath?: string; code?: string; message?: string; engine?: string }>;
}

function getMusic3GenBridge(): Music3GenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { music3GenRuntime?: Music3GenBridge }).music3GenRuntime
    : undefined;
}

/** 权重获取进行中(下载/转换阶段都算)。 */
function isWeightsInstalling(status: Music3GenRuntimeStatus | null): boolean {
  const install = status?.mlxServWeightsInstall;
  return install?.status === "downloading" || install?.status === "converting";
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

  const beginPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      bridge?.status()
        .then((polled) => {
          setStatus(polled);
          if (polled.downloadStatus !== "downloading" && !isWeightsInstalling(polled)) {
            stopPolling();
            if (polled.downloadStatus === "complete") toast.success("MiniMax-Music3 就绪");
            if (polled.downloadStatus === "error") toast.error(polled.downloadError || "模型下载失败");
            const weights = polled.mlxServWeightsInstall;
            if (weights?.status === "complete") toast.success("bf16 权重已就绪(已自动指向)");
            if (weights?.status === "error") toast.error(weights.error || "bf16 权重获取失败");
          }
        })
        .catch(() => undefined);
    }, 1200);
  }, [bridge, stopPolling]);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.status().then((next) => {
      if (cancelled) return;
      setStatus(next);
      if (next.downloadStatus === "downloading" || isWeightsInstalling(next)) {
        beginPolling();
      }
      // 挂载即静默体检:idle 时自动跑一次运行时检查(对齐深度/超分等区块的挂载
      // 自动探测),否则「未检查」会一直挂到用户手动点按钮(08-28 修)。
      if (next.setupStage === "idle") {
        bridge.setup()
          .then((final) => { if (!cancelled) setStatus(final); })
          .catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bridge, stopPolling, beginPolling]);

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
    toast.info("MiniMax-Music3 开始下载(约 28.5 GB,bf16 权重+运行时转换)");
    beginPolling();
  }, [bridge, beginPolling]);

  /** bf16 权重获取(ModelScope 全量 → 本地转 MLX → 自动指向)。 */
  const startWeightsInstall = useCallback(async () => {
    if (!bridge?.installWeights) {
      toast.error("当前版本不支持权重获取,请升级应用");
      return;
    }
    const result = await bridge.installWeights();
    if (!result.accepted) {
      toast.error(result.message);
      return;
    }
    toast.info(result.message);
    beginPolling();
  }, [bridge, beginPolling]);

  const refreshStatus = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.status();
      setStatus(next);
      if (isWeightsInstalling(next)) beginPolling();
    } catch {
      // 状态刷新失败保持现状
    }
  }, [bridge, beginPolling]);

  return { hasRuntime, status, isSettingUp, setupRuntime, startDownload, startWeightsInstall, refreshStatus, bridge };
}
