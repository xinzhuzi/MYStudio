import { Check, Download, Film, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRemotionRuntimeSettings } from "./useRemotionRuntimeSettings";

const RENDERER_OPTIONS = [
  {
    id: "remotion" as const,
    title: "Remotion",
    description: "使用固定 composition 与 Player 渲染时间线；高级效果会按能力矩阵路由到 FFmpeg。",
  },
  {
    id: "ffmpeg" as const,
    title: "FFmpeg",
    description: "使用现有 FFmpeg 时间线渲染器，适合需要高级滤镜的项目。",
  },
];

export function RenderingSettingsTab() {
  const runtime = useRemotionRuntimeSettings();
  const progressPercent = Math.round((runtime.progress?.ratio ?? 0) * 100);
  const statusLabel = runtime.isCheckingStatus
    ? "检查中"
    : runtime.status?.state === "ready"
      ? "已就绪"
      : runtime.status?.state === "update-required"
        ? "需要手动更新"
        : runtime.status?.state === "not-installed"
          ? "尚未安装"
          : runtime.status?.state === "error" || runtime.verificationState === "error"
            ? "检查失败"
            : "未检查";
  const validationLabel = runtime.verificationState === "ready"
    ? "可执行文件与缓存匹配"
    : runtime.verificationState === "needs-download"
      ? "需要安装或更新"
      : runtime.verificationState === "error"
        ? "无法验证"
        : "验证中";
  const downloadLabel = runtime.status?.state === "update-required"
    ? "手动更新"
    : runtime.verificationState === "error"
      ? "重试下载"
      : "下载 Headless Shell";

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Film className="h-5 w-5" />
            渲染引擎
          </h3>
          <p className="text-sm text-muted-foreground mt-1">统一控制剪辑台预览和最终时间线导出的渲染器。</p>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-4" role="radiogroup" aria-label="时间线渲染器">
          <div className="space-y-1">
            <h4 className="font-medium text-foreground">全局渲染器</h4>
            <p className="text-xs text-muted-foreground">选择会持久化到应用设置，不绑定单个项目。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {RENDERER_OPTIONS.map((option) => {
              const selected = runtime.renderer === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => runtime.selectRenderer(option.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{option.title}</span>
                    {selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-medium text-foreground">Remotion Headless Shell</h4>
              <p className="text-xs text-muted-foreground mt-1">导出前必须手动安装官方浏览器运行时；状态检查不会触发下载。</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="刷新浏览器状态" onClick={() => void runtime.refreshStatus()} disabled={!runtime.runtimeAvailable || runtime.isBusy}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {!runtime.runtimeAvailable ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 p-4">浏览器运行时设置仅在桌面版中可用。</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">当前状态</span>
                <span className="font-medium text-foreground">{statusLabel}</span>
              </div>
              {runtime.status?.remotionVersion && (
                <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                  <span>Remotion 版本</span>
                  <span className="font-mono">{runtime.status.remotionVersion}</span>
                </div>
              )}
              {runtime.status?.preparedForRemotionVersion && (
                <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                  <span>缓存准备版本</span>
                  <span className="font-mono">{runtime.status.preparedForRemotionVersion}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">可执行文件/缓存验证</span>
                <span className="font-medium text-foreground">{validationLabel}</span>
              </div>
              <p id="remotion-browser-verification" className="text-sm leading-6 text-muted-foreground" role="status" aria-live="polite">
                {runtime.verificationMessage}
              </p>
              {runtime.progress && runtime.progress.phase !== "completed" && (
                <div className="space-y-2" aria-live="polite">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{runtime.progress.phase === "downloading" ? "下载中" : runtime.progress.phase === "failed" ? "下载失败" : "准备中"}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} />
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void runtime.downloadBrowser()} disabled={!runtime.canDownload || runtime.isBusy} aria-describedby="remotion-browser-verification">
                  {runtime.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloadLabel}
                </Button>
                <Button variant="outline" onClick={() => void runtime.verifyBrowser()} disabled={runtime.isBusy}>
                  {runtime.isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  重新验证/修复
                </Button>
              </div>
              {runtime.error && <p className="text-sm text-destructive" role="alert">{runtime.error}</p>}
            </>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
