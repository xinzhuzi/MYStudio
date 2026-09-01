"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Server, ServerOff } from "lucide-react";
import { toast } from "sonner";
import type { SeedVr2ProbeResultV1 } from "@rendering/contracts/seedvr2-restore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * SeedVR2 图像修复(超分链修复档)——设置→本地配置(模型可见性铁律:用到的模型必须展示路径)。
 *
 * 模型跑在用户的 ComfyUI 内(7B sharp,修复→超分4K 约45秒/张),应用只读探测:
 * 服务状态(2s 快速失败)+ 模型文件在位。绝无自动下载。
 */

interface SeedVr2Bridge {
  probe: () => Promise<SeedVr2ProbeResultV1>;
}

function getBridge(): SeedVr2Bridge | undefined {
  return typeof window !== "undefined"
    ? (window as { seedvr2Restore?: SeedVr2Bridge }).seedvr2Restore
    : undefined;
}

const copyPath = async (path: string) => {
  try {
    await navigator.clipboard.writeText(path);
    toast.success("路径已复制");
  } catch {
    toast.error("复制路径失败");
  }
};

/** 探测 hook:挂载时探测一次 + 手动「探测」按钮重探;不常驻轮询。 */
export function useSeedVr2Probe() {
  const [status, setStatus] = useState<SeedVr2ProbeResultV1 | null>(null);
  const [probing, setProbing] = useState(false);
  const run = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setProbing(true);
    try {
      setStatus(await bridge.probe());
    } catch {
      // 探测失败保持旧快照
    } finally {
      setProbing(false);
    }
  }, []);
  useEffect(() => {
    void run();
  }, [run]);
  return { status, probing, reprobe: run, hasBridge: Boolean(getBridge()) };
}

export type SeedVr2Pill = "checking" | "ready" | "needs-runtime" | "model-missing" | "unsupported";

export function seedVr2PillOf(status: SeedVr2ProbeResultV1 | null, hasBridge: boolean): SeedVr2Pill {
  if (!hasBridge) return "unsupported";
  if (!status) return "checking";
  if (!status.modelPresent) return "model-missing";
  return status.serviceUp ? "ready" : "needs-runtime";
}

export function SeedVr2SettingsSection({ state }: { state: ReturnType<typeof useSeedVr2Probe> }) {
  const { status, probing, reprobe, hasBridge } = state;
  if (!hasBridge) {
    return (
      <div className="px-5 py-4 text-sm text-muted-foreground">
        SeedVR2 图像修复配置仅在桌面应用中可用。
      </div>
    );
  }
  const modelReady = status?.modelPresent === true;
  const serviceUp = status?.serviceUp === true;
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          {modelReady ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : status ? (
            <ServerOff className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {status
              ? modelReady
                ? `模型已就绪 · ${(status.modelBytes ?? 0) >= 1024 ** 3
                    ? `${((status.modelBytes ?? 0) / 1024 ** 3).toFixed(1)} GB`
                    : `${Math.round((status.modelBytes ?? 0) / 1024 ** 2)} MB`}`
                : "模型未找到（需在 ComfyUI 模型目录）"
              : "探测中…"}
            {" · "}
            <span className={cn(serviceUp ? "text-success" : "text-muted-foreground")}>
              ComfyUI {serviceUp ? "运行中" : "未运行"}
            </span>
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void reprobe()} disabled={probing}>
          <RefreshCw className={cn("mr-2 h-4 w-4", probing && "animate-spin")} aria-hidden />
          探测
        </Button>
      </div>

      {status ? (
        <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center">
          <span className="text-xs text-muted-foreground">修复模型</span>
          <Input
            readOnly
            value={status.modelFile}
            containerClassName="w-full min-w-0"
            className="min-w-0 font-mono text-xs"
            data-seedvr2-model-file
          />
          <div className="flex flex-nowrap gap-2 md:justify-end">
            <Button size="sm" variant="outline" onClick={() => void copyPath(status.modelFile)}>
              <Copy className="mr-1 h-4 w-4" aria-hidden />
              复制
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void window.electronAPI?.openPath(status.modelFile);
              }}
            >
              打开
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground">
        三个超分入口的「SeedVR2 模型修复+去噪」档使用（先修复画质、自动去噪、再放大 4K，约 45
        秒/张；大图自动缩到 1MP 内再修复）。模型由 ComfyUI 管理，需 ComfyUI 运行中；本应用不下载、不改动该模型。
      </p>
    </div>
  );
}
