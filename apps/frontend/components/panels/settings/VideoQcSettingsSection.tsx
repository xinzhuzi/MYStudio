"use client";

import { Download, FolderOpen, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useVideoQcRuntimeSettings } from "./useVideoQcRuntimeSettings";

type VideoQcSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 视频评分模型(DOVER-Mobile)配置区块 — 设置 → 本地配置。
 *
 * 出片后 QC 链的观感层:模型未下载/未就绪时该层自动跳过并在 QC 报告标注,
 * 不阻塞渲染交付。下载政策与深度/超分一致:绝不自动下载。
 */
export function VideoQcSettingsSection({ embedded = false }: VideoQcSettingsSectionProps) {
  const runtime = useVideoQcRuntimeSettings();
  const status = runtime.status;
  const lifecycleState = status?.state;
  const isRuntimeReady = lifecycleState === "ready";
  const modelReady = status?.modelReady === true;
  const downloading = status?.downloadStatus === "downloading" || runtime.isDownloading;
  const downloadProgress = downloading ? (status?.downloadProgress ?? 0) : undefined;
  const modelCacheDir = status?.modelCacheDir ?? "";

  const lifecycleStatusLabel = runtime.isProbing
    ? "检查中"
    : lifecycleState === "ready"
      ? "已就绪"
      : lifecycleState === "needs-runtime"
        ? "需要准备运行时"
        : lifecycleState === "blocked"
          ? "已阻塞"
          : lifecycleState === "error"
            ? "检查失败"
            : "未探测";
  const lifecycleStatusClass = lifecycleState === "ready"
    ? "border-success/30 bg-success/10 text-success"
    : lifecycleState === "blocked" || lifecycleState === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-warning/30 bg-warning/10 text-warning";

  const handleSetup = async () => {
    try {
      const next = await runtime.setup();
      if (next?.state === "ready") toast.success("观感评分运行时已就绪");
      else toast.error(next?.message ?? "运行时准备失败");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "运行时准备失败");
    }
  };

  const handleDownload = async () => {
    const result = await runtime.downloadModel("dover-mobile");
    if (result?.accepted) toast.success("模型下载已开始");
    else toast.error(result?.message ?? "下载启动失败");
  };

  const handleSelectCacheDir = async () => {
    const storageManager = getStorageManagerBridge();
    if (!storageManager?.selectDirectory) {
      toast.error("选择文件夹仅在桌面应用中可用");
      return;
    }
    try {
      const dirPath = await storageManager.selectDirectory();
      if (!dirPath) return;
      const result = await runtime.setModelCacheDir(dirPath);
      if (!result?.success) toast.error(result?.error || "设置缓存目录失败");
      else toast.success("缓存目录已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择目录失败");
    }
  };

  const handleOpenCacheDir = async () => {
    if (!modelCacheDir) {
      toast.error("没有可打开的模型目录");
      return;
    }
    try {
      const result = await window.electronAPI?.openPath?.(modelCacheDir);
      if (result && typeof result === "object" && "success" in result && !result.success) {
        toast.error("打开模型目录失败");
      }
    } catch {
      toast.error("打开模型目录失败");
    }
  };

  const handleDelete = async () => {
    const result = await runtime.deleteModel("dover-mobile");
    if (result?.success) toast.success("已删除本地模型");
    else toast.error(result?.error ?? "删除失败");
  };

  return (
    <div className={cn("space-y-4 px-5 py-4", !embedded && "rounded-xl border border-border bg-card/30 p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", lifecycleStatusClass)}>
          {lifecycleStatusLabel}
        </span>
        {isRuntimeReady && (
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium",
              modelReady
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            {modelReady ? "模型已就绪" : (status?.modelCode === "arch-unavailable" ? "模型权重缺推理架构" : "模型未下载")}
          </span>
        )}
      </div>

      {!runtime.hasBridge && (
        <p className="text-sm text-muted-foreground">当前环境不支持本地观感评分(仅桌面应用可用)。</p>
      )}
      {status?.message && runtime.hasBridge && (
        <p className="text-sm text-muted-foreground">{status.message}</p>
      )}
      {status?.modelMessage && (
        <p className="text-sm text-muted-foreground">模型状态:{status.modelMessage}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {runtime.hasBridge && !isRuntimeReady && (
          <Button variant="outline" size="sm" onClick={handleSetup} disabled={runtime.isProbing || downloading}>
            {runtime.isProbing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            准备运行时
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={!runtime.hasBridge || !isRuntimeReady || downloading || modelReady}
        >
          {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
          {modelReady ? "已下载" : downloading ? `下载中 ${downloadProgress ?? 0}%` : "下载模型"}
        </Button>
        {modelReady && (
          <Button variant="outline" size="sm" onClick={handleDelete}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            删除模型
          </Button>
        )}
        {runtime.hasBridge && (
          <Button variant="ghost" size="sm" onClick={() => void runtime.refresh()} disabled={runtime.isProbing}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
        )}
      </div>

      {downloading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${downloadProgress ?? 0}%` }} />
          </div>
          {status?.downloadError && <p className="text-xs text-destructive">{status.downloadError}</p>}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
        <Label htmlFor="video-qc-cache-dir" className="text-sm text-muted-foreground">缓存目录</Label>
        <Input
          id="video-qc-cache-dir"
          value={modelCacheDir}
          readOnly
          className="min-w-0 truncate font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSelectCacheDir} disabled={!runtime.hasBridge || downloading}>
            <FolderOpen className="mr-1.5 h-4 w-4" />
            选择
          </Button>
          <Button variant="ghost" size="sm" onClick={handleOpenCacheDir} disabled={!modelCacheDir}>
            打开
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        出片后 QC 链的观感层;模型按系列基线相对告警(UGC 校准,不做绝对国标)。未下载时该层自动跳过并在 QC 报告标注,不影响出片。
      </p>
    </div>
  );
}
