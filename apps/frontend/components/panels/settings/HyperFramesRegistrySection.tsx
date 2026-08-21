/**
 * HyperFrames Registry 特效依赖区块 — 设置 → 本地配置。
 * 管理从 CDN 下载的特效依赖(GSAP/Three.js/D3/字体),供 373 个
 * GitHub Registry HTML 模板离线渲染。下载到
 * <userData>/hyperframes-registry-deps/;显式下载,不自动。
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Package } from "lucide-react";
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
    return await window.electronAPI?.hyperFramesRegistryDepsCheck() ?? { installed: false, installedCount: 0, totalCount: 0 };
  };

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const result = await window.electronAPI?.hyperFramesRegistryDepsDownload();
      if (result?.success) {
        toast.success(`特效依赖下载完成: ${result.downloaded} 个文件`);
      } else {
        toast.error(`下载失败 ${result?.failed?.length ?? "?"} 个文件,请重试`);
      }
      setStatus(await checkStatus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h5 className="font-medium text-foreground flex items-center gap-2">
          <Package className="h-4 w-4" aria-hidden="true" />
          特效依赖(GitHub Registry)
        </h5>
        <p className="text-xs text-muted-foreground">
          373 个 GitHub 特效模板的离线依赖(GSAP/Three.js/D3/字体)。首次使用前需下载;
          已有 43 个本地模板无需下载即可使用。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleDownload} disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
          {downloading ? "下载中..." : "下载依赖"}
        </Button>
        {status && (
          <span className="text-xs text-muted-foreground">
            {status.installed ? "✓ " : ""}
            {status.installedCount} / {status.totalCount} 就绪
            {status.installed ? "(全部可用)" : "(需下载后 hy:* 模板才能离线渲染)"}
          </span>
        )}
      </div>
    </div>
  );
}
