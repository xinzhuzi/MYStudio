import { Check, Download, Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRemotionRuntimeSettings } from "./useRemotionRuntimeSettings";

const RENDERER_OPTIONS = [
  {
    id: "remotion" as const,
    title: "Remotion",
    description: "使用原生 Remotion Composition、Studio 与 renderMedia 生成分镜和章节视频。",
  },
];

export function RenderingSettingsTab() {
  const runtime = useRemotionRuntimeSettings();
  const statusLabel = runtime.isCheckingStatus
    ? "检查中"
    : runtime.verificationState === "error" || runtime.progress?.phase === "failed"
      ? "下载失败"
      : runtime.verificationState === "ready"
        ? "下载成功"
        : runtime.isLoading || runtime.progress?.phase === "downloading" || runtime.progress?.phase === "starting"
          ? "下载中"
          : "未下载";
  const downloadLabel = runtime.verificationState === "ready"
    ? "已下载"
    : runtime.verificationState === "error"
      ? "重新下载"
      : "下载";

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Film className="h-5 w-5" />
            渲染引擎
          </h3>
          <p className="text-sm text-muted-foreground mt-1">正式视频生产统一使用 Remotion；AI 物料先通过门禁，再由 Remotion 合成。</p>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-4" role="radiogroup" aria-label="时间线渲染器">
          <div className="space-y-1">
            <h4 className="font-medium text-foreground">全局渲染器</h4>
            <p className="text-xs text-muted-foreground">Remotion 是正式生产路径，不按项目复制工程或依赖。</p>
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
          <div>
            <h4 className="font-medium text-foreground">Remotion Headless Shell</h4>
            <p className="text-xs text-muted-foreground mt-1">导出前先下载官方浏览器运行时。</p>
          </div>

          {!runtime.runtimeAvailable ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 p-4">浏览器运行时设置仅在桌面版中可用。</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">下载状态</span>
                <span className="font-medium text-foreground">{statusLabel}</span>
              </div>
              <div className="flex flex-wrap gap-3" aria-live="polite">
                <Button onClick={() => void runtime.downloadBrowser()} disabled={!runtime.canDownload || runtime.isBusy}>
                  {runtime.isLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : runtime.verificationState === "ready"
                      ? <Check className="h-4 w-4" />
                      : <Download className="h-4 w-4" />}
                  {downloadLabel}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
