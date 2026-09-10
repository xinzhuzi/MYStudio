"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Mic, LayoutDashboard, NotebookTabs, Workflow as WorkflowIcon, FolderOpen, BookOpenText, Film, Boxes, Share2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";
import type { StudioMode } from "@/stores/assist/freedom-store";

/** 悬浮球面板·沉浸视图导航区(09-10 全屏 ComfyUI 合一):
 * 上=本视图内部切换(画布/配音室),下=应用视图跳转(沉浸态下球=唯一出入)。
 * 刻意不含分镜面板入口(2026-08-23 裁定:唯一入口=节点图「分镜面板」的「进入」)。 */

const VIEW_ENTRIES: ReadonlyArray<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "主页", icon: LayoutDashboard },
  { id: "overview", label: "概览", icon: NotebookTabs },
  { id: "studio", label: "工作流", icon: WorkflowIcon },
  { id: "assets", label: "资产", icon: FolderOpen },
  { id: "skills", label: "技能", icon: BookOpenText },
  { id: "export", label: "导出", icon: Film },
  { id: "media", label: "产物", icon: Boxes },
  { id: "self-media", label: "自媒体", icon: Share2 },
  { id: "settings", label: "设置", icon: Settings },
];

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string }> = [
  { id: "comfy", label: "ComfyUI 画布" },
  { id: "tts", label: "配音室" },
];

export function FreedomOrbNav({
  mode,
  onModeChange,
}: {
  mode: StudioMode;
  onModeChange: (mode: StudioMode) => void;
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);

  return (
    <div className="space-y-1.5 px-1" data-freedom-orb-nav>
      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        本视图
      </p>
      <div className="grid grid-cols-2 gap-1">
        {MODE_ENTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-orb-nav-mode={item.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
              item.id === mode ? "bg-accent/60 text-foreground" : "text-muted-foreground",
            )}
            onClick={() => onModeChange(item.id)}
          >
            {item.id === "tts" ? (
              <Mic className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
            ) : (
              <WorkflowIcon className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
            )}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
      <p className="px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        前往
      </p>
      <div className="grid grid-cols-3 gap-1">
        {VIEW_ENTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-orb-nav-view={item.id}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
