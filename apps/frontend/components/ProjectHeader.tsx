// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ProjectHeader - Top bar showing project name and workspace breadcrumb
 */

import { useProjectStore } from "@/stores/project/project-store";
import { useMediaPanelStore, stages, type Stage, type Tab } from "@/stores/navigation/media-panel-store";
import { ChromeControls, SidebarToggleButton } from "@/components/ChromeControls";

const WORKSPACE_LABELS: Partial<Record<Tab, string>> = {
  dashboard: "项目仪表盘",
  overview: "项目概览",
  studio: "漫影工作流",
  script: "策划编剧",
  characters: "角色库",
  scenes: "场景库",
  freedom: "本地模型工作台",
  director: "导演工作台",
  sclass: "S级镜头",
  assets: "资产库",
  media: "产物管理",
  skills: "技能编辑",
  export: "成片与导出",
  settings: "系统设置",
};

export function getProjectWorkspaceLabel(activeTab: Tab, activeStage: Stage): string {
  const tabLabel = WORKSPACE_LABELS[activeTab];
  if (tabLabel) {
    return `当前工作区：${tabLabel}`;
  }

  const stageLabel = stages.find((stage) => stage.id === activeStage)?.label;
  return `当前工作区：${stageLabel || "项目工作区"}`;
}

interface ProjectHeaderProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function ProjectHeader({
  sidebarCollapsed = false,
  onToggleSidebar,
}: ProjectHeaderProps) {
  const { activeProject } = useProjectStore();
  const {
    activeTab,
    activeStage,
    activeEpisodeIndex,
    backToSeries,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = useMediaPanelStore();

  return (
    <div className="project-chrome h-10 pr-4 pl-20 flex items-center justify-between shrink-0">
      {/* Left: Project Name + Episode pill */}
      <div className="flex min-w-0 items-center gap-2.5">
        {onToggleSidebar && (
          <SidebarToggleButton
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={onToggleSidebar}
          />
        )}
        <ChromeControls
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack()}
          canGoForward={canGoForward()}
        />
        <div className="project-breadcrumb min-w-0">
          <span className="project-chrome-title text-sm font-semibold text-foreground truncate max-w-[220px]">
            {activeProject?.name || "未命名项目"}
          </span>
        </div>
        {activeEpisodeIndex != null && (
          <button
            className="project-chrome-episode rounded-md"
            onClick={backToSeries}
            title="返回全剧视图"
          >
            第{activeEpisodeIndex}集
          </button>
        )}
        <span className="project-chrome-divider text-muted-foreground/40">/</span>
        <span className="project-chrome-workspace text-xs text-muted-foreground">
          {getProjectWorkspaceLabel(activeTab, activeStage)}
        </span>
      </div>
    </div>
  );
}
