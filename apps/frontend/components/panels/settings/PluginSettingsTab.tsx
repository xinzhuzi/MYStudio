"use client";

import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { Plug } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { getTtsRuntimeStatus, startTtsRuntime } from "@/lib/tts/client";
import type { VideoWorkflowPluginId } from "@rendering/contracts/video-workflow";
import { usePythonRuntimeSettings } from "./usePythonRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import { PythonSettingsTab } from "./PythonSettingsTab";
import { DepthSettingsSection } from "./DepthSettingsSection";
import { LocalImageSettingsSection } from "./LocalImageSettingsSection";
import { UpscaleSettingsSection } from "./UpscaleSettingsSection";
import { LocalAudioSettingsSection } from "./LocalAudioSettingsSection";
import { RenderingSettingsTab } from "./RenderingSettingsTab";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((module) => ({
  default: module.LocalTtsPanel,
})));

/**
 * Unified local capability configuration. The order is intentional:
 * managed Python is the foundation; depth/music are local AI models
 * (explicit download, local inference); TTS and the video workflow plugins
 * are runtime services that consume those artifacts. Local image generation
 * remains an explicit opt-in provider and is surfaced below with the same
 * fail-closed lifecycle controls.
 */
export function PluginSettingsTab() {
  const python = usePythonRuntimeSettings();
  const videoPlugins = useVideoWorkflowPlugins();
  const [isPreparing, setIsPreparing] = useState(false);

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
                按依赖优先级配置本地能力：Python 运行环境 → TTS 运行时与模型 → 视频工作流插件（Remotion、HyperFrames、video-use、Seedance Prompt Skill）。
                不会自动下载未选择的声线模型。
              </p>
            </div>
            <Button onClick={() => void prepareByPriority()} disabled={isPreparing || !python.hasRuntime}>
              {isPreparing ? "按优先级准备中..." : "按优先级准备基础运行时"}
            </Button>
          </div>
        </header>

        <section aria-labelledby="plugin-python-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-python-heading" className="text-base font-semibold text-foreground">Python 运行环境</h4>
            <p className="text-xs text-muted-foreground">所有本地 TTS、video-use Python worker 和 MLX 对齐都复用应用管理的 Python。</p>
          </div>
          <PythonSettingsTab embedded />
        </section>

        <section aria-labelledby="plugin-depth-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-depth-heading" className="text-base font-semibold text-foreground">深度估计（电影级 3D）</h4>
            <p className="text-xs text-muted-foreground">静态图 → 3D 电影级纵深的深度模型（依赖上方 Python 运行环境）。准备、探测与回滚走统一生命周期；模型仅在用户点击下载时获取，渲染时绝不自动下载。</p>
          </div>
          <DepthSettingsSection embedded />
        </section>

        <section aria-labelledby="plugin-image-gen-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-image-gen-heading" className="text-base font-semibold text-foreground">本地图片生成（免费）</h4>
            <p className="text-xs text-muted-foreground">SDXL Turbo / FLUX.1-schnell 本地生图；准备、探测与回滚走统一生命周期，生成入口仍需在云端 AI 设置中显式选择「本地图片生成」。</p>
          </div>
          <LocalImageSettingsSection embedded />
        </section>

        <section aria-labelledby="plugin-upscale-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-upscale-heading" className="text-base font-semibold text-foreground">图片超分（1K → 4K）</h4>
            <p className="text-xs text-muted-foreground">本地 Real-ESRGAN 超分模型（依赖上方 Python 运行环境），把云端/本地生成的 1K 图原生放大 4 倍。模型仅在用户点击下载时获取，超分时绝不自动下载。</p>
          </div>
          <UpscaleSettingsSection embedded />
        </section>

        <section aria-labelledby="plugin-audio-gen-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-audio-gen-heading" className="text-base font-semibold text-foreground">本地音乐生成</h4>
            <p className="text-xs text-muted-foreground">MusicGen 本地 BGM 生成（约 2 GB）。生成的 WAV 可在工作台「章节共享音频」导入为 BGM 轨道；模型仅在点击下载时获取。</p>
          </div>
          <LocalAudioSettingsSection embedded />
        </section>

        <section aria-labelledby="plugin-tts-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-tts-heading" className="text-base font-semibold text-foreground">TTS 运行时与模型</h4>
            <p className="text-xs text-muted-foreground">先启动本地 TTS，再按需下载模型；模型缓存和音色 profile 继续由原 TTS 页面管理。</p>
          </div>
          <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载 TTS 配置中...</div>}>
            <LocalTtsPanelLazy embedded />
          </Suspense>
        </section>

        <section aria-labelledby="plugin-video-heading" className="rounded-xl border border-border bg-card/30">
          <div className="border-b border-border px-5 py-4 space-y-2">
            <h4 id="plugin-video-heading" className="text-base font-semibold text-foreground">视频工作流插件</h4>
            <p className="text-xs text-muted-foreground">video-use 先完成对齐、EDL、字幕时间、调色、preview 和自评；随后准备 HyperFrames overlay，Remotion 负责正式渲染。</p>
          </div>
          <RenderingSettingsTab embedded />
        </section>
      </div>
    </ScrollArea>
  );
}
