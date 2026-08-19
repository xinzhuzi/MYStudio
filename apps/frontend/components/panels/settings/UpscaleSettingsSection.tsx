"use client";

import { Check, Download, FolderOpen, Loader2, RefreshCw, RotateCcw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useUpscaleRuntimeSettings } from "./useUpscaleRuntimeSettings";

type UpscaleSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 图片超分模型配置区块 — 设置 → 本地配置。
 *
 * Model download policy: inference NEVER auto-downloads. Super-resolution
 * models are downloaded only when the user clicks the buttons here; upscale
 * actions that need a missing model fail with "model-not-downloaded" and
 * surface a toast redirecting to this section.
 */
export function UpscaleSettingsSection({ embedded = false }: UpscaleSettingsSectionProps) {
  const runtime = useUpscaleRuntimeSettings();
  const status = runtime.status;
  const lifecycleState = runtime.lifecycleStatus?.state ?? status?.state;
  const isRuntimeReady = lifecycleState === "ready";
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
  const setupFailed = status?.setupStage === "failed";
  const downloading = status?.downloadStatus === "downloading" || runtime.isDownloading;
  const downloadFailed = status?.downloadStatus === "error";
  const setupProgress = status?.setupProgress;
  const downloadProgress = downloading ? (status?.downloadProgress ?? 0) : undefined;
  const modelCacheDir = runtime.lifecycleStatus?.modelCacheDir ?? status?.modelCacheDir ?? "";
  const prepareDisabled = runtime.isSettingUp
    || runtime.isRollingBack
    || runtime.isProbing
    || downloading
    || (runtime.hasLifecycleBridge && isRuntimeReady);
  const rollbackAvailable = runtime.hasLifecycleBridge && isRuntimeReady;

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
    const target = modelCacheDir.trim();
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
        图片超分模型配置仅在桌面应用中可用。
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Runtime lifecycle row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isRuntimeReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", setupFailed && "text-destructive")}>图片超分运行时</span>
            <span
              className={cn("rounded-full border px-2 py-0.5 text-xs", lifecycleStatusClass)}
              data-upscale-runtime-state={lifecycleState ?? "unknown"}
            >
              {lifecycleStatusLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {runtime.hasLifecycleBridge ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runtime.probeRuntime()}
              disabled={runtime.isSettingUp || runtime.isRollingBack || runtime.isProbing || downloading}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", runtime.isProbing && "animate-spin")} aria-hidden />
              探测
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runtime.setupRuntime()}
            disabled={prepareDisabled || runtime.isSetupActive}
          >
            {runtime.isSettingUp || runtime.isSetupActive ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="mr-2 h-4 w-4" aria-hidden />
            )}
            {runtime.hasLifecycleBridge && isRuntimeReady ? "已准备" : isRuntimeReady ? "重新检查" : "准备"}
          </Button>
          {runtime.hasLifecycleBridge ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runtime.rollbackRuntime()}
              disabled={!rollbackAvailable || runtime.isSettingUp || runtime.isRollingBack || runtime.isProbing || downloading}
            >
              {runtime.isRollingBack ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              )}
              回滚
            </Button>
          ) : null}
        </div>
      </div>

      {runtime.lifecycleError ? (
        <p className="text-xs text-destructive" role="alert">{runtime.lifecycleError}</p>
      ) : null}
      {runtime.lifecycleStatus?.message && !runtime.lifecycleError ? (
        <p className="text-xs text-muted-foreground">{runtime.lifecycleStatus.message}</p>
      ) : null}

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

      {/* Model rows — one per catalog entry */}
      <div className="space-y-2" data-upscale-model-list>
        {runtime.models.map((model) => {
          const isActive = status?.activeModel === model.modelName;
          const isDownloadingThis = downloading && status?.downloadingModel === model.modelName;
          return (
            <div
              key={model.modelName}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2"
              data-upscale-model-row={model.modelName}
            >
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {model.downloaded ? (
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate font-medium" title={`${model.label} · BSD-3-Clause · x${model.scale}`}>
                  {model.label}
                  {isActive ? "（默认）" : ""}
                  {" · "}
                  {isDownloadingThis
                    ? "下载中"
                    : model.downloaded
                      ? `已下载 · 约 ${model.sizeMb ?? "?"} MB`
                      : downloadFailed
                        ? (status?.downloadError ?? "下载失败")
                        : `未下载 · 约 ${model.sizeMb ?? "?"} MB`}
                </span>
              </div>
              <div className="flex flex-nowrap gap-1.5">
                {!isActive && model.downloaded ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runtime.setActive(model.modelName)}
                    disabled={downloading}
                  >
                    设为默认
                  </Button>
                ) : null}
                {model.downloaded ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runtime.removeModel(model.modelName)}
                    disabled={downloading}
                  >
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                    删除
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => void runtime.startDownload(model.modelName)}
                  disabled={!isRuntimeReady || downloading}
                >
                  {isDownloadingThis ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  {isDownloadingThis ? "下载中…" : model.downloaded ? "重新下载" : "下载"}
                </Button>
              </div>
            </div>
          );
        })}
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

      {/* Model cache directory (mirrors the TTS/Depth/Python install-path grid layout) */}
      <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
        <Label className="text-xs text-muted-foreground">模型缓存目录</Label>
        <Input
          readOnly
          value={modelCacheDir}
          placeholder="…/UpscaleModel"
          containerClassName="w-full min-w-0"
          className="min-w-0 font-mono text-xs truncate"
          data-upscale-model-cache-dir
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
            disabled={!modelCacheDir}
          >
            <FolderOpen className="mr-1 h-4 w-4" aria-hidden />
            打开
          </Button>
        </div>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        图片超分用于把云端/本地生成的 1K 图放大到 4K 级别(原生 ×2/×4,不定尺)。默认「动漫插画 6B」
        为道劫工笔风格实证模型;模型仅在点击下载时获取,超分时绝不自动下载;
        下载源:ModelScope(国内优先),失败回退 HuggingFace/GitHub 官方 Release。
      </p>
    </div>
  );
}
