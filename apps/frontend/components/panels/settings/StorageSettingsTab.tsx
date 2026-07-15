import { Download, Folder, HardDrive, Info, Loader2, RefreshCw } from "lucide-react";
import { UpdateDialog } from "@/components/UpdateDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { formatStorageBytes, useStorageSettings } from "./useStorageSettings";

export function StorageSettingsTab() {
  const storage = useStorageSettings();

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-8 w-full space-y-8">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              存储设置
            </h3>
            <p className="text-sm text-muted-foreground mt-1">设置资源共享策略、存储位置与缓存管理</p>
          </div>

          {!storage.hasStorageManager && (
            <div className="flex items-start gap-3 p-4 bg-muted/50 border border-border rounded-lg">
              <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">存储设置仅在桌面版中可用。</p>
            </div>
          )}

          <div className="p-6 border border-border rounded-xl bg-card space-y-4">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <Folder className="h-4 w-4" />
              资源共享
            </h4>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">角色库跨项目共享</p>
                <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
              </div>
              <Switch
                checked={storage.resourceSharing.shareCharacters}
                onCheckedChange={storage.toggleShareCharacters}
                disabled={!storage.hasStorageManager}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">场景库跨项目共享</p>
                <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
              </div>
              <Switch
                checked={storage.resourceSharing.shareScenes}
                onCheckedChange={storage.toggleShareScenes}
                disabled={!storage.hasStorageManager}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">素材库跨项目共享</p>
                <p className="text-xs text-muted-foreground">关闭后，仅当前项目可见</p>
              </div>
              <Switch
                checked={storage.resourceSharing.shareMedia}
                onCheckedChange={storage.toggleShareMedia}
                disabled={!storage.hasStorageManager}
              />
            </div>
          </div>

          <div className="p-6 border border-border rounded-xl bg-card space-y-5">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              存储位置
            </h4>
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">数据存储位置（包含项目和素材）</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={storage.storagePaths.basePath || "默认位置"}
                  placeholder="默认位置"
                  readOnly
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={storage.selectStoragePath} disabled={!storage.hasStorageManager}>选择</Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={storage.exportData} disabled={!storage.hasStorageManager}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  导出
                </Button>
                <Button variant="outline" size="sm" onClick={storage.importData} disabled={!storage.hasStorageManager}>导入</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">⚠️ 更改位置会移动现有数据到新目录（自动创建 projects/ 和 media/ 子目录）</p>
          </div>

          <div className="p-6 border border-border rounded-xl bg-card space-y-4">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              数据恢复
            </h4>
            <p className="text-sm text-muted-foreground">换设备或重装系统后，指向已有数据目录即可恢复所有配置和项目</p>
            <div className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                onClick={storage.linkData}
                disabled={!storage.hasStorageManager}
                className="w-full"
              >
                <Folder className="h-3.5 w-3.5 mr-1" />
                指向已有数据目录
              </Button>
              <p className="text-xs text-muted-foreground">💡 选择包含 projects/ 和 media/ 子目录的数据目录，操作后重启应用。</p>
            </div>
          </div>

          <div className="p-6 border border-border rounded-xl bg-card space-y-4">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              缓存管理
            </h4>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">缓存大小</p>
                <p className="text-xs text-muted-foreground">
                  {storage.isCacheLoading ? "计算中..." : formatStorageBytes(storage.cacheSize)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="刷新缓存大小"
                  onClick={storage.refreshCacheSize}
                  disabled={!storage.hasStorageManager || storage.isCacheLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${storage.isCacheLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={storage.clearCache}
                  disabled={!storage.hasStorageManager || storage.isClearingCache}
                >
                  {storage.isClearingCache ? <Loader2 className="h-4 w-4 animate-spin" /> : "清理"}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">自动清理</p>
                <p className="text-xs text-muted-foreground">默认关闭</p>
              </div>
              <Switch
                checked={storage.cacheSettings.autoCleanEnabled}
                onCheckedChange={(checked) => storage.setCacheSettings({ autoCleanEnabled: checked })}
                disabled={!storage.hasStorageManager}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">清理</Label>
              <Input
                type="number"
                min={1}
                value={storage.cacheSettings.autoCleanDays}
                onChange={(event) => storage.setCacheSettings({ autoCleanDays: Math.max(1, parseInt(event.target.value) || 1) })}
                className="w-20"
                disabled={!storage.cacheSettings.autoCleanEnabled}
              />
              <span className="text-xs text-muted-foreground">天前的缓存文件</span>
            </div>
          </div>

          <div className="p-6 border border-border rounded-xl bg-card space-y-5">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <Download className="h-4 w-4" />
              应用更新
            </h4>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">当前版本</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">v{storage.appVersion}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={storage.checkForUpdates}
                disabled={!storage.hasAppUpdater || storage.isCheckingForUpdates}
              >
                {storage.isCheckingForUpdates ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                检查更新
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">启动时自动检查更新</p>
                <p className="text-xs text-muted-foreground">开启后，桌面版启动时会自动检查远程版本清单并提示新版本</p>
              </div>
              <Switch
                checked={storage.updateSettings.autoCheckEnabled}
                onCheckedChange={(checked) => storage.setUpdateSettings({ autoCheckEnabled: checked })}
                disabled={!storage.hasAppUpdater}
              />
            </div>
            {storage.updateSettings.ignoredVersion && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">已忽略版本</p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">v{storage.updateSettings.ignoredVersion}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={storage.clearIgnoredVersion}>恢复提醒</Button>
              </div>
            )}
            {!storage.hasAppUpdater && <p className="text-xs text-muted-foreground">此功能仅在桌面打包版中可用。</p>}
          </div>
        </div>
      </ScrollArea>
      <UpdateDialog
        open={storage.updateDialogOpen}
        onOpenChange={storage.setUpdateDialogOpen}
        updateInfo={storage.availableUpdate}
        onIgnoreVersion={storage.ignoreVersion}
      />
    </>
  );
}
