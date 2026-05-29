// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ProjectHeader - Top bar showing project name and save status
 * Based on CineGen-AI App.tsx auto-save pattern
 */

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useScriptStore } from "@/stores/script-store";
import { useMediaPanelStore, stages, type Stage, type Tab } from "@/stores/media-panel-store";
import { CloudOff, Loader2, Check, ChevronRight } from "lucide-react";
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
  script: "剧本策划",
  characters: "角色库",
  scenes: "场景库",
  freedom: "辅助界面",
  director: "导演工作台",
  sclass: "S级镜头",
  assets: "资产库",
  media: "视频管理",
  skills: "技能编辑",
  tts: "TTS 口播",
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
  onBack: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function ProjectHeader({
  onBack,
  sidebarCollapsed = false,
  onToggleSidebar,
}: ProjectHeaderProps) {
  const { activeProject } = useProjectStore();
  const { activeTab, activeStage, activeEpisodeIndex, backToSeries } = useMediaPanelStore();
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

  const workspaceLabel = getProjectWorkspaceLabel(activeTab, activeStage);

  return (
    <div className="project-chrome h-11 border-b px-4 flex items-center justify-between shrink-0">
      {/* Left: Project Name + Stage + Episode Breadcrumb */}
      <div className="flex min-w-0 items-center gap-4">
        {sidebarCollapsed && onToggleSidebar && (
          <SidebarToggleButton
            sidebarCollapsed
            onToggleSidebar={onToggleSidebar}
          />
        )}
        <ChromeControls
          onBack={onBack}
          canGoBack
        />
        <div className="project-breadcrumb min-w-0">
          <span className="project-chrome-title text-sm font-medium text-white truncate max-w-[220px]">
            {activeProject?.name || "未命名项目"}
          </span>
        </div>
        {activeEpisodeIndex != null && (
          <>
            <ChevronRight className="project-chrome-separator h-3 w-3" />
            <button
              className="project-chrome-episode text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              onClick={backToSeries}
              title="返回全剧视图"
            >
              第{activeEpisodeIndex}集
            </button>
          </>
        )}
        <span className="project-chrome-divider">/</span>
        <span className="project-chrome-workspace text-xs">
          {workspaceLabel}
        </span>
      </div>

      {/* Right: Save Status */}
      <div className="flex items-center gap-2">
        <SaveStatusIndicator status={saveStatus} />
      </div>
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <div
      className={cn(
        "save-status-pill flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors",
        status === "saved" && "text-green-500/70 bg-green-500/5",
        status === "saving" && "text-yellow-500/70 bg-yellow-500/5",
        status === "unsaved" && "text-zinc-500 bg-zinc-800/50"
      )}
    >
      {status === "saved" && (
        <>
          <Check className="w-3 h-3" />
          <span>{SAVE_STATUS_COPY.saved}</span>
        </>
      )}
      {status === "saving" && (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{SAVE_STATUS_COPY.saving}</span>
        </>
      )}
      {status === "unsaved" && (
        <>
          <CloudOff className="w-3 h-3" />
          <span>{SAVE_STATUS_COPY.unsaved}</span>
        </>
      )}
    </div>
  );
}
