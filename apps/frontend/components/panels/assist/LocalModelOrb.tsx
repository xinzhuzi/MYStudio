"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 拆双球裁定(用户原话:comfyui 地方应该是另一套悬浮球,区分开不融合):
// 本地模型球=沉浸视图(freedom)专属导航枢纽,只含本视图切换与视图跳转;
// 工作流内容(阶段/就绪)不在本球(归 panels/studio 工作流球);
// 交互壳与折叠分区原语来自 @/components/orbs 基础设施。
// 沉浸态直达工作流阶段已退役(Q3 裁定):去工作流=「前往→工作流」两步。
// 刻意不含分镜面板入口(2026-08-23 裁定:唯一入口=节点图「分镜面板」的「进入」)。

import { useState } from "react";
import {
  Mic,
  Palette,
  LayoutDashboard,
  NotebookTabs,
  Workflow as WorkflowIcon,
  FolderOpen,
  BookOpenText,
  Film,
  Boxes,
  Share2,
  Settings,
} from "lucide-react";
import {
  OrbSection,
  OrbShell,
  LOCAL_MODEL_ORB_POSITION_KEY,
} from "@/components/orbs";
import { cn } from "@/lib/utils";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";
import type { StudioMode } from "@/stores/assist/freedom-store";

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

const MODE_ENTRIES: ReadonlyArray<{ id: StudioMode; label: string; icon: typeof Palette }> = [
  { id: "comfy", label: "ComfyUI 画布", icon: Palette },
  { id: "tts", label: "配音室", icon: Mic },
];

/** 本地模型球面板:两个折叠分区(09-10 裁定:默认收起,点标题行展开,
 * 面板重开回默认收起)。沉浸视图零应用 chrome,本球=唯一出入。 */
export function LocalModelOrb({
  mode,
  onModeChange,
}: {
  mode: StudioMode;
  onModeChange: (mode: StudioMode) => void;
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const currentModeLabel =
    MODE_ENTRIES.find((entry) => entry.id === mode)?.label ?? "ComfyUI 画布";

  return (
    <OrbShell
      storageKey={LOCAL_MODEL_ORB_POSITION_KEY}
      dataOrb="local-model-orb"
      ariaLabel={`本地模型导航:当前${currentModeLabel},点按打开导航面板`}
      capsuleText={currentModeLabel}
      ballContent={
        <Boxes className="h-5 w-5 text-foreground" aria-hidden />
      }
      panelContent={() => (
        <div className="space-y-1">
          <OrbSection
            section="views"
            title="本视图"
            open={viewsOpen}
            onToggle={() => setViewsOpen((open) => !open)}
          >
            <div className="grid grid-cols-2 gap-1">
              {MODE_ENTRIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-orb-nav-mode={item.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                    item.id === mode
                      ? "bg-accent/60 text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onModeChange(item.id)}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </OrbSection>
          <OrbSection
            section="goto"
            title="前往"
            open={gotoOpen}
            onToggle={() => setGotoOpen((open) => !open)}
          >
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
          </OrbSection>
        </div>
      )}
    />
  );
}
