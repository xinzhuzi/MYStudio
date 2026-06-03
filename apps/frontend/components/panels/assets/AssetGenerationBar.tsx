"use client";

/**
 * 资产批量润色操作栏
 *
 * 位于 StudioAssetLibrary 搜索栏下方，提供：
 * - 全部润色提示词（Phase 1）
 * - 全部生成图片（Phase 2，暂禁用）
 * - 进度条 + 取消
 */

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/stores/studio-store";
import { polishAssetsAndUpdateStore, type AssetType } from "@/lib/studio/asset-generation-orchestrator";
import { Loader2, Sparkles, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";

interface AssetGenerationBarProps {
  /** 当前资产类型 */
  assetType: AssetType;
}

export function AssetGenerationBar({ assetType }: AssetGenerationBarProps) {
  const [isPolishing, setIsPolishing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  // 获取当前项目的视觉手册 ID
  const visualManualId = useStudioStore(
    (s) => s.workflowConfig?.visualManualId,
  );

  const handlePolishAll = useCallback(async () => {
    if (!visualManualId) {
      toast.error("请先在「风格选择」中选择视觉手册");
      return;
    }

    setIsPolishing(true);
    cancelRef.current = false;

    try {
      const result = await polishAssetsAndUpdateStore(assetType, visualManualId, {
        concurrency: 3,
        onProgress: (done, total) => setProgress({ done, total }),
        onCancel: () => cancelRef.current,
      });

      if (result.success > 0) {
        toast.success(`润色完成：${result.success} 个成功${result.failed > 0 ? `，${result.failed} 个失败` : ""}`);
      } else if (result.failed > 0) {
        toast.error(`润色失败：${result.failed} 个资产`);
      } else {
        toast.info("没有需要润色的资产");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`润色出错: ${message}`);
    } finally {
      setIsPolishing(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [assetType, visualManualId]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const label = assetType === "character" ? "角色" : assetType === "scene" ? "场景" : "道具";

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
      {/* 润色按钮 */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handlePolishAll}
        disabled={isPolishing || !visualManualId}
        className="h-7 gap-1.5 text-xs"
      >
        {isPolishing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {isPolishing
          ? `润色中 ${progress.done}/${progress.total}`
          : `全部润色${label}提示词`}
      </Button>

      {/* 生成图片按钮（Phase 2，暂禁用） */}
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="h-7 gap-1.5 text-xs opacity-50"
      >
        <ImageIcon className="h-3.5 w-3.5" />
        全部生成图片
      </Button>

      {/* 进度条 */}
      {isPolishing && progress.total > 0 && (
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{
              width: `${(progress.done / progress.total) * 100}%`,
            }}
          />
        </div>
      )}

      {/* 取消按钮 */}
      {isPolishing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="h-7 gap-1 text-xs text-red-400 hover:text-red-300"
        >
          <X className="h-3.5 w-3.5" />
          取消
        </Button>
      )}

      {/* 未选择视觉手册的提示 */}
      {!visualManualId && !isPolishing && (
        <span className="text-xs text-muted-foreground">
          请先在「风格选择」中选择视觉手册
        </span>
      )}
    </div>
  );
}
