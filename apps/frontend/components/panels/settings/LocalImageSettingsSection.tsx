"use client";

import { Check, Download, Image as ImageIcon, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useImageGenRuntimeSettings } from "./useImageGenRuntimeSettings";

type LocalImageSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 本地图片生成配置区块 — 设置 → 本地配置。
 *
 * Qwen-Image-Edit 2511 本地生图（21.7B 编辑级模型；大件指向 ComfyUI 现成文件
 * 零重下，首次点「补齐小件」获取 ~300MB 官方小件）以 OpenAI 兼容本地提供方
 * 暴露，可替代云端 API。模型显式获取；生成端点绝不自动下载。
 */
export function LocalImageSettingsSection({ embedded = false }: LocalImageSettingsSectionProps) {
  const runtime = useImageGenRuntimeSettings();
  const status = runtime.status;
  const lifecycleState = runtime.lifecycleStatus?.state;
  const isReady = runtime.hasLifecycleBridge
    ? lifecycleState === "ready"
    : status?.setupStage === "ready" || status?.running;
  const setupFailed = runtime.lifecycleError || lifecycleState === "blocked" || lifecycleState === "error" || status?.setupStage === "failed";

  if (!runtime.hasRuntime) {
    return (
      <div className={cn("px-5 py-4 text-sm text-muted-foreground", !embedded && "rounded-xl border border-border")}>
        本地图片生成配置仅在桌面应用中可用。
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Server row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className={cn("font-medium", setupFailed && "text-destructive")}>
            {isReady
              ? "本地生图服务运行中 (127.0.0.1:17595)"
              : setupFailed
                ? (runtime.lifecycleError ?? status?.setupMessage ?? "服务启动失败")
                : lifecycleState === "needs-runtime"
                  ? "运行时未准备（请先准备模型）"
                  : "服务未启动（依赖共享 Python 运行环境）"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {runtime.hasLifecycleBridge ? (
            <Button size="sm" variant="ghost" onClick={() => void runtime.probeRuntime()} disabled={runtime.isProbing || runtime.isSettingUp || runtime.isRollingBack}>
              <RefreshCw className={cn("mr-2 h-4 w-4", runtime.isProbing && "animate-spin")} aria-hidden />
              探测
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void runtime.setupRuntime()} disabled={runtime.isSettingUp || runtime.isProbing || runtime.isRollingBack}>
            {runtime.isSettingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ImageIcon className="mr-2 h-4 w-4" aria-hidden />}
            {isReady ? "重新检查" : "准备运行时"}
          </Button>
          {runtime.hasLifecycleBridge ? (
            <Button size="sm" variant="ghost" onClick={() => void runtime.rollbackRuntime()} disabled={!isReady || runtime.isSettingUp || runtime.isProbing || runtime.isRollingBack}>
              {runtime.isRollingBack ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="mr-2 h-4 w-4" aria-hidden />}
              回滚
            </Button>
          ) : null}
        </div>
      </div>

      {runtime.lifecycleStatus?.message && !runtime.lifecycleError ? <p className="text-xs text-muted-foreground">{runtime.lifecycleStatus.message}</p> : null}
      {runtime.lifecycleStatus?.modelCacheDir ? <p className="truncate text-xs text-muted-foreground" title={runtime.lifecycleStatus.modelCacheDir}>模型缓存：{runtime.lifecycleStatus.modelCacheDir}</p> : null}

      {/* Model rows */}
      {(status?.models ?? []).map((model) => {
        const downloading = status?.downloadStatus?.[model.modelName] === "downloading";
        const failed = status?.downloadStatus?.[model.modelName] === "error";
        const progress = downloading ? (status?.downloadProgress?.[model.modelName] ?? 0) : undefined;
        // 指向版三态:大件在+小件缺 → 「待补齐小件」;下载按钮语义同步切换
        const needsSmallPieces = model.downloaded && model.smallPiecesReady === false;
        const statusLabel = needsSmallPieces
          ? "大件已就绪 · 待补齐小件(~300MB)"
          : downloading
            ? "下载中"
            : model.downloaded
              ? model.pointed
                ? "已就绪（指向 ComfyUI 路径）"
                : "已下载"
              : failed
                ? "下载失败"
                : "未下载";
        return (
          <div key={model.modelName} className="space-y-1.5">
            {model.pointedFiles?.length ? (
              <div className="space-y-0.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                {model.pointedFiles.map((file) => (
                  <p key={file} className="truncate font-mono text-[11px] leading-4 text-muted-foreground" title={file}>
                    {file}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                {model.downloaded && !needsSmallPieces ? (
                  <Check className="h-4 w-4 text-success" aria-hidden />
                ) : (
                  <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
                <span className={cn("font-medium", failed && "text-destructive")} title={model.repoId}>
                  {model.label}
                  {model.downloaded && model.sizeMb != null ? ` · ${(model.sizeMb / 1024).toFixed(1)} GB` : ""}
                  {" — "}
                  {statusLabel}
                  {status?.activeModel === model.modelName ? " · 当前模型" : ""}
                </span>
              </div>
              <div className="flex gap-1.5">
                {model.downloaded && status?.activeModel !== model.modelName ? (
                  <Button size="sm" variant="outline" onClick={() => void runtime.selectModel(model.modelName)}>
                    设为当前
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => void runtime.startDownload(model.modelName)}
                  disabled={!isReady || downloading}
                >
                  {downloading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  {downloading ? "补齐中…" : needsSmallPieces ? "补齐小件(~300MB)" : model.downloaded ? "重新下载小件" : "下载模型"}
                </Button>
              </div>
            </div>
            {downloading && progress !== undefined && (
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{Math.round(progress)}%</p>
              </div>
            )}
            {failed && status?.downloadError?.[model.modelName] ? (
              <p className="text-xs text-destructive">{status.downloadError[model.modelName]}</p>
            ) : null}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground leading-5">
        本地生图零 API 费用（Qwen-Image-Edit 编辑级模型，大件直接复用 ComfyUI 已有文件，仅首次补齐约 300MB 小件）。
        准备运行时后，在 设置 → 云端AI 中将「角色生图 / 场景生图 / 道具生图」绑定到
        「本地图片生成」提供方即可替代云 API。小件仅在点击时获取。
      </p>
    </div>
  );
}
