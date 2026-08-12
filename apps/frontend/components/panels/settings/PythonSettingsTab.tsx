import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { usePythonRuntimeSettings } from "./usePythonRuntimeSettings";

type PythonSettingsTabProps = {
  embedded?: boolean;
};

const RECONFIGURE_HOLD_MS = 1_000;

export function PythonSettingsTab({ embedded = false }: PythonSettingsTabProps) {
  const runtime = usePythonRuntimeSettings();
  const progress = runtime.status?.setupProgress;
  const isConfigured = Boolean(runtime.status?.installed);
  const [isHoldingReconfigure, setIsHoldingReconfigure] = useState(false);
  const reconfigureTimerRef = useRef<number | null>(null);

  const cancelReconfigureHold = useCallback(() => {
    if (reconfigureTimerRef.current !== null) {
      window.clearTimeout(reconfigureTimerRef.current);
      reconfigureTimerRef.current = null;
    }
    setIsHoldingReconfigure(false);
  }, []);

  const startReconfigureHold = useCallback(() => {
    if (!isConfigured || reconfigureTimerRef.current !== null) return;
    setIsHoldingReconfigure(true);
    reconfigureTimerRef.current = window.setTimeout(() => {
      reconfigureTimerRef.current = null;
      setIsHoldingReconfigure(false);
      void runtime.setupRuntime();
    }, RECONFIGURE_HOLD_MS);
  }, [isConfigured, runtime]);

  useEffect(() => () => {
    if (reconfigureTimerRef.current !== null) {
      window.clearTimeout(reconfigureTimerRef.current);
    }
  }, []);

  const handleOpenInstallDir = async () => {
    const target = runtime.config?.pythonRuntimeDir;
    if (!target || !window.electronAPI?.openPath) {
      toast.error("没有可打开的安装路径");
      return;
    }
    try {
      const result = await window.electronAPI.openPath(target);
      if (!result.success) {
        toast.error(result.error || "打开失败");
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "打开失败");
    }
  };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteRuntime = async () => {
    if (!window.confirm("确认删除整个 Python 运行环境目录？将清空已安装内容并停止 TTS，需重新配置。")) return;
    await runtime.deleteRuntime();
  };

  const content = (
    <div className="p-8 w-full space-y-6">
        <div className={embedded ? "space-y-5" : "rounded-xl border border-border bg-card p-5"}>
            <p className="text-sm text-muted-foreground">
              Python 是本地大模型、TTS 和插件的基础运行环境。为减小应用安装包体积，Python 不随应用内置；首次使用前请点击「开始配置」，将运行环境和所需依赖安装到本地项目存储路径。
            </p>

          <div className="mt-5 flex flex-col gap-6">
            {/* Install Path Input */}
            <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)] md:items-center lg:grid-cols-[5rem_minmax(50%,1fr)_auto]">
              <Label className="text-xs text-muted-foreground">安装路径</Label>
              <Input
                value={runtime.config?.pythonRuntimeDir || "启动时读取项目存储路径"}
                readOnly
                containerClassName="w-full min-w-0"
                className="min-w-0 font-mono text-xs truncate"
              />
              <div className="flex flex-wrap gap-2 md:col-start-2 lg:col-start-auto lg:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenInstallDir()}
                  disabled={!runtime.config?.pythonRuntimeDir || !runtime.hasRuntime}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  打开
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runtime.resetInstallDir()}
                  disabled={!runtime.hasRuntime}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  恢复默认
                </Button>
              </div>
            </div>

            {/* Download Source Input */}
            <div className="grid gap-3 md:grid-cols-[max-content_minmax(50%,1fr)_auto] md:items-center">
              <Label className="whitespace-nowrap text-xs text-muted-foreground">Python 下载源</Label>
              <Input
                value={runtime.pythonRuntimeUrlDraft}
                onChange={(event) => runtime.setPythonRuntimeUrlDraft(event.target.value)}
                placeholder={runtime.config?.defaultPythonRuntimeUrl || "自动检测平台默认源"}
                containerClassName="w-full min-w-0"
                className="min-w-0 font-mono text-xs truncate"
                disabled={!runtime.hasRuntime}
              />
              <div className="flex flex-nowrap gap-2 md:justify-end">
                <Button
                  className="shrink-0"
                  size="sm"
                  onClick={() => void runtime.saveConfig()}
                  disabled={runtime.isSaving || !runtime.hasRuntime}
                >
                  {runtime.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  保存
                </Button>
                <Button
                  className="shrink-0"
                  variant="outline"
                  size="sm"
                  onClick={runtime.resetRuntimeUrl}
                  disabled={runtime.isSaving || !runtime.hasRuntime}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  恢复默认
                </Button>
              </div>
            </div>

            <div>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5">
                {runtime.installedItems.map((item, index) => (
                  <Fragment key={`${item.label}-${index}`}>
                    <dt className="whitespace-nowrap text-muted-foreground">{item.label}</dt>
                    <dd className={cn("font-medium", item.status === "installed" ? "text-emerald-600" : item.status === "skipped" ? "text-muted-foreground" : item.status === "pending" ? "text-primary" : item.status === "failed" ? "text-destructive" : "text-foreground")}>{item.detail || item.label}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>

            {/* Requirements.txt Details - show separately below the box */}
            {runtime.requirements && (
              <details className="group border border-border rounded-md">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground bg-muted/40 hover:bg-muted transition-colors">
                  依赖清单 (backend/requirements.txt)
                </summary>
                <pre className="mx-3 mb-2 text-[10px] leading-3 text-muted-foreground overflow-x-auto p-2 bg-muted/20 rounded-sm whitespace-pre-wrap break-words">
{runtime.requirements.content}
                </pre>
              </details>
            )}

            {(runtime.status?.setupMessage || runtime.isSettingUp) && (
              <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium text-foreground">
                    {runtime.status?.setupMessage || "正在配置 Python 运行环境"}
                  </span>
                  {typeof progress === "number" && (
                    <span className="font-mono text-xs text-muted-foreground">{progress}%</span>
                  )}
                </div>
                {typeof progress === "number" ? (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                    />
                  </div>
                ) : (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {isConfigured && (
                <span id="python-reconfigure-hint" className="text-xs text-muted-foreground">
                  长按 1 秒
                </span>
              )}
              <Button
                className={cn(isConfigured && "select-none")}
                onClick={() => {
                  if (!isConfigured) void runtime.setupRuntime();
                }}
                onPointerDown={startReconfigureHold}
                onPointerUp={cancelReconfigureHold}
                onPointerLeave={cancelReconfigureHold}
                onPointerCancel={cancelReconfigureHold}
                onKeyDown={(event) => {
                  if (!isConfigured || event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  startReconfigureHold();
                }}
                onKeyUp={(event) => {
                  if (!isConfigured || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  cancelReconfigureHold();
                }}
                onBlur={cancelReconfigureHold}
                aria-describedby={isConfigured ? "python-reconfigure-hint" : undefined}
                disabled={!runtime.hasRuntime || runtime.isSettingUp || runtime.isSetupActive}
              >
                {(runtime.isSettingUp || runtime.isSetupActive) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : isConfigured ? (
                  <RefreshCw className={cn("mr-2 h-4 w-4", isHoldingReconfigure && "animate-spin")} />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {isConfigured ? (isHoldingReconfigure ? "继续按住" : "重新配置") : "开始配置"}
              </Button>
            </div>
        </div>
      </div>
    </div>
  );

  return embedded ? content : <ScrollArea className="h-full">{content}</ScrollArea>;
}

type InstallSummaryProps = {
  installedItems: { label: string; detail: string; status: "pending" | "installed" | "skipped" | "failed" }[];
  pythonExecutablePath: string;
  requirements?: { content: string; path: string } | null;
};

function _InstallSummary({ installedItems, pythonExecutablePath, requirements }: InstallSummaryProps) {
  const pythonItem = installedItems.find((item) => item.label.toLowerCase().includes("python"));
  const dependencyItems = installedItems.filter((item) => item !== pythonItem);
  const hasFailed = installedItems.some((item) => item.status === "failed");
  const hasPending = installedItems.some((item) => item.status === "pending");

  const pythonStatusText = installedItems.length === 0
    ? "未配置"
    : pythonItem?.status === "installed"
      ? "已安装"
      : pythonItem?.status === "failed"
        ? "安装失败"
        : pythonItem?.status === "pending"
          ? "安装中"
          : pythonItem?.status === "skipped"
            ? "已存在"
            : "未配置";

  const folderStatusText = installedItems.length === 0
    ? "未生成"
    : hasFailed
      ? "不完整"
      : hasPending
        ? "配置中"
        : pythonExecutablePath
          ? "完整"
          : "未生成";

  const depsStatusText = dependencyItems.length === 0
    ? "未安装"
    : dependencyItems.some((item) => item.status === "failed")
      ? "有失败项"
      : dependencyItems.some((item) => item.status === "pending")
        ? "安装中"
        : "已完整";

  const Row = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-medium",
          tone,
        )}
      >
        {value}
      </dd>
    </>
  );

  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 items-center text-xs text-muted-foreground">
      <Row label="Python 运行环境" value={pythonStatusText} tone={pythonStatusText === "已安装" ? "text-emerald-600" : pythonStatusText === "安装失败" ? "text-destructive" : "text-muted-foreground"} />
      <Row label="文件夹完整性" value={folderStatusText} tone={folderStatusText === "完整" ? "text-emerald-600" : folderStatusText === "不完整" ? "text-destructive" : "text-muted-foreground"} />
      <dt className="text-muted-foreground">依赖清单</dt>
      <dd className="text-foreground">
        {requirements?.content ? (
          <details>
            <summary className="cursor-pointer truncate font-mono text-xs text-muted-foreground">
              {requirements.path}
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px]">
              {requirements.content}
            </pre>
          </details>
        ) : (
          <span className="break-all font-mono text-xs text-muted-foreground">
            {requirements?.path || "未找到 requirements.txt"}
          </span>
        )}
      </dd>
      <Row label="pip 依赖完整性" value={depsStatusText} tone={depsStatusText === "已完整" ? "text-emerald-600" : depsStatusText === "有失败项" ? "text-destructive" : "text-muted-foreground"} />
    </dl>
  );
}
