"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 「导航」分区(原「前往」,09-11 用户裁定更名):全局模块导航区,10 视口全覆盖
// (09-10 补:球全局化后须含本地模型入口——旧两球时代球住沉浸视图故自指无意义)。
// 本分区不持开合态(调用方持,默认收起);分镜面板入口不进(08-23 唯一入口裁定)。

import {
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
import { LocalModelsIcon } from "@/components/ui/local-models-icon";
import { OrbSection } from "./OrbSection";
import type { OrbSectionProps } from "./OrbSection";
import { useMediaPanelStore, type Tab } from "@/stores/navigation/media-panel-store";
import { cn } from "@/lib/utils";

const VIEW_ENTRIES: ReadonlyArray<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "主页", icon: LayoutDashboard },
  { id: "overview", label: "概览", icon: NotebookTabs },
  // label 随侧栏命名(09-12 装机轮:并行会话「MY 工作流」已随包装机+smoke 断言,对齐)
  { id: "studio", label: "MY 工作流", icon: WorkflowIcon },
  { id: "assets", label: "资产", icon: FolderOpen },
  // 09-10 补:球全局化后「前往」须含本地模型(旧两球时代球住沉浸视图故自指无意义)
  // 09-14 图标换血:弃辅助时代 Palette,与侧栏同源用 ComfyUI 模型库 ai-model 图标
  { id: "freedom", label: "本地模型", icon: LocalModelsIcon },
  { id: "skills", label: "技能", icon: BookOpenText },
  { id: "export", label: "导出", icon: Film },
  { id: "media", label: "产物", icon: Boxes },
  { id: "self-media", label: "自媒体", icon: Share2 },
  { id: "settings", label: "设置", icon: Settings },
];

/** 「导航」分区:应用模块导航(10 视口)。开合态由调用方持有;
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
    <OrbSection section="goto" title="导航" open={open} onToggle={onToggle}>
      <div className="grid grid-cols-3 gap-1">
        {VIEW_ENTRIES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-orb-nav-view={item.id}
            className={cn(
              // 09-12 面板美化:磁贴条目——图标坐进小底座,悬停底座提亮
              // (house spec 禁 active:scale 按压缩放,按压反馈=底色变化)
              "group flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none",
              item.id === activeTab
                ? "bg-accent/60 text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => setActiveTab(item.id)}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none",
                item.id === activeTab
                  ? "bg-primary/15 text-primary"
                  : "bg-accent/40 text-foreground/70 group-hover:bg-accent/70 group-hover:text-foreground",
              )}
            >
              <item.icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </OrbSection>
  );
}
