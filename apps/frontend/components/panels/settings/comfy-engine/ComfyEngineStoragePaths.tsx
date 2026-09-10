"use client";
// ComfyUI 存储位置配置卡(09-09 comfyui-frontend-swap 0a,design.md 2.6)。
//
// 源码目录/Python 运行时(venv)/工作流目录 三行可改:
// - 未安装:直接落账(manifest),安装时落到新位
// - 已安装:改路径=迁移(引擎/工作流搬移+venv 新位重建),确认后走 job 进度
// - 引擎运行中:禁改(先停止)
// 模型目录(纯指针,可编辑)由引擎设置区注入为首行——09-10 用户裁定:同卡展示
// 不区分、卡内不嵌盒子,路径一律平文本(整页只有一个盒子)。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getComfyEngineClient,
  type ComfyEnginePathsStatus,
  type ComfyEngineJob,
} from "./comfy-engine-contract";

type PathKey = "engineDir" | "venvDir" | "workflowsDir";

const ROWS: Array<{ key: PathKey; label: string; hint: string }> = [
  { key: "engineDir", label: "源码目录", hint: "ComfyUI 源码仓库与插件 custom_nodes(整体搬移)" },
  { key: "venvDir", label: "引擎虚拟环境", hint: "ComfyUI 专用依赖环境 venv(与全局「Python 运行环境」无关;迁移时在新位置重建,依赖走缓存)" },
  { key: "workflowsDir", label: "工作流目录", hint: "内置模板与你的工作流库" },
];

/** 探测期回落显示的默认路径:与后端 comfy_manifest.storage_root 同口径
 * (09-09 用户裁定:comfyui 家与 python 运行时平级,<userData>/comfyui);仅作显示,真值以服务返回为准。 */
async function fallbackDefaultPaths(): Promise<ComfyEnginePathsStatus | null> {
  try {
    const paths = await window.storageManager?.getPaths?.();
    const root = paths?.basePath ?? paths?.pythonRuntimeDir?.replace(/\/python$/, "");
    if (!root) return null;
    const home = `${root.replace(/\/$/, "")}/comfyui`;
    const paths2 = {
      engineDir: `${home}/ComfyUI`,
      venvDir: `${home}/venv`,
      modelsDir: `${home}/models`,
      workflowsDir: `${home}/workflows`,
    };
    return {
      installed: false,
      running: false,
      paths: paths2,
      defaults: paths2,
      customized: { engineDir: false, venvDir: false, modelsDir: false, workflowsDir: false },
    };
  } catch {
    return null;
  }
}

export function ComfyEngineStoragePaths({ modelsDirRow }: { modelsDirRow?: ReactNode }) {
  // client 引用必须稳定:getComfyEngineClient() 每次渲染返回新 HTTP client,
  // 会重建 refresh→effect 循环重跑(sidecar 未起时连环 toast,09-09 实弹报障)
  const client = useMemo(() => getComfyEngineClient(), []);
  const [status, setStatus] = useState<ComfyEnginePathsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrateJob, setMigrateJob] = useState<ComfyEngineJob | null>(null);
  const [pendingMigrate, setPendingMigrate] = useState<{ key: PathKey; path: string } | null>(null);
  // 探测失败回落默认路径后,延时重试一次拉真值(引擎卡挂载会拉起本地服务,
  // 通常 2-3 秒内就绪);只重试一次,不形成轮询
  const retryRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      setStatus(await client.getPaths());
    } catch {
      // 探测期失败(本地生图服务未起)静默回落:默认路径直显,不弹提示行
      // (09-09 用户裁定「没必要提示,默认把路径写上去」);服务起来后由
      // 引擎卡状态变化触发手动刷新替换为实际值
      const fallback = await fallbackDefaultPaths();
      if (fallback) setStatus(fallback);
      if (!retryRef.current) {
        retryRef.current = true;
        window.setTimeout(() => void refresh(), 2500);
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 迁移 job 轮询(既有引擎卡同款节奏)
  useEffect(() => {
    if (!migrateJob || migrateJob.state !== "running" || !client) return;
    const timer = window.setTimeout(async () => {
      try {
        const job = await client.getJob(migrateJob.jobId);
        setMigrateJob(job);
        if (job.state === "succeeded") {
          toast.success("目录迁移完成");
          await refresh();
        } else if (job.state === "failed") {
          toast.error(job.message || "目录迁移失败");
        }
      } catch {
        /* 轮询失败下次再试 */
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [migrateJob, client, refresh]);

  const pickAndApply = useCallback(
    async (key: PathKey) => {
      if (!client || !status) return;
      const chosen = await window.storageManager?.selectDirectory(status.paths[key]);
      if (!chosen) return;
      const validation = await client.validatePaths({ [key]: chosen });
      if (!validation.ok) {
        const firstError = Object.values(validation.errors)[0] ?? "路径不可用";
        toast.error(firstError);
        return;
      }
      if (validation.warnings.disk) toast.warning(validation.warnings.disk);
      if (!status.installed) {
        try {
          await client.setPaths({ [key]: chosen });
          toast.success("已更新(引擎尚未安装,安装时将使用新位置)");
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "保存失败");
        }
        return;
      }
      // 已安装:弹确认对话框(09-09 修复——window.confirm 在 Electron 下不可控,
      // 换项目标准 AlertDialog;确认按钮用中性色,不用金色实心)
      setPendingMigrate({ key, path: chosen });
    },
    [client, status, refresh],
  );

  const confirmMigrate = useCallback(async () => {
    const pending = pendingMigrate;
    setPendingMigrate(null);
    if (!pending || !client) return;
    try {
      const reply = await client.migratePaths({ [pending.key]: pending.path });
      const job = await client.getJob(reply.jobId);
      setMigrateJob(job);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动迁移失败");
    }
  }, [client, pendingMigrate]);

  if (!client) return null; // 桥不可达(非 Electron/未注入):零渲染

  const disabled = migrateJob?.state === "running";
  const engineRunning = status?.running === true;

  return (
    <section
      data-comfy-engine-storage-paths
      className="space-y-3 rounded-lg border border-border bg-background/40 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">存储位置</h4>
          <p className="text-xs text-muted-foreground">
            引擎装在哪个盘、虚拟环境放哪,都可自定义(引擎运行中不可修改)
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} aria-label="刷新存储位置">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </header>

      <div className="space-y-2" data-comfy-engine-storage-rows>
        {/* 模型目录行(可编辑)由引擎设置区注入:状态归 useComfyEngineSettings,卡内首行同展 */}
        {modelsDirRow ?? null}
        {ROWS.map((row) => {
          const value = status?.paths[row.key] ?? "";
          const customized = status?.customized[row.key] === true;
          return (
            <div key={row.key} className="grid items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)_auto]" data-comfy-path-row={row.key}>
              <span className="text-xs text-muted-foreground" title={row.hint}>
                {row.label}
                {customized ? <span className="ml-1 text-[10px] text-primary/80">(自定义)</span> : null}
              </span>
              {/* 平文本路径(09-10 用户裁定:卡内不嵌盒子);超长截断,悬停看全 */}
              <span
                className="min-w-0 truncate font-mono text-xs text-foreground"
                title={value}
                aria-label={`${row.label}路径`}
              >
                {value}
              </span>
              <div className="flex flex-nowrap gap-2 md:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (value) void window.electronAPI?.openPath(value);
                  }}
                  aria-label={`打开${row.label}`}
                >
                  <FolderOpen className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || engineRunning}
                  title={engineRunning ? "请先停止引擎再修改目录" : undefined}
                  onClick={() => void pickAndApply(row.key)}
                  aria-label={`更改${row.label}`}
                  data-comfy-path-change={row.key}
                >
                  更改
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {migrateJob ? (
        <p className="text-xs text-muted-foreground" data-comfy-migrate-status>
          迁移:{migrateJob.message ?? migrateJob.stage}
          {migrateJob.state === "running" ? `(${migrateJob.progress}%)` : ""}
        </p>
      ) : null}

      {/* 迁移确认(09-09 修复:window.confirm 在 Electron 下不可控,换标准弹窗;
          确认按钮中性色——不用金色实心) */}
      <AlertDialog open={pendingMigrate !== null} onOpenChange={(open) => { if (!open) setPendingMigrate(null); }}>
        <AlertDialogContent data-comfy-migrate-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>迁移存储位置</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  将把「{pendingMigrate ? ROWS.find((row) => row.key === pendingMigrate.key)?.label : ""}」迁移到:
                </p>
                <p className="break-all rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">
                  {pendingMigrate?.path}
                </p>
                <p>
                  现有文件会搬移过去(跨盘较大时需数分钟;Python 运行时会在新位置重建,依赖走本地缓存)。
                  迁移期间请不要操作引擎。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-secondary/60 text-secondary-foreground border border-foreground/[0.06] hover:bg-secondary/80"
              onClick={() => void confirmMigrate()}
            >
              开始迁移
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
