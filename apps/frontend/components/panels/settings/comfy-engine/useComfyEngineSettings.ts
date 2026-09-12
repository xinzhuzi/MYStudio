// ComfyUI 引擎设置 hook——照 useImageGenRuntimeSettings/usePythonRuntimeSettings 模式:
// 挂载期一次性探测(严禁常驻轮询;初次失败时有界重试至 sidecar 就绪),只有任务
// (install/update/reset/插件装卸)进行中才按间隔拉 job 进度,任务终结即停。
// client 可注入(测试/后端未就绪时用 mock),默认走 window.comfyEngine 桥(集成接线点)。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { logEvent } from "@/lib/diagnostics/logger";
import {
  getComfyEngineClient,
  type ComfyCatalogEntry,
  type ComfyDoctorReport,
  type ComfyEngineAckReply,
  type ComfyEngineClient,
  type ComfyEngineJob,
  type ComfyEngineStatus,
  type ComfyEngineUpdateCheckReply,
  type ComfyEngineUpdateReport,
  type ComfyPluginInstallReport,
  type ComfyPluginInfo,
  type ComfyPluginUsageReply,
  ComfyModelsReply, ComfySnapshotEntry,
} from "./comfy-engine-contract";

const JOB_POLL_INTERVAL_MS = 800;
// 初次探测赶在 sidecar 就绪前失败时的有界重试:3s × 20 次 = 至多 1 分钟窗口,
// 覆盖 prepare 拉起 python 侧车的冷启动;超窗仍无状态则交回既有自愈(prepare)语义。
const STATUS_RETRY_INTERVAL_MS = 3_000;
const STATUS_RETRY_MAX_ATTEMPTS = 20;
// 手动启停撞上「sidecar 恰好死着」窗口时,prepare 自愈后补试一次前的等待
// (给 python 侧车冷启动留时间;测试经 options 调小)。
const SIDECAR_HEAL_WAIT_MS = 3_000;

/** 桥接层「服务不在」大白话判据(探活门禁的固定文案):仅这类失败值得补试。 */
function isSidecarDownError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("本地生图服务未运行");
}

export interface UseComfyEngineSettingsOptions {
  /** 覆盖数据通道(注入 mock client);不传用 window.comfyEngine。 */
  client?: ComfyEngineClient;
  /** 任务轮询间隔(测试调小);默认 800ms。 */
  pollIntervalMs?: number;
  /** 状态有界重试间隔(测试调小);默认 3000ms。 */
  statusRetryIntervalMs?: number;
  /** sidecar 自愈补试前的等待(测试调小);默认 3000ms。 */
  sidecarHealWaitMs?: number;
}

export function useComfyEngineSettings(options: UseComfyEngineSettingsOptions = {}) {
  // client 引用必须跨渲染稳定(照 ComfyCanvasStudio/ComfyEngineStoragePaths 同款修法):
  // HTTP 回落客户端每次调用都新建实例,若每 render 取新 client,全部 [client] 回调与
  // 挂载效应会退化成每 render 重跑 → 状态/插件/模型清单自刷新循环(09-10 实弹:
  // 本地配置模型页 195 件清单来回切页狂刷不止)。
  const client = useMemo(() => options.client ?? getComfyEngineClient(), [options.client]);
  const pollIntervalMs = options.pollIntervalMs ?? JOB_POLL_INTERVAL_MS;
  const statusRetryIntervalMs = options.statusRetryIntervalMs ?? STATUS_RETRY_INTERVAL_MS;
  const sidecarHealWaitMs = options.sidecarHealWaitMs ?? SIDECAR_HEAL_WAIT_MS;
  const hasBridge = Boolean(client);

  const [status, setStatus] = useState<ComfyEngineStatus | null>(null);
  const [activeJob, setActiveJob] = useState<ComfyEngineJob | null>(null);
  const [updateCheck, setUpdateCheck] = useState<ComfyEngineUpdateCheckReply | null>(null);
  const [updateReport, setUpdateReport] = useState<ComfyEngineUpdateReport | null>(null);
  const [pluginInstallReport, setPluginInstallReport] = useState<ComfyPluginInstallReport | null>(null);
  const [plugins, setPlugins] = useState<ComfyPluginInfo[]>([]);
  // 插件清单是否成功拉到过(挂载失败后的有界重试用;不用 plugins.length 判,
  // 空/非空是合法数据,只有「一次都没成功」才需要补拉)
  const [pluginsLoaded, setPluginsLoaded] = useState(false);
  const [catalog, setCatalog] = useState<ComfyCatalogEntry[]>([]);
  const [doctorReport, setDoctorReport] = useState<ComfyDoctorReport | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isSavingModelsDir, setIsSavingModelsDir] = useState(false);
  const [isRunningDoctor, setIsRunningDoctor] = useState(false);
  const [isStartingService, setIsStartingService] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const pollRef = useRef<number | null>(null);
  // runJob 从发起到首个轮询建立之间还有异步空档,仅靠 pollRef 判「有任务在途」
  // 会漏——启动中标志补上这道缝(09-11 P3:并发任务顶掉轮询槽的另一半根因)。
  const jobStartingRef = useRef(false);
  const statusFailuresRef = useRef(0);
  const lastHealRef = useRef(0);

  /** sidecar 不在时的统一自愈:prepare 拉起 + 等冷启动,只做一次由调用方控。 */
  const healSidecar = useCallback(async () => {
    try {
      void window.imageGenRuntime?.prepare?.();
    } catch {
      // 旧构建无桥不阻塞
    }
    await new Promise((resolve) => window.setTimeout(resolve, sidecarHealWaitMs));
  }, [sidecarHealWaitMs]);

  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!client) return;
    try {
      setStatus(await client.getEngineStatus());
      statusFailuresRef.current = 0;
    } catch {
      // 探测失败保持旧快照;行胶囊停留在「检查中」由上层判定。
      // sidecar 被采纳后又死掉(rollback 回收/外部进程退出)时控制器状态不
      // 会自动复活——连续失败节流触发一次 prepare 自愈拉起(09-10 实弹根修:
      // 引擎已装却恒显「检查中」,画布旧版还会误报「还没安装」)。
      statusFailuresRef.current += 1;
      if (statusFailuresRef.current >= 3 && Date.now() - lastHealRef.current > 30_000) {
        lastHealRef.current = Date.now();
        try {
          void window.imageGenRuntime?.prepare?.();
        } catch {
          // 拉不起(旧构建无桥)不阻塞,下轮探测照常
        }
      }
    }
  }, [client]);

  const refreshPlugins = useCallback(async () => {
    if (!client) return;
    try {
      setPlugins(await client.listPlugins());
      setPluginsLoaded(true);
    } catch {
      // 插件清单拉不到不阻塞引擎状态展示;挂载赶在 sidecar 就绪前失败时
      // 由有界重试补拉(09-10 实弹:装机版新启首进设置页恒「已装 0 个」)
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

  // 挂载探测失败的有界自愈:初次探测常赶在 prepare 拉起 sidecar 之前发出而失败,
  // 原实现无任何重试,引擎卡永转「正在确认引擎状态…」(09-10 两次实弹:上午「引擎
  // 已装却恒显检查中」+ 下午用户分钟级卡等)。status 仍为空或插件清单一次都没
  // 拉到时按间隔补探,双双就位/超窗即停——不是常驻轮询,本效应不再介入。
  // (09-10 晚实弹:插件清单原先不参与重试,装机版新启首进设置页恒「已装 0 个」。)
  useEffect(() => {
    if (!client || (status && pluginsLoaded)) return;
    let attempts = 0;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (attempts > STATUS_RETRY_MAX_ATTEMPTS) {
        window.clearInterval(retry);
        return;
      }
      if (!status) void refreshStatus();
      if (!pluginsLoaded) void refreshPlugins();
    }, statusRetryIntervalMs);
    return () => window.clearInterval(retry);
  }, [client, status, pluginsLoaded, refreshStatus, refreshPlugins, statusRetryIntervalMs]);

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
      // 09-11 P3 根修:原实现单轮询槽,并发第二个任务会顶掉第一个的轮询,前者
      // 永不收尾(无 toast、activeJob 悬挂)。后端本就是单任务闸,前端对齐成
      // 明拒;启动空档(start→轮询建立)由 jobStartingRef 一并盖住。
      if (jobStartingRef.current || pollRef.current !== null) {
        toast.error("已有任务在进行中,请等它完成再操作");
        return;
      }
      jobStartingRef.current = true;
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
      } finally {
        jobStartingRef.current = false;
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

  /** silent=更新页激活时的自动静默检查(照 Comfy Desktop):结果只进徽章,不弹 toast。 */
  const checkUpdate = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!client) return;
      setIsCheckingUpdate(true);
      try {
        const reply = await client.checkUpdate();
        setUpdateCheck(reply);
        if (!options.silent) {
          if (reply.updateAvailable) {
            toast.info(`发现新版 ${reply.latest},建议更新`);
          } else {
            toast.success("已是最新版本");
          }
        }
        await refreshStatus();
      } catch (error) {
        if (!options.silent) {
          toast.error(error instanceof Error ? error.message : "检查更新失败");
        }
      } finally {
        setIsCheckingUpdate(false);
      }
    },
    [client, refreshStatus],
  );

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

  // 启动配置(09-10 Desktop 化):命令行串/环境变量/端口策略落账,重启引擎后生效
  const setLaunchConfig = useCallback(
    async (config: { argsString?: string; envVars?: Record<string, string>; portConflictPolicy?: "auto-shift" | "fail" }) => {
      if (!client) return;
      try {
        const reply = await client.setLaunchConfig(config);
        if (!reply.accepted) toast.error(reply.message || "启动参数未保存");
        else toast.success("已保存,重启引擎后生效");
        return reply; // 调用方(防抖 effect)依 accepted 决定是否标记已存(深审 W3)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "启动参数保存失败");
        return undefined;
      }
    },
    [client],
  );

  // 模型库清单(09-10 用户裁定:模型页展示 comfyui/models 真实内容);
  // 拉不到不阻塞(侧车缺席=空态占位),激活「模型」页时由组件显式调用。
  const [models, setModels] = useState<ComfyModelsReply | null>(null);
  const isLoadingModels = useRef(false);
  const loadModels = useCallback(async () => {
    if (!client || isLoadingModels.current) return;
    isLoadingModels.current = true;
    try {
      setModels(await client.listModels());
    } finally {
      isLoadingModels.current = false;
    }
  }, [client]);

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
      let reply: ComfyEngineAckReply;
      try {
        reply = await client.startEngine();
      } catch (error) {
        // 09-11 P3 补缝:点击瞬间 sidecar 恰好死着(探测通道的自愈要几秒)——
        // 仅对「服务不在」类失败当场 prepare 拉起补试一次,连续两败如实报错
        if (!isSidecarDownError(error)) throw error;
        await healSidecar();
        reply = await client.startEngine();
      }
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
  }, [client, healSidecar, refreshStatus]);

  const stopService = useCallback(async () => {
    if (!client) return;
    try {
      let reply: ComfyEngineAckReply;
      try {
        reply = await client.stopEngine();
      } catch (error) {
        // 同 startService:停引擎撞上 sidecar 死窗,自愈补试一次
        if (!isSidecarDownError(error)) throw error;
        await healSidecar();
        reply = await client.stopEngine();
      }
      if (reply.accepted) {
        toast.success("ComfyUI 引擎服务已停止");
      } else {
        toast.error(reply.message || "服务停止失败");
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "服务停止失败");
    }
  }, [client, healSidecar, refreshStatus]);

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
    setLaunchConfig,
    snapshots,
    refreshSnapshots,
    models,
    loadModels,
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
