"use client";

import {
  Check,
  Copy,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useImageGenRuntimeSettings } from "./useImageGenRuntimeSettings";

const copyPath = async (path: string) => {
  try {
    await navigator.clipboard.writeText(path);
    toast.success("路径已复制");
  } catch {
    toast.error("复制路径失败");
  }
};

type LocalImageSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 本地图片生成配置区块 — 设置 → 本地配置。
 *
 * 本地生图四引擎（08-31 起）：Krea2 Turbo（主力，场景优秀/人物有色彩偏差）+
 * FLUX.2 Klein 9B + Z-Image-Turbo + Qwen-Image-Edit 2511 共存，按模型行分派；
 * 大件指向 ComfyUI 现成文件零重下，首次点「补齐小件」获取官方小件。
 * OpenAI 兼容本地提供方暴露，可替代云端 API。模型显式获取；生成端点绝不自动下载。
 */
export function LocalImageSettingsSection({
  embedded = false,
}: LocalImageSettingsSectionProps) {
  const runtime = useImageGenRuntimeSettings();
  const status = runtime.status;
  const lifecycleState = runtime.lifecycleStatus?.state;
  const modelReady = runtime.hasLifecycleBridge
    ? lifecycleState === "ready"
    : (status?.models ?? []).some(
        (model) => model.downloaded && model.smallPiecesReady !== false,
      );
  const serverRunning = status?.running === true;
  const isReady = modelReady && serverRunning;
  const setupFailed =
    runtime.lifecycleError ||
    lifecycleState === "blocked" ||
    lifecycleState === "error" ||
    status?.setupStage === "failed";

  if (!runtime.hasRuntime) {
    return (
      <div
        className={cn(
          "px-5 py-4 text-sm text-muted-foreground",
          !embedded && "rounded-xl border border-border",
        )}
      >
        本地图片生成配置仅在桌面应用中可用。
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Server row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {modelReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span
            className={cn(
              "font-medium",
              serverRunning
                ? "text-success"
                : setupFailed && "text-destructive",
            )}
          >
            {serverRunning
              ? "本地生图服务运行中 (127.0.0.1:17595)"
              : setupFailed
                ? (runtime.lifecycleError ??
                  status?.setupMessage ??
                  "服务启动失败")
                : modelReady
                  ? "模型已就绪；本地服务未启动——点「准备运行时」拉起后即可生图"
                  : "运行时未准备（请先准备模型）"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {runtime.hasLifecycleBridge ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runtime.probeRuntime()}
              disabled={
                runtime.isProbing ||
                runtime.isSettingUp ||
                runtime.isRollingBack
              }
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-4 w-4",
                  runtime.isProbing && "animate-spin",
                )}
                aria-hidden
              />
              探测
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runtime.setupRuntime()}
            disabled={
              runtime.isSettingUp || runtime.isProbing || runtime.isRollingBack
            }
          >
            {runtime.isSettingUp ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ImageIcon className="mr-2 h-4 w-4" aria-hidden />
            )}
            {isReady ? "重新检查" : "准备运行时"}
          </Button>
          {runtime.hasLifecycleBridge ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runtime.rollbackRuntime()}
              disabled={
                !isReady ||
                runtime.isSettingUp ||
                runtime.isProbing ||
                runtime.isRollingBack
              }
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

      {runtime.lifecycleStatus?.message && !runtime.lifecycleError ? (
        <p className="text-xs text-muted-foreground">
          {runtime.lifecycleStatus.message}
        </p>
      ) : null}
      {/* 缓存目录(超分/VLM 同款 grid:label + 只读可选输入框 + 复制/打开按钮) */}
      {runtime.lifecycleStatus?.modelCacheDir ? (
        <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
          <span className="text-xs text-muted-foreground">模型缓存目录</span>
          <Input
            readOnly
            value={runtime.lifecycleStatus.modelCacheDir}
            containerClassName="w-full min-w-0"
            className="min-w-0 font-mono text-xs"
            data-imagegen-model-cache-dir
          />
          <div className="flex flex-nowrap gap-2 md:justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void copyPath(runtime.lifecycleStatus!.modelCacheDir!)
              }
            >
              <Copy className="mr-1 h-4 w-4" aria-hidden />
              复制
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void window.electronAPI?.openPath(
                  runtime.lifecycleStatus!.modelCacheDir!,
                );
              }}
            >
              <FolderOpen className="mr-1 h-4 w-4" aria-hidden />
              打开
            </Button>
          </div>
        </div>
      ) : null}

      {/* 分割模型组(09-04 无衣物节点):目录存在性探测,无下载按钮(小模型手动放置) */}
      {(status?.models ?? []).filter((model) => model.layout === "segmentation").length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">无衣物分割模型(「无衣物」节点双分割)</p>
          {(status?.models ?? []).filter((model) => model.layout === "segmentation").map((model) => (
            <div key={model.modelName} className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
              <span className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                model.downloaded ? "bg-success" : "bg-muted-foreground/40",
              )} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{model.modelName}</p>
                <p className="text-[11px] text-muted-foreground">{model.description}</p>
              </div>
              <span className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                model.downloaded ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
              )}>
                {model.downloaded ? "已就绪" : "未下载"}
              </span>
            </div>
          ))}
          {(status?.models ?? []).some((model) => model.layout === "segmentation" && !model.downloaded) ? (
            <p className="text-[11px] text-muted-foreground">
              下载方式:从 ComfyUI models 目录复制同名文件夹到模型缓存目录,或从 HuggingFace 下载(fashn-ai/fashn-human-parser)。详见 docs/krea2.md
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Model rows —— ComfyUI 桥是服务连接而非本地模型,状态展示移至「MCP 服务」tab */}
      {(status?.models ?? []).filter((model) => model.modelName !== "comfyui-bridge" && model.layout !== "segmentation").map((model) => {
        const downloading =
          status?.downloadStatus?.[model.modelName] === "downloading";
        const failed = status?.downloadStatus?.[model.modelName] === "error";
        const progress = downloading
          ? (status?.downloadProgress?.[model.modelName] ?? 0)
          : undefined;
        const pieceSize =
          model.modelName === "qwen-image-edit-2511" ? "300MB" : "400MB";
        const fullSizeByModel: Record<string, string> = {
          "krea2-turbo": "35GB",
          "flux2-klein-9b": "35GB",
          "z-image-turbo": "13.7GB",
          "qwen-image-edit-2511": "37GB",
        };
        const isBridge = model.modelName === "comfyui-bridge";
        const fullSize = fullSizeByModel[model.modelName] ?? "37GB";
        const pointedBigMissing =
          model.pointed === true &&
          !model.downloaded &&
          model.modelName !== "qwen-image-edit-2511";
        // 指向版三态:大件在+小件缺 → 「待补齐小件」;下载按钮语义同步切换
        const needsSmallPieces =
          model.downloaded && model.smallPiecesReady === false;
        const statusLabel = isBridge
          ? model.downloaded
            ? `已就绪（ComfyUI ${model.comfyuiVersion ?? "服务"}）`
            : "未就绪（需 ComfyUI 正在运行）"
          : needsSmallPieces
            ? `大件已就绪 · 待补齐小件(~${pieceSize})`
            : downloading
              ? "下载中"
              : model.downloaded
                ? model.bigFilesSource === "app-cache"
                  ? "已就绪（本地完整下载）"
                  : model.pointed
                    ? "已就绪（指向 ComfyUI 路径）"
                    : "已下载"
                : failed
                  ? "下载失败"
                  : pointedBigMissing
                    ? "未就绪（请先放入 ComfyUI 大件）"
                    : "未下载（可完整下载自足）";
        return (
          <div key={model.modelName} className="space-y-1.5">
            {model.pointedFiles?.length ? (
              <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                {model.pointedFiles.map((file) => (
                  <div key={file} className="flex items-start gap-1.5">
                    <p className="min-w-0 flex-1 select-text break-all font-mono text-[11px] leading-4 text-muted-foreground">
                      {file}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 p-0"
                      aria-label="复制路径"
                      title="复制路径"
                      onClick={() => void copyPath(file)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                {model.downloaded && !needsSmallPieces ? (
                  <Check className="h-4 w-4 text-success" aria-hidden />
                ) : (
                  <Download
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span
                  className={cn("font-medium", failed && "text-destructive")}
                  title={model.repoId}
                >
                  {model.label}
                  {model.downloaded && model.sizeMb != null
                    ? ` · ${(model.sizeMb / 1024).toFixed(1)} GB`
                    : ""}
                  {" — "}
                  {statusLabel}
                  {status?.activeModel === model.modelName ? " · 当前模型" : ""}
                </span>
              </div>
              <div className="flex gap-1.5">
                {model.downloaded && status?.activeModel !== model.modelName ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runtime.selectModel(model.modelName)}
                  >
                    设为当前
                  </Button>
                ) : null}
                {!isBridge ? (
                  <Button
                    size="sm"
                    onClick={() => void runtime.startDownload(model.modelName)}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <Loader2
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <Download className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    {downloading
                      ? "补齐中…"
                      : needsSmallPieces
                        ? `补齐小件(~${pieceSize})`
                        : model.downloaded
                          ? "重新下载小件"
                          : pointedBigMissing
                            ? "等待 ComfyUI 大件"
                            : `下载完整模型(~${fullSize})`}
                  </Button>
                ) : null}
              </div>
            </div>
            {downloading && progress !== undefined && (
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, progress))}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {Math.round(progress)}%
                </p>
              </div>
            )}
            {failed && status?.downloadError?.[model.modelName] ? (
              <p className="text-xs text-destructive">
                {status.downloadError[model.modelName]}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
