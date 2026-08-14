"use client";

import { Check, Download, FolderOpen, Loader2, Layers, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useDepthRuntimeSettings, DEPTH_CINEMATIC_PRESET_OPTIONS } from "./useDepthRuntimeSettings";

type DepthSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 深度估计模型配置区块 — 设置 → 本地配置。
 *
 * Model download policy: inference NEVER auto-downloads. The depth model is
 * downloaded only when the user clicks the button here; renders that need the
 * model fail with "model-not-downloaded" and surface a dialog redirecting to
 * this section.
 */
export function DepthSettingsSection({ embedded = false }: DepthSettingsSectionProps) {
  const runtime = useDepthRuntimeSettings();
  const status = runtime.status;
  const isRuntimeReady = status?.state === "ready";
  const setupFailed = status?.setupStage === "failed";
  const modelDownloaded = status?.modelDownloaded ?? false;
  const downloading = status?.downloadStatus === "downloading" || runtime.isDownloading;
  const downloadFailed = status?.downloadStatus === "error";
  const setupProgress = status?.setupProgress;
  const downloadProgress = downloading ? (status?.downloadProgress ?? 0) : undefined;

  const handleSelectCacheDir = async () => {
    const storageManager = getStorageManagerBridge();
    if (!storageManager?.selectDirectory) {
      toast.error("选择文件夹仅在桌面应用中可用");
      return;
    }
    const dir = await storageManager.selectDirectory();
    if (!dir) return;
    await runtime.changeModelCacheDir(dir);
  };

  const handleOpenCacheDir = async () => {
    const target = status?.modelCacheDir?.trim();
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的模型目录");
      return;
    }
    try {
      const result = await window.electronAPI.openPath(target);
      if (!result.success) toast.error(result.error || "打开模型目录失败");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开模型目录失败");
    }
  };

  if (!runtime.hasRuntime) {
    return (
      <div className={cn("px-5 py-4 text-sm text-muted-foreground", !embedded && "rounded-xl border border-border")}>
        深度估计模型配置仅在桌面应用中可用。
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Runtime row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isRuntimeReady ? (
            <Check className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className={cn("font-medium", setupFailed && "text-destructive")}>
            {isRuntimeReady
              ? "运行时已就绪"
              : setupFailed
                ? (status?.setupMessage ?? "运行时配置失败")
                : (status?.setupMessage ?? "未配置（依赖共享 Python 运行环境）")}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runtime.setupRuntime()}
          disabled={runtime.isSettingUp || runtime.isSetupActive || downloading}
        >
          {runtime.isSettingUp || runtime.isSetupActive ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Layers className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isRuntimeReady ? "重新检查" : "配置运行时"}
        </Button>
      </div>

      {(runtime.isSetupActive || setupFailed) && setupProgress !== undefined && !setupFailed && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${setupProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(setupProgress)}%</p>
        </div>
      )}

      {/* Model row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {modelDownloaded ? (
            <Check className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span
            className={cn("font-medium", downloadFailed && "text-destructive")}
            title="Depth Anything V2 Small · Apache-2.0 · 约 100 MB"
          >
            Depth Anything V2 Small
            {modelDownloaded && status?.modelSizeMb != null ? ` · ${status.modelSizeMb.toFixed(1)} MB` : ""}
            {" — "}
            {downloading
              ? "下载中"
              : modelDownloaded
                ? "已下载"
                : downloadFailed
                  ? (status?.downloadError ?? "下载失败")
                  : "未下载"}
          </span>
        </div>
        <div className="flex gap-1.5">
          {modelDownloaded ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runtime.removeModel()}
              disabled={downloading}
            >
              <Trash2 className="mr-1 h-4 w-4" aria-hidden />
              删除
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void runtime.startDownload()}
            disabled={!isRuntimeReady || downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden />
            )}
            {downloading ? "下载中…" : modelDownloaded ? "重新下载" : "下载模型"}
          </Button>
        </div>
      </div>

      {downloading && downloadProgress !== undefined && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(downloadProgress)}%</p>
        </div>
      )}

      {downloadFailed && status?.downloadError && (
        <p className="text-xs text-destructive">{status.downloadError}</p>
      )}

      {/* Model cache directory (mirrors the TTS/Python install-path grid layout) */}
      <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
        <Label className="text-xs text-muted-foreground">模型缓存目录</Label>
        <Input
          readOnly
          value={status?.modelCacheDir ?? ""}
          placeholder="…/DeepModel"
          containerClassName="w-full min-w-0"
          className="min-w-0 font-mono text-xs truncate"
          data-depth-model-cache-dir
        />
        <div className="flex flex-nowrap gap-2 md:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleSelectCacheDir()}
            disabled={downloading}
          >
            更改目录
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleOpenCacheDir()}
            disabled={!status?.modelCacheDir}
          >
            <FolderOpen className="mr-1 h-4 w-4" aria-hidden />
            打开
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-5">
        深度模型用于静态图 → 3D 电影级纵深效果（相机推拉/环绕/视差 + 景深）。模型仅在点击下载时获取，
        渲染时绝不自动下载；下载源：ModelScope（国内优先），失败回退 HuggingFace。
      </p>

      {/* Cinematic camera preset */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">3D 相机运动预设</span>
          <span className="text-xs text-muted-foreground">
            {status?.cinematicPresetMode === "manual"
              ? "手动：所有静态图分镜使用同一镜头运动"
              : `AI 自动：按剧本逐镜选择${status?.cinematicPresetCount ? `（已分析 ${status.cinematicPresetCount} 镜）` : ""}`}
          </span>
        </div>
        <Select
          value={status?.cinematicPresetMode === "manual"
            ? (status?.cinematicPreset ?? "cinematic-dolly-in")
            : "cinematic-auto"}
          onValueChange={(value) => void runtime.selectPreset(value)}
          disabled={!runtime.hasRuntime}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="选择预设" />
          </SelectTrigger>
          <SelectContent>
            {DEPTH_CINEMATIC_PRESET_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
