"use client";

import { useEffect, useState } from "react";
import { Check, Download, FolderOpen, Loader2, Music } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useAudioGenRuntimeSettings } from "./useAudioGenRuntimeSettings";
import { useMusic3GenRuntimeSettings } from "./useMusic3GenRuntimeSettings";
import { MUSIC3_MAX_DURATION_S, MUSIC3_MIN_DURATION_S, MUSIC3_PLATFORM_MATRIX, MUSIC3_WEIGHTS_MIN_RAM_GB } from "@/types/music3-gen";

type LocalAudioSettingsSectionProps = {
  embedded?: boolean;
};

const MUSIC_ENGINE_KEY = "mystudio.settings.musicEngine";
type MusicEngine = "minimax" | "musicgen";

function readMusicEngine(): MusicEngine {
  try {
    const raw = window.localStorage.getItem(MUSIC_ENGINE_KEY);
    return raw === "musicgen" ? "musicgen" : "minimax";
  } catch {
    return "minimax";
  }
}

/**
 * 本地音乐生成配置区块 — 设置 → 本地配置。双引擎(08-19-minimax-music3-engine):
 * MiniMax-Music3(整曲 10-300s/44.1kHz 立体声,默认)与 MusicGen(轻量 15-60s)
 * 共存可切换;生成产物均落导出目录,可经工作台「章节共享音频」导入为 BGM。
 */
export function LocalAudioSettingsSection({ embedded = false }: LocalAudioSettingsSectionProps) {
  const [engine, setEngine] = useState<MusicEngine>(readMusicEngine);
  useEffect(() => {
    try {
      window.localStorage.setItem(MUSIC_ENGINE_KEY, engine);
    } catch {
      // 记忆失败不影响本轮交互
    }
  }, [engine]);

  return (
    <div className={cn("space-y-4 px-5 py-4 rounded-xl border border-border bg-card/30", embedded && "mx-5 mb-4")}>
      {/* 引擎切换 */}
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="tablist" aria-label="音乐引擎">
        <button
          type="button"
          role="tab"
          aria-selected={engine === "minimax"}
          onClick={() => setEngine("minimax")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            engine === "minimax" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          MiniMax-Music3 · 整曲(默认)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={engine === "musicgen"}
          onClick={() => setEngine("musicgen")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            engine === "musicgen" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          MusicGen · 轻量
        </button>
      </div>
      {engine === "minimax" ? <Music3EnginePanel /> : <MusicGenEnginePanel />}
    </div>
  );
}

/** MusicGen 引擎面板(原单引擎内容,行为不变)。 */
function MusicGenEnginePanel() {
  const runtime = useAudioGenRuntimeSettings();
  const status = runtime.status;
  const model = status?.models?.[0];
  const isReady = status?.setupStage === "ready";
  const downloaded = model?.downloaded ?? false;
  const downloading = status?.downloadStatus === "downloading";
  const [testPrompt, setTestPrompt] = useState("轻柔的钢琴背景音乐，温暖而舒缓");
  const [isGenerating, setIsGenerating] = useState(false);

  if (!runtime.hasRuntime) {
    return (
      <div className="text-sm text-muted-foreground">本地音乐生成配置仅在桌面应用中可用。</div>
    );
  }

  const handleTestGenerate = async () => {
    if (!runtime.bridge || !testPrompt.trim()) {
      toast.error("请输入 BGM 描述");
      return;
    }
    setIsGenerating(true);
    try {
      const result = await runtime.bridge.generate({
        prompt: testPrompt.trim(),
        seconds: 15,
        outputDir: "__APP_EXPORTS__",
      });
      if (result.status === "accepted" && result.outputPath) {
        toast.success(`BGM 已生成: ${result.outputPath}`);
      } else if (result.code === "model-not-downloaded") {
        toast.error("MusicGen 模型未下载，请先下载模型");
      } else {
        toast.error(result.message || "BGM 生成失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "BGM 生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Music className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {isReady ? "运行时就绪" : (status?.setupMessage ?? "未检查（依赖共享 Python 运行环境）")}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void runtime.setupRuntime()} disabled={runtime.isSettingUp}>
          {runtime.isSettingUp ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Music className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isReady ? "重新检查" : "检查运行时"}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {downloaded ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {model?.label ?? "MusicGen Small"}
            {downloaded && model?.sizeMb != null ? ` · ${(model.sizeMb / 1024).toFixed(1)} GB` : ""}
            {" — "}
            {downloading ? "下载中" : downloaded ? "已下载" : "未下载"}
          </span>
        </div>
        <Button size="sm" onClick={() => void runtime.startDownload()} disabled={!isReady || downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-2 h-4 w-4" aria-hidden />
          )}
          {downloading ? "下载中…" : downloaded ? "重新下载" : "下载模型"}
        </Button>
      </div>

      {downloading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, status?.downloadProgress ?? 0)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(status?.downloadProgress ?? 0)}%</p>
        </div>
      )}

      {downloaded ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={testPrompt}
              onChange={(event) => setTestPrompt(event.currentTarget.value)}
              placeholder="BGM 描述，如：紧张的弦乐，节奏渐强"
              className="flex-1"
            />
            <Button size="sm" onClick={() => void handleTestGenerate()} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Music className="mr-2 h-4 w-4" aria-hidden />
              )}
              {isGenerating ? "生成中…" : "生成测试 BGM"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground leading-5">
        MusicGen 本地 BGM 生成（约 2 GB）。模型仅在点击下载时获取；生成的 WAV 可在工作台
        「章节共享音频」中导入为 BGM 轨道。注意：权重为 CC-BY-NC（非商用）。
      </p>
    </div>
  );
}

/** mlx-serve 引擎自动安装(下载 62MB tar.gz 到 <userData>/model/mlx-serve-managed/)。 */
function AutoInstallMlxServe({ runtime, onInstalled }: { runtime: ReturnType<typeof useMusic3GenRuntimeSettings>; onInstalled: () => void }) {
  const [isInstalling, setIsInstalling] = useState(false);
  const handleInstall = async () => {
    if (!runtime.bridge?.installMlxServeBinary) {
      toast.error("当前版本不支持自动安装,请升级应用");
      return;
    }
    setIsInstalling(true);
    try {
      const result = await runtime.bridge.installMlxServeBinary();
      if (result.installed) {
        toast.success("mlx-serve 引擎已安装");
        onInstalled();
      } else {
        toast.error(`安装失败: ${result.error ?? "未知错误"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "安装失败");
    } finally {
      setIsInstalling(false);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={() => void handleInstall()} disabled={isInstalling}>
      {isInstalling ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Download className="mr-2 h-4 w-4" aria-hidden />
      )}
      {isInstalling ? "下载安装中…" : "自动安装 mlx-serve(62MB)"}
    </Button>
  );
}

/** bf16 权重一键获取(ModelScope 全量 → 本地转 MLX → 自动指向;08-19 指向版补权重获取,只用 bf16)。 */
function InstallWeightsBlock({ runtime }: { runtime: ReturnType<typeof useMusic3GenRuntimeSettings> }) {
  const install = runtime.status?.mlxServWeightsInstall;
  const busy = install?.status === "downloading" || install?.status === "converting";
  const ramGb = runtime.status?.hostTotalRamGb;
  const ramOk = ramGb == null || ramGb >= MUSIC3_WEIGHTS_MIN_RAM_GB;
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await runtime.startWeightsInstall();
    } finally {
      setIsStarting(false);
    }
  };

  const stageText = (() => {
    if (install?.status === "downloading") return `下载中 ${Math.round(install.progress)}%(ModelScope 直连,断点续传)`;
    if (install?.status === "converting") return install.stage === "cleanup" ? "清理源目录…" : "本地转换 MLX bf16(约 1 分钟)…";
    return "";
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          没有现成权重?一键获取:ModelScope 全量下载(约 28.5 GB)→ 本地转 bf16(落 应用数据/model/minimax/,完成后自动指向)
        </span>
        <Button size="sm" variant="outline" onClick={() => void handleStart()} disabled={busy || isStarting || !ramOk}>
          {busy || isStarting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-2 h-4 w-4" aria-hidden />
          )}
          {busy ? "获取中…" : "一键获取 bf16 权重"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        bf16 全精度,需 48GB+ 内存{ramGb != null ? `(本机 ${ramGb}GB)` : ""};内存不足的机器请使用轻量 MusicGen
      </p>
      {busy ? (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, install?.progress ?? 0)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{stageText}</p>
        </div>
      ) : null}
      {install?.status === "error" && install.error ? (
        <p className="text-xs text-destructive">{install.error}</p>
      ) : null}
    </div>
  );
}

/** mlx-serve 指向路线卡片:零拷贝使用本地已转换的 MiniMax-Music3 MLX 权重(08-19-music3-mlxserv-connector)。 */
function MlxServCard({ runtime, onConfigured }: { runtime: ReturnType<typeof useMusic3GenRuntimeSettings>; onConfigured: () => void }) {
  const mlxServ = runtime.status?.mlxServ;
  const config = mlxServ?.config;
  const [isPicking, setIsPicking] = useState(false);

  if (!runtime.hasRuntime || !mlxServ || !config) return null;

  const handlePickDir = async () => {
    if (!runtime.bridge) return;
    const storageManager = getStorageManagerBridge();
    if (!storageManager?.selectDirectory) {
      toast.error("选择文件夹仅在桌面应用中可用");
      return;
    }
    setIsPicking(true);
    try {
      const picked = await storageManager.selectDirectory();
      if (picked) {
        await runtime.bridge.configure({ weightsDir: picked });
        toast.success(`已指向权重目录: ${picked}`);
        onConfigured();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择目录失败");
    } finally {
      setIsPicking(false);
    }
  };

  const setPreferred = async (preferredEngine: "pocket" | "mlxserv") => {
    if (!runtime.bridge) return;
    await runtime.bridge.configure({ preferredEngine });
    onConfigured();
  };

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {mlxServ.serverRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : mlxServ.weightsReady && mlxServ.binaryFound ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Music className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="text-muted-foreground">mlx-serve 指向已有权重(免下载)</span>
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="首选引擎">
          <Button
            size="sm"
            variant={config.preferredEngine === "pocket" ? "default" : "outline"}
            role="radio"
            aria-checked={config.preferredEngine === "pocket"}
            onClick={() => void setPreferred("pocket")}
          >
            下载版
          </Button>
          <Button
            size="sm"
            variant={config.preferredEngine === "mlxserv" ? "default" : "outline"}
            role="radio"
            aria-checked={config.preferredEngine === "mlxserv"}
            disabled={!mlxServ.weightsReady || !mlxServ.binaryFound}
            onClick={() => void setPreferred("mlxserv")}
          >
            指向版
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
        <span className="text-muted-foreground">权重目录</span>
        <span className="truncate font-mono text-xs" title={config.weightsDir || "未指定"}>
          {config.weightsDir || "未指定(选择已转换的 minimax-music3 MLX 权重目录)"}
        </span>
        <div className="flex items-center gap-1">
          {config.weightsDir ? (
            <Button size="sm" variant="outline" onClick={() => { void window.electronAPI?.openPath(config.weightsDir); }}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              打开
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void handlePickDir()} disabled={isPicking}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            选择目录
          </Button>
        </div>
      </div>

      {!mlxServ.weightsReady ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{mlxServ.weightsReason}</p>
          <InstallWeightsBlock runtime={runtime} />
        </div>
      ) : (
        <p className="text-xs text-success dark:text-success">权重完整(直接指向不拷贝,8bit/bf16 均支持)</p>
      )}

      {!mlxServ.binaryFound ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">未找到 mlx-serve 引擎。可自动下载安装(62MB 到应用目录,无需 brew),或手动安装:</p>
          <AutoInstallMlxServe runtime={runtime} onInstalled={onConfigured} />
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs">brew tap ddalcu/mlx-serve https://github.com/ddalcu/mlx-serve{"\n"}brew install mlx-serve</pre>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          引擎:{mlxServ.binaryPath}
          {mlxServ.serverRunning ? " · 服务器运行中(10 分钟空闲自动回收)" : " · 按需启动"}
        </p>
      )}
    </div>
  );
}

/** MiniMax-Music3 引擎面板(整曲,默认)。 */
function Music3EnginePanel() {
  const runtime = useMusic3GenRuntimeSettings();
  const status = runtime.status;
  const model = status?.models?.[0];
  const isReady = status?.setupStage === "ready";
  const downloaded = model?.downloaded ?? false;
  const downloading = status?.downloadStatus === "downloading";
  const unsupported = model?.availability === "unsupported";
  const hardware = status?.hardwareProfile;
  const mlxservReady = Boolean(status?.mlxServ?.weightsReady && status?.mlxServ?.binaryFound);
  const [testPrompt, setTestPrompt] = useState("紧张激烈的仙侠配乐,鼓点密集,弦乐渐强");
  const [testSeed, setTestSeed] = useState("7");
  const [testSeconds, setTestSeconds] = useState("60");
  const [isGenerating, setIsGenerating] = useState(false);

  if (!runtime.hasRuntime) {
    return (
      <div className="text-sm text-muted-foreground">本地音乐生成配置仅在桌面应用中可用。</div>
    );
  }

  const handleTestGenerate = async () => {
    if (!runtime.bridge || !testPrompt.trim()) {
      toast.error("请输入 BGM 描述");
      return;
    }
    const seed = Number.parseInt(testSeed, 10);
    if (!Number.isInteger(seed)) {
      toast.error("种子必须是整数");
      return;
    }
    const seconds = Number.parseFloat(testSeconds);
    if (!Number.isFinite(seconds)) {
      toast.error("时长必须是数字");
      return;
    }
    setIsGenerating(true);
    toast.info("整曲生成为分钟级,请稍候(最长 30 分钟硬限)");
    try {
      const result = await runtime.bridge.generate({
        prompt: testPrompt.trim(),
        seed,
        seconds: Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, seconds)),
        outputDir: "__APP_EXPORTS__",
      });
      if (result.status === "accepted" && result.outputPath) {
        toast.success(`整曲 BGM 已生成: ${result.outputPath}`);
      } else if (result.code === "model-not-downloaded") {
        toast.error("MiniMax-Music3 未下载,请先下载模型(约 12 GB)");
      } else if (result.code === "platform-unsupported") {
        toast.error(result.message || "本机硬件不满足 MiniMax-Music3 运行要求");
      } else {
        toast.error(result.message || "整曲生成失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "整曲生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Music className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {isReady ? "运行时就绪" : (status?.setupMessage ?? "未检查(依赖共享 Python 运行环境的 mlx)")}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void runtime.setupRuntime()} disabled={runtime.isSettingUp}>
          {runtime.isSettingUp ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Music className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isReady ? "重新检查" : "检查运行时"}
        </Button>
      </div>

      {unsupported ? (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">
            本机硬件不满足 MiniMax-Music3 本地运行要求:{model?.unsupportedReason ?? "平台不受支持"}
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <tbody>
                {MUSIC3_PLATFORM_MATRIX.map((row) => (
                  <tr key={row.platform} className="border-b border-border/60 last:border-b-0">
                    <td className="px-2.5 py-1.5 text-muted-foreground">{row.platform}</td>
                    <td className="px-2.5 py-1.5">{row.model}</td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{row.runnable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">不同平台按硬件自动选择可用模型;当前无可下载条目。</p>
        </div>
      ) : hardware ? (
        <p className="text-xs text-muted-foreground">
          已按本机硬件自动匹配:Apple Silicon(MLX)整曲版({hardware.platform}/{hardware.machine})
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {downloaded ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {model?.label ?? "MiniMax-Music3(MLX 整曲引擎)"}
            {downloaded && model?.sizeMb != null ? ` · ${(model.sizeMb / 1024).toFixed(1)} GB` : ""}
            {" — "}
            {downloading ? "下载中" : downloaded ? "已就绪" : unsupported ? "本机不适用" : "未下载"}
          </span>
        </div>
        <Button size="sm" onClick={() => void runtime.startDownload()} disabled={!isReady || downloading || unsupported}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-2 h-4 w-4" aria-hidden />
          )}
          {downloading ? "下载中…" : downloaded ? "重新下载" : "下载模型(约 12 GB)"}
        </Button>
      </div>

      {downloading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, status?.downloadProgress ?? 0)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(status?.downloadProgress ?? 0)}%</p>
        </div>
      )}

      {status?.modelCacheDir ? (
        <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="text-muted-foreground">模型缓存目录</span>
          <span className="truncate font-mono text-xs" title={status.modelCacheDir}>{status.modelCacheDir}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void window.electronAPI?.openPath(status.modelCacheDir!); }}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            打开
          </Button>
        </div>
      ) : null}

      <MlxServCard runtime={runtime} onConfigured={() => { void runtime.refreshStatus(); }} />

      {(downloaded || mlxservReady) ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={testPrompt}
              onChange={(event) => setTestPrompt(event.currentTarget.value)}
              placeholder="整曲描述,如:大气磅礴的仙侠交响,前段压抑后段爆发"
              className="flex-1"
            />
            <Input
              value={testSeed}
              onChange={(event) => setTestSeed(event.currentTarget.value)}
              placeholder="种子"
              className="w-16"
              inputMode="numeric"
            />
            <Input
              value={testSeconds}
              onChange={(event) => setTestSeconds(event.currentTarget.value)}
              placeholder="秒"
              className="w-16"
              inputMode="numeric"
            />
            <Button size="sm" onClick={() => void handleTestGenerate()} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Music className="mr-2 h-4 w-4" aria-hidden />
              )}
              {isGenerating ? "生成中…" : "生成整曲"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground leading-5">
        MiniMax-Music3 本地整曲 BGM({MUSIC3_MIN_DURATION_S}-{MUSIC3_MAX_DURATION_S} 秒/立体声 WAV,
        [Instrumental] 纯音乐,同提示词+同种子=同一文件;采样率以实测为准,官方口径 32kHz)。约 12 GB,仅在点击下载时获取,
        与其他本地模型共用缓存目录;生成需数分钟(30 分钟硬限)。生成 WAV 经工作台
        「章节共享音频」导入为 BGM。引擎来源:MiniMax-Music3 Community License
        (商用需在产品界面标注「MiniMax-Music3」;年营收超 2000 万美元需书面授权)。
      </p>
    </div>
  );
}
