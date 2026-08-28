/**
 * HyperFrames Registry 特效依赖(08-21)——嵌入 HyperFrames 插件卡片内。
 * 紧凑行内布局(与卡片 dl 路径行同风格):状态+下载/重下+缓存目录打开。
 * 依赖下载到 <userData>/hyperframes-registry-deps/(由 main 侧提供路径)。
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Package, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";

interface DepsStatus {
  installed: boolean;
  installedCount: number;
  totalCount: number;
}

export function HyperFramesRegistrySection(): React.ReactElement {
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<DepsStatus | null>(null);

  const checkStatus = async (): Promise<DepsStatus> => {
    try {
      return await window.electronAPI?.hyperFramesRegistryDepsCheck?.()
        ?? { installed: false, installedCount: 0, totalCount: 0 };
    } catch {
      // IPC 拒绝/超时不悬挂空态——回落未就绪,用户可点检查重试
      return { installed: false, installedCount: 0, totalCount: 0 };
    }
  };

  // 打开即探测:此前 status 初始 null 且从不自动检查,空心圈+「下载依赖」被误读成
  // 「没下载完」(08-28 修;实际依赖 08-22 已下全,点「检查」也一直能过)。
  useEffect(() => {
    void checkStatus().then(setStatus);
  }, []);

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const result = await window.electronAPI?.hyperFramesRegistryDepsDownload?.();
      if (result?.success) {
        toast.success(`特效依赖下载完成: ${result.downloaded} 个文件`);
      } else {
        toast.error(`下载失败 ${result?.failed?.length ?? "?"} 个文件`);
      }
      setStatus(await checkStatus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          {status?.installed ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-foreground font-medium">GitHub Registry 特效</span>
          <span className="text-muted-foreground">
            370 个模板{status ? ` · 离线依赖 ${status.installedCount}/${status.totalCount}` : ""}
            {status ? (status.installed ? " 已就绪" : " 未下载") : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={async () => {
              setStatus(await checkStatus());
            }}
          >
            检查
          </Button>
          <Button size="sm" className="h-7 px-3 text-xs" onClick={handleDownload} disabled={downloading}>
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
            {downloading ? "下载中..." : status?.installed ? "重新下载" : "下载依赖"}
          </Button>
        </div>
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">
        370 个特效模板已随应用内置,无需下载;此处仅下载模板引用的第三方运行库
        (GSAP/Three.js/D3/字体)到 hyperframes-registry-deps/,一次下载永久离线。
      </p>
    </div>
  );
}
