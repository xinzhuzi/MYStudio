"use client";

import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plug } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getTtsRuntimeStatus, startTtsRuntime } from "@/lib/tts/client";
import type { VideoWorkflowPluginId } from "@rendering/contracts/video-workflow";
import { usePythonRuntimeSettings } from "./usePythonRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import { PythonSettingsTab } from "./PythonSettingsTab";
import { DepthSettingsSection } from "./DepthSettingsSection";
import { LocalImageSettingsSection } from "./LocalImageSettingsSection";
import { UpscaleSettingsSection } from "./UpscaleSettingsSection";
import { VlmReviewSettingsSection } from "./VlmReviewSettingsSection";
import { VideoQcSettingsSection } from "./VideoQcSettingsSection";
import { LocalAudioSettingsSection } from "./LocalAudioSettingsSection";
import { SfxGenSettingsSection } from "./SfxGenSettingsSection";
import { RenderingSettingsTab } from "./RenderingSettingsTab";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((module) => ({
  default: module.LocalTtsPanel,
})));

/** 大区块折叠记忆键：值为被折叠区块 id 数组；无记忆时默认全折叠（08-18 用户拍板）。 */
const SECTION_STORAGE_KEY = "mystudio.settings.plugins.collapsedSections";

const SECTION_IDS = ["python", "depth", "image-gen", "upscale", "vlm-review", "video-qc", "audio", "video"] as const;

type SectionId = (typeof SECTION_IDS)[number];

function readCollapsedSections(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SECTION_STORAGE_KEY);
    // null = 从未手动折叠过 → 全折叠起步；有记忆则完全按用户的显式选择。
    if (raw === null) return new Set<string>(SECTION_IDS);
    const ids = JSON.parse(raw) as unknown;
    return new Set<string>(Array.isArray(ids) ? ids.map(String) : SECTION_IDS);
  } catch {
    return new Set<string>(SECTION_IDS);
  }
}

/**
 * Unified local capability configuration. The order is intentional:
 * managed Python is the foundation; depth/music are local AI models
 * (explicit download, local inference); TTS and the video workflow plugins
 * are runtime services that consume those artifacts. Local image generation
 * remains an explicit opt-in provider and is surfaced below with the same
 * fail-closed lifecycle controls. Every section folds; the collapsed header
 * keeps the title and one-line description visible.
 */
export function PluginSettingsTab() {
  const python = usePythonRuntimeSettings();
  const videoPlugins = useVideoWorkflowPlugins();
  const [isPreparing, setIsPreparing] = useState(false);
  // 大区块折叠：默认全折叠（08-18 用户拍板），手动展开/折叠后 localStorage 记忆。
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => readCollapsedSections());
  const toggleSectionCollapsed = (sectionId: SectionId) => {
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      try {
        window.localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // 记忆失败不影响本轮交互
      }
      return next;
    });
  };
  const sectionChevron = (sectionId: SectionId) => (
    <ChevronDown
      className={`h-4 w-4 shrink-0 mt-1 text-muted-foreground transition-transform ${collapsedSections.has(sectionId) ? "-rotate-90" : ""}`}
      aria-hidden="true"
    />
  );

  const prepareByPriority = async () => {
    if (!python.hasRuntime) {
      toast.error("当前环境不支持本地配置");
      return;
    }

    setIsPreparing(true);
    try {
      // 1. Refresh plugin status first for accurate detection
      await videoPlugins.refresh();

      // 2. Cal readiness signals
      const pythonReady = python.installedItems?.length > 0 && !python.installedItems.some((item) => item.status === "failed");
      const ttsStatus = await getTtsRuntimeStatus();
      const ttsReady = ttsStatus.running && ttsStatus.setupStage === "ready";

      const VIDEO_GATE_PLUGIN_IDS: VideoWorkflowPluginId[] = ["video-use", "remotion", "hyperframes"];
      const videoReady = VIDEO_GATE_PLUGIN_IDS.every((id) => videoPlugins.getPlugin(id)?.runtimeState === "ready");

      // 3. All ready → skip all, report success
      if (pythonReady && ttsReady && videoReady) {
        toast.success("所有依赖已就绪，无需重新配置");
        return;
      }

      // 4. Per-layer config (only for unready layers)
      const reports: string[] = [];

      // Python layer
      if (!pythonReady) {
        await python.setupRuntime();
        reports.push("Python 运行环境（已就绪）");
      } else {
        reports.push("Python 运行环境（已就绪）");
      }

      // TTS layer
      if (!ttsReady) {
        if (!ttsStatus.running) {
          const started = await startTtsRuntime();
          if (!started.success) {
            toast.error(started.error || "本地 TTS 后端启动失败");
            return;
          }
        }
        reports.push("TTS 运行时与模型（已就绪）");
      } else {
        reports.push("TTS 运行时与模型（已就绪）");
      }

      // Video layer
      if (!videoReady) {
        const result = await videoPlugins.prepareCurrentWorkflow();
        if (!result?.success) {
          toast.error(videoPlugins.error || "视频工作流插件准备失败");
          return;
        }
        reports.push("视频工作流插件（已就绪）");
      }

      // 5. Summary toast with per-layer results
      toast.success(`配置完成：${reports.join(", ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "本地配置准备失败");
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full max-w-[1600px] mx-auto space-y-6">
        <header className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Plug className="h-5 w-5 text-primary" />
                本地配置
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                按依赖优先级配置本地能力：Python 运行环境 → 声音（TTS 声线、本地音乐与音效）→ 视频工作流插件（Remotion、HyperFrames、video-use、Seedance Prompt Skill）。
                不会自动下载未选择的声线模型。
              </p>
            </div>
            <Button onClick={() => void prepareByPriority()} disabled={isPreparing || !python.hasRuntime}>
              {isPreparing ? "按优先级准备中..." : "按优先级准备基础运行时"}
            </Button>
          </div>
        </header>

        <section aria-labelledby="plugin-python-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("python")} onOpenChange={() => toggleSectionCollapsed("python")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-python-heading" className="text-base font-semibold text-foreground">Python 运行环境</h4>
                  <p className="text-xs text-muted-foreground">所有本地 TTS、video-use Python worker 和 MLX 对齐都复用应用管理的 Python。</p>
                </div>
                {sectionChevron("python")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <PythonSettingsTab embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-depth-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("depth")} onOpenChange={() => toggleSectionCollapsed("depth")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-depth-heading" className="text-base font-semibold text-foreground">深度估计（电影级 3D）</h4>
                  <p className="text-xs text-muted-foreground">静态图 → 3D 电影级纵深的深度模型（依赖上方 Python 运行环境）。准备、探测与回滚走统一生命周期；模型仅在用户点击下载时获取，渲染时绝不自动下载。</p>
                </div>
                {sectionChevron("depth")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <DepthSettingsSection embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-image-gen-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("image-gen")} onOpenChange={() => toggleSectionCollapsed("image-gen")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-image-gen-heading" className="text-base font-semibold text-foreground">本地图片生成（免费）</h4>
                  <p className="text-xs text-muted-foreground">SDXL Turbo / FLUX.1-schnell 本地生图；准备、探测与回滚走统一生命周期，生成入口仍需在云端 AI 设置中显式选择「本地图片生成」。</p>
                </div>
                {sectionChevron("image-gen")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <LocalImageSettingsSection embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-upscale-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("upscale")} onOpenChange={() => toggleSectionCollapsed("upscale")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-upscale-heading" className="text-base font-semibold text-foreground">图片超分（1K → 4K）</h4>
                  <p className="text-xs text-muted-foreground">本地 Real-ESRGAN 超分模型（依赖上方 Python 运行环境），把云端/本地生成的 1K 图原生放大 4 倍。模型仅在用户点击下载时获取，超分时绝不自动下载。</p>
                </div>
                {sectionChevron("upscale")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <UpscaleSettingsSection embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-vlm-review-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("vlm-review")} onOpenChange={() => toggleSectionCollapsed("vlm-review")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-vlm-review-heading" className="text-base font-semibold text-foreground">视觉审核（VLM 一致性检查）</h4>
                  <p className="text-xs text-muted-foreground">本地 Qwen3-VL 视觉模型,自动比对生成的分镜图与资产参考图,判断角色/服装/场景是否一致(依赖上方 Python 运行环境)。模型仅在用户点击下载时获取,审核时绝不自动下载。</p>
                </div>
                {sectionChevron("vlm-review")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <VlmReviewSettingsSection embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-video-qc-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("video-qc")} onOpenChange={() => toggleSectionCollapsed("video-qc")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-video-qc-heading" className="text-base font-semibold text-foreground">成片观感评分</h4>
                  <p className="text-xs text-muted-foreground">DOVER-Mobile 本地观感模型（依赖上方 Python 运行环境），出片后 QC 链的观感层按系列基线相对告警。模型仅在点击下载时获取；未下载时该层自动跳过，不影响出片。</p>
                </div>
                {sectionChevron("video-qc")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <VideoQcSettingsSection embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-audio-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("audio")} onOpenChange={() => toggleSectionCollapsed("audio")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-audio-heading" className="text-base font-semibold text-foreground">声音（TTS · 音乐 · 音效）</h4>
                  <p className="text-xs text-muted-foreground">本地 TTS 声线、MusicGen BGM 与短音效生成统一在此管理；音乐与音效共用模型缓存，模型仅在点击下载时获取。</p>
                </div>
                {sectionChevron("audio")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <div className="divide-y divide-border">
                <section aria-labelledby="plugin-audio-tts-heading">
                  <div className="px-5 pt-4 pb-1">
                    <h5 id="plugin-audio-tts-heading" className="text-sm font-semibold text-foreground">TTS 运行时与模型</h5>
                    <p className="text-xs text-muted-foreground">先启动本地 TTS，再按需下载模型；模型缓存和音色 profile 继续由原 TTS 页面管理。</p>
                  </div>
                  <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载 TTS 配置中...</div>}>
                    <LocalTtsPanelLazy embedded />
                  </Suspense>
                </section>
                <section aria-labelledby="plugin-audio-music-heading">
                  <div className="px-5 pt-4 pb-1">
                    <h5 id="plugin-audio-music-heading" className="text-sm font-semibold text-foreground">本地音乐生成</h5>
                    <p className="text-xs text-muted-foreground">MiniMax-Music3 整曲生成（默认，约 12 GB）+ MusicGen 轻量备选；生成的音频可在工作台「章节共享音频」导入为 BGM 轨道。</p>
                  </div>
                  <LocalAudioSettingsSection embedded />
                </section>
                <section aria-labelledby="plugin-audio-sfx-heading">
                  <div className="px-5 pt-4 pb-1">
                    <h5 id="plugin-audio-sfx-heading" className="text-sm font-semibold text-foreground">本地音效生成</h5>
                    <p className="text-xs text-muted-foreground">短音效 one-shot 本地生成（≤5 秒，同提示词+同种子=同文件）；与本地音乐生成共用模型缓存，供 sfx 绑定选用；模型仅在点击下载时获取。</p>
                  </div>
                  <SfxGenSettingsSection embedded />
                </section>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section aria-labelledby="plugin-video-heading" className="rounded-xl border border-border bg-card/30">
          <Collapsible open={!collapsedSections.has("video")} onOpenChange={() => toggleSectionCollapsed("video")}>
            <CollapsibleTrigger className="w-full text-left">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <h4 id="plugin-video-heading" className="text-base font-semibold text-foreground">视频工作流插件</h4>
                  <p className="text-xs text-muted-foreground">video-use 先完成对齐、EDL、字幕时间、调色、preview 和自评；随后准备 HyperFrames overlay，Remotion 负责正式渲染。</p>
                </div>
                {sectionChevron("video")}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <RenderingSettingsTab embedded />
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>
    </ScrollArea>
  );
}
