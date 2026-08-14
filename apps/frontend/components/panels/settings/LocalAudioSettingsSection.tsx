"use client";

import { useState } from "react";
import { Check, Download, Loader2, Music } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAudioGenRuntimeSettings } from "./useAudioGenRuntimeSettings";

type LocalAudioSettingsSectionProps = {
  embedded?: boolean;
};

/**
 * 本地音乐生成配置区块 — 设置 → 本地配置。
 * MusicGen BGM: explicit model download + test generation into the user's
 * Music folder. Generated WAVs can be imported as chapter BGM via the
 * workbench shared-audio import.
 */
export function LocalAudioSettingsSection({ embedded = false }: LocalAudioSettingsSectionProps) {
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
      <div className={cn("px-5 py-4 text-sm text-muted-foreground", !embedded && "rounded-xl border border-border")}>
        本地音乐生成配置仅在桌面应用中可用。
      </div>
    );
  }

  const handleTestGenerate = async () => {
    if (!runtime.bridge || !testPrompt.trim()) {
      toast.error("请输入 BGM 描述");
      return;
    }
    setIsGenerating(true);
    try {
      // "__APP_EXPORTS__" is resolved to the app export dir by the main process;
      // the toast surfaces the full path for import into the chapter BGM track.
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
    <div className="space-y-4 px-5 py-4">
      {/* Runtime row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {isReady ? (
            <Check className="h-4 w-4 text-green-500" aria-hidden />
          ) : (
            <Music className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {isReady ? "运行时就绪" : (status?.setupMessage ?? "未检查（依赖共享 Python 运行环境）")}
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
            <Music className="mr-2 h-4 w-4" aria-hidden />
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

      {/* Test generation */}
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
