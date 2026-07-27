import {
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TtsModelCacheInfo, TtsRuntimeStatus } from "@/types/tts";
import { cn } from "@/lib/utils";
import { RuntimeSetupProgress, RuntimeStatusLine } from "./LocalTtsPanelPresentation";

export interface LocalTtsRuntimeCardProps {
  runtimeStatus: TtsRuntimeStatus | null;
  modelCacheInfo: TtsModelCacheInfo | null;
  draftModelCacheDir: string;
  starting: boolean;
  refreshing: boolean;
  applyingModelCacheDir: boolean;
  onSelectModelCacheDir: () => void;
  onManualRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
}

export function LocalTtsRuntimeCard({
  runtimeStatus,
  modelCacheInfo,
  draftModelCacheDir,
  starting,
  refreshing,
  applyingModelCacheDir,
  onSelectModelCacheDir,
  onManualRefresh,
  onStart,
  onStop,
}: LocalTtsRuntimeCardProps) {
  const scanPaths = modelCacheInfo?.scan_paths?.filter(Boolean) ?? [];
  const runtimeSetupStage = runtimeStatus?.setupStage ?? "idle";
  const runtimeSetupActive = [
    "checking",
    "downloading-python",
    "extracting-python",
    "installing-deps",
    "starting-backend",
  ].includes(runtimeSetupStage);

  return (
    <div className="tts-glass-card rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            本地 TTS
          </h3>
          <div className="mt-2 space-y-1 text-sm">
            <RuntimeStatusLine
              label="状态"
              value={runtimeStatus?.running
                ? (runtimeStatus.managed === false ? "运行中（残留进程）" : "运行中")
                : runtimeStatus?.installed
                  ? "已安装，未运行"
                  : "未安装"}
            />
            <RuntimeStatusLine label="后端" value={runtimeStatus?.baseUrl ?? "http://127.0.0.1:17593"} />
            <RuntimeStatusLine label="运行数据" value={runtimeStatus?.cacheDir || "tts-runtime"} />
            <RuntimeStatusLine label="Python" value={runtimeStatus?.pythonRuntimeDir || "启动时配置"} />
            <RuntimeStatusLine label="模型缓存" value={modelCacheInfo?.path || "启动后读取"} />
            <RuntimeStatusLine label="下载写入" value={modelCacheInfo?.download_path || "启动后读取"} />
            <RuntimeStatusLine label="扫描路径" value={scanPaths.length ? scanPaths.join("；") : "启动后读取"} />
          </div>
          <RuntimeSetupProgress status={runtimeStatus} starting={starting} />
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
            <Button
              type="button"
              variant="outline"
              onClick={onSelectModelCacheDir}
              disabled={applyingModelCacheDir || runtimeStatus?.running}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              选择模型目录
            </Button>
          </div>
          <div className="mt-3 space-y-1">
            {draftModelCacheDir && (
              <div className="text-xs text-muted-foreground">
                当前路径：<span className="text-foreground">{draftModelCacheDir}</span>
              </div>
            )}
            {runtimeStatus?.defaultModelCacheDir
              && runtimeStatus.defaultModelCacheDir !== draftModelCacheDir && (
              <div className="text-xs text-muted-foreground">
                项目路径：<span className="text-foreground">{runtimeStatus.defaultModelCacheDir}</span>
              </div>
            )}
            {runtimeStatus?.systemModelCacheDir
              && runtimeStatus.systemModelCacheDir !== draftModelCacheDir && (
              <div className="text-xs text-muted-foreground">
                HF 路径：<span className="text-foreground">{runtimeStatus.systemModelCacheDir}</span>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onManualRefresh} disabled={refreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
              刷新
            </Button>
            {runtimeStatus?.running ? (
              <Button variant="outline" onClick={onStop}>
                <Unplug className="mr-2 h-4 w-4" />
                停止
              </Button>
            ) : (
              <Button
                onClick={onStart}
                disabled={starting || runtimeSetupActive || runtimeStatus?.installed === false}
              >
                {starting || runtimeSetupActive
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Play className="mr-2 h-4 w-4" />}
                启动
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
