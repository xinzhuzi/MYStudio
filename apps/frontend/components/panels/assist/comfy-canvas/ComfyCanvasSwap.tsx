"use client";
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布槽位(09-09 换代批6 终态):ComfyUI 画布 + 旧画布退役占位。
 * 旧 React Flow 画布已退役删除;存量数据冻结在 store(深链照常读写),
 * 画布化操作全走 ComfyUI。09-10 用户裁定(三轮):「导入存量画布」入口与
 * 退役说明文案全撤——头部只留返回+标题,画布即主体。
 */

import { Button } from "@/components/ui/button";
import { ComfyCanvasStudio } from "./ComfyCanvasStudio";

export function ComfyCanvasSwap({
  title,
  onBack,
  legacy,
}: {
  title: string;
  onBack?: () => void;
  /** 兼容旧签名的残留入参(不再渲染;调用方清理后移除) */
  legacy?: React.ReactNode;
}) {
  void legacy;

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col" data-comfy-swap="comfy">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        {onBack ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBack} data-comfy-swap-back>
            返回
          </Button>
        ) : null}
        <span className="text-xs font-medium text-foreground">{title}</span>
      </div>
      <ComfyCanvasStudio />
    </div>
  );
}
