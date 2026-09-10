// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ProjectHeader - Top bar showing project name and save status
 * Based on CineGen-AI App.tsx auto-save pattern
 */

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/project/project-store";
import { useScriptStore } from "@/stores/script/script-store";
import { useMediaPanelStore, stages, type Stage, type Tab } from "@/stores/navigation/media-panel-store";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChromeControls, SidebarToggleButton } from "@/components/ChromeControls";

export type SaveStatus = "saved" | "saving" | "unsaved";

export const SAVE_STATUS_COPY: Record<SaveStatus, string> = {
  saved: "已保存",
  saving: "保存中...",
  unsaved: "未保存",
};

const WORKSPACE_LABELS: Partial<Record<Tab, string>> = {
  dashboard: "项目仪表盘",
  overview: "项目概览",
  studio: "漫影工作流",
  script: "策划编剧",
  characters: "角色库",
  scenes: "场景库",
  freedom: "辅助界面",
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
  const scriptStore = useScriptStore();
  
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Get current project data for change detection
  const projectId = activeProject?.id;
  const scriptProject = projectId ? scriptStore.projects[projectId] : null;
  const currentUpdatedAt = scriptProject?.updatedAt || 0;

  // Auto-save effect with 1s debounce
  useEffect(() => {
    if (!projectId || currentUpdatedAt === 0) return;
    
    // Skip if this is the first mount or no actual change
    if (lastUpdateRef.current === currentUpdatedAt) return;
    
    // Mark as unsaved
    setSaveStatus("unsaved");
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Set new timeout for saving
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saving");
      
      // Simulate save (Zustand persist handles actual storage)
      setTimeout(() => {
        setSaveStatus("saved");
        lastUpdateRef.current = currentUpdatedAt;
      }, 300);
    }, 1000); // 1s debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectId, currentUpdatedAt]);

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

      {/* Right: Save Status */}
      <div className="flex items-center gap-2.5">
        <SaveStatusIndicator status={saveStatus} />
      </div>
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <div
      className={cn(
        "save-status-pill flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors",
        status === "saving" && "text-warning",
      )}
    >
      {status === "saved" && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-success/80" />
          <span>{SAVE_STATUS_COPY.saved}</span>
        </>
      )}
      {status === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-warning" />
          <span>{SAVE_STATUS_COPY.saving}</span>
        </>
      )}
      {status === "unsaved" && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          <span>{SAVE_STATUS_COPY.unsaved}</span>
        </>
      )}
    </div>
  );
}
