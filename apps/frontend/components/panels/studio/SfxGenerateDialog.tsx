"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { checkSfxModelReady, notifySfxModelMissing } from "@/lib/sfx/sfx-generation-precheck";
import { SFX_MAX_DURATION_S } from "@/types/sfx-gen";

interface SfxGenBridge {
  generate: (payload: { prompt: string; seed?: number; seconds?: number; outputDir: string }) => Promise<{
    status: string;
    outputPath?: string;
    code?: string;
    message?: string;
  }>;
}

function getSfxGenBridge(): SfxGenBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { sfxGenRuntime?: SfxGenBridge }).sfxGenRuntime
    : undefined;
}

/**
 * 工作台「本地生成音效」对话框(08-19-local-sfx-generation P2)。
 * 提示词+种子+时长 → 主进程生成(种子确定性)→ 沿既有 importAudio 绑定为分镜 sfx。
 * 缺模型时 fail-closed:toast + 去设置深链,绝不自动下载。
 */
export function SfxGenerateDialog(props: {
  open: boolean;
  shotLabel: string;
  onOpenChange: (open: boolean) => void;
  onGenerated: (wavPath: string) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState("短促的呼啸声,快速掠过");
  const [seed, setSeed] = useState("42");
  const [seconds, setSeconds] = useState("2");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (props.open) {
      setPrompt("短促的呼啸声,快速掠过");
      setSeed("42");
      setSeconds("2");
    }
  }, [props.open]);

  const handleGenerate = async () => {
    const bridge = getSfxGenBridge();
    if (!bridge) {
      toast.error("本地音效生成仅在桌面应用中可用");
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("请输入音效描述");
      return;
    }
    const parsedSeed = Number.parseInt(seed, 10);
    if (!Number.isInteger(parsedSeed)) {
      toast.error("种子必须是整数");
      return;
    }
    const parsedSeconds = Number.parseFloat(seconds);
    if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
      toast.error("时长必须是正数");
      return;
    }

    const readiness = await checkSfxModelReady();
    if (readiness === "missing") {
      notifySfxModelMissing();
      return;
    }
    if (readiness === "unknown") {
      toast.error("本地音效生成仅在桌面应用中可用");
      return;
    }

    setGenerating(true);
    try {
      // "__APP_EXPORTS__" 由主进程解析为应用导出目录;importAudio 会复制入项目
      // 存储,导出目录只是生成中转(与 BGM 生成同款)。
      const result = await bridge.generate({
        prompt: trimmed,
        seed: parsedSeed,
        seconds: Math.min(SFX_MAX_DURATION_S, parsedSeconds),
        outputDir: "__APP_EXPORTS__",
      });
      if (result.status === "accepted" && result.outputPath) {
        await props.onGenerated(result.outputPath);
        props.onOpenChange(false);
      } else if (result.code === "model-not-downloaded") {
        notifySfxModelMissing();
      } else {
        toast.error(result.message || "音效生成失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "音效生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>本地生成音效</DialogTitle>
          <p className="text-xs text-muted-foreground">
            为分镜「{props.shotLabel}」生成短音效并绑定为 SFX(≤{SFX_MAX_DURATION_S} 秒)。
            同提示词+同种子=同一文件,可安全复用;已绑定的分镜 SFX 会被替换。
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sfx-prompt">音效描述</Label>
            <Input
              id="sfx-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder="如:金属撞击声,清脆短促"
            />
          </div>
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="sfx-seed">种子</Label>
              <Input
                id="sfx-seed"
                value={seed}
                onChange={(event) => setSeed(event.currentTarget.value)}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sfx-seconds">秒数</Label>
              <Input
                id="sfx-seconds"
                value={seconds}
                onChange={(event) => setSeconds(event.currentTarget.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={generating}>
            取消
          </Button>
          <Button onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="mr-2 h-4 w-4" aria-hidden />
            )}
            {generating ? "生成中…" : "生成并绑定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
