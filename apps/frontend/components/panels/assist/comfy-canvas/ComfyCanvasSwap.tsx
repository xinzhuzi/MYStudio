"use client";
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布槽位(09-09 换代批6 终态):ComfyUI 画布 + 旧画布退役占位。
 * 旧 React Flow 画布已退役删除;存量数据冻结在 store(深链照常读写),
 * 画布化操作全走 ComfyUI。存量迁移入口=头部「导入存量画布」一键批量
 * 入库(库=ComfyUI 原生用户工作流目录,webview 工作流菜单立即可见;
 * 09-09 存量迁移链打通,原 comfy-workflow-browser 已随之退役)。
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ComfyCanvasStudio } from "./ComfyCanvasStudio";
import { ComfyLegacyImportButton } from "./ComfyLegacyImportButton";

export function ComfyCanvasSwap({
  title,
  onBack,
  legacy,
}: {
  title: string;
  onBack?: () => void;
  /** 兼容旧签名的残留入参(不再渲染;调用方清理后移除) */
  legacy?: ReactNode;
}) {
  void legacy;

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col" data-comfy-swap="comfy">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBack} data-comfy-swap-back>
              返回
            </Button>
          ) : null}
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <ComfyLegacyImportButton />
          <span className="text-[11px] text-muted-foreground">旧画布已退役,画布操作全在 ComfyUI</span>
        </div>
      </div>
      <ComfyCanvasStudio embedded />
    </div>
  );
}
