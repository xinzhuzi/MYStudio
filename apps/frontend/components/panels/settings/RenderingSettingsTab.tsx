import { Check, Download, Film, Loader2, RefreshCw, RotateCcw, Type, Wrench } from "lucide-react";
import { toast } from "sonner";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ma-shan-zheng/400.css";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRemotionRuntimeSettings } from "./useRemotionRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  DEFAULT_SUBTITLE_FONT_ID,
  SUBTITLE_FONT_IDS,
  SUBTITLE_FONT_STYLES,
  subtitleTextShadow,
} from "@/lib/studio/remotion/subtitle-fonts";

const SUBTITLE_FONT_SAMPLE_TEXT = "道劫风云，剑指苍穹。";

const SUBTITLE_FONT_OPTIONS = SUBTITLE_FONT_IDS.map((id) => ({
  id,
  title: SUBTITLE_FONT_STYLES[id].label,
  description: id === "ma-shan-zheng"
    ? "毛笔楷书，仙侠武侠片题字质感（默认）。"
    : id === "noto-serif-sc"
      ? "思源宋体，端正典雅的书卷气。"
      : "思源黑体，现代干净的阅读体。",
  style: SUBTITLE_FONT_STYLES[id],
}));

const RENDERER_OPTIONS = [
  {
    id: "remotion" as const,
    title: "Remotion",
    description: "使用原生 Remotion Composition、Studio 与 renderMedia 生成分镜和章节视频。",
  },
];

const PLUGIN_DEFINITIONS: Array<{ id: VideoWorkflowPluginId; title: string; description: string }> = [
  { id: "remotion", title: "Remotion", description: "正式的 Composition、Studio 与章节渲染路径。" },
  { id: "hyperframes", title: "HyperFrames", description: "时间线确认后的透明动效 overlay；无动效也会记录 no-op artifact。" },
  { id: "video-use", title: "video-use", description: "原文对齐、EDL、字幕时间、调色、preview 与自评。" },
  { id: "seedance-prompt", title: "Seedance Prompt Skill", description: "仅提供 Seedance 提示词能力，不进入视频执行门禁。" },
];

type RenderingSettingsTabProps = {
  embedded?: boolean;
};

export function RenderingSettingsTab({ embedded = false }: RenderingSettingsTabProps) {
  const runtime = useRemotionRuntimeSettings();
  const plugins = useVideoWorkflowPlugins();
  const workflowConfig = useStudioStore((state) => state.workflowConfig);
  const setWorkflowConfig = useStudioStore((state) => state.setWorkflowConfig);
  const selectedSubtitleFont = workflowConfig.subtitleFont ?? DEFAULT_SUBTITLE_FONT_ID;
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
  const content = (
    <div className="p-8 w-full space-y-8">
        {embedded ? null : (
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Film className="h-5 w-5" />
              视频工作流插件
            </h3>
            <p className="text-sm text-muted-foreground mt-1">在同一区域查看和管理 Remotion、HyperFrames、video-use 与 Seedance Prompt Skill；所有失败都在 UI 中阻塞并可重试。</p>
          </div>
        )}

        <div className={embedded ? "space-y-4" : "p-6 border border-border rounded-xl bg-card space-y-4"}>
          {/* 工作流说明 */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <h4 className="font-medium text-foreground">视频工作流运行说明</h4>
            <div className="space-y-1.5 text-xs leading-5 text-muted-foreground">
              <p><span className="font-medium text-foreground">共享运行时</span>：video-use 复用本地配置页已准备的 Python 3.12，HyperFrames 复用 Electron 内置 Node（无需额外下载），FFmpeg / ffprobe 由系统提供，所有插件共享同一组。</p>
              <p><span className="font-medium text-foreground">执行顺序</span>：video-use 先完成原文对齐、EDL 编辑、字幕时间轴、调色、预览渲染与自评；用户确认时间线后，准备 HyperFrames 生成透明动效 overlay（无动效也会写入 no-op 记录）；最后由 Remotion 负责正式 Composition 与章节视频渲染。</p>
              <p><span className="font-medium text-foreground">失败处理</span>：任一阶段失败都会阻塞后续流程并在 UI 中提示，可点击「准备」或「修复」重试，无需重启应用。</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-medium text-foreground">插件运行时</h4>
              <p className="text-xs text-muted-foreground mt-1">点击「准备当前工作流」一键准备所有插件，或单独准备某个插件。</p>
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
          <div className="space-y-4" aria-label="视频工作流插件状态">
            {/* 共享 FFmpeg/ffprobe 信息 */}
            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-medium text-foreground">FFmpeg / ffprobe</h4>
                <span className="text-xs text-muted-foreground">视频工作流共享</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">视频工作流的所有插件复用同一组 FFmpeg 与 ffprobe，不按项目独立安装。</p>
              {(() => {
                const videoUsePlugin = plugins.getPlugin("video-use");
                const ffmpeg = videoUsePlugin?.dependencies?.ffmpeg;
                const ffprobe = videoUsePlugin?.dependencies?.ffprobe;
                if (!ffmpeg && !ffprobe) return null;
                return (
                  <dl className="grid gap-1 text-[10px] text-muted-foreground">
                    {ffmpeg ? (
                      <div className="grid grid-cols-[5rem_1fr] gap-2">
                        <dt>ffmpeg</dt>
                        <dd className="truncate font-mono" title={ffmpeg}>{ffmpeg}</dd>
                      </div>
                    ) : null}
                    {ffprobe ? (
                      <div className="grid grid-cols-[5rem_1fr] gap-2">
                        <dt>ffprobe</dt>
                        <dd className="truncate font-mono" title={ffprobe}>{ffprobe}</dd>
                      </div>
                    ) : null}
                  </dl>
                );
              })()}
            </div>
            {PLUGIN_DEFINITIONS.map((definition) => {
              const plugin = plugins.getPlugin(definition.id);
              const deferred = plugin?.runtimeState === "deferred" || definition.id === "seedance-prompt";
              const updateAvailable = plugin?.runtimeState === "update-available";
              const busy = plugins.busyAction?.pluginId === definition.id;
              return (
                <article key={definition.id} aria-labelledby={`video-plugin-${definition.id}`} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 id={`video-plugin-${definition.id}`} className="font-medium text-foreground">{definition.title}</h4>
                    <span className="text-xs text-muted-foreground">{statusText(plugin)}</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{definition.description}</p>
                  {plugin?.message ? (
                    <p className={plugin.runtimeState === "error" || plugin.runtimeState === "blocked" || plugin.runtimeState === "needs-runtime" ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs text-muted-foreground"}>{plugin.message}</p>
                  ) : null}
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
                      {Object.entries(plugin.dependencies)
                        .filter(([key]) => key !== "ffmpeg" && key !== "ffprobe" && key !== "node")
                        .map(([key, value]) => value ? (
                        <div key={key} className="grid grid-cols-[5rem_1fr] gap-2">
                          <dt>{key}</dt>
                          <dd className="truncate" title={value}>{value}</dd>
                        </div>
                      ) : null)}
                    </dl>
                  ) : null}
                  {definition.id === "remotion" ? (
                    <div className="space-y-4 border-t border-border pt-4">
                      <div className="space-y-1">
                        <h5 className="font-medium text-foreground">全局渲染器</h5>
                        <p className="text-xs text-muted-foreground">Remotion 是正式生产路径，不按项目复制工程或依赖。</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="时间线渲染器">
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

                      <div className="space-y-1">
                        <h5 className="font-medium text-foreground flex items-center gap-2">
                          <Type className="h-4 w-4" aria-hidden="true" />
                          字幕字体
                        </h5>
                        <p className="text-xs text-muted-foreground">烧录字幕的字体；对新发起的分镜与章节渲染生效（缺省=毛笔楷书）。</p>
                        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="字幕字体">
                          {SUBTITLE_FONT_OPTIONS.map((option) => {
                            const selected = selectedSubtitleFont === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setWorkflowConfig({ subtitleFont: option.id })}
                                className={`rounded-xl border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-medium text-foreground">{option.title}</span>
                                  {selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                                </div>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</p>
                                {/* 样张=该字体成片输出的真实样式(同字体/字重/暖白/描边),缩放到卡片尺寸 */}
                                <div className="mt-3 flex justify-center overflow-hidden rounded-lg bg-black/80 px-3 py-2.5" aria-hidden="true">
                                  <span
                                    style={{
                                      fontFamily: option.style.fontFamily,
                                      fontWeight: option.style.fontWeight,
                                      fontSize: 24,
                                      lineHeight: 1.4,
                                      letterSpacing: option.style.letterSpacing,
                                      color: option.style.color,
                                      textShadow: subtitleTextShadow(2),
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {SUBTITLE_FONT_SAMPLE_TEXT}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h5 className="font-medium text-foreground">Remotion Headless Shell</h5>
                            <p className="text-xs text-muted-foreground mt-1">导出前先下载官方浏览器运行时。</p>
                          </div>
                          {!runtime.runtimeAvailable ? null : (
                            <div className="flex items-center gap-4 text-sm">
                              <span className="text-muted-foreground">下载状态</span>
                              <span className="font-medium text-foreground">{statusLabel}</span>
                              <Button size="sm" onClick={() => void runtime.downloadBrowser()} disabled={!runtime.canDownload || runtime.isBusy}>
                                {runtime.isLoading
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : runtime.verificationState === "ready"
                                    ? <Check className="h-4 w-4" />
                                    : <Download className="h-4 w-4" />}
                                {downloadLabel}
                              </Button>
                            </div>
                          )}
                        </div>

                        {!runtime.runtimeAvailable ? (
                          <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 p-4">浏览器运行时设置仅在桌面版中可用。</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={async () => {
                      const reply = await plugins.prepare(definition.id);
                      if (reply?.success) toast.success(`${definition.title} 准备完成`);
                      else if (reply && !reply.success) toast.error(`${definition.title} 准备失败: ${reply.message ?? "未知错误"}`);
                      else if (plugins.error) toast.error(`${definition.title} 准备失败: ${plugins.error}`);
                    }} disabled={deferred || plugins.isBusy || plugin?.runtimeState === "ready"}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                      {definition.id === "hyperframes" && plugin?.runtimeState === "needs-runtime" ? "下载并准备" : "准备"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const reply = await plugins.update(definition.id);
                      if (reply?.success) toast.success(`${definition.title} 更新完成`);
                      else if (reply && !reply.success) toast.error(`${definition.title} 更新失败: ${reply.message ?? "未知错误"}`);
                    }} disabled={deferred || !updateAvailable || plugins.isBusy}>
                      <RefreshCw className="h-4 w-4" /> 更新
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const reply = await plugins.repair(definition.id);
                      if (reply?.success) toast.success(`${definition.title} 修复完成`);
                      else if (reply && !reply.success) toast.error(`${definition.title} 修复失败: ${reply.message ?? "未知错误"}`);
                    }} disabled={deferred || plugins.isBusy || plugin?.runtimeState === "ready"}>
                      <Wrench className="h-4 w-4" /> 修复
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const reply = await plugins.rollback(definition.id);
                      if (reply?.success) toast.success(`${definition.title} 回滚完成`);
                      else if (reply && !reply.success) toast.error(`${definition.title} 回滚失败: ${reply.message ?? "未知错误"}`);
                    }} disabled={deferred || plugins.isBusy || plugin?.runtimeState === "ready"}>
                      <RotateCcw className="h-4 w-4" /> 回滚
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {plugins.error && <p className="text-sm text-destructive" role="alert">{plugins.error}</p>}
        </div>

    </div>
  );

  return embedded ? content : <ScrollArea className="h-full">{content}</ScrollArea>;
}
