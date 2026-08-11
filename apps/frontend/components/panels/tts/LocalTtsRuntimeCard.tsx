import {
  Check,
  FolderInput,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  modelCacheDirty: boolean;
  migratingStorage: boolean;
  onModelCacheDirChange: (value: string) => void;
  onApplyModelCacheDir: () => void;
  onSelectModelCacheDir: () => void;
  onOpenModelCacheDir: () => void;
  onResetModelCacheDir: () => void;
  onMigrateStorage: () => void;
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
  modelCacheDirty,
  migratingStorage,
  onModelCacheDirChange,
  onApplyModelCacheDir,
  onSelectModelCacheDir,
  onOpenModelCacheDir,
  onResetModelCacheDir,
  onMigrateStorage,
  onManualRefresh,
  onStart,
  onStop,
}: LocalTtsRuntimeCardProps) {
  const scanPaths = modelCacheInfo?.scan_paths?.filter(Boolean) ?? [];
  const storageLayout = runtimeStatus?.storageLayout;
  const runtimeSetupStage = runtimeStatus?.setupStage ?? "idle";
  const runtimeSetupActive = [
    "checking",
    "downloading-python",
    "extracting-python",
    "installing-deps",
    "starting-backend",
  ].includes(runtimeSetupStage);
  const canChangeModelCacheDir = !applyingModelCacheDir && !runtimeStatus?.running;
  const defaultModelCacheDir = runtimeStatus?.defaultModelCacheDir ?? "";

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
            <RuntimeStatusLine label="运行数据" value={runtimeStatus?.cacheDir || "TTS/runtime"} />
            <RuntimeStatusLine label="Python" value={runtimeStatus?.pythonRuntimeDir || "启动时配置"} />
            <RuntimeStatusLine label="模型缓存" value={modelCacheInfo?.path || "启动后读取"} />
            <RuntimeStatusLine label="下载写入" value={modelCacheInfo?.download_path || "启动后读取"} />
            <RuntimeStatusLine label="扫描路径" value={scanPaths.length ? scanPaths.join("；") : "启动后读取"} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onManualRefresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            刷新 TTS 状态
          </Button>
          {runtimeStatus?.running ? (
            <Button type="button" variant="outline" onClick={onStop}>
              <Unplug className="mr-2 h-4 w-4" />
              停止 TTS 后端服务
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onStart}
              disabled={starting || runtimeSetupActive || runtimeStatus?.installed === false}
            >
              {starting || runtimeSetupActive
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Play className="mr-2 h-4 w-4" />}
              启动 TTS 后端服务
            </Button>
          )}
        </div>
        <div className="w-full">
          <section className="mt-5 border-y border-border py-4" aria-label="TTS 文件夹配置">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FolderOpen className="h-4 w-4 text-primary" />
                TTS 文件夹
              </div>
              <span className={cn(
                "text-xs",
                storageLayout?.migrationState === "conflict" ? "text-destructive" : "text-muted-foreground",
              )}>
                {storageLayout?.migrationState === "ready"
                  ? "待迁移旧数据"
                  : storageLayout?.migrationState === "conflict"
                    ? "迁移已阻止"
                    : "已使用统一目录"}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <RuntimeStatusLine label="根目录" value={storageLayout?.rootDir || "启动后读取"} />
              <RuntimeStatusLine label="运行数据" value={storageLayout?.runtimeDir || "启动后读取"} />
              <RuntimeStatusLine label="默认模型" value={storageLayout?.modelsDir || "启动后读取"} />
              <RuntimeStatusLine label="HF 迁移来源" value={storageLayout?.legacyHuggingFaceHubDir || "启动后读取"} />
            </div>
            {storageLayout?.migrationMessage && (
              <p className={cn(
                "mt-3 text-xs leading-5",
                storageLayout.migrationState === "conflict" ? "text-destructive" : "text-muted-foreground",
              )}>
                {storageLayout.migrationMessage}
              </p>
            )}
            {storageLayout?.migrationState === "ready" && (
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={onMigrateStorage}
                disabled={migratingStorage}
              >
                {migratingStorage
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <FolderInput className="mr-2 h-4 w-4" />}
                迁移到 TTS 文件夹
              </Button>
            )}
          </section>
          <RuntimeSetupProgress status={runtimeStatus} starting={starting} />
          <div className="mt-5 grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)] md:items-center lg:grid-cols-[5rem_minmax(50%,1fr)_auto]">
            <Label className="text-xs text-muted-foreground">安装路径</Label>
            <Input
              aria-label="模型缓存安装路径"
              value={draftModelCacheDir}
              onChange={(event) => onModelCacheDirChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && modelCacheDirty && canChangeModelCacheDir) {
                  event.preventDefault();
                  onApplyModelCacheDir();
                }
              }}
              placeholder={defaultModelCacheDir || "启动时读取项目存储路径"}
              containerClassName="w-full min-w-0"
              className="min-w-0 font-mono text-xs"
              disabled={!canChangeModelCacheDir}
            />
            <div className="flex flex-wrap gap-2 md:col-start-2 lg:col-start-auto lg:justify-end">
              <Button
                type="button"
                size="sm"
                onClick={onApplyModelCacheDir}
                disabled={!modelCacheDirty || !canChangeModelCacheDir}
              >
                {applyingModelCacheDir ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                保存
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onSelectModelCacheDir} disabled={!canChangeModelCacheDir}>
                <FolderOpen className="mr-2 h-4 w-4" />
                选择模型目录
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onOpenModelCacheDir} disabled={!draftModelCacheDir || modelCacheDirty}>
                <FolderOpen className="mr-2 h-4 w-4" />
                打开
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onResetModelCacheDir} disabled={!defaultModelCacheDir || !canChangeModelCacheDir}>
                <RotateCcw className="mr-2 h-4 w-4" />
                恢复默认
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {runtimeStatus?.hfHubCacheDir
              && runtimeStatus.hfHubCacheDir !== draftModelCacheDir && (
              <div className="text-xs text-muted-foreground">
                HF 缓存：<span className="text-foreground">{runtimeStatus.hfHubCacheDir}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
