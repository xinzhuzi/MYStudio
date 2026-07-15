import { Download, Folder, Loader2, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { DevelopmentSettings } from "@/stores/app-settings-store";
import type { DiagnosticsLogInfo } from "@/types/diagnostics";

type DevelopmentSettingsTabProps = {
  settings: DevelopmentSettings;
  onChange: (settings: Partial<DevelopmentSettings>) => void;
  hasDevTools: boolean;
  isOpeningDevTools: boolean;
  onOpenDevTools: () => void;
  hasDiagnostics: boolean;
  diagnosticsInfo: DiagnosticsLogInfo | null;
  isDiagnosticsLoading: boolean;
  isExportingDiagnostics: boolean;
  isClearingDiagnostics: boolean;
  onRefreshDiagnostics: () => void;
  onOpenDiagnosticsFolder: () => void;
  onExportDiagnostics: () => void;
  onClearDiagnostics: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DevelopmentSettingsTab({
  settings,
  onChange,
  hasDevTools,
  isOpeningDevTools,
  onOpenDevTools,
  hasDiagnostics,
  diagnosticsInfo,
  isDiagnosticsLoading,
  isExportingDiagnostics,
  isClearingDiagnostics,
  onRefreshDiagnostics,
  onOpenDiagnosticsFolder,
  onExportDiagnostics,
  onClearDiagnostics,
}: DevelopmentSettingsTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">开发模式</h3>
          <p className="text-sm text-muted-foreground mt-1">
            用于排查页面、网络、接口和渲染日志。普通制作流程无需开启。
          </p>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-5">
          <h4 className="font-medium text-foreground flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            控制台
          </h4>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">显示开发工具入口</p>
              <p className="text-xs text-muted-foreground">
                开启后显示「打开控制台」按钮，用于当前窗口的 Chromium DevTools。
              </p>
            </div>
            <Switch
              checked={settings.showDevToolsControls}
              onCheckedChange={(checked) => onChange({ showDevToolsControls: checked })}
            />
          </div>

          {settings.showDevToolsControls && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-3">
              <div>
                <p className="text-sm font-medium">打开控制台</p>
                <p className="text-xs text-muted-foreground">会打开当前桌面窗口对应的 DevTools 调试面板。</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDevTools}
                disabled={!hasDevTools || isOpeningDevTools}
              >
                {isOpeningDevTools
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  : <Terminal className="h-4 w-4 mr-1" />}
                打开控制台
              </Button>
            </div>
          )}
          {!hasDevTools && <p className="text-xs text-muted-foreground">控制台入口仅在桌面应用窗口中可用。</p>}
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              诊断日志
            </h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshDiagnostics}
              disabled={!hasDiagnostics || isDiagnosticsLoading}
            >
              {isDiagnosticsLoading
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <RefreshCw className="h-4 w-4 mr-1" />}
              刷新
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">日志大小</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {diagnosticsInfo ? formatBytes(diagnosticsInfo.totalBytes) : "未读取"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">近 24 小时警告</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{diagnosticsInfo?.recentWarnCount ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">近 24 小时错误</p>
              <p className="mt-1 text-sm font-semibold text-destructive">{diagnosticsInfo?.recentErrorCount ?? 0}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">目录</p>
            <p className="text-xs font-mono text-foreground break-all">
              {diagnosticsInfo?.directory || "仅桌面应用可用"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpenDiagnosticsFolder} disabled={!hasDiagnostics}>
              <Folder className="h-4 w-4 mr-1" />打开文件夹
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExportDiagnostics}
              disabled={!hasDiagnostics || isExportingDiagnostics}
            >
              {isExportingDiagnostics
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Download className="h-4 w-4 mr-1" />}
              导出诊断包
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearDiagnostics}
              disabled={!hasDiagnostics || isClearingDiagnostics}
            >
              {isClearingDiagnostics
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Trash2 className="h-4 w-4 mr-1" />}
              清理日志
            </Button>
          </div>

          <div className="rounded-lg bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">提示：</span>
            日志只保存在本机，默认保留 30 天；API Key、Authorization、token、base64 图片和长提示词会自动脱敏。
          </div>
          {!hasDiagnostics && <p className="text-xs text-muted-foreground">诊断日志仅在桌面应用窗口中可用。</p>}
        </div>
      </div>
    </ScrollArea>
  );
}
