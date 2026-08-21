/**
 * HyperFrames Registry 特效依赖区块 — 设置 → 本地配置。
 * 管理从 CDN 下载的特效依赖(GSAP/Three.js/D3/字体),供 373 个
 * GitHub Registry HTML 模板离线渲染。下载到
 * <userData>/hyperframes-registry-deps/;显式下载,不自动。
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Package, FolderOpen } from "lucide-react";
import { toast } from "sonner";

interface HyperFramesRegistrySectionProps {
  userDataDir: string;
}

interface DepsStatus {
  installed: boolean;
  installedCount: number;
  totalCount: number;
}

export function HyperFramesRegistrySection({ userDataDir }: HyperFramesRegistrySectionProps) {
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<DepsStatus | null>(null);

  const depsDir = `${userDataDir}/hyperframes-registry-deps`;

  const checkStatus = async (): Promise<DepsStatus> => {
    // TODO: 接 IPC(需要 preload+main 注册 hyperFramesRegistryDeps 通道)
    // 当前先用本地状态模拟(下载管理模块在 main 进程侧)
    return { installed: false, installedCount: 0, totalCount: 42 };
  };

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      // TODO: 调 IPC 下载(接通后替换为 window.electronAPI.hyperFramesRegistryDeps.download())
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.info("特效依赖下载需接通 IPC 通道(下一步 preload+main 注册)");
      setStatus(await checkStatus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenDir = (): void => {
    void window.electronAPI?.openPath?.(depsDir);
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
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
      <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)_auto] items-center">
        <span className="text-xs text-muted-foreground">缓存目录</span>
        <code className="truncate rounded border border-border bg-muted/30 px-2 py-1 text-xs text-foreground">
          {depsDir}
        </code>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleOpenDir}>
            <FolderOpen className="h-3.5 w-3.5" />
            打开
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            {downloading ? "下载中..." : "下载依赖"}
          </Button>
        </div>
      </div>
      {status && (
        <p className="text-xs text-muted-foreground">
          {status.installed ? "✓ " : ""}
          已安装 {status.installedCount} / {status.totalCount} 个依赖
          {status.installed ? "(全部就绪)" : "(需下载后 hy:* 模板才能离线渲染)"}
        </p>
      )}
    </div>
  );
}
