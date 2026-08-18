"use client";

import { useState } from "react";
import { Check, Download, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSfxGenRuntimeSettings } from "./useSfxGenRuntimeSettings";
import { SFX_MAX_DURATION_S } from "@/types/sfx-gen";

type SfxGenSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 本地音效生成配置区块 — 设置 → 本地配置(08-19-local-sfx-generation P1)。
 * 短音效 one-shot:提示词+种子确定性生成(≤5s),显式下载政策与深度/生歌同款。
 * 生成的 WAV 落导出目录,可经工作台 sfx 绑定导入成片。
 */
export function SfxGenSettingsSection({ embedded = false }: SfxGenSettingsSectionProps) {
  const runtime = useSfxGenRuntimeSettings();
  const status = runtime.status;
  const enabledModel = status?.models?.find((row) => row.enabled !== false);
  const isReady = status?.setupStage === "ready";
  const downloaded = enabledModel?.downloaded ?? false;
  const downloading = status?.downloadStatus === "downloading";
  const [testPrompt, setTestPrompt] = useState("短促的呼啸声,快速掠过");
  const [testSeed, setTestSeed] = useState("42");
  const [isGenerating, setIsGenerating] = useState(false);

  if (!runtime.hasRuntime) {
    return (
      <div className={cn("px-5 py-4 text-sm text-muted-foreground", !embedded && "rounded-xl border border-border")}>
        本地音效生成配置仅在桌面应用中可用。
      </div>
    );
  }

  const handleTestGenerate = async () => {
    if (!runtime.bridge || !testPrompt.trim()) {
      toast.error("请输入音效描述");
      return;
    }
    const seed = Number.parseInt(testSeed, 10);
    if (!Number.isInteger(seed)) {
      toast.error("种子必须是整数");
      return;
    }
    setIsGenerating(true);
    try {
      // "__APP_EXPORTS__" 由主进程解析为应用导出目录;同种子+同提示词=同文件,
      // 渲染缓存(hashInput)友好。
      const result = await runtime.bridge.generate({
        prompt: testPrompt.trim(),
        seed,
        seconds: 2,
        outputDir: "__APP_EXPORTS__",
      });
      if (result.status === "accepted" && result.outputPath) {
        toast.success(`音效已生成: ${result.outputPath}`);
      } else if (result.code === "model-not-downloaded") {
        toast.error("音效模型未下载,请先下载模型(与本地音乐生成共用缓存)");
      } else {
        toast.error(result.message || "音效生成失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "音效生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Runtime row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? (
            <Check className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {isReady ? "运行时就绪" : (status?.setupMessage ?? "未检查(依赖共享 Python 运行环境)")}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runtime.setupRuntime()}
          disabled={runtime.isSettingUp}
        >
          {runtime.isSettingUp ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Zap className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isReady ? "重新检查" : "检查运行时"}
        </Button>
      </div>

      {/* Model row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {downloaded ? (
            <Check className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {enabledModel?.label ?? "音效生成(MusicGen 引擎)"}
            {downloaded && enabledModel?.sizeMb != null ? ` · ${(enabledModel.sizeMb / 1024).toFixed(1)} GB` : ""}
            {" — "}
            {downloading ? "下载中" : downloaded ? "已就绪" : "未下载"}
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

      {/* Test generation */}
      {downloaded ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={testPrompt}
              onChange={(event) => setTestPrompt(event.currentTarget.value)}
              placeholder="音效描述,如:金属撞击声,清脆短促"
              className="flex-1"
            />
            <Input
              value={testSeed}
              onChange={(event) => setTestSeed(event.currentTarget.value)}
              placeholder="种子"
              className="w-20"
              inputMode="numeric"
            />
            <Button size="sm" onClick={() => void handleTestGenerate()} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Zap className="mr-2 h-4 w-4" aria-hidden />
              )}
              {isGenerating ? "生成中…" : "生成音效"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground leading-5">
        本地短音效生成(whoosh/impact/riser 等,≤{SFX_MAX_DURATION_S} 秒):同提示词+同种子=同一文件,
        可安全用于渲染缓存。模型与本地音乐生成共用缓存(已下载 MusicGen 则零额外下载);
        仅在点击下载时获取,生成时绝不自动下载。权重许可 CC-BY-NC(非商用)。
        AudioGen 引擎为选型候选,待实测与许可核定后启用。
      </p>
    </div>
  );
}
