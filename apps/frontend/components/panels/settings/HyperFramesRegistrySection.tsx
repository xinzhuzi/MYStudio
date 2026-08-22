/**
 * HyperFrames Registry 特效依赖(08-21)——嵌入 HyperFrames 插件卡片内。
 * 紧凑行内布局(与卡片 dl 路径行同风格):状态+下载/重下+缓存目录打开。
 * 依赖下载到 <userData>/hyperframes-registry-deps/(由 main 侧提供路径)。
 */

import { useState } from "react";
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
    return await window.electronAPI?.hyperFramesRegistryDepsCheck?.() ?? { installed: false, installedCount: 0, totalCount: 0 };
  };

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
        370 个 GitHub 特效模板的离线依赖(GSAP/Three.js/D3/字体);下载到 hyperframes-registry-deps/;
        已有 43 个本地模板无需下载即可使用。
      </p>
    </div>
  );
}
