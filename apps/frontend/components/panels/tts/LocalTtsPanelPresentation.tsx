import type { ChangeEvent, ReactNode } from "react";
import { AlertCircle, Download, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TtsModelRow, TtsRuntimeStatus } from "@/types/tts";
import { formatBytes, formatSizeMb } from "./local-tts-formatters";
import {
  LocalTtsModelDetailsDialog,
  ModelStateIcon,
  ModelStateLabel,
  PendingScanLabel,
} from "./LocalTtsModelDetailsDialog";
import {
  getLocalTtsModelState,
  type ModelProgressEvent,
} from "./local-tts-model-state";

export { LocalTtsModelDetailsDialog };

export function NativeTtsSelect({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-hidden focus:ring-1 focus:ring-ring",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function RuntimeStatusLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 leading-6">
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className="min-w-0 break-all text-muted-foreground">{value}</span>
    </div>
  );
}

const runtimeSetupMessages: Record<NonNullable<TtsRuntimeStatus["setupStage"]>, string> = {
  idle: "本地 TTS 后端未启动",
  checking: "正在检查 Python 运行环境",
  "downloading-python": "正在下载 Python 运行环境",
  "extracting-python": "正在配置 Python 仓库",
  "installing-deps": "正在安装 TTS 依赖",
  "starting-backend": "本地 TTS 后端启动中",
  ready: "本地 TTS 后端已就绪",
  failed: "本地 TTS 后端启动失败",
};

export function RuntimeSetupProgress({
  status,
  starting,
}: {
  status: TtsRuntimeStatus | null;
  starting: boolean;
}) {
  const setupStage = status?.setupStage ?? "idle";
  const active = starting || ["checking", "downloading-python", "extracting-python", "installing-deps", "starting-backend"].includes(setupStage);
  const failed = setupStage === "failed";
  if (!active && !failed) return null;

  const progress = typeof status?.setupProgress === "number" ? Math.max(0, Math.min(100, status.setupProgress)) : undefined;
  const message = status?.setupMessage || runtimeSetupMessages[setupStage];

  return (
    <div className={cn(
      "mt-4 rounded-xl border p-3",
      failed ? "border-red-400/20 bg-red-500/[0.06]" : "border-primary/20 bg-primary/[0.04]",
    )}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className={cn("flex min-w-0 items-center gap-2 font-medium", failed ? "text-destructive" : "text-foreground")}>
          {failed ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
          <span className="truncate">{message}</span>
        </div>
        {typeof progress === "number" && (
          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(progress)}%</span>
        )}
      </div>
      <Progress value={progress ?? (active ? 35 : 0)} className={cn("mt-3 h-1.5", progress === undefined && active && "opacity-60")} />
      {status?.pythonRuntimeDir && (
        <div className="mt-2 break-all text-xs text-muted-foreground">
          Python 路径：{status.pythonRuntimeDir}
        </div>
      )}
    </div>
  );
}

export function ErrorBanner({ errors, onClear }: { errors: Record<string, string>; onClear: () => void }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 backdrop-blur-lg p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertCircle className="h-4 w-4" />
          下载/运行错误
        </div>
        <Button size="sm" variant="ghost" onClick={onClear}>清除</Button>
      </div>
      <div className="space-y-2">
        {entries.map(([key, message]) => (
          <div key={key} className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{key}</span>：{message}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModelRow({
  row,
  progress,
  canDownload,
  onOpen,
  onDownload,
  onCancel,
}: {
  row: TtsModelRow;
  progress?: ModelProgressEvent;
  canDownload: boolean;
  onOpen: (row: TtsModelRow) => void;
  onDownload: (row: TtsModelRow) => void;
  onCancel: (row: TtsModelRow) => void;
}) {
  const state = getLocalTtsModelState(row, progress);
  const progressValue = progress?.progress ?? (state === "downloaded" || state === "loaded" ? 100 : 0);

  return (
    <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_160px_120px_180px] gap-3 items-center border-b border-white/[0.06] px-4 py-3 last:border-b-0 transition-colors hover:bg-white/[0.02]">
      <button type="button" onClick={() => onOpen(row)} className="min-w-0 text-left">
        <div className="flex items-center gap-2">
          <ModelStateIcon state={state} />
          <span className="truncate text-sm font-medium text-foreground">{row.displayName}</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{row.description}</div>
      </button>
      <div className="text-xs text-muted-foreground">{row.engine}</div>
      <div className="truncate text-xs text-muted-foreground">{row.languages.join(" / ")}</div>
      <div className="text-xs text-muted-foreground">{formatSizeMb(row.sizeMb)}</div>
      <div className="flex items-center justify-end gap-2">
        {state === "downloading" ? (
          <Button size="sm" variant="outline" onClick={() => onCancel(row)}>
            <Square className="mr-1 h-3.5 w-3.5" />
            停止
          </Button>
        ) : !canDownload && (state === "missing" || state === "failed") ? (
          <PendingScanLabel />
        ) : state === "missing" || state === "failed" ? (
          <Button size="sm" variant={state === "failed" ? "outline" : "default"} onClick={() => onDownload(row)}>
            <Download className="mr-1 h-3.5 w-3.5" />
            {state === "failed" ? "重试" : "下载"}
          </Button>
        ) : (
          <ModelStateLabel state={state} />
        )}
        <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
          详情
        </Button>
      </div>
      {(state === "downloading" || state === "failed") && (
        <div className="col-span-5 pl-6 pr-2">
          <Progress value={progressValue} className="h-1.5" />
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">{progress?.filename || (state === "failed" ? progress?.error || "下载失败" : "准备下载...")}</span>
            <span className="shrink-0">
              {state === "downloading"
                ? `${Math.round(progressValue)}% · ${formatBytes(progress?.current)} / ${formatBytes(progress?.total)}`
                : "失败"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
