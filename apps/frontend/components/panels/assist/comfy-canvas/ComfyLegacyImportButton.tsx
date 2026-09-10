"use client";
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 「导入存量画布(N)」共享入口(09-10 ComfyUI 完整功能补齐):
 * 画布头部条(ComfyCanvasSwap)与辅助第六 tab 引擎条(ComfyCanvasStudio)
 * 复用同一实现——有存量流才显示、单飞防连点、跑真迁移批+toast 汇总。
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { migrateWorkflowsToLibraryWithToast } from "@/lib/assist/image-studio/workflow-migrate-batch";
import { useStudioStore } from "@/stores/studio/studio-store";

export function ComfyLegacyImportButton({ className }: { className?: string }) {
  const legacyCount = useStudioStore((state) => state.imageWorkflows.length);
  const [migrating, setMigrating] = useState(false);

  if (legacyCount === 0) return null;

  const runMigration = async () => {
    if (migrating) return; // 单飞:连点只跑一次
    setMigrating(true);
    try {
      await migrateWorkflowsToLibraryWithToast();
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="secondary"
      className={className ?? "h-7 px-2 text-xs"}
      disabled={migrating}
      data-comfy-swap-migrate
      onClick={() => void runMigration()}
    >
      {migrating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {migrating ? "迁移中…" : `导入存量画布(${legacyCount})`}
    </Button>
  );
}
