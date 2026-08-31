import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageGenModelRow, ImageGenRuntimeStatus } from "@/types/image-gen";
import type {
  ImageGenRuntimeActionReplyV1,
  ImageGenRuntimeStatusV1,
} from "@rendering/contracts/image-gen-workflow";

interface ImageGenBridge {
  probe?: () => Promise<ImageGenRuntimeStatusV1>;
  prepare?: () => Promise<ImageGenRuntimeActionReplyV1>;
  rollback?: () => Promise<ImageGenRuntimeActionReplyV1>;
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
  const [lifecycleStatus, setLifecycleStatus] = useState<ImageGenRuntimeStatusV1 | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const pollRef = useRef<number | null>(null);
  const bridge = getImageGenBridge();
  const hasRuntime = Boolean(bridge);
  const hasLifecycleBridge = Boolean(bridge?.probe && bridge?.prepare && bridge?.rollback);

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
    if (hasLifecycleBridge) {
      bridge.probe?.().then(async (next) => {
        if (cancelled) return;
        setLifecycleStatus(next);
        // 探测顺带把模型清单(含 ComfyUI 指向路径)扫进主进程缓存;本 effect 开头那次
        // status 快照先于扫描返回,这里必须补拉一次,否则首次进页模型行整块空白。
        try {
          const refreshed = await bridge?.status();
          if (!cancelled && refreshed) setStatus(refreshed);
        } catch {
          // 补拉失败不打扰探测结果,保持旧快照
        }
      }).catch((error) => {
        if (!cancelled) setLifecycleError(error instanceof Error ? error.message : "本地图片运行时探测失败");
      });
    }
    bridge.status()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (Object.values(next.downloadStatus).some((s) => s === "downloading")) startPolling();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [bridge, hasLifecycleBridge, startPolling, stopPolling]);

  const applyLifecycleReply = useCallback((reply: ImageGenRuntimeActionReplyV1, successMessage: string) => {
    setLifecycleStatus(reply.status);
    if (reply.success) {
      setLifecycleError(undefined);
      toast.success(successMessage);
      return;
    }
    const message = reply.message || "本地图片运行时操作未完成";
    setLifecycleError(message);
    toast.error(message);
  }, []);

  const setupRuntime = useCallback(async () => {
    if (!bridge) return;
    setIsSettingUp(true);
    setLifecycleError(undefined);
    try {
      if (hasLifecycleBridge && bridge.prepare) {
        const reply = await bridge.prepare();
        applyLifecycleReply(reply, "本地图像运行时准备完成");
        const next = await bridge.status();
        setStatus(next);
        return;
      }
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
  }, [applyLifecycleReply, bridge, hasLifecycleBridge]);

  const probeRuntime = useCallback(async () => {
    if (!bridge?.probe) return undefined;
    setIsProbing(true);
    setLifecycleError(undefined);
    try {
      const next = await bridge.probe();
      setLifecycleStatus(next);
      // 探测刷新了主进程里的模型清单缓存,同步补拉一次让界面立即反映(同挂载期竞态)
      try {
        setStatus(await bridge.status());
      } catch {
        // 保持旧快照
      }
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地图片运行时探测失败";
      setLifecycleError(message);
      toast.error(message);
      return undefined;
    } finally {
      setIsProbing(false);
    }
  }, [bridge]);

  const rollbackRuntime = useCallback(async () => {
    if (!bridge?.rollback) {
      toast.error("当前环境不支持本地图片运行时回滚");
      return undefined;
    }
    setIsRollingBack(true);
    setLifecycleError(undefined);
    try {
      const reply = await bridge.rollback();
      applyLifecycleReply(reply, "本地图像运行时回滚完成");
      return reply;
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地图片运行时回滚失败";
      setLifecycleError(message);
      toast.error(message);
      return undefined;
    } finally {
      setIsRollingBack(false);
    }
  }, [applyLifecycleReply, bridge]);

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

  return {
    hasRuntime,
    hasLifecycleBridge,
    status,
    lifecycleStatus,
    lifecycleError,
    isSettingUp,
    isProbing,
    isRollingBack,
    setupRuntime,
    probeRuntime,
    rollbackRuntime,
    startDownload,
    selectModel,
  };
}
