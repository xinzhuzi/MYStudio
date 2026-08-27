"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, FolderOpen, Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { VlmReviewProbeResult, VlmDownloadProgress } from "@/types/contracts/vlm-review-workflow";

type VlmReviewSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * VLM 视觉审核模型配置区块 — 设置 → 插件设置 → 视觉审核(VLM 一致性检查)。
 *
 * Model download policy: inference NEVER auto-downloads. The Qwen3-VL model
 * (~9.9GB) is downloaded only when the user clicks the button here; VLM review
 * in the generation pipeline treats a missing model as "skip review" (fail-open).
 */
export function VlmReviewSettingsSection({ embedded = false }: VlmReviewSettingsSectionProps) {
  const [probe, setProbe] = useState<VlmReviewProbeResult | null>(null);
  const [progress, setProgress] = useState<VlmDownloadProgress | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasBridge = typeof window !== "undefined" && Boolean(window.vlmReview);
  const isReady = probe?.status === "ready";
  const modelMissing = probe?.code === "model-not-downloaded";
  const unsupported = probe?.code === "unsupported-platform";

  const refresh = useCallback(async () => {
    if (!window.vlmReview?.probe) return;
    setIsProbing(true);
    try {
      const result = await window.vlmReview!.probe();
      setProbe(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "探测失败");
    } finally {
      setIsProbing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Download progress polling
  useEffect(() => {
    if (!isDownloading || !window.vlmReview?.getDownloadProgress) return;
    pollRef.current = setInterval(async () => {
      const p = await window.vlmReview!.getDownloadProgress();
      setProgress(p);
      if (p.status === "done" || p.status === "error") {
        setIsDownloading(false);
        void refresh();
      }
    }, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isDownloading, refresh]);

  const handleDownload = async () => {
    if (!window.vlmReview?.downloadModel) return;
    setIsDownloading(true);
    setProgress({ status: "downloading", percentage: 0 });
    try {
      await window.vlmReview!.downloadModel();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.vlmReview?.deleteModel) return;
    try {
      await window.vlmReview!.deleteModel();
      toast.success("模型已删除");
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleOpenCacheDir = async () => {
    const dir = probe?.modelDir;
    if (!dir || !window.electronAPI?.openPath) {
      toast.error("没有可打开的模型目录");
      return;
    }
    try {
      // modelDir points to model/vlm/<name>, open its parent (model/vlm/)
      const parentDir = dir.split("/").slice(0, -1).join("/");
      const result = await window.electronAPI.openPath(parentDir);
      if (!result.success) toast.error(result.error || "打开模型目录失败");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开模型目录失败");
    }
  };

  if (!hasBridge) {
    return (
      <div className={cn("px-5 py-4 text-sm text-muted-foreground", !embedded && "rounded-xl border border-border")}>
        VLM 视觉审核模型配置仅在桌面应用中可用。
      </div>
    );
  }

  const statusLabel = isReady ? "已就绪"
    : unsupported ? "不支持"
    : modelMissing ? "模型未下载"
    : probe?.status === "blocked" ? "已阻塞"
    : "未探测";
  const statusClass = isReady
    ? "border-success/30 bg-success/10 text-success"
    : unsupported || probe?.status === "blocked"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className="space-y-4 px-5 py-4" data-vlm-review-settings>
      {/* Status row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? <Check className="h-4 w-4 text-success" /> : <Zap className="h-4 w-4 text-muted-foreground" />}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">视觉审核运行时</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs", statusClass)} data-vlm-review-state={probe?.status ?? "unknown"}>
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={isProbing || isDownloading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isProbing && "animate-spin")} />
            探测
          </Button>
        </div>
      </div>

      {/* Model info */}
      <div className="grid gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">审核模型</span>
          <span className="font-medium">Qwen3-VL-8B-Instruct MLX 8-bit</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-muted-foreground">模型大小</span>
          <span>9.9 GB</span>
        </div>
      </div>

      {/* 缓存目录(沿超分同款 grid 布局:5rem label + 弹性路径 + 右侧按钮) */}
      <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
        <span className="text-xs text-muted-foreground">模型缓存目录</span>
        <Input
          readOnly
          value={probe?.modelDir ?? "~/Library/Application Support/漫影工作室/model/vlm/"}
          placeholder="…/model/vlm/"
          containerClassName="w-full min-w-0"
          className="min-w-0 font-mono text-xs truncate"
          data-vlm-model-dir
        />
        <div className="flex flex-nowrap gap-2 md:justify-end">
          <Button size="sm" variant="outline" onClick={() => void handleOpenCacheDir()} disabled={!probe?.modelDir}>
            <FolderOpen className="mr-1 h-4 w-4" aria-hidden />
            打开
          </Button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={modelMissing ? "default" : "outline"}
          onClick={() => void handleDownload()}
          disabled={isDownloading || isReady}
          data-vlm-download-button
        >
          {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {isDownloading ? "下载中…" : isReady ? "已下载" : "下载模型（9.9GB）"}
        </Button>
        {isReady ? (
          <Button size="sm" variant="outline" onClick={() => void handleDelete()} data-vlm-delete-button>
            <Trash2 className="mr-2 h-4 w-4" />
            删除模型
          </Button>
        ) : null}
      </div>

      {/* Download progress */}
      {isDownloading && progress?.status === "downloading" ? (
        <div className="space-y-1" data-vlm-download-progress>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress.percentage ?? 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {Math.round(progress.percentage ?? 0)}% · {progress.downloadedMB ?? 0} MB / {progress.totalMB ?? 9900} MB
          </p>
        </div>
      ) : null}

      {/* Unsupported platform */}
      {unsupported ? (
        <p className="text-xs text-destructive" role="alert">
          ⚠ {probe?.message ?? "此功能需要 Apple Silicon Mac(M 系列芯片)"}
        </p>
      ) : null}

      {/* Model missing hint */}
      {modelMissing ? (
        <p className="text-xs text-muted-foreground">
          模型未下载时,生图链自动跳过视觉审核(不阻塞生成)。下载后自动启用。
        </p>
      ) : null}
    </div>
  );
}
