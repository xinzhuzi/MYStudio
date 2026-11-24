/**
 * 引擎同步域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 单真源清单/勾选/逐项同步/结果弹窗/引擎重启。逻辑零改动。
 * 在跑态守卫读镜像 ref(Torch 域每渲染回写)=原闭包上一帧值语义。
 */
import { useEffect, useState } from "react";
import {
  getEngineSyncManifest,
  getEnginePluginHealth,
  syncEngine,
  restartRemoteEngine,
  SIDECAR_DOWN_GUIDANCE,
  isSidecarDownError,
  ComfySidecarHttpError,
  ENGINE_SYNC_OVERALL_TIMEOUT_MS,
  type EnginePluginHealth,
  type EngineSyncManifest,
  type EngineSyncManifestItem,
  type EngineSyncResultItem,
} from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { toast } from "sonner";

export function useEngineSyncAdmin({
  sshConnected,
  torchRunningMirror,
  torchBusyMirror,
  syncRunningMirror,
}: {
  sshConnected: boolean;
  torchRunningMirror: { current: boolean };
  torchBusyMirror: { current: boolean };
  syncRunningMirror: { current: boolean };
}) {
  // ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗 ──
  const [engineSyncManifest, setEngineSyncManifest] =
    useState<EngineSyncManifest | null>(null);
  // 1107 自愈可见化:Win 引擎插件加载健康(挂件挂因/pip 欠账;null=未探)
  const [enginePluginHealth, setEnginePluginHealth] =
    useState<EnginePluginHealth | null>(null);
  const [engineSyncError, setEngineSyncError] = useState<string | null>(null);
  const [engineSyncChecked, setEngineSyncChecked] = useState<
    Record<string, boolean>
  >({});
  // 逐项进度(Q3:每完成一件更新一行):name → "pending" ⬜等待 | "syncing" ⏳ | 完成回执
  const [engineSyncProgress, setEngineSyncProgress] = useState<
    Record<string, "pending" | "syncing" | EngineSyncResultItem>
  >({});
  const [engineSyncRunning, setEngineSyncRunning] = useState(false);
  // 同步完成结果弹窗(null=关;⚠️ pip 失败不阻断,随行展示)
  const [engineSyncDialog, setEngineSyncDialog] = useState<
    EngineSyncResultItem[] | null
  >(null);
  const [engineRestarting, setEngineRestarting] = useState(false);
  // 挂载即取清单(R3):GET manifest → 渲染勾选清单。SSH 未连接(503 ssh-
  // disconnected)/sidecar 未在驾 → 静默留空态+提示,按钮禁用(照 SSH 行范式
  // 首开设置页不弹错)。win-only 默认勾上(1122 用户令「Win 独有也要能更新」,
  // 同步按仓自身 origin 拉最新);skip(my-nodes,Q2)不渲染。
  useEffect(() => {
    let cancelled = false;
    getEngineSyncManifest()
      .then((manifest) => {
        if (cancelled) return;
        setEngineSyncManifest(manifest);
        setEngineSyncError(null);
        setEngineSyncChecked(
          Object.fromEntries(
            manifest.items
              .filter(
                (item) =>
                  item.status === "both" ||
                  item.status === "mac-only" ||
                  item.status === "win-only",
              )
              .map((item) => [item.name, true]),
          ),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        if (isSidecarDownError(error))
          setEngineSyncError(SIDECAR_DOWN_GUIDANCE);
        else if (error instanceof ComfySidecarHttpError && error.status === 503)
          setEngineSyncError(
            "需先连接 SSH(下方 SSH 远端连接点一条连接)再取同步清单",
          );
        else
          setEngineSyncError(
            error instanceof Error ? error.message : "取同步清单失败",
          );
      });
    // 1107 自愈可见化:插件加载健康图(挂件+挂因/pip 欠账)随清单取——
    // 失败静默(徽标退「未探」,不拦同步清单本体)
    getEnginePluginHealth()
      .then((health) => {
        if (!cancelled) setEnginePluginHealth(health);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // 引擎同步清单可见行(skip 态不渲染;skip=my-nodes Q2 归 deploy-dual 管——
  // 手动清单条目双侧均无时后端报 mac-only,不落 skip,可见可勾选)
  const engineSyncRows: EngineSyncManifestItem[] = (
    engineSyncManifest?.items ?? []
  ).filter((item) => item.status !== "skip");
  // 清单回拉(同步完成后回刷版本 / SSH 迟连补拉共用)。成功即清除错误态:
  // 渲染序为「SSH 未连提示 > 错误 > 空清单 > 清单」,不清错误则补拉成功后
  // 页面仍停在旧的「需先连接 SSH」上(1123 实弹:补拉回 200 而清单不出现)。
  // 回刷不动勾选态(1122 版本展示:拉最新后行内版本要跟上)。
  const refreshEngineSyncManifest = () => {
    getEngineSyncManifest()
      .then((manifest) => {
        setEngineSyncManifest(manifest);
        setEngineSyncError(null);
      })
      .catch(() => {}); // 刷新失败静默:行内版本停在旧值,下次开面板自愈
  };
  // SSH 迟连自愈(1122 实弹踩雷):清单只在挂载时拉一次,SSH 未通=503 扑空,
  // keeper 翻绿后不补拉=面板恒空。连接态翻绿且清单仍缺/错 → 自动补拉。
  useEffect(() => {
    if (sshConnected && (engineSyncManifest === null || engineSyncError)) {
      refreshEngineSyncManifest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只盯连接态翻转
  }, [sshConnected]);
  const toggleEngineSyncItem = (name: string, checked: boolean) => {
    setEngineSyncChecked((prev) => ({ ...prev, [name]: checked }));
  };

  // 开始同步(R3):勾选项逐件 POST sync-engine——单发 POST 拿不到中途回执,
  // 逐件串行发=真·逐项进度(Q3 每完成一件更新一行);单件失败不拦后续(C8)。
  // 整体超时 30min(Q3;1104 修正 10→30min,41 件全量 clone 需要时间)跨批次
  // 生效(1104 复核修):逐件单发会让每件都拿全新预算,故前端持全局 deadline
  // ——每件 POST 带剩余秒数(timeoutS),预算耗尽后剩余件不再发、按后端同口径
  // 标「整体超时」。
  const startEngineSync = async () => {
    const names = engineSyncRows
      .filter((item) => engineSyncChecked[item.name])
      .map((item) => item.name);
    if (
      names.length === 0 ||
      engineSyncRunning ||
      torchRunningMirror.current ||
      torchBusyMirror.current
    )
      return;
    setEngineSyncRunning(true);
    setEngineSyncProgress(
      Object.fromEntries(names.map((name) => [name, "pending" as const])),
    );
    const deadline = Date.now() + ENGINE_SYNC_OVERALL_TIMEOUT_MS;
    const overallTimeoutError = `整体超时(${ENGINE_SYNC_OVERALL_TIMEOUT_MS / 60_000}min),未同步`;
    const results: EngineSyncResultItem[] = [];
    for (const name of names) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // 预算耗尽:不发新 POST,剩余件按后端超时同口径收摊
        const timedOut: EngineSyncResultItem = {
          name,
          type: name === "ComfyUI" ? "engine" : "plugin",
          macHead: null,
          winHead: null,
          action: "failed",
          verified: false,
          error: overallTimeoutError,
        };
        results.push(timedOut);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: timedOut }));
        continue;
      }
      setEngineSyncProgress((prev) => ({ ...prev, [name]: "syncing" })); // 当前件 ⏳,其余 ⬜ 等待
      try {
        const reply = await syncEngine(
          [name],
          // 1122 sshd 楔死实弹:SSH 通道挂死时后端内层超时不再走火(channel
          // 阻塞不吃 deadline),HTTP 层若拿整段剩余预算(最长 30min)干等=批次
          // 长僵(14:50 批第 16 件实证)。单件预算封顶 6min:楔件按超时落
          // failed,批次继续走,不再死等。
          Math.min(360, Math.max(1, Math.ceil(remainingMs / 1000))),
        );
        const item = reply.items[0];
        results.push(item);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: item }));
      } catch (error) {
        const failed: EngineSyncResultItem = {
          name,
          type: name === "ComfyUI" ? "engine" : "plugin",
          macHead: null,
          winHead: null,
          action: "failed",
          verified: false,
          error: error instanceof Error ? error.message : "同步失败",
        };
        results.push(failed);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: failed }));
      }
    }
    setEngineSyncRunning(false);
    setEngineSyncDialog(results);
    refreshEngineSyncManifest();
    if (results.some((r) => r.action === "failed")) {
      toast.error(
        `引擎同步有 ${results.filter((r) => r.action === "failed").length} 件失败——见结果弹窗`,
      );
    } else {
      toast.success("引擎同步完成——建议重启引擎使插件生效");
    }
  };
  // 重启引擎(R3):SSH schtasks /Run /TN EngineDurable(远端 Windows 计划任务)
  const restartEngine = async () => {
    setEngineRestarting(true);
    try {
      const reply = await restartRemoteEngine();
      if (reply.ok)
        toast.success("重启指令已发(EngineDurable),引擎约需 1-2 分钟起");
      else toast.error(`重启指令失败: ${reply.output || "schtasks 未成功"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重启失败");
    } finally {
      setEngineRestarting(false);
    }
  };

  // 跨域镜像回写(Torch 守卫读同步在跑态;每渲染一次=原闭包上一帧值语义)
  syncRunningMirror.current = engineSyncRunning;

  return {
    engineSyncManifest, enginePluginHealth, engineSyncError, engineSyncChecked,
    engineSyncProgress, engineSyncRunning, engineSyncDialog, setEngineSyncDialog,
    engineRestarting, engineSyncRows, refreshEngineSyncManifest,
    toggleEngineSyncItem, startEngineSync, restartEngine,
  };
}
