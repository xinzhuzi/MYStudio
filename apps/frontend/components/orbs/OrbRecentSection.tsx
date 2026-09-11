"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 「最近」分区(09-11 中转枢纽裁定):球记录模块跳转,最近到访一键回跳。
// 数据由 use-recent-tabs 供给(离栈者入列,持久化);当前模块不在列。

import {
  LayoutDashboard,
  NotebookTabs,
  Workflow as WorkflowIcon,
  FolderOpen,
  Palette,
  BookOpenText,
  Film,
  Boxes,
  Share2,
  Settings,
} from "lucide-react";
import { OrbSection, type OrbSectionProps } from "./OrbSection";
import { tabs as TAB_LABELS, useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";

const ENTRY_ICONS: Partial<Record<Tab, typeof LayoutDashboard>> = {
  dashboard: LayoutDashboard,
  overview: NotebookTabs,
  studio: WorkflowIcon,
  assets: FolderOpen,
  freedom: Palette,
  skills: BookOpenText,
  export: Film,
  media: Boxes,
  "self-media": Share2,
  settings: Settings,
};

/** 「最近」分区:模块跳转记录(MRU)。空记录时整区不渲染。 */
export function OrbRecentSection({
  recent,
  open,
  onToggle,
}: Pick<OrbSectionProps, "open" | "onToggle"> & {
  recent: Tab[];
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const activeTab = useMediaPanelStore((state) => state.activeTab);
  const entries = recent.filter((tab) => tab !== activeTab);
  if (entries.length === 0) return null;
  return (
    <OrbSection section="recent" title="最近" open={open} onToggle={onToggle}>
      <div className="grid grid-cols-3 gap-1">
        {entries.map((tab) => {
          const Icon = ENTRY_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              data-orb-recent={tab}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setActiveTab(tab)}
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              <span className="truncate">{TAB_LABELS[tab]?.label ?? tab}</span>
            </button>
          );
        })}
      </div>
    </OrbSection>
  );
}
