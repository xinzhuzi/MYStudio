import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadDepthModel,
  getDepthRuntimeStatus,
  setDepthCinematicMode as bridgeSetCinematicMode,
  setDepthCinematicPreset as bridgeSetCinematicPreset,
  setupDepthRuntime,
} from "@/lib/depth/client";
import { getDepthRuntimeBridge } from "@/lib/bridge/depth-runtime";
import type { DepthRuntimeStatus } from "@/types/depth";

const ACTIVE_SETUP_STAGES = new Set(["checking", "preparing-profile"]);
const POLL_INTERVAL_MS = 500;

/** Camera preset options surfaced in the settings dropdown (labels are Chinese). */
export const DEPTH_CINEMATIC_PRESET_AUTO = "cinematic-auto" as const;
export const DEPTH_CINEMATIC_PRESET_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: DEPTH_CINEMATIC_PRESET_AUTO, label: "AI 自动（根据剧本智能选择）" },
  // 推拉 (dolly)
  { value: "cinematic-dolly-in", label: "推近（Dolly In）" },
  { value: "cinematic-dolly-out", label: "拉远（Dolly Out）" },
  { value: "cinematic-slow-push", label: "缓慢逼近（Slow Push）" },
  { value: "cinematic-fly-through", label: "深度穿越（Fly Through）" },
  { value: "cinematic-pull-back-reveal", label: "大幅后拉揭示（Pull Back Reveal）" },
  // 摇 (pan/tilt)
  { value: "cinematic-pan-left", label: "左摇（Pan Left）" },
  { value: "cinematic-pan-right", label: "右摇（Pan Right）" },
  { value: "cinematic-whip-pan", label: "甩镜（Whip Pan）" },
  { value: "cinematic-reveal-tilt-up", label: "仰角揭示（Tilt Up）" },
  { value: "cinematic-tilt-down", label: "俯摇揭示（Tilt Down）" },
  // 移/跟 (tracking/pedestal)
  { value: "cinematic-tracking-left", label: "左跟拍（Tracking Left）" },
  { value: "cinematic-tracking-right", label: "右跟拍（Tracking Right）" },
  { value: "cinematic-parallax-lr", label: "左右视差（Parallax LR）" },
  { value: "cinematic-parallax-ud", label: "上下视差（Parallax UD）" },
  { value: "cinematic-arc-left", label: "左弧线（Arc Left）" },
  { value: "cinematic-arc-right", label: "右弧线（Arc Right）" },
  { value: "cinematic-pedestal-up", label: "上升平移（Pedestal Up）" },
  { value: "cinematic-pedestal-down", label: "下降平移（Pedestal Down）" },
  // 升降 (crane/jib)
  { value: "cinematic-crane-up", label: "升降上升（Crane Up）" },
  { value: "cinematic-crane-down", label: "下降揭示（Crane Down）" },
  { value: "cinematic-spiral", label: "螺旋上升（Spiral）" },
  { value: "cinematic-rise-and-pull", label: "升起后拉（Rise & Pull）" },
  { value: "cinematic-descend-and-push", label: "下降推进（Descend & Push）" },
  { value: "cinematic-orbit", label: "环绕（Orbit）" },
  // 变焦 (zoom)
  { value: "cinematic-zoom-in", label: "光学推近（Zoom In）" },
  { value: "cinematic-zoom-out", label: "光学拉远（Zoom Out）" },
  { value: "cinematic-crash-zoom", label: "急推（Crash Zoom）" },
  { value: "cinematic-vertigo", label: "眩晕变焦（Dolly Zoom）" },
  // 情绪/特效
  { value: "cinematic-ken-burns-3d", label: "3D Ken Burns" },
  { value: "cinematic-drift", label: "梦幻漂移（Drift）" },
  { value: "cinematic-breathing", label: "呼吸推拉（Breathing）" },
  { value: "cinematic-handheld", label: "手持质感（Handheld）" },
  { value: "cinematic-fall", label: "坠落（Fall）" },
  { value: "cinematic-impact", label: "冲击震动（Impact）" },
  { value: "cinematic-dutch-roll", label: "缓慢旋转（Dutch Roll）" },
];

/**
 * Settings hook for the depth estimation runtime — mirrors the polling
 * lifecycle of usePythonRuntimeSettings: setup() is long-running, and the
 * renderer polls status() every 500 ms until it settles.
 */
export function useDepthRuntimeSettings() {
  const [status, setStatus] = useState<DepthRuntimeStatus | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollRef = useRef<number | null>(null);
  const hasRuntime = Boolean(getDepthRuntimeBridge());

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    if (!hasRuntime) return;
    let cancelled = false;

    // While a download is active, poll status so the progress bar animates.
    const startDownloadPolling = () => {
      stopPolling();
      pollRef.current = window.setInterval(() => {
        getDepthRuntimeStatus()
          .then((next) => {
            if (cancelled) return;
            setStatus(next);
            if (next.downloadStatus !== "downloading") {
              stopPolling();
              setIsDownloading(false);
              if (next.downloadStatus === "error") {
                toast.error(next.downloadError || "深度模型下载失败");
              } else if (next.downloadStatus === "complete") {
                toast.success("深度估计模型下载完成");
              }
            }
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    };

    getDepthRuntimeStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.downloadStatus === "downloading") {
          setIsDownloading(true);
          startDownloadPolling();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [hasRuntime, stopPolling]);

  const setupRuntime = useCallback(async () => {
    if (!hasRuntime) return;
    setIsSettingUp(true);
    stopPolling();
    const poll = window.setInterval(() => {
      getDepthRuntimeStatus()
        .then((next) => setStatus(next))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    pollRef.current = poll;
    try {
      const final = await setupDepthRuntime();
      setStatus(final);
      if (final.setupStage === "failed") {
        toast.error(final.setupMessage || "深度估计运行时配置失败");
      } else {
        toast.success("深度估计运行时配置完成");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "深度估计运行时配置失败");
    } finally {
      stopPolling();
      setIsSettingUp(false);
    }
  }, [hasRuntime, stopPolling]);

  const startDownload = useCallback(async () => {
    if (!hasRuntime) return;
    try {
      const result = await downloadDepthModel();
      if (!result.accepted) {
        toast.error(result.message);
        return;
      }
      setIsDownloading(true);
      stopPolling();
      pollRef.current = window.setInterval(() => {
        getDepthRuntimeStatus()
          .then((next) => {
            setStatus(next);
            if (next.downloadStatus !== "downloading") {
              stopPolling();
              setIsDownloading(false);
              if (next.downloadStatus === "error") {
                toast.error(next.downloadError || "深度模型下载失败");
              } else if (next.downloadStatus === "complete") {
                toast.success("深度估计模型下载完成");
              }
            }
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "深度模型下载启动失败");
    }
  }, [hasRuntime, stopPolling]);

  const selectPreset = useCallback(async (preset: string) => {
    if (!hasRuntime) return;
    try {
      if (preset === DEPTH_CINEMATIC_PRESET_AUTO) {
        const modeResult = await bridgeSetCinematicMode("auto");
        if (!modeResult.accepted) {
          toast.error(modeResult.message);
          return;
        }
        setStatus((previous) => (previous ? { ...previous, cinematicPresetMode: "auto" } : previous));
        toast.success("已切换为 AI 自动镜头语言（渲染入队时按剧本分析）");
        return;
      }
      const result = await bridgeSetCinematicPreset(preset);
      if (!result.accepted) {
        toast.error(result.message);
        return;
      }
      setStatus((previous) => (previous
        ? { ...previous, cinematicPreset: preset, cinematicPresetMode: "manual" }
        : previous));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "相机预设更新失败");
    }
  }, [hasRuntime]);

  const changeModelCacheDir = useCallback(async (dirPath: string) => {
    const bridge = getDepthRuntimeBridge();
    if (!bridge) return;
    const result = await bridge.setModelCacheDir(dirPath);
    if (!result.success) {
      toast.error(result.error || "深度模型缓存路径切换失败");
      return;
    }
    const next = await getDepthRuntimeStatus().catch(() => null);
    if (next) setStatus(next);
    toast.success("深度模型缓存路径已切换");
  }, []);

  const removeModel = useCallback(async () => {
    const bridge = getDepthRuntimeBridge();
    if (!bridge) return;
    const result = await bridge.deleteModel();
    if (!result.success) {
      toast.error(result.error || "深度模型删除失败");
      return;
    }
    const next = await getDepthRuntimeStatus().catch(() => null);
    if (next) setStatus(next);
    toast.success("深度估计模型已删除");
  }, []);

  const isSetupActive = status
    ? ACTIVE_SETUP_STAGES.has(status.setupStage)
    : false;

  return {
    hasRuntime,
    status,
    isSettingUp,
    isSetupActive,
    isDownloading,
    setupRuntime,
    startDownload,
    selectPreset,
    changeModelCacheDir,
    removeModel,
  };
}
