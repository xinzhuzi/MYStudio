"use client";
// ComfyUI 存储位置配置卡(09-09 comfyui-frontend-swap 0a,design.md 2.6)。
//
// 引擎目录/Python 运行时(venv)/工作流目录 三行可改:
// - 未安装:直接落账(manifest),安装时落到新位
// - 已安装:改路径=迁移(引擎/工作流搬移+venv 新位重建),确认后走 job 进度
// - 引擎运行中:禁改(先停止)
// 模型目录走既有引擎设置区(modelsDir 纯指针,不在此重复做编辑面)。

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getComfyEngineClient,
  type ComfyEnginePathsStatus,
  type ComfyEngineJob,
} from "./comfy-engine-contract";

type PathKey = "engineDir" | "venvDir" | "workflowsDir";

const ROWS: Array<{ key: PathKey; label: string; hint: string }> = [
  { key: "engineDir", label: "引擎目录", hint: "ComfyUI 源码与插件(custom_nodes 随引擎整体搬移)" },
  { key: "venvDir", label: "Python 运行时", hint: "引擎专用虚拟环境(与引擎分开存放;迁移时在新位置重建)" },
  { key: "workflowsDir", label: "工作流目录", hint: "内置模板与你的工作流库" },
];

const MODELS_ROW = { label: "模型目录", hint: "指向现有模型库即免重下(在上方引擎设置里修改)" };

export function ComfyEngineStoragePaths() {
  const client = getComfyEngineClient();
  const [status, setStatus] = useState<ComfyEnginePathsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrateJob, setMigrateJob] = useState<ComfyEngineJob | null>(null);
  const pendingRef = useRef<Partial<Record<PathKey, string>>>({});

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      setStatus(await client.getPaths());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取存储位置失败");
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
      // 已安装:确认迁移
      pendingRef.current = { [key]: chosen };
      const confirmed = window.confirm(
        `将把「${ROWS.find((row) => row.key === key)?.label}」迁移到:\n${chosen}\n\n`
        + "现有文件会搬移过去(跨盘较大时需数分钟;Python 运行时会在新位置重建,依赖走本地缓存)。\n"
        + "迁移期间请不要操作引擎。继续?",
      );
      if (!confirmed) {
        pendingRef.current = {};
        return;
      }
      try {
        const reply = await client.migratePaths({ [key]: chosen });
        const job = await client.getJob(reply.jobId);
        setMigrateJob(job);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "启动迁移失败");
      }
    },
    [client, status, refresh],
  );

  if (!client) return null; // 桥不可达(非 Electron/未注入):零渲染

  const disabled = migrateJob?.state === "running";
  const engineRunning = status?.running === true;

  return (
    <section
      data-comfy-engine-storage-paths
      className="mt-4 space-y-3 rounded-lg border border-border bg-background/40 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-foreground">存储位置</h4>
          <p className="text-xs text-muted-foreground">
            引擎装在哪个盘、Python 运行时放哪,都可自定义(引擎运行中不可修改)
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} aria-label="刷新存储位置">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </header>

      <div className="space-y-2" data-comfy-engine-storage-rows>
        {ROWS.map((row) => {
          const value = status?.paths[row.key] ?? "";
          const customized = status?.customized[row.key] === true;
          return (
            <div key={row.key} className="grid items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)_auto]" data-comfy-path-row={row.key}>
              <span className="text-xs text-muted-foreground" title={row.hint}>
                {row.label}
                {customized ? <span className="ml-1 text-[10px] text-primary/80">(自定义)</span> : null}
              </span>
              <Input
                readOnly
                value={value}
                containerClassName="w-full min-w-0"
                className="min-w-0 font-mono text-xs"
                aria-label={`${row.label}路径`}
              />
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

        {/* 模型目录:纯指针,编辑面在引擎设置区,此处只读展示 */}
        <div className="grid items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)_auto]" data-comfy-path-row="modelsDir">
          <span className="text-xs text-muted-foreground" title={MODELS_ROW.hint}>
            {MODELS_ROW.label}
          </span>
          <Input
            readOnly
            value={status?.paths.modelsDir ?? ""}
            containerClassName="w-full min-w-0"
            className="min-w-0 font-mono text-xs"
            aria-label="模型目录路径"
          />
          <div className="flex flex-nowrap gap-2 md:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const value = status?.paths.modelsDir;
                if (value) void window.electronAPI?.openPath(value);
              }}
              aria-label="打开模型目录"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      {migrateJob ? (
        <p className="text-xs text-muted-foreground" data-comfy-migrate-status>
          迁移:{migrateJob.message ?? migrateJob.stage}
          {migrateJob.state === "running" ? `(${migrateJob.progress}%)` : ""}
        </p>
      ) : null}
    </section>
  );
}
