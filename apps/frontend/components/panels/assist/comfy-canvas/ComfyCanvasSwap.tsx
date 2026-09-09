"use client";
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 画布换壳(09-09 comfyui-frontend-swap 阶段2 批4:换代)。
 *
 * 默认=ComfyUI 画布(引擎 webview 嵌入,复用 ComfyCanvasStudio 全套
 * 引擎状态机+回写消费+分镜侧栏);旧 React Flow 画布保留为**只读存档**
 * 视图(pointer-events 封印=可看不可操作,双轨期 PRD 口径)。阶段3
 * 旧画布随 React Flow 一并退役,此壳届时只剩 ComfyUI 分支。
 */

import { useState, type ReactNode } from "react";
import { Archive, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComfyCanvasStudio } from "./ComfyCanvasStudio";

export function ComfyCanvasSwap({
  title,
  onBack,
  legacy,
  legacyLabel = "旧画布(只读存档)",
  defaultView = "comfy",
}: {
  title: string;
  onBack?: () => void;
  /** 旧 React Flow 画布(仅在切到只读视图时挂载) */
  legacy: ReactNode;
  legacyLabel?: string;
  defaultView?: "comfy" | "legacy";
}) {
  const [view, setView] = useState<"comfy" | "legacy">(defaultView);
  return (
    <div className="flex h-full min-h-0 flex-col" data-comfy-swap={view}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBack} data-comfy-swap-back>
              返回
            </Button>
          ) : null}
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="画布视图切换">
          <Button
            size="sm"
            variant={view === "comfy" ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setView("comfy")}
            role="tab"
            aria-selected={view === "comfy"}
            data-comfy-swap-tab="comfy"
          >
            <Boxes className="mr-1 h-3.5 w-3.5" aria-hidden />
            ComfyUI 画布
          </Button>
          <Button
            size="sm"
            variant={view === "legacy" ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setView("legacy")}
            role="tab"
            aria-selected={view === "legacy"}
            data-comfy-swap-tab="legacy"
          >
            <Archive className="mr-1 h-3.5 w-3.5" aria-hidden />
            {legacyLabel}
          </Button>
        </div>
      </div>
      {view === "comfy" ? (
        <ComfyCanvasStudio embedded />
      ) : (
        <div className="relative min-h-0 flex-1">
          {/* 只读封印:旧画布可查看不可操作;交互一律去 ComfyUI 画布 */}
          <div className="pointer-events-none h-full overflow-hidden" data-comfy-swap-legacy>
            {legacy}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center pt-2">
            <span className="rounded-full border border-border bg-background/95 px-3 py-1 text-[11px] text-muted-foreground">
              旧画布只读存档——查看历史用;新建连线与生成请切回 ComfyUI 画布
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
