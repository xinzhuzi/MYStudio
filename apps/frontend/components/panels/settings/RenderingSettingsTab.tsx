import { Check, Download, Film, Loader2, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRemotionRuntimeSettings } from "./useRemotionRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";

const RENDERER_OPTIONS = [
  {
    id: "remotion" as const,
    title: "Remotion",
    description: "使用原生 Remotion Composition、Studio 与 renderMedia 生成分镜和章节视频。",
  },
];

export function RenderingSettingsTab() {
  const runtime = useRemotionRuntimeSettings();
  const plugins = useVideoWorkflowPlugins();
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
  const statusText = (plugin: VideoWorkflowPluginStatusV1 | undefined) => {
    switch (plugin?.runtimeState) {
      case "ready": return "已就绪";
      case "needs-runtime": return "需要准备运行时";
      case "update-available": return "有可用更新";
      case "blocked": return "已阻塞";
      case "error": return "检查失败";
      case "deferred": return "本轮暂缓";
      default: return "检查中";
    }
  };
  const pluginDefinitions: Array<{ id: VideoWorkflowPluginId; title: string; description: string }> = [
    { id: "remotion", title: "Remotion", description: "唯一正式 renderer：StoryboardShot、ChapterVideo 与 evidence。" },
    { id: "video-use", title: "video-use", description: "分镜完成后的原文对齐、EDL、字幕时间、调色、preview 与自评。" },
    { id: "hyperframes", title: "HyperFrames", description: "时间线确认后的透明动效 overlay；无动效也记录 no-op artifact。" },
    { id: "seedance-prompt", title: "Seedance Prompt Skill", description: "仅保留提示词能力来源，本轮不进入执行门禁。" },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Film className="h-5 w-5" />
            视频工作流插件
          </h3>
          <p className="text-sm text-muted-foreground mt-1">按“本地 TTS → 对齐 → video-use → HyperFrames → Remotion”准备当前章节；所有失败都在 UI 中阻塞并可重试。</p>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-medium text-foreground">插件运行时</h4>
              <p className="text-xs text-muted-foreground mt-1">复用应用 Python 3.12 与同一组 FFmpeg/ffprobe；HyperFrames 只使用应用级 Node 22。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void plugins.refresh()} disabled={plugins.isBusy}>
                <RefreshCw className="h-4 w-4" /> 刷新状态
              </Button>
              <Button size="sm" onClick={() => void plugins.prepareCurrentWorkflow()} disabled={plugins.isBusy || !plugins.status}>
                <Wrench className="h-4 w-4" /> 准备当前工作流
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2" aria-label="视频工作流插件状态">
            {pluginDefinitions.map((definition) => {
              const plugin = plugins.getPlugin(definition.id);
              const deferred = plugin?.runtimeState === "deferred" || definition.id === "seedance-prompt";
              const busy = plugins.busyAction?.pluginId === definition.id;
              return (
                <div key={definition.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{definition.title}</span>
                    <span className="text-xs text-muted-foreground">{statusText(plugin)}</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{definition.description}</p>
                  {plugin?.message && <p className="text-xs text-amber-600 dark:text-amber-400">{plugin.message}</p>}
                  {plugin ? (
                    <dl className="grid gap-1 text-[10px] text-muted-foreground">
                      {plugin.runtimePath ? (
                        <div className="grid grid-cols-[5rem_1fr] gap-2">
                          <dt>运行时路径</dt>
                          <dd className="truncate" title={plugin.runtimePath}>{plugin.runtimePath}</dd>
                        </div>
                      ) : null}
                      {plugin.profilePath ? (
                        <div className="grid grid-cols-[5rem_1fr] gap-2">
                          <dt>Profile</dt>
                          <dd className="truncate" title={plugin.profilePath}>{plugin.profilePath}</dd>
                        </div>
                      ) : null}
                      {Object.entries(plugin.dependencies).map(([key, value]) => value ? (
                        <div key={key} className="grid grid-cols-[5rem_1fr] gap-2">
                          <dt>{key}</dt>
                          <dd className="truncate" title={value}>{value}</dd>
                        </div>
                      ) : null)}
                    </dl>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void plugins.prepare(definition.id)} disabled={deferred || plugins.isBusy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} 准备
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void plugins.repair(definition.id)} disabled={deferred || plugins.isBusy}>
                      <Wrench className="h-4 w-4" /> 修复
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void plugins.rollback(definition.id)} disabled={deferred || plugins.isBusy}>
                      <RotateCcw className="h-4 w-4" /> 回滚
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {plugins.error && <p className="text-sm text-destructive" role="alert">{plugins.error}</p>}
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
