"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 09-10 终裁(用户:悬浮球功能应一致、都展示全面):「前往」为两球共有分区,
// 抽成 features 层共享组件,任何球消费即保证条目/行为一致。
// 本分区不持开合态(调用方持,默认收起);分镜面板入口不进(08-23 唯一入口裁定)。

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
import { OrbSection } from "./OrbSection";
import type { OrbSectionProps } from "./OrbSection";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";
import { cn } from "@/lib/utils";

const VIEW_ENTRIES: ReadonlyArray<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "主页", icon: LayoutDashboard },
  { id: "overview", label: "概览", icon: NotebookTabs },
  { id: "studio", label: "工作流", icon: WorkflowIcon },
  { id: "assets", label: "资产", icon: FolderOpen },
  // 09-10 补:球全局化后「前往」须含本地模型(旧两球时代球住沉浸视图故自指无意义)
  { id: "freedom", label: "本地模型", icon: Palette },
  { id: "skills", label: "技能", icon: BookOpenText },
  { id: "export", label: "导出", icon: Film },
  { id: "media", label: "产物", icon: Boxes },
  { id: "self-media", label: "自媒体", icon: Share2 },
  { id: "settings", label: "设置", icon: Settings },
];

/** 「前往」分区:应用模块导航(10 视口)。开合态由调用方持有;
 * activeTab 传入时高亮当前模块(09-11 裁定:不同模块不同效果)。 */
export function OrbGotoSection({
  activeTab,
  open,
  onToggle,
}: Pick<OrbSectionProps, "open" | "onToggle"> & {
  activeTab?: Tab;
}) {
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  return (
    <OrbSection section="goto" title="前往" open={open} onToggle={onToggle}>
      <div className="grid grid-cols-3 gap-1">
        {VIEW_ENTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-orb-nav-view={item.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-foreground",
              item.id === activeTab
                ? "bg-accent/60 text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </OrbSection>
  );
}
