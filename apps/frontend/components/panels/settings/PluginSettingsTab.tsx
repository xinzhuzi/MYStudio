"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  Clapperboard,
  Gauge,
  Plug,
  ScanEye,
  ServerCog,
  Terminal,
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
import { useImageGenRuntimeSettings } from "./useImageGenRuntimeSettings";
import { useSfxGenRuntimeSettings } from "./useSfxGenRuntimeSettings";
import { useVideoQcRuntimeSettings } from "./useVideoQcRuntimeSettings";
import { PythonSettingsTab } from "./PythonSettingsTab";
import { ComfyEngineSettingsSection, type ComfyEngineTab } from "./comfy-engine/ComfyEngineSettingsSection";
import {
  REVEAL_SETTINGS_SECTION_EVENT,
  consumePendingRevealSection,
} from "./comfy-engine/comfy-engine-update-reminder";
import {
  deriveComfyEnginePill,
  formatComfyEnginePillLabel,
  type ComfyEnginePillKind,
} from "./comfy-engine/comfy-engine-contract";
import { useComfyEngineSettings } from "./comfy-engine/useComfyEngineSettings";
import { VlmReviewSettingsSection } from "./VlmReviewSettingsSection";
import { VideoQcSettingsSection } from "./VideoQcSettingsSection";
import { SfxGenSettingsSection } from "./SfxGenSettingsSection";
import { RenderingSettingsTab } from "./RenderingSettingsTab";

const LocalTtsPanelLazy = lazy(() => import("@/components/panels/tts/LocalTtsPanel").then((module) => ({
  default: module.LocalTtsPanel,
})));

/** 区块行折叠记忆键：值为被折叠行 id 数组；无记忆时默认全折叠（08-18 用户拍板）。 */
const SECTION_STORAGE_KEY = "mystudio.settings.plugins.collapsedSections";

const SECTION_IDS = [
  "python",
  "comfy-engine",
  "vlm-review",
  "video-qc",
  "audio-tts",
  "audio-sfx",
  "video",
] as const;

type SectionId = (typeof SECTION_IDS)[number];

/** 旧「声音」整卡折叠记忆 → 拆平后的三行继承(08-28 布局重做)。 */
const LEGACY_COLLAPSED_MIGRATIONS: Record<string, readonly SectionId[]> = {
  audio: ["audio-tts", "audio-sfx"],
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
    // 09-09 用户裁定:ComfyUI 引擎卡每次进本地设置默认收起——点开才挂载才触发
    // GitHub 更新检查,不因上次的展开记忆一进页就查。本会话内点开自由;外部
    // 深链 reveal(缺插件指路等)不受影响。
    migrated.add("comfy-engine");
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
  | "not-installed"
  | "preparing"
  | "downloading"
  | "update"
  | "updating"
  | "error"
  | "blocked";

const PILL_LABELS: Record<CapabilityPillKind, string> = {
  checking: "检查中",
  unsupported: "不支持",
  ready: "已就绪",
  "model-missing": "未下载",
  "needs-runtime": "需准备",
  "not-installed": "未安装",
  preparing: "配置中",
  downloading: "下载中",
  update: "可更新",
  updating: "更新中",
  error: "检查失败",
  blocked: "已阻塞",
};

const PILL_STYLES: Record<CapabilityPillKind, string> = {
  checking: "border-border bg-muted/60 text-muted-foreground",
  unsupported: "border-border bg-muted/60 text-muted-foreground",
  "model-missing": "border-border bg-muted/60 text-muted-foreground",
  "not-installed": "border-border bg-muted/60 text-muted-foreground",
  ready: "border-success/30 bg-success/10 text-success",
  "needs-runtime": "border-warning/30 bg-warning/10 text-warning",
  preparing: "border-warning/30 bg-warning/10 text-warning",
  downloading: "border-warning/30 bg-warning/10 text-warning",
  update: "border-warning/30 bg-warning/10 text-warning",
  updating: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
};

type CapabilityRowProps = {
  sectionId: SectionId;
  headingId: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  pill: CapabilityPillKind;
  /** 覆盖胶囊文案(如引擎行「下载中 42%」「出错」);不传用默认文案。 */
  pillLabel?: string;
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
  pillLabel,
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
            {pillLabel ?? PILL_LABELS[pill]}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        {description ? (
          <p className="px-5 pt-4 text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
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
 * 统一的本地能力配置页。分组按依赖顺序排列:基础运行时(Python 是地基)
 * → ComfyUI 引擎(引擎/插件/本地大模型)→ 图像能力(Python 侧视觉工具)
 * → 声音 → 视频生产插件。
 *
 * 行级状态胶囊只做挂载期一次性探测,并在折叠行/一键准备后重探,不做常驻
 * 轮询——下载进度等实时状态仍由各区块展开内容自行展示。模型下载政策不变:
 * 仅在用户点击下载时获取,绝不自动下载。
 */
export function PluginSettingsTab() {
  const python = usePythonRuntimeSettings();
  const comfyEngine = useComfyEngineSettings();
  const videoPlugins = useVideoWorkflowPlugins();
  const imageGen = useImageGenRuntimeSettings();
  const sfx = useSfxGenRuntimeSettings();
  const videoQc = useVideoQcRuntimeSettings();
  const [vlmProbe, setVlmProbe] = useState<VlmReviewProbeResult | null>(null);
  const [ttsRunning, setTtsRunning] = useState<{ running: boolean; setupStage?: string } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  // 区块行折叠:默认全折叠(08-18 用户拍板),手动展开/折叠后 localStorage 记忆。
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => readCollapsedSections());
  // 深链目标页(「去更新」→ "update"):只在 reveal 时生效;用户手动折叠/展开
  // 引擎卡后清空,避免旧深链让下次手动展开误落到过期页面。
  const [revealTab, setRevealTab] = useState<ComfyEngineTab | null>(null);

  const refreshRowStatuses = () => {
    void imageGen.probeRuntime();
    void comfyEngine.refreshStatus();
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

  // 引擎卡胶囊重探(09-08 加固④):挂载期 comfy 探测在 sidecar 未起时会静默
  // 失败,胶囊停在「检查中」不自动重试;imageGen 生命周期翻到 ready(=sidecar
  // 刚被拉起)且 comfy 状态仍未拿到时补探一次。幂等:探测成功后条件自然失效,
  // 不引入轮询。
  const comfyRefreshStatus = comfyEngine.refreshStatus;
  const comfyHasBridge = comfyEngine.hasBridge;
  const comfyStatusKnown = comfyEngine.status !== null;
  const imageGenSidecarUp =
    imageGen.lifecycleStatus?.state === "ready" ||
    (!imageGen.hasLifecycleBridge && Boolean(imageGen.status?.running || imageGen.status?.setupStage === "ready"));
  useEffect(() => {
    if (!comfyHasBridge || comfyStatusKnown || !imageGenSidecarUp) return;
    void comfyRefreshStatus();
  }, [comfyHasBridge, comfyStatusKnown, imageGenSidecarUp, comfyRefreshStatus]);

  // 编程式直达分区(09-08 更新提醒链「去更新」按钮):广播事件 + 挂载期
  // pending 兜底(事件可能早于本 tab 挂载),展开对应折叠行;detail.tab 可带
  // 引擎卡目标页(09-09 模型页并入后深链需直落「更新」页)。
  useEffect(() => {
    const revealSection = (sectionId: string, tab?: string) => {
      setCollapsedSections((previous) => {
        if (!previous.has(sectionId)) return previous;
        const next = new Set(previous);
        next.delete(sectionId);
        return next;
      });
      if (sectionId === "comfy-engine") setRevealTab((tab as ComfyEngineTab | undefined) ?? null);
    };
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<{ sectionId?: string; tab?: string }>).detail;
      if (detail?.sectionId) revealSection(detail.sectionId, detail.tab);
    };
    const pending = consumePendingRevealSection();
    if (pending) revealSection(pending.sectionId, pending.tab);
    window.addEventListener(REVEAL_SETTINGS_SECTION_EVENT, onReveal);
    return () => {
      window.removeEventListener(REVEAL_SETTINGS_SECTION_EVENT, onReveal);
    };
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
    // 手动切页视为深链过期:清 reveal 目标页,下次展开回默认「模型」页。
    if (sectionId === "comfy-engine") setRevealTab(null);
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

  // ComfyUI 引擎行:胶囊分级裁定 出错>可更新>需准备;下载中带 x%,就绪口径=装完即就绪。
  const comfyPillKind: ComfyEnginePillKind = deriveComfyEnginePill({
    hasBridge: comfyEngine.hasBridge,
    status: comfyEngine.status,
    activeJob: comfyEngine.activeJob,
  });
  const comfyPill: CapabilityPillKind =
    comfyPillKind === "needs-setup"
      ? "needs-runtime"
      : comfyPillKind === "error"
        ? "error"
        : comfyPillKind;
  // 仅「出错」「下载中 x%」需要覆盖默认文案,其余用共享文案。
  const comfyPillLabel =
    comfyPillKind === "error"
      ? "出错"
      : comfyPillKind === "downloading" && comfyEngine.activeJob?.progress != null
        ? formatComfyEnginePillLabel(comfyPillKind, comfyEngine.activeJob)
        : undefined;



  // imageGen 行已撤(09-09 模型页并入引擎卡),但 tab 级 hook 保留:挂载探测
  // + 引擎卡胶囊补探 effect 依赖它的 sidecar ready 信号(见上方 effect)。



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
              按依赖顺序配置本地能力：Python 运行环境 → ComfyUI 引擎与模型 → 视觉工具 → 声音 → 视频插件。模型仅在点击下载时获取，绝不自动下载。
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

        {/* 09-09 拆组(comfyui-frontend-swap 0a):ComfyUI 引擎独立分组——
            自管实例自成体系(独立引擎+独立venv+插件生态+本地大模型),不再挂在
            Python 地基组下;存储位置配置在引擎卡「存储」标签页,本地大模型展示
            在引擎卡「模型」标签页(09-09-comfy-model-tab) */}
        <CapabilityGroup label="ComfyUI 引擎">
          <CapabilityRow
            sectionId="comfy-engine"
            headingId="plugin-comfy-engine-heading"
            icon={ServerCog}
            title="ComfyUI 引擎"
            pill={comfyPill}
            pillLabel={comfyPillLabel}
            collapsed={collapsedSections.has("comfy-engine")}
            onToggle={toggleSectionCollapsed}
          >
            <ComfyEngineSettingsSection embedded initialActiveTab={revealTab ?? undefined} />
          </CapabilityRow>
        </CapabilityGroup>

        <CapabilityGroup label="图像能力">
          {/* 深度估计行已撤(09-10 用户裁定:depth 域随 MiniMax 视频/音频路线退役) */}
          {/* 本地图片生成行已撤(09-09-comfy-model-tab):模型展示整块迁入
              ComfyUI 引擎卡「模型」标签页,与引擎/插件同卡管理 */}
          {/* 图片超分行已撤(09-10 用户裁定:超分全量走 ComfyUI,应用侧 Real-ESRGAN 链退役) */}
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
            sectionId="audio-sfx"
            headingId="plugin-audio-sfx-heading"
            icon={AudioWaveform}
            title="本地音效生成"
            description="短音效 one-shot 本地生成（≤5 秒，同提示词+同种子=同文件）；与 MusicGen 轻量引擎共用模型缓存，供 sfx 绑定选用。"
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
