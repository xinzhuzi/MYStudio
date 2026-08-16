import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadUpscaleModel,
  getUpscaleRuntimeStatus,
  prepareUpscaleRuntimeLifecycle,
  probeUpscaleRuntimeLifecycle,
  rollbackUpscaleRuntimeLifecycle,
  scanUpscaleModelInventory,
  setupUpscaleRuntime,
} from "@/lib/upscale/client";
import { getUpscaleRuntimeBridge } from "@/lib/bridge/upscale-runtime";
import type { UpscaleModelRow, UpscaleRuntimeStatus } from "@/types/upscale";
import type { UpscaleRuntimeActionReplyV1, UpscaleRuntimeStatusV1 } from "@rendering/contracts/upscale-workflow";

const ACTIVE_SETUP_STAGES = new Set(["checking", "preparing-profile"]);
const POLL_INTERVAL_MS = 500;

/**
 * Settings hook for the image super-resolution runtime — mirrors the polling
 * lifecycle of useDepthRuntimeSettings, extended with a multi-model
 * inventory (5 Real-ESRGAN variants, one active).
 */
export function useUpscaleRuntimeSettings() {
  const [status, setStatus] = useState<UpscaleRuntimeStatus | null>(null);
  const [models, setModels] = useState<UpscaleModelRow[]>([]);
  const [lifecycleStatus, setLifecycleStatus] = useState<UpscaleRuntimeStatusV1 | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getUpscaleRuntimeBridge();
  const hasRuntime = Boolean(bridge);
  const hasLifecycleBridge = Boolean(
    bridge
      && typeof bridge.probe === "function"
      && typeof bridge.prepare === "function"
      && typeof bridge.rollback === "function",
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const probeRuntime = useCallback(async () => {
    if (!hasLifecycleBridge) return undefined;
    setIsProbing(true);
    setLifecycleError(undefined);
    try {
      const next = await probeUpscaleRuntimeLifecycle();
      setLifecycleStatus(next);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片超分运行时探测失败";
      setLifecycleError(message);
      toast.error(message);
      return undefined;
    } finally {
      setIsProbing(false);
    }
  }, [hasLifecycleBridge]);

  const applyLifecycleReply = useCallback((reply: UpscaleRuntimeActionReplyV1, successMessage: string) => {
    setLifecycleStatus(reply.status);
    if (reply.success) {
      setLifecycleError(undefined);
      toast.success(successMessage);
      return;
    }
    const message = reply.message || "图片超分运行时操作未完成";
    setLifecycleError(message);
    toast.error(message);
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      setModels(await scanUpscaleModelInventory());
    } catch {
      setModels([]);
    }
  }, []);

  const refreshLegacyStatus = useCallback(async () => {
    const currentBridge = getUpscaleRuntimeBridge();
    if (!currentBridge || typeof currentBridge.status !== "function") return undefined;
    const next = await getUpscaleRuntimeStatus().catch(() => undefined);
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!hasRuntime) return;
    let cancelled = false;

    if (hasLifecycleBridge) void probeRuntime();
    if (typeof bridge?.status !== "function") {
      return () => {
        cancelled = true;
        stopPolling();
      };
    }

    // While a download is active, poll status so the progress bar animates.
    const startDownloadPolling = () => {
      stopPolling();
      pollRef.current = window.setInterval(() => {
        getUpscaleRuntimeStatus()
          .then((next) => {
            if (cancelled) return;
            setStatus(next);
            if (next.downloadStatus !== "downloading") {
              stopPolling();
              setIsDownloading(false);
              if (next.downloadStatus === "error") {
                toast.error(next.downloadError || "超分模型下载失败");
              } else if (next.downloadStatus === "complete") {
                toast.success("超分模型下载完成");
              }
              void refreshModels();
            }
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    };

    getUpscaleRuntimeStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.downloadStatus === "downloading") {
          setIsDownloading(true);
          startDownloadPolling();
        }
      })
      .catch(() => undefined);
    void refreshModels();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bridge, hasLifecycleBridge, hasRuntime, probeRuntime, refreshModels, stopPolling]);

  const setupRuntime = useCallback(async () => {
    if (!hasRuntime) return;
    setIsSettingUp(true);
    setLifecycleError(undefined);
    stopPolling();
    if (hasLifecycleBridge) {
      try {
        const reply = await prepareUpscaleRuntimeLifecycle();
        applyLifecycleReply(reply, "图片超分运行时准备完成");
        await refreshLegacyStatus();
        await refreshModels();
        return reply;
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片超分运行时准备失败";
        setLifecycleError(message);
        toast.error(message);
        return undefined;
      } finally {
        setIsSettingUp(false);
      }
    }
    try {
      const final = await setupUpscaleRuntime();
      setStatus(final);
      if (final.setupStage === "failed") {
        toast.error(final.setupMessage || "图片超分运行时配置失败");
      } else {
        toast.success("图片超分运行时配置完成");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片超分运行时配置失败";
      setLifecycleError(message);
      toast.error(message);
    } finally {
      setIsSettingUp(false);
    }
    return undefined;
  }, [applyLifecycleReply, hasLifecycleBridge, hasRuntime, refreshLegacyStatus, refreshModels, stopPolling]);

  const rollbackRuntime = useCallback(async () => {
    if (!hasLifecycleBridge) {
      toast.error("当前环境不支持图片超分运行时回滚");
      return undefined;
    }
    setIsRollingBack(true);
    setLifecycleError(undefined);
    stopPolling();
    try {
      const reply = await rollbackUpscaleRuntimeLifecycle();
      applyLifecycleReply(reply, "图片超分运行时回滚完成");
      await refreshLegacyStatus();
      return reply;
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片超分运行时回滚失败";
      setLifecycleError(message);
      toast.error(message);
      return undefined;
    } finally {
      setIsRollingBack(false);
    }
  }, [applyLifecycleReply, hasLifecycleBridge, refreshLegacyStatus, stopPolling]);

  const startDownload = useCallback(async (modelName: string) => {
    if (!hasRuntime) return;
    try {
      const result = await downloadUpscaleModel(modelName);
      if (!result.accepted) {
        toast.error(result.message);
        return;
      }
      setIsDownloading(true);
      stopPolling();
      pollRef.current = window.setInterval(() => {
        getUpscaleRuntimeStatus()
          .then((next) => {
            setStatus(next);
            if (next.downloadStatus !== "downloading") {
              stopPolling();
              setIsDownloading(false);
              if (next.downloadStatus === "error") {
                toast.error(next.downloadError || "超分模型下载失败");
              } else if (next.downloadStatus === "complete") {
                toast.success("超分模型下载完成");
              }
              void refreshModels();
            }
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "超分模型下载启动失败");
    }
  }, [hasRuntime, refreshModels, stopPolling]);

  const setActive = useCallback(async (modelName: string) => {
    const currentBridge = getUpscaleRuntimeBridge();
    if (!currentBridge) return;
    const result = await currentBridge.setActiveModel(modelName);
    if (!result.success) {
      toast.error(result.error || "默认超分模型设置失败");
      return;
    }
    await refreshLegacyStatus();
    toast.success("默认超分模型已更新");
  }, [refreshLegacyStatus]);

  const changeModelCacheDir = useCallback(async (dirPath: string) => {
    const currentBridge = getUpscaleRuntimeBridge();
    if (!currentBridge) return;
    const result = await currentBridge.setModelCacheDir(dirPath);
    if (!result.success) {
      toast.error(result.error || "超分模型缓存路径切换失败");
      return;
    }
    const next = await getUpscaleRuntimeStatus().catch(() => null);
    if (next) setStatus(next);
    await refreshModels();
    toast.success("超分模型缓存路径已切换");
  }, [refreshModels]);

  const removeModel = useCallback(async (modelName: string) => {
    const currentBridge = getUpscaleRuntimeBridge();
    if (!currentBridge) return;
    const result = await currentBridge.deleteModel(modelName);
    if (!result.success) {
      toast.error(result.error || "超分模型删除失败");
      return;
    }
    const next = await getUpscaleRuntimeStatus().catch(() => null);
    if (next) setStatus(next);
    await refreshModels();
    toast.success("超分模型已删除");
  }, [refreshModels]);

  const isSetupActive = status
    ? ACTIVE_SETUP_STAGES.has(status.setupStage)
    : false;

  return {
    hasRuntime,
    hasLifecycleBridge,
    status,
    models,
    lifecycleStatus,
    lifecycleError,
    isProbing,
    isSettingUp,
    isRollingBack,
    isSetupActive,
    isDownloading,
    probeRuntime,
    setupRuntime,
    rollbackRuntime,
    startDownload,
    setActive,
    changeModelCacheDir,
    removeModel,
  };
}
