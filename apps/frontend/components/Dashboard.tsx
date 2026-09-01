// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Dashboard - Project List and Management
 * Features: create, open, rename, duplicate, batch select & delete
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardProjectLifecycle } from "./dashboard-project-lifecycle";
import { useDashboardMoveActions } from "./dashboard-move-actions";
import { useDashboardProjectActions } from "./dashboard-project-actions";
import { DashboardDialogs } from "./dashboard-dialogs";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { switchProject } from "@/lib/project/project-switcher";
import {
  DEFAULT_REMOTION_RENDER_SETTINGS,
  buildRemotionProductionProfile,
  ensureRemotionWorkspace,
} from "@/lib/studio/remotion/remotion-workspace-storage";
import { getFileStorageBridge } from "@/lib/bridge/file-storage";
import { getProjectFolderBridge } from "@/lib/bridge/project-folder";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import {
  copyProjectScopedStoreFiles,
  waitForProjectStoreFile,
} from "@/lib/project/project-duplication";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { SidebarToggleButton } from "@/components/ChromeControls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Trash2,
 
  Clock,
  Clapperboard,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  FolderUp,
  Layers3,
  MonitorPlay,
  Scissors,
  Sparkles,
  X,
  MoreVertical,
  Pencil,
  Copy,
  CheckSquare,
  Wand2,
  Waves,
} from "lucide-react";
import { cn, generateUUID } from "@/lib/utils";
import { toast } from "sonner";
import type { Project } from "@/stores/project/project-store";
import type {
  ProjectFolderImportResult,
  ProjectFolderMoveProgressEvent,
  ProjectFolderMoveResult,
} from "@/types/electron";

interface DashboardProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export async function initializeRemotionWorkspace(projectId: string): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.remotionRuntime : undefined;
  if (!bridge?.workspaceRuntime) return;
  try {
    const runtime = await bridge.workspaceRuntime();
    const productionProfile = buildRemotionProductionProfile(
      useStudioStore.getState().workflowConfig,
    );
    const result = await ensureRemotionWorkspace(projectId, {
      templateVersion: runtime.templateVersion,
      remotionVersion: runtime.remotionVersion,
      bundleContentHash: runtime.bundleContentHash,
      defaultRenderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
    }, { productionProfile });
    if (result.status === "blocked") {
      toast.error("Remotion 工作区初始化被阻止", { description: result.message });
    }
  } catch (error) {
    toast.error("Remotion 工作区初始化失败", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

const dashboardStages = [
  { label: "小说", detail: "故事核", icon: Layers3 },
  { label: "剧本", detail: "场次", icon: Film },
  { label: "分镜", detail: "镜头", icon: Clapperboard },
  { label: "素材", detail: "资产", icon: Sparkles },
  { label: "剪辑", detail: "成片", icon: Scissors },
];

const timelineLanes = [
  { label: "画面", width: "78%", tone: "cyan" },
  { label: "角色", width: "54%", tone: "amber" },
  { label: "声音", width: "68%", tone: "green" },
];

/** 二期移动进度:跨卷复制时主进程按文件粒度推送阶段。 */
const MOVE_PHASE_LABELS: Record<ProjectFolderMoveProgressEvent["phase"], string> = {
  copying: "正在复制文件…",
  verifying: "正在校验文件…",
  finalizing: "正在完成移动…",
};

export const MOVE_ERROR_HINTS: Record<Extract<ProjectFolderMoveResult, { ok: false }>["code"], string> = {
  MISSING_DIR: "源项目文件夹不存在，可在项目列表使用「导入项目」重新挂接该文件夹",
  CONFLICT: "目标父目录下已存在同名非空文件夹",
  PARENT_INVALID: "目标父目录无效",
  NOT_WRITABLE: "目标父目录不可写",
  NESTED: "目标位置嵌套在应用数据目录或另一项目文件夹内",
  CANCELLED: "已取消移动",
  MOVE_FAILED: "移动项目文件夹失败",
};

export const IMPORT_ERROR_HINTS: Record<Extract<ProjectFolderImportResult, { ok: false }>["code"], string> = {
  INVALID_PATH: "所选路径无效",
  NOT_A_PROJECT: "所选文件夹不是漫影项目（缺少 script.json / director.json）",
  ALREADY_REGISTERED: "该项目已在列表中",
  NESTED: "所选位置嵌套在应用数据目录或另一项目文件夹内",
  IMPORT_FAILED: "处理项目数据失败",
};

/**
 * OQ3 in-flight 探针:remotion 队列的 switch 检查对同 id 请求直接放行
 * （requestProjectSwitch 的 fromProjectId === toProjectId 分支），而移动的是
 * 当前 active 项目本身。用一个永不可能是真实项目 id 的哨兵值即可触发与
 * project-switcher 完全相同的 running/queued 作业判定。
 */
export const MOVE_INFLIGHT_PROBE_PROJECT_ID = "__project-move-inflight-probe__";

/** 选择模式长按选中:按住保持 2 秒才切换选中,普通点击不选中(防误触)。 */
export const SELECT_HOLD_MS = 2_000;
/** 按住期间指针位移超过该距离视为取消(容忍手抖,不干扰拖动/滚动意图)。 */
export const SELECT_HOLD_CANCEL_DISTANCE_PX = 8;

export function Dashboard({
  sidebarCollapsed = false,
  onToggleSidebar,
}: DashboardProps) {
  const {
    projects,
    createProject,
    deleteProject,
    renameProject,
    importProject,
    setProjectLocation,
    setActiveProject,
  } = useProjectStore();
  const { setActiveTab } = useMediaPanelStore();
  const { projectLocationDefaults, setProjectLocationDefaults } = useAppSettingsStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectParentDir, setNewProjectParentDir] = useState("");
  const [newProjectError, setNewProjectError] = useState<string | null>(null);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  // 长按选中:正在按住的卡片 id(驱动进度反馈);fired 标记用于吞掉长按
  // 完成后松手必然触发的那次 click,避免选中状态被立刻反向切换。
  const [holdSelectProjectId, setHoldSelectProjectId] = useState<string | null>(null);
  const holdSelectTimerRef = useRef<number | null>(null);
  const holdSelectFiredRef = useRef(false);
  const holdSelectStartRef = useRef<{ x: number; y: number } | null>(null);

  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Duplicate loading
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Move dialog (OQ3: confirm → directory picker → progress/cancel)
  const [moveTarget, setMoveTarget] = useState<Project | null>(null);
  const [movePhase, setMovePhase] = useState<"confirm" | "moving">("confirm");
  const [moveProgress, setMoveProgress] = useState<ProjectFolderMoveProgressEvent | null>(null);

  // Import: brief scroll+ring attention on an already-registered project card
  const [highlightProjectId, setHighlightProjectId] = useState<string | null>(null);

  // Sort projects by updatedAt descending
  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  // ==================== Create / Open ====================

  const { handleOpenProject, handleSelectAll, handleBatchDelete, handleRename, openRenameDialog, toggleSelectionMode, toggleSelect, startHoldSelect, moveHoldSelect, cancelHoldSelect } = useDashboardProjectActions({
    projects, selectionMode, setSelectionMode, selectedIds, setSelectedIds,
    setBatchDeleteConfirm, setRenameDialogOpen, renameTarget, setRenameTarget,
    renameValue, setRenameValue, getProjectFolderBridge, deleteProject, renameProject, initializeRemotionWorkspace, setActiveTab, holdSelectTimerRef, holdSelectStartRef, holdSelectFiredRef, setHoldSelectProjectId,
  });

  const { handleMoveStart, handleCancelMove, highlightProjectCard, openMoveDialog, closeMoveDialog } = useDashboardMoveActions({
    moveTarget, setMoveTarget, setMovePhase, setMoveProgress,
    setActiveProject, setProjectLocation, setHighlightProjectId,
    projectLocationDefaults, setProjectLocationDefaults,
  });

  const { handleChooseParentDir, handleCreateProject, handleDuplicate, handleImportProject } = useDashboardProjectLifecycle({
    projects, showNewProject, setShowNewProject, newProjectName, setNewProjectName,
    newProjectParentDir, setNewProjectParentDir, newProjectError, setNewProjectError,
    setHighlightProjectId, createProject, importProject,
    duplicatingId, setDuplicatingId, projectLocationDefaults, setProjectLocationDefaults, setActiveTab,
    highlightProjectCard,
  });

  const formatDate = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const allSelected = projects.length > 0 && selectedIds.size === projects.length;

  return (
    <div className="dashboard-shell flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="dashboard-topbar h-14 border-b border-border bg-panel pr-8 pl-20 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {onToggleSidebar && (
            <SidebarToggleButton
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={onToggleSidebar}
            />
          )}
          <div className="dashboard-topbar-title">
            <span className="text-sm font-semibold text-foreground">漫影工作室</span>
            <span className="text-xs text-muted-foreground">影像制片工作台</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {projects.length > 0 && (
            <Button
              variant={selectionMode ? "secondary" : "outline"}
              size="sm"
              onClick={toggleSelectionMode}
            >
              <CheckSquare className="w-4 h-4 mr-1.5" />
              {selectionMode ? "退出选择" : "管理"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleImportProject}
          >
            <FolderUp className="w-4 h-4 mr-2" />
            导入项目
          </Button>
          <Button
            onClick={() => setShowNewProject(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          >
            <Plus className="w-4 h-4 mr-2" />
            新建项目
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="dashboard-content dashboard-content-scroll flex-1 overflow-y-auto p-8">
        <div className="w-full max-w-7xl mx-auto">
          <div className="dashboard-hero mb-8">
            <div className="dashboard-hero-copy min-w-0">
              <div className="dashboard-kicker">
                <span className="dashboard-kicker-line" />
                <span>电影级 AI 漫剧工作流</span>
              </div>
              <h2 className="dashboard-title text-foreground">漫影工作室</h2>
              <div className="dashboard-title-rule" />
              <div className="dashboard-stage-row mt-5">
                {dashboardStages.map(({ label, detail, icon: StageIcon }) => (
                  <span key={label} className="dashboard-stage-chip">
                    <StageIcon className="h-3.5 w-3.5" />
                    <span className="dashboard-stage-label">{label}</span>
                    <span className="dashboard-stage-detail">{detail}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="dashboard-cinema-board" aria-hidden="true">
              <div className="dashboard-board-header">
                <div className="dashboard-board-title">
                  <span className="dashboard-board-led" />
                  <span>制片画布</span>
                </div>
                <div className="dashboard-board-meters">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="dashboard-monitor">
                <div className="dashboard-monitor-screen">
                  <div className="dashboard-monitor-vignette" />
                  <div className="dashboard-monitor-scene is-wide">
                    <Clapperboard className="h-5 w-5" />
                  </div>
                  <div className="dashboard-monitor-scene">
                    <MonitorPlay className="h-5 w-5" />
                  </div>
                  <div className="dashboard-monitor-scene is-warm">
                    <Wand2 className="h-5 w-5" />
                  </div>
                </div>
              </div>
              <div className="dashboard-console">
                <div className="dashboard-console-preview">
                  <Waves className="h-5 w-5" />
                </div>
                <div className="dashboard-console-timeline">
                  {timelineLanes.map((lane) => (
                    <div key={lane.label} className="dashboard-lane">
                      <span>{lane.label}</span>
                      <i
                        className={`dashboard-lane-bar is-${lane.tone}`}
                        style={{ width: lane.width }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section Header */}
          <div className="dashboard-section-header flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">我的项目</h2>
              <p className="text-sm text-muted-foreground">
                共 {projects.length} 个项目
                {selectionMode && (
                  <span className="ml-2 text-muted-foreground/70">· 长按卡片 2 秒选中或取消</span>
                )}
                {selectionMode && selectedIds.size > 0 && (
                  <span className="text-primary ml-2">· 已选 {selectedIds.size} 个</span>
                )}
              </p>
            </div>

            {/* Selection toolbar */}
            {selectionMode && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSelectAll}>
                  {allSelected ? "取消全选" : "全选"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selectedIds.size === 0}
                  onClick={() => setBatchDeleteConfirm(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  删除选中 ({selectedIds.size})
                </Button>
              </div>
            )}
          </div>

          {/* New Project Input */}
          {showNewProject && (
            <div className="dashboard-inline-editor mb-6 p-4 bg-muted/50 border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="输入项目名称..."
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    setNewProjectError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                  className="flex-1"
                  autoFocus
                />
                <Button onClick={handleCreateProject} disabled={!newProjectName.trim() || !newProjectParentDir}>
                  创建
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName("");
                    setNewProjectParentDir("");
                    setNewProjectError(null);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <Button variant="outline" size="sm" onClick={handleChooseParentDir}>
                  <Folder className="w-4 h-4 mr-1.5" />
                  选择位置
                </Button>
                <div className="flex-1 min-w-0">
                  {newProjectParentDir ? (
                    <p
                      className="text-xs font-mono text-muted-foreground truncate"
                      title={newProjectParentDir}
                    >
                      {newProjectParentDir}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">
                      必选：项目文件夹将创建在所选父目录下
                    </p>
                  )}
                </div>
              </div>
              {newProjectError && (
                <p className="text-xs text-destructive mt-2">{newProjectError}</p>
              )}
            </div>
          )}

          {/* Project Grid */}
          <div className="dashboard-project-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sortedProjects.map((project, index) => {
              const isSelected = selectedIds.has(project.id);
              const isDuplicating = duplicatingId === project.id;

              return (
                <div
                  key={project.id}
                  data-project-card={project.id}
                  // 卡片是纯 div,不在全局音效系统的交互选择器里;显式接入快门音。
                  // 选择模式下点按无动作(选中只认长按),不出声。
                  data-interaction-sound={selectionMode ? "off" : "primary"}
                  className={cn(
                    "dashboard-project-card group relative bg-card border rounded-xl overflow-hidden transition-all duration-200",
                    highlightProjectId === project.id && "ring-2 ring-primary",
                    selectionMode && "select-none",
                    selectionMode
                      ? isSelected
                        ? "border-primary ring-1 ring-primary/30 cursor-pointer"
                        : "border-border cursor-pointer hover:border-muted-foreground/30"
                      : "border-border hover:border-primary/50 cursor-pointer",
                  )}
                  onClick={() => {
                    if (selectionMode) {
                      // 选中只认长按满 2 秒;这里同时吞掉长按完成后松手的那次
                      // click,避免选中状态被立刻反向切换。
                      holdSelectFiredRef.current = false;
                      return;
                    }
                    handleOpenProject(project.id);
                  }}
                  onPointerDown={(event) => startHoldSelect(project.id, event)}
                  onPointerMove={moveHoldSelect}
                  onPointerUp={cancelHoldSelect}
                  onPointerLeave={cancelHoldSelect}
                  onPointerCancel={cancelHoldSelect}
                >
                  {/* Selection Checkbox */}
                  {selectionMode && (
                    <div className="absolute top-3 left-3 z-10">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(project.id)}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="bg-background/80 backdrop-blur-sm"
                      />
                    </div>
                  )}

                  {/* 长按进度反馈:2 秒填满即选中(时长与 SELECT_HOLD_MS 同步) */}
                  {selectionMode && holdSelectProjectId === project.id && (
                    <div className="absolute inset-x-0 bottom-0 z-20 h-1 overflow-hidden" aria-hidden="true">
                      <div className="dashboard-hold-select-progress h-full bg-primary" />
                    </div>
                  )}

                  {/* Project Thumbnail */}
                  <div className="dashboard-project-thumb aspect-video bg-muted flex items-center justify-center">
                    <div className="dashboard-project-thumb-mark">
                      <Film className="w-9 h-9" />
                    </div>
                    <div className="dashboard-project-thumb-timeline" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    {isDuplicating && (
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      </div>
                    )}
                  </div>

                  {/* Project Info */}
                  <div className="p-4">
                    <div className="metadata-mono text-[9px] text-accent/80 tracking-widest mb-1.5 font-medium">
                      REEL // {(sortedProjects.length - index).toString().padStart(3, "0")}
                    </div>
                    <h3 className="font-semibold text-foreground truncate mb-2 text-[15px]">
                      {project.name}
                    </h3>
                    {project.location && (
                      <p
                        className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground/80 truncate mb-2"
                        title={project.location}
                      >
                        <FolderOpen className="w-3 h-3 shrink-0" />
                        <span className="truncate">{project.location}</span>
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span className="metadata-mono">{formatDate(project.updatedAt)}</span>
                      </div>

                      {/* Actions menu (hidden in selection mode) */}
                      {!selectionMode && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-all"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => openRenameDialog(project.id, project.name)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDuplicate(project.id)}
                              disabled={isDuplicating}
                            >
                              <Copy className="w-4 h-4 mr-2" />
                              复制项目
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openMoveDialog(project)}>
                              <FolderInput className="w-4 h-4 mr-2" />
                              移动到…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Hover Overlay (not in selection mode) */}
                  {!selectionMode && (
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  )}
                </div>
              );
            })}

            {/* Empty State */}
            {projects.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <Film className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                  还没有项目
                </h3>
                <p className="text-sm text-muted-foreground/70 mb-6">
                  创建你的第一个 AI 视频项目
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleImportProject}>
                    <FolderUp className="w-4 h-4 mr-2" />
                    导入项目
                  </Button>
                  <Button onClick={() => setShowNewProject(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    新建项目
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DashboardDialogs
        renameDialogOpen={renameDialogOpen} setRenameDialogOpen={setRenameDialogOpen}
        renameValue={renameValue} setRenameValue={setRenameValue} handleRename={handleRename}
        movePhase={movePhase} moveProgress={moveProgress} moveTarget={moveTarget}
        handleCancelMove={handleCancelMove} closeMoveDialog={closeMoveDialog} handleMoveStart={handleMoveStart}
        Progress={Progress} selectedIds={selectedIds} projects={projects}
        MOVE_PHASE_LABELS={MOVE_PHASE_LABELS}
        batchDeleteConfirm={batchDeleteConfirm} setBatchDeleteConfirm={setBatchDeleteConfirm}
        handleBatchDelete={handleBatchDelete}
      />
    </div>
  );
}
