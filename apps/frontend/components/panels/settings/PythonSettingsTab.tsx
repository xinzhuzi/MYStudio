import { Check, Download, Loader2, RefreshCw, RotateCcw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { usePythonRuntimeSettings } from "./usePythonRuntimeSettings";

export function PythonSettingsTab() {
  const runtime = usePythonRuntimeSettings();
  const progress = runtime.status?.setupProgress;

  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary" />
                Python 运行环境
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                不随应用启动自动配置；点击开始配置后，才会下载 Python 并安装 TTS 依赖到项目存储路径。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void runtime.setupRuntime()}
                disabled={!runtime.hasRuntime || runtime.isSettingUp || runtime.isSetupActive}
              >
                {(runtime.isSettingUp || runtime.isSetupActive) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                开始配置
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runtime.resetRuntimeUrl}
                disabled={runtime.isSaving || !runtime.hasRuntime}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                恢复默认下载源
              </Button>
            </div>
          </div>

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

          <div className="mt-5 grid gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">安装路径</Label>
              <Input
                value={runtime.config?.pythonRuntimeDir || "启动时读取项目存储路径"}
                readOnly
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Python 下载源</Label>
              <div className="flex gap-2">
                <Input
                  value={runtime.pythonRuntimeUrlDraft}
                  onChange={(event) => runtime.setPythonRuntimeUrlDraft(event.target.value)}
                  placeholder={runtime.config?.defaultPythonRuntimeUrl || "默认 python-build-standalone 下载源"}
                  className="font-mono text-xs"
                  disabled={!runtime.hasRuntime}
                />
                <Button
                  onClick={() => void runtime.saveConfig()}
                  disabled={runtime.isSaving || !runtime.hasRuntime}
                >
                  {runtime.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  保存
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                留空使用默认源；需要内网或国内镜像时，填写完整的 Python runtime 压缩包 URL。
              </p>
            </div>
            {runtime.config?.defaultPythonRuntimeUrl && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                默认源：<span className="break-all font-mono text-foreground">{runtime.config.defaultPythonRuntimeUrl}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">安装明细</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                这里展示 Python 配置过程已经安装、跳过或失败的项目。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runtime.refreshConfig()}
              disabled={!runtime.hasRuntime}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-border">
            <div className="grid gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm md:grid-cols-[160px_96px_minmax(0,1fr)] md:items-center">
              <span className="font-medium text-foreground">Python 使用路径</span>
              <span className="w-fit rounded px-2 py-0.5 text-xs bg-primary/10 text-primary">当前</span>
              <span className="break-all font-mono text-xs text-foreground">{runtime.pythonExecutablePath}</span>
            </div>
            {runtime.installedItems.length > 0 ? (
              <div className="divide-y divide-border">
                {runtime.installedItems.map((item) => (
                  <div key={item.label} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[160px_96px_minmax(0,1fr)] md:items-center">
                    <span className="font-medium text-foreground">{item.label}</span>
                    <span className={cn(
                      "w-fit rounded px-2 py-0.5 text-xs",
                      item.status === "installed" && "bg-emerald-500/10 text-emerald-600",
                      item.status === "skipped" && "bg-blue-500/10 text-blue-600",
                      item.status === "failed" && "bg-destructive/10 text-destructive",
                      item.status === "pending" && "bg-muted text-muted-foreground",
                    )}>
                      {item.status === "installed" ? "已安装" : item.status === "skipped" ? "已存在" : item.status === "failed" ? "失败" : "等待中"}
                    </span>
                    <span className="break-all font-mono text-xs text-muted-foreground">{item.detail}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                暂无安装记录。点击开始配置后会显示 Python 运行环境和 TTS 依赖明细。
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
