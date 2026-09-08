// ComfyUI 引擎设置 hook——照 useImageGenRuntimeSettings/usePythonRuntimeSettings 模式:
// 挂载期一次性探测(严禁常驻轮询),只有任务(install/update/reset/插件装卸)进行中
// 才按间隔拉 job 进度,任务终结即停。client 可注入(测试/后端未就绪时用 mock),
// 默认走 window.comfyEngine 桥(集成接线点)。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { logEvent } from "@/lib/diagnostics/logger";
import {
  getComfyEngineClient,
  type ComfyCatalogEntry,
  type ComfyDoctorReport,
  type ComfyEngineClient,
  type ComfyEngineJob,
  type ComfyEngineStatus,
  type ComfyEngineUpdateCheckReply,
  type ComfyEngineUpdateReport,
  type ComfyPluginInstallReport,
  type ComfyPluginInfo,
  type ComfyPluginUsageReply,
  ComfySnapshotEntry,
} from "./comfy-engine-contract";

const JOB_POLL_INTERVAL_MS = 800;

export interface UseComfyEngineSettingsOptions {
  /** 覆盖数据通道(注入 mock client);不传用 window.comfyEngine。 */
  client?: ComfyEngineClient;
  /** 任务轮询间隔(测试调小);默认 800ms。 */
  pollIntervalMs?: number;
}

export function useComfyEngineSettings(options: UseComfyEngineSettingsOptions = {}) {
  const client = options.client ?? getComfyEngineClient();
  const pollIntervalMs = options.pollIntervalMs ?? JOB_POLL_INTERVAL_MS;
  const hasBridge = Boolean(client);

  const [status, setStatus] = useState<ComfyEngineStatus | null>(null);
  const [activeJob, setActiveJob] = useState<ComfyEngineJob | null>(null);
  const [updateCheck, setUpdateCheck] = useState<ComfyEngineUpdateCheckReply | null>(null);
  const [updateReport, setUpdateReport] = useState<ComfyEngineUpdateReport | null>(null);
  const [pluginInstallReport, setPluginInstallReport] = useState<ComfyPluginInstallReport | null>(null);
  const [plugins, setPlugins] = useState<ComfyPluginInfo[]>([]);
  const [catalog, setCatalog] = useState<ComfyCatalogEntry[]>([]);
  const [doctorReport, setDoctorReport] = useState<ComfyDoctorReport | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isSavingModelsDir, setIsSavingModelsDir] = useState(false);
  const [isRunningDoctor, setIsRunningDoctor] = useState(false);
  const [isStartingService, setIsStartingService] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!client) return;
    try {
      setStatus(await client.getEngineStatus());
    } catch {
      // 探测失败保持旧快照;行胶囊停留在「检查中」由上层判定
    }
  }, [client]);

  const refreshPlugins = useCallback(async () => {
    if (!client) return;
    try {
      setPlugins(await client.listPlugins());
    } catch {
      // 插件清单拉不到不阻塞引擎状态展示
    }
  }, [client]);

  // 挂载/桥就绪:一次性探测引擎状态 + 插件清单(不轮询)。
  useEffect(() => {
    // 09-08 修正:引擎卡自给自足——挂载即拉起本地生图服务(prepare 幂等,已
    // 在跑则秒回),否则 sidecar 没起时状态恒为空,卡会停在「检查中」。
    try {
      void window.imageGenRuntime?.prepare?.();
    } catch {
      // 拉不起(旧构建无桥)不阻塞,探测照常走
    }
    if (!client) return;
    let cancelled = false;
    void (async () => {
      await refreshStatus();
      if (cancelled) return;
      await refreshPlugins();
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [client, refreshStatus, refreshPlugins, stopPolling]);

  /** 任务收尾:按类型刷新 + 报告/错误分流 + 诊断日志(保留终态 job 供 UI 展示错误)。 */
  const settleJob = useCallback(
    (job: ComfyEngineJob) => {
      void logEvent({
        category: "runtime",
        level: job.state === "failed" ? "error" : "info",
        message: `comfy-engine job ${job.kind} ${job.state}`,
        context: { jobId: job.jobId, stage: job.stage, message: job.message },
      });
      setActiveJob(job);
      if (job.kind === "update" && job.state === "succeeded" && job.report?.kind === "update") {
        setUpdateReport(job.report);
        toast.success(`引擎已更新到 ${job.report.newVersion}`);
      } else if (job.state === "succeeded") {
        if (job.report?.kind === "plugin-install") {
          setPluginInstallReport(job.report);
          toast.success(`插件安装成功,新增 ${job.report.addedNodeCount} 个节点`);
        } else if (job.kind === "plugin-update") {
          toast.success("插件更新完成");
        } else if (job.kind === "reset") {
          toast.success("运行环境已重建");
        } else if (job.kind === "install") {
          toast.success("ComfyUI 引擎安装完成");
        }
      } else if (job.state === "failed") {
        toast.error(job.message || "操作失败,请查看日志后重试");
      }
      if (job.kind.startsWith("plugin")) {
        void refreshPlugins();
      }
      void refreshStatus();
    },
    [refreshPlugins, refreshStatus],
  );

  /** 启动任务并轮询到终结(轮询=既有下载进度通道模式,任务结束即停)。 */
  const runJob = useCallback(
    async (start: (client: ComfyEngineClient) => Promise<{ jobId: string }>) => {
      if (!client) {
        toast.error("ComfyUI 引擎配置仅在桌面应用中可用");
        return;
      }
      stopPolling();
      try {
        const { jobId } = await start(client);
        const first = await client.getJob(jobId);
        setActiveJob(first);
        if (first.state !== "running") {
          settleJob(first);
          return;
        }
        pollRef.current = window.setInterval(() => {
          void client
            .getJob(jobId)
            .then((job) => {
              setActiveJob(job);
              if (job.state !== "running") {
                stopPolling();
                settleJob(job);
              }
            })
            .catch(() => undefined);
        }, pollIntervalMs);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "任务启动失败");
        void refreshStatus();
      }
    },
    [client, pollIntervalMs, refreshStatus, settleJob, stopPolling],
  );

  const installEngine = useCallback(() => {
    setUpdateReport(null);
    return runJob((bridge) => bridge.installEngine());
  }, [runJob]);

  const updateEngine = useCallback(() => {
    setUpdateReport(null);
    return runJob((bridge) => bridge.updateEngine());
  }, [runJob]);

  const resetEngine = useCallback(() => {
    return runJob((bridge) => bridge.resetEngine());
  }, [runJob]);

  const installPlugin = useCallback(
    (source: "curated" | "registry" | "git" | "local", ref: string) => {
      setPluginInstallReport(null);
      return runJob((bridge) => bridge.installPlugin(source, ref));
    },
    [runJob],
  );

  const updatePlugin = useCallback(
    (id: string) => runJob((bridge) => bridge.updatePlugin(id)),
    [runJob],
  );

  const uninstallPlugin = useCallback(
    async (id: string) => {
      if (!client) return false;
      try {
        const reply = await client.uninstallPlugin(id);
        if (!reply.accepted) {
          toast.error(reply.message || "插件卸载失败");
          return false;
        }
        toast.success("插件已卸载");
        await refreshPlugins();
        await refreshStatus();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "插件卸载失败");
        return false;
      }
    },
    [client, refreshPlugins, refreshStatus],
  );

  const getPluginUsage = useCallback(
    async (id: string): Promise<ComfyPluginUsageReply | null> => {
      if (!client) return null;
      try {
        return await client.getPluginUsage(id);
      } catch {
        return null;
      }
    },
    [client],
  );

  const checkUpdate = useCallback(async () => {
    if (!client) return;
    setIsCheckingUpdate(true);
    try {
      const reply = await client.checkUpdate();
      setUpdateCheck(reply);
      if (reply.updateAvailable) {
        toast.info(`发现新版 ${reply.latest},建议更新`);
      } else {
        toast.success("已是最新版本");
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "检查更新失败");
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [client, refreshStatus]);

  const rollbackUpdate = useCallback(async () => {
    if (!client) return;
    setIsRollingBack(true);
    try {
      const reply = await client.rollbackUpdate();
      if (reply.accepted) {
        toast.success(reply.message || "已回滚到更新前快照");
        setUpdateReport(null);
      } else {
        toast.error(reply.message || "回滚失败");
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回滚失败");
    } finally {
      setIsRollingBack(false);
    }
  }, [client, refreshStatus]);

  // 高级设置(09-08 映射表补口):性能档/加速方式落账,重启引擎后生效
  const setLaunchArgs = useCallback(
    async (args: { vramPolicy?: "auto" | "gpu-only" | "reserve-vram"; reserveVramGb?: number | null; attentionMode?: "auto" | "pytorch-cross-attention" }) => {
      if (!client) return;
      try {
        const reply = await client.setLaunchArgs(args);
        if (!reply.accepted) toast.error(reply.message || "性能档设置未保存");
        else toast.success("已保存,重启引擎后生效");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "性能档设置失败");
      }
    },
    [client],
  );

  // 快照列表(09-08 映射表补口:快照页→搬并强化)
  const [snapshots, setSnapshots] = useState<ComfySnapshotEntry[]>([]);
  const refreshSnapshots = useCallback(async () => {
    if (!client) return;
    try {
      setSnapshots(await client.listSnapshots());
    } catch {
      // 列表拉不到不阻塞(引擎未装/离线时为空)
    }
  }, [client]);

  const rollbackTo = useCallback(
    async (snapshotId: string) => {
      if (!client) return;
      setIsRollingBack(true);
      try {
        const reply = await client.rollbackUpdate(snapshotId);
        if (reply.accepted) {
          toast.success(reply.message || "已回滚到所选快照");
          setUpdateReport(null);
        } else {
          toast.error(reply.message || "回滚失败");
        }
        await refreshStatus();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "回滚失败");
      } finally {
        setIsRollingBack(false);
      }
    },
    [client, refreshStatus],
  );

  const setModelsDir = useCallback(
    async (path: string) => {
      if (!client) return false;
      setIsSavingModelsDir(true);
      try {
        const reply = await client.setModelsDir(path);
        if (!reply.accepted) {
          toast.error(reply.message || "模型目录保存失败");
          return false;
        }
        toast.success("模型目录已保存");
        await refreshStatus();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "模型目录保存失败");
        return false;
      } finally {
        setIsSavingModelsDir(false);
      }
    },
    [client, refreshStatus],
  );

  const runDoctor = useCallback(async () => {
    if (!client) return;
    setIsRunningDoctor(true);
    try {
      setDoctorReport(await client.doctor());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "依赖体检失败");
    } finally {
      setIsRunningDoctor(false);
    }
  }, [client]);

  // 清理孤儿插件(体检报告的可执行动作,09-08 补口)
  const cleanOrphans = useCallback(async () => {
    if (!client) return;
    try {
      const reply = await client.cleanOrphans();
      toast.success(reply.message ?? "清理完成");
      await runDoctor();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清理未完成");
    }
  }, [client, runDoctor]);

  const startService = useCallback(async () => {
    if (!client) return;
    setIsStartingService(true);
    try {
      const reply = await client.startEngine();
      if (reply.accepted) {
        toast.success("ComfyUI 引擎服务已启动");
      } else {
        toast.error(reply.message || "服务启动失败");
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "服务启动失败");
    } finally {
      setIsStartingService(false);
    }
  }, [client, refreshStatus]);

  const stopService = useCallback(async () => {
    if (!client) return;
    try {
      const reply = await client.stopEngine();
      if (reply.accepted) {
        toast.success("ComfyUI 引擎服务已停止");
      } else {
        toast.error(reply.message || "服务停止失败");
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "服务停止失败");
    }
  }, [client, refreshStatus]);

  const searchCatalog = useCallback(
    async (query: string) => {
      if (!client) return;
      try {
        setCatalog(await client.searchCatalog(query));
      } catch {
        // 搜索失败保持旧结果
      }
    },
    [client],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of catalog) {
      if (entry.category) set.add(entry.category);
    }
    return [...set];
  }, [catalog]);

  return {
    hasBridge,
    status,
    activeJob,
    updateCheck,
    updateReport,
    pluginInstallReport,
    plugins,
    catalog,
    categories,
    doctorReport,
    isCheckingUpdate,
    isSavingModelsDir,
    isRunningDoctor,
    isStartingService,
    isRollingBack,
    installEngine,
    updateEngine,
    resetEngine,
    rollbackUpdate,
    rollbackTo,
    setLaunchArgs,
    snapshots,
    refreshSnapshots,
    cleanOrphans,
    checkUpdate,
    setModelsDir,
    runDoctor,
    startService,
    stopService,
    searchCatalog,
    installPlugin,
    updatePlugin,
    uninstallPlugin,
    getPluginUsage,
    refreshStatus,
    refreshPlugins,
  };
}

export type ComfyEngineSettingsController = ReturnType<typeof useComfyEngineSettings>;
