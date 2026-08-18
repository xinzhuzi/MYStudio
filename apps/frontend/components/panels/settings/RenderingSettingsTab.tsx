import { Check, ChevronDown, Download, Film, Loader2, Plus, RefreshCw, RotateCcw, Type, Wrench } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import "@fontsource/noto-sans-sc/900.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/ma-shan-zheng/400.css";
import "@fontsource/zhi-mang-xing/400.css";
import "@fontsource/long-cang/400.css";
import "@fontsource/liu-jian-mao-cao/400.css";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRemotionRuntimeSettings } from "./useRemotionRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  DEFAULT_SUBTITLE_FONT_ID,
  SUBTITLE_FONT_CATEGORIES,
  SUBTITLE_FONT_CATEGORY_LABELS,
  SUBTITLE_FONT_IDS,
  SUBTITLE_FONT_STYLES,
  resolveSubtitleFontStyle,
  subtitleTextShadow,
} from "@/lib/studio/remotion/subtitle-fonts";

const SUBTITLE_FONT_SAMPLE_TEXT = "道劫风云，剑指苍穹。";

/** 字体选项卡：内置与自定义共用，样式经注册表统一解析（含 custom:*）。 */
function FontOptionCard(props: { id: string; selected: boolean; onSelect: () => void }) {
  const style = resolveSubtitleFontStyle(props.id);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${props.selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">{style.label}</span>
        {props.selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{style.description}</p>
      {/* 样张=该字体成片输出的真实样式(同字体/字重/暖白/描边),缩放到卡片尺寸 */}
      <div className="mt-3 flex justify-center overflow-hidden rounded-lg bg-black/80 px-3 py-2.5" aria-hidden="true">
        <span
          style={{
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize: 24,
            lineHeight: 1.4,
            letterSpacing: style.letterSpacing,
            color: style.color,
            textShadow: subtitleTextShadow(2),
            whiteSpace: "nowrap",
          }}
        >
          {SUBTITLE_FONT_SAMPLE_TEXT}
        </span>
      </div>
    </button>
  );
}

/** 折叠状态记忆键：值为被折叠模块 id 数组；无记忆时默认全折叠（08-18 用户拍板）。 */
const COLLAPSE_STORAGE_KEY = "mystudio.settings.rendering.collapsedModules";

function readCollapsedModules(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    // null = 从未手动折叠过 → 全折叠起步；有记忆则完全按用户的显式选择。
    if (raw === null) return new Set(ALL_MODULE_IDS);
    const ids = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(ids) ? ids.map(String) : ALL_MODULE_IDS);
  } catch {
    return new Set(ALL_MODULE_IDS);
  }
}

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
  { id: "video-use", title: "video-use", description: "原文对齐、EDL、字幕时间轴、调色、preview 与自评。" },
  { id: "seedance-prompt", title: "Seedance Prompt Skill", description: "仅提供 Seedance 提示词能力，不进入视频执行门禁。" },
];

const ALL_MODULE_IDS = ["ffmpeg-shared", ...PLUGIN_DEFINITIONS.map((definition) => `plugin-${definition.id}`)];

type RenderingSettingsTabProps = {
  embedded?: boolean;
};

export function RenderingSettingsTab({ embedded = false }: RenderingSettingsTabProps) {
  const runtime = useRemotionRuntimeSettings();
  const plugins = useVideoWorkflowPlugins();
  const workflowConfig = useStudioStore((state) => state.workflowConfig);
  const setWorkflowConfig = useStudioStore((state) => state.setWorkflowConfig);
  const selectedSubtitleFont = workflowConfig.subtitleFont ?? DEFAULT_SUBTITLE_FONT_ID;
  // 自定义字体：主进程 <userData>/SubtitleFonts 管理，UI 侧 FontFace 挂样张。
  const [customFonts, setCustomFonts] = React.useState<Array<{ id: string; label: string; family: string; fileName: string; sizeBytes: number }>>([]);
  const [importingFont, setImportingFont] = React.useState(false);
  const refreshCustomFonts = React.useCallback(async () => {
    try {
      const list = await window.subtitleFonts?.list();
      if (Array.isArray(list)) setCustomFonts(list);
    } catch {
      // 桥未接入（测试环境）保持空列表
    }
  }, []);
  React.useEffect(() => { void refreshCustomFonts(); }, [refreshCustomFonts]);
  const ensureCustomFontFace = React.useCallback(async (fontId: string, family: string) => {
    if (document.fonts.check(`400 24px "${family}"`)) return;
    try {
      const reply = await window.subtitleFonts?.read(fontId);
      if (!reply?.success || !reply.data) return;
      const loaded = new FontFace(family, reply.data);
      await loaded.load();
      document.fonts.add(loaded);
    } catch {
      // 读取/加载失败：样张回退系统楷体，不阻塞设置页
    }
  }, []);
  React.useEffect(() => {
    for (const font of customFonts) void ensureCustomFontFace(font.id, font.family);
  }, [customFonts, ensureCustomFontFace]);
  const importCustomFont = async () => {
    setImportingFont(true);
    try {
      const reply = await window.subtitleFonts?.import();
      if (!reply) throw new Error("当前环境未接入字体导入");
      if (!reply.success) {
        if (reply.code !== "canceled") toast.error(`导入失败: ${reply.message ?? reply.code}`);
        return;
      }
      await refreshCustomFonts();
      toast.success(`已导入「${reply.font.label}」，选择后对新发起的渲染生效`);
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportingFont(false);
    }
  };
  // 模块折叠：默认全折叠（08-18 用户改拍板），手动展开/折叠后 localStorage 记忆。
  const [collapsedModules, setCollapsedModules] = React.useState<Set<string>>(() => readCollapsedModules());
  const toggleModuleCollapsed = (moduleId: string) => {
    setCollapsedModules((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // 记忆失败不影响本轮交互
      }
      return next;
    });
  };
  const moduleChevron = (moduleId: string) => (
    <ChevronDown
      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsedModules.has(moduleId) ? "-rotate-90" : ""}`}
      aria-hidden="true"
    />
  );
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
            <Collapsible
              open={!collapsedModules.has("ffmpeg-shared")}
              onOpenChange={() => toggleModuleCollapsed("ffmpeg-shared")}
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-3">
                  <h4 className="font-medium text-foreground">FFmpeg / ffprobe</h4>
                  <span className="text-xs text-muted-foreground">视频工作流共享</span>
                </div>
                {moduleChevron("ffmpeg-shared")}
              </CollapsibleTrigger>
              <CollapsibleContent>
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
              </CollapsibleContent>
            </Collapsible>
            {PLUGIN_DEFINITIONS.map((definition) => {
              const plugin = plugins.getPlugin(definition.id);
              const deferred = plugin?.runtimeState === "deferred" || definition.id === "seedance-prompt";
              const updateAvailable = plugin?.runtimeState === "update-available";
              const busy = plugins.busyAction?.pluginId === definition.id;
              const open = !collapsedModules.has(`plugin-${definition.id}`);
              return (
                <Collapsible
                  key={definition.id}
                  open={open}
                  onOpenChange={() => toggleModuleCollapsed(`plugin-${definition.id}`)}
                  className="rounded-lg border border-border p-4 space-y-3"
                  aria-labelledby={`video-plugin-${definition.id}`}
                >
                  <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 text-left">
                    <h4 id={`video-plugin-${definition.id}`} className="font-medium text-foreground">{definition.title}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{statusText(plugin)}</span>
                      {moduleChevron(`plugin-${definition.id}`)}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
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
                        <p className="text-xs text-muted-foreground">烧录字幕的字体，按风格分组；对新发起的分镜与章节渲染生效（缺省=毛笔楷书）。</p>
                        {SUBTITLE_FONT_CATEGORIES.filter((category) => category !== "custom").map((category) => (
                          <div key={category} className="space-y-2 pt-2">
                            <h6 className="text-xs font-medium text-muted-foreground">{SUBTITLE_FONT_CATEGORY_LABELS[category]}</h6>
                            <div
                              className="grid gap-3 md:grid-cols-3"
                              role="radiogroup"
                              aria-label={`字幕字体：${SUBTITLE_FONT_CATEGORY_LABELS[category]}`}
                            >
                              {SUBTITLE_FONT_IDS
                                .filter((id) => SUBTITLE_FONT_STYLES[id].category === category)
                                .map((id) => (
                                  <FontOptionCard
                                    key={id}
                                    id={id}
                                    selected={selectedSubtitleFont === id}
                                    onSelect={() => setWorkflowConfig({ subtitleFont: id })}
                                  />
                                ))}
                            </div>
                          </div>
                        ))}
                        <div className="space-y-2 pt-2">
                          <h6 className="text-xs font-medium text-muted-foreground">{SUBTITLE_FONT_CATEGORY_LABELS.custom}</h6>
                          {customFonts.length === 0 ? (
                            <p className="text-xs text-muted-foreground">尚未导入自定义字体；导入后可用于烧录字幕。</p>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="字幕字体：自定义">
                              {customFonts.map((font) => (
                                <div key={font.id} className="relative">
                                  <FontOptionCard
                                    id={font.id}
                                    selected={selectedSubtitleFont === font.id}
                                    onSelect={() => setWorkflowConfig({ subtitleFont: font.id })}
                                  />
                                  <button
                                    type="button"
                                    aria-label={`删除字体 ${font.label}`}
                                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    onClick={async () => {
                                      const reply = await window.subtitleFonts?.delete(font.id);
                                      if (reply?.success) {
                                        toast.success(`已删除「${font.label}」`);
                                        if (selectedSubtitleFont === font.id) setWorkflowConfig({ subtitleFont: DEFAULT_SUBTITLE_FONT_ID });
                                        await refreshCustomFonts();
                                      } else {
                                        toast.error(`删除失败: ${reply?.message ?? "未知错误"}`);
                                      }
                                    }}
                                  >
                                    <span className="text-xs">删除</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="pt-1">
                            <Button variant="outline" size="sm" onClick={() => void importCustomFont()} disabled={importingFont}>
                              {importingFont ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                              导入自定义字体（.ttf / .otf / .woff2，≤20MB）
                            </Button>
                          </div>
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
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
          {plugins.error && <p className="text-sm text-destructive" role="alert">{plugins.error}</p>}
        </div>

    </div>
  );

  return embedded ? content : <ScrollArea className="h-full">{content}</ScrollArea>;
}
