"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  Clapperboard,
  Gauge,
  Image as ImageIcon,
  Layers,
  Music2,
  Plug,
  ScanEye,
  Terminal,
  ZoomIn,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { getTtsRuntimeStatus, startTtsRuntime } from "@/lib/tts/client";
import type { VideoWorkflowPluginId } from "@rendering/contracts/video-workflow";
import type { VlmReviewProbeResult } from "@/types/contracts/vlm-review-workflow";
import { usePythonRuntimeSettings } from "./usePythonRuntimeSettings";
import { useVideoWorkflowPlugins } from "./useVideoWorkflowPlugins";
import { useDepthRuntimeSettings } from "./useDepthRuntimeSettings";
import { useImageGenRuntimeSettings } from "./useImageGenRuntimeSettings";
import { useUpscaleRuntimeSettings } from "./useUpscaleRuntimeSettings";
import { useMusic3GenRuntimeSettings } from "./useMusic3GenRuntimeSettings";
import { useSfxGenRuntimeSettings } from "./useSfxGenRuntimeSettings";
import { useVideoQcRuntimeSettings } from "./useVideoQcRuntimeSettings";
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

/** 区块行折叠记忆键：值为被折叠行 id 数组；无记忆时默认全折叠（08-18 用户拍板）。 */
const SECTION_STORAGE_KEY = "mystudio.settings.plugins.collapsedSections";

const SECTION_IDS = [
  "python",
  "depth",
  "image-gen",
  "upscale",
  "vlm-review",
  "video-qc",
  "audio-tts",
  "audio-music",
  "audio-sfx",
  "video",
] as const;

type SectionId = (typeof SECTION_IDS)[number];

/** 旧「声音」整卡折叠记忆 → 拆平后的三行继承(08-28 布局重做)。 */
const LEGACY_COLLAPSED_MIGRATIONS: Record<string, readonly SectionId[]> = {
  audio: ["audio-tts", "audio-music", "audio-sfx"],
};

function readCollapsedSections(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SECTION_STORAGE_KEY);
    // null = 从未手动折叠过 → 全折叠起步；有记忆则完全按用户的显式选择。
    if (raw === null) return new Set<string>(SECTION_IDS);
    const parsed = JSON.parse(raw) as unknown;
    const stored = Array.isArray(parsed) ? parsed.map(String) : [...SECTION_IDS];
    const migrated = new Set<string>();
    for (const id of stored) {
      const expansion = LEGACY_COLLAPSED_MIGRATIONS[id];
      if (expansion) expansion.forEach((expanded) => migrated.add(expanded));
      else migrated.add(id);
    }
    return migrated;
  } catch {
    return new Set<string>(SECTION_IDS);
  }
}

const VIDEO_GATE_PLUGIN_IDS: VideoWorkflowPluginId[] = ["video-use", "remotion", "hyperframes"];

type CapabilityPillKind =
  | "checking"
  | "unsupported"
  | "ready"
  | "model-missing"
  | "needs-runtime"
  | "preparing"
  | "downloading"
  | "update"
  | "error"
  | "blocked";

const PILL_LABELS: Record<CapabilityPillKind, string> = {
  checking: "检查中",
  unsupported: "不支持",
  ready: "已就绪",
  "model-missing": "未下载",
  "needs-runtime": "需准备",
  preparing: "配置中",
  downloading: "下载中",
  update: "可更新",
  error: "检查失败",
  blocked: "已阻塞",
};

const PILL_STYLES: Record<CapabilityPillKind, string> = {
  checking: "border-border bg-muted/60 text-muted-foreground",
  unsupported: "border-border bg-muted/60 text-muted-foreground",
  "model-missing": "border-border bg-muted/60 text-muted-foreground",
  ready: "border-success/30 bg-success/10 text-success",
  "needs-runtime": "border-warning/30 bg-warning/10 text-warning",
  preparing: "border-warning/30 bg-warning/10 text-warning",
  downloading: "border-warning/30 bg-warning/10 text-warning",
  update: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
};

type CapabilityRowProps = {
  sectionId: SectionId;
  headingId: string;
  icon: LucideIcon;
  title: string;
  description: string;
  pill: CapabilityPillKind;
  collapsed: boolean;
  onToggle: (sectionId: SectionId) => void;
  children: React.ReactNode;
};

function CapabilityRow({
  sectionId,
  headingId,
  icon: Icon,
  title,
  description,
  pill,
  collapsed,
  onToggle,
  children,
}: CapabilityRowProps) {
  return (
    <Collapsible open={!collapsed} onOpenChange={() => onToggle(sectionId)}>
      <CollapsibleTrigger className="w-full text-left">
        <div className="flex items-center gap-3 px-4 py-3">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h4 id={headingId} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h4>
          <span
            className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", PILL_STYLES[pill])}
            data-capability-pill={pill}
          >
            {PILL_LABELS[pill]}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        <p className="px-5 pt-4 text-xs leading-5 text-muted-foreground">{description}</p>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

type CapabilityGroupProps = {
  label: string;
  children: React.ReactNode;
};

function CapabilityGroup({ label, children }: CapabilityGroupProps) {
  return (
    <section aria-label={label} className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border/80 bg-card/70">
        {children}
      </div>
    </section>
  );
}

/**
 * 统一的本地能力配置页。四个分组按依赖顺序排列:基础运行时(Python 是地基)
 * → 图像能力(视觉模型都跑在 Python 上)→ 声音 → 视频生产插件。
 *
 * 行级状态胶囊只做挂载期一次性探测,并在折叠行/一键准备后重探,不做常驻
 * 轮询——下载进度等实时状态仍由各区块展开内容自行展示。模型下载政策不变:
 * 仅在用户点击下载时获取,绝不自动下载。
 */
export function PluginSettingsTab() {
  const python = usePythonRuntimeSettings();
  const videoPlugins = useVideoWorkflowPlugins();
  const depth = useDepthRuntimeSettings();
  const imageGen = useImageGenRuntimeSettings();
  const upscale = useUpscaleRuntimeSettings();
  const music = useMusic3GenRuntimeSettings();
  const sfx = useSfxGenRuntimeSettings();
  const videoQc = useVideoQcRuntimeSettings();
  const [vlmProbe, setVlmProbe] = useState<VlmReviewProbeResult | null>(null);
  const [ttsRunning, setTtsRunning] = useState<{ running: boolean; setupStage?: string } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  // 区块行折叠:默认全折叠(08-18 用户拍板),手动展开/折叠后 localStorage 记忆。
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => readCollapsedSections());

  const refreshRowStatuses = () => {
    void depth.probeRuntime();
    void imageGen.probeRuntime();
    void upscale.probeRuntime();
    void music.refreshStatus();
    void videoQc.refresh();
    if (typeof window !== "undefined" && window.vlmReview?.probe) {
      window.vlmReview.probe().then(setVlmProbe).catch(() => undefined);
    }
    getTtsRuntimeStatus().then(setTtsRunning).catch(() => undefined);
  };

  useEffect(() => {
    refreshRowStatuses();
    // 一次性挂载探测;各探测函数均为 hook 内稳定引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // 展开或收起都重探行级状态,吸收用户在别处(配音室/生成链)刚发生的启停。
    refreshRowStatuses();
  };

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
      const ttsReady = ttsStatus.running;
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
      refreshRowStatuses();
    }
  };

  // --- 行级状态胶囊推导(镜像各区块内部的判定口径) ---
  const pythonReady = (python.installedItems?.length ?? 0) > 0 && !python.installedItems?.some((item) => item.status === "failed");
  const pythonPill: CapabilityPillKind = !python.hasRuntime
    ? "unsupported"
    : python.isSetupActive
      ? "preparing"
      : pythonReady
        ? "ready"
        : "needs-runtime";

  const depthState = depth.lifecycleStatus?.state ?? depth.status?.state;
  const depthModelDownloaded = depth.lifecycleStatus?.modelDownloaded ?? depth.status?.modelDownloaded;
  const depthPill: CapabilityPillKind = !depth.hasRuntime
    ? "unsupported"
    : depth.isDownloading || depth.status?.downloadStatus === "downloading"
      ? "downloading"
      : depthState === "ready"
        ? (depthModelDownloaded === false ? "model-missing" : "ready")
        : depthState === "needs-runtime"
          ? "needs-runtime"
          : depthState === "blocked" || depthState === "error"
            ? "blocked"
            : "checking";

  const imageGenState = imageGen.lifecycleStatus?.state;
  const imageGenPill: CapabilityPillKind = !imageGen.hasRuntime
    ? "unsupported"
    : imageGenState === "ready" || (!imageGen.hasLifecycleBridge && (imageGen.status?.setupStage === "ready" || imageGen.status?.running))
      ? "ready"
      : imageGenState === "needs-runtime"
        ? "needs-runtime"
        : imageGenState === "blocked" || imageGenState === "error"
          ? "blocked"
          : "checking";

  const upscaleState = upscale.lifecycleStatus?.state ?? upscale.status?.state;
  const upscaleModelDownloaded = upscale.lifecycleStatus?.modelDownloaded
    ?? (upscale.models.length > 0 ? upscale.models.some((model) => model.downloaded) : undefined);
  const upscalePill: CapabilityPillKind = !upscale.hasRuntime
    ? "unsupported"
    : upscale.isDownloading || upscale.status?.downloadStatus === "downloading"
      ? "downloading"
      : upscaleState === "ready"
        ? (upscaleModelDownloaded === false ? "model-missing" : "ready")
        : upscaleState === "needs-runtime"
          ? "needs-runtime"
          : upscaleState === "blocked" || upscaleState === "error"
            ? "blocked"
            : "checking";

  const vlmBridge = typeof window !== "undefined" ? window.vlmReview : undefined;
  const vlmPill: CapabilityPillKind = !vlmBridge
    ? "unsupported"
    : vlmProbe === null
      ? "checking"
      : vlmProbe.status === "ready"
        ? "ready"
        : vlmProbe.code === "model-not-downloaded"
          ? "model-missing"
          : vlmProbe.code === "unsupported-platform"
            ? "unsupported"
            : "blocked";

  const videoQcStatus = videoQc.status;
  const videoQcPill: CapabilityPillKind = !videoQc.hasBridge
    ? "unsupported"
    : videoQc.isDownloading || videoQcStatus?.downloadStatus === "downloading"
      ? "downloading"
      : videoQcStatus?.state === "ready"
        ? (videoQcStatus.modelReady ? "ready" : "model-missing")
        : videoQcStatus?.state === "needs-runtime"
          ? "needs-runtime"
          : videoQcStatus?.state === "blocked" || videoQcStatus?.state === "error"
            ? "blocked"
            : "checking";

  const musicPill: CapabilityPillKind = !music.hasRuntime
    ? "unsupported"
    : music.isSettingUp
      ? "preparing"
      : music.status?.setupStage === "ready"
        ? "ready"
        : music.status?.setupStage === "failed"
          ? "blocked"
          : music.status
            ? "needs-runtime"
            : "checking";

  const sfxPill: CapabilityPillKind = !sfx.hasRuntime
    ? "unsupported"
    : sfx.isSettingUp
      ? "preparing"
      : sfx.status?.setupStage === "ready"
        ? "ready"
        : sfx.status?.setupStage === "failed"
          ? "blocked"
          : sfx.status
            ? "needs-runtime"
            : "checking";

  // TTS 就绪口径 = running(实时健康检查,镜像 LocalTtsPanel 的判定);
  // setupStage 只反映上次启动流程收尾,应用重启后回 idle 但 sidecar 仍活着,
  // 双条件会误报「需准备」(08-28 修)。
  const ttsPill: CapabilityPillKind = ttsRunning === null
    ? "checking"
    : ttsRunning.running
      ? "ready"
      : "needs-runtime";

  // 视频行聚合分级(优先级 出错 > 可更新 > 需准备):三插件任一 error → 检查失败;
  // 任一 update-available → 可更新(仍可用);否则任一未就绪 → 需准备。
  const videoPluginStates = VIDEO_GATE_PLUGIN_IDS.map((id) => videoPlugins.getPlugin(id)?.runtimeState);
  const videoPill: CapabilityPillKind = videoPlugins.plugins.length === 0
    ? "checking"
    : videoPlugins.error || videoPluginStates.includes("error")
      ? "error"
      : videoPluginStates.includes("update-available")
        ? "update"
        : videoPluginStates.every((state) => state === "ready")
          ? "ready"
          : "needs-runtime";

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full max-w-[1600px] mx-auto space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Plug className="h-5 w-5 text-primary" aria-hidden="true" />
              本地配置
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              按依赖顺序配置本地能力：Python 运行环境 → 各能力模型 → 声音 → 视频插件。模型仅在点击下载时获取，绝不自动下载。
            </p>
          </div>
          <Button onClick={() => void prepareByPriority()} disabled={isPreparing || !python.hasRuntime}>
            {isPreparing ? "按优先级准备中..." : "按优先级准备基础运行时"}
          </Button>
        </header>

        <CapabilityGroup label="基础运行时">
          <CapabilityRow
            sectionId="python"
            headingId="plugin-python-heading"
            icon={Terminal}
            title="Python 运行环境"
            description="所有本地 TTS、video-use Python worker 和 MLX 对齐都复用应用管理的 Python。"
            pill={pythonPill}
            collapsed={collapsedSections.has("python")}
            onToggle={toggleSectionCollapsed}
          >
            <PythonSettingsTab embedded />
          </CapabilityRow>
        </CapabilityGroup>

        <CapabilityGroup label="图像能力">
          <CapabilityRow
            sectionId="depth"
            headingId="plugin-depth-heading"
            icon={Layers}
            title="深度估计（电影级 3D）"
            description="静态图 → 3D 电影级纵深的深度模型（依赖 Python 运行环境）。模型仅在点击下载时获取，渲染时绝不自动下载。"
            pill={depthPill}
            collapsed={collapsedSections.has("depth")}
            onToggle={toggleSectionCollapsed}
          >
            <DepthSettingsSection embedded />
          </CapabilityRow>
          <CapabilityRow
            sectionId="image-gen"
            headingId="plugin-image-gen-heading"
            icon={ImageIcon}
            title="本地图片生成（免费）"
            description="本地生图零 API 费用，多引擎可选：Krea2 Turbo（主力,当前唯一就绪引擎;场景优秀,人物面部有色彩偏差建议配合云端或后续修复）/ Z-Image-Turbo / Qwen-Image-Edit 2511（编辑级）。大件直接复用 ComfyUI 现成文件零重下，小件仅首次点击补齐（数百 MB）。准备运行时后，在 设置 → 云端AI 中将「角色生图 / 场景生图 / 道具生图」绑定到「本地图片生成」提供方，即可替代云 API。"
            pill={imageGenPill}
            collapsed={collapsedSections.has("image-gen")}
            onToggle={toggleSectionCollapsed}
          >
            <LocalImageSettingsSection embedded />
          </CapabilityRow>
          <CapabilityRow
            sectionId="upscale"
            headingId="plugin-upscale-heading"
            icon={ZoomIn}
            title="图片超分（1K → 4K）"
            description="本地 Real-ESRGAN 超分模型（依赖 Python 运行环境），把云端/本地生成的 1K 图原生放大 4 倍。模型仅在点击下载时获取。"
            pill={upscalePill}
            collapsed={collapsedSections.has("upscale")}
            onToggle={toggleSectionCollapsed}
          >
            <UpscaleSettingsSection embedded />
          </CapabilityRow>
          <CapabilityRow
            sectionId="vlm-review"
            headingId="plugin-vlm-review-heading"
            icon={ScanEye}
            title="视觉审核（VLM 一致性检查）"
            description="本地 Qwen3-VL 视觉模型，自动比对生成的分镜图与资产参考图，判断角色/服装/场景是否一致。模型仅在点击下载时获取。"
            pill={vlmPill}
            collapsed={collapsedSections.has("vlm-review")}
            onToggle={toggleSectionCollapsed}
          >
            <VlmReviewSettingsSection embedded />
          </CapabilityRow>
          <CapabilityRow
            sectionId="video-qc"
            headingId="plugin-video-qc-heading"
            icon={Gauge}
            title="视频评分模型"
            description="DOVER-Mobile 本地评分模型（依赖 Python 运行环境），出片后按系列基线相对告警；未下载时自动跳过，不影响出片。"
            pill={videoQcPill}
            collapsed={collapsedSections.has("video-qc")}
            onToggle={toggleSectionCollapsed}
          >
            <VideoQcSettingsSection embedded />
          </CapabilityRow>
        </CapabilityGroup>

        <CapabilityGroup label="声音">
          <CapabilityRow
            sectionId="audio-tts"
            headingId="plugin-audio-tts-heading"
            icon={AudioLines}
            title="TTS 运行时与模型"
            description="本地 TTS 声线管理；模型缓存和音色 profile 由 TTS 面板管理，不会自动下载未选择的声线模型。"
            pill={ttsPill}
            collapsed={collapsedSections.has("audio-tts")}
            onToggle={toggleSectionCollapsed}
          >
            <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">加载 TTS 配置中...</div>}>
              <LocalTtsPanelLazy embedded />
            </Suspense>
          </CapabilityRow>
          <CapabilityRow
            sectionId="audio-music"
            headingId="plugin-audio-music-heading"
            icon={Music2}
            title="本地音乐生成"
            description="MiniMax-Music3 整曲生成（默认，bf16 约 28.5 GB）+ MusicGen 轻量备选；生成的音频可在工作台「章节共享音频」导入为 BGM 轨道。"
            pill={musicPill}
            collapsed={collapsedSections.has("audio-music")}
            onToggle={toggleSectionCollapsed}
          >
            <LocalAudioSettingsSection embedded />
          </CapabilityRow>
          <CapabilityRow
            sectionId="audio-sfx"
            headingId="plugin-audio-sfx-heading"
            icon={AudioWaveform}
            title="本地音效生成"
            description="短音效 one-shot 本地生成（≤5 秒，同提示词+同种子=同文件）；与本地音乐生成共用模型缓存，供 sfx 绑定选用。"
            pill={sfxPill}
            collapsed={collapsedSections.has("audio-sfx")}
            onToggle={toggleSectionCollapsed}
          >
            <SfxGenSettingsSection embedded />
          </CapabilityRow>
        </CapabilityGroup>

        <CapabilityGroup label="视频生产">
          <CapabilityRow
            sectionId="video"
            headingId="plugin-video-heading"
            icon={Clapperboard}
            title="视频工作流插件"
            description="video-use 先完成对齐、EDL、字幕时间、调色和自评；HyperFrames overlay 随后就绪，Remotion 负责正式渲染。"
            pill={videoPill}
            collapsed={collapsedSections.has("video")}
            onToggle={toggleSectionCollapsed}
          >
            <RenderingSettingsTab embedded />
          </CapabilityRow>
        </CapabilityGroup>
      </div>
    </ScrollArea>
  );
}
