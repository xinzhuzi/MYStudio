// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Dashboard - Project List and Management
 * Features: create, open, rename, duplicate, batch select & delete
 */

import { useState, useCallback } from "react";
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
import { SidebarToggleButton } from "@/components/ChromeControls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
 
  Clock,
  Clapperboard,
  Film,
  Folder,
  FolderOpen,
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

interface DashboardProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

async function initializeRemotionWorkspace(projectId: string): Promise<void> {
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

export function Dashboard({
  sidebarCollapsed = false,
  onToggleSidebar,
}: DashboardProps) {
  const { projects, createProject, deleteProject, renameProject } = useProjectStore();
  const { setActiveTab } = useMediaPanelStore();
  const { projectLocationDefaults, setProjectLocationDefaults } = useAppSettingsStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectParentDir, setNewProjectParentDir] = useState("");
  const [newProjectError, setNewProjectError] = useState<string | null>(null);

  // External-project delete confirmation (full paths must be shown)
  const [deleteConfirmTargets, setDeleteConfirmTargets] = useState<Project[] | null>(null);
  const [isDeletingProjects, setIsDeletingProjects] = useState(false);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Duplicate loading
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // Sort projects by updatedAt descending
  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  // ==================== Create / Open ====================

  const handleChooseParentDir = useCallback(async () => {
    const storage = getStorageManagerBridge();
    if (!storage) {
      toast.error("选择位置需要桌面端环境");
      return;
    }
    const dir = await storage.selectDirectory(projectLocationDefaults.lastParentDir || undefined);
    if (!dir) return;
    setNewProjectParentDir(dir);
    setNewProjectError(null);
  }, [projectLocationDefaults.lastParentDir]);

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name || !newProjectParentDir) return;
    const folderBridge = getProjectFolderBridge();
    if (!folderBridge) {
      toast.error("新建项目文件夹需要桌面端环境");
      return;
    }
    const projectId = generateUUID();
    const prepared = await folderBridge.prepare(projectId, newProjectParentDir, name);
    if (!prepared.ok) {
      // Keep the form open so the user can fix the name / location.
      if (prepared.code === "CONFLICT") {
        setNewProjectError(prepared.message);
      } else {
        toast.error("项目文件夹创建失败", { description: prepared.message });
      }
      return;
    }
    createProject(name, prepared.location, projectId);
    setProjectLocationDefaults({ lastParentDir: newProjectParentDir });
    setNewProjectName("");
    setNewProjectParentDir("");
    setNewProjectError(null);
    setShowNewProject(false);
    await switchProject(projectId);
    await initializeRemotionWorkspace(projectId);
    setActiveTab("overview");
  };

  const handleOpenProject = async (projectId: string) => {
    if (selectionMode) return; // Don't open in selection mode
    const project = projects.find((p) => p.id === projectId);
    if (project?.location) {
      const folderBridge = getProjectFolderBridge();
      if (folderBridge) {
        const status = await folderBridge.status(projectId);
        if (!status.exists) {
          toast.error("项目文件夹不存在，无法打开", {
            description: status.location ?? project.location,
          });
          return;
        }
      }
    }
    await switchProject(projectId);
    await initializeRemotionWorkspace(projectId);
    setActiveTab("overview");
  };

  // ==================== Selection ====================

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set()); // Clear on exit
      return !prev;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === projects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(projects.map((p) => p.id)));
    }
  }, [projects, selectedIds.size]);

  // ==================== Delete (legacy immediate / external orchestrated) ====================

  const deleteProjectsOrchestrated = useCallback(
    async (targets: Project[]): Promise<number> => {
      let removed = 0;
      for (const project of targets) {
        if (project.location) {
          const folderBridge = getProjectFolderBridge();
          if (!folderBridge) {
            toast.error(`删除「${project.name}」需要桌面端环境`);
            continue;
          }
          const result = await folderBridge.remove(project.id);
          if (!result.ok) {
            toast.error(`删除「${project.name}」的文件夹失败`, { description: result.message });
            continue;
          }
        }
        deleteProject(project.id);
        removed += 1;
      }
      return removed;
    },
    [deleteProject],
  );

  const handleSingleDelete = useCallback(
    (project: Project) => {
      if (project.location) {
        // External projects delete the whole folder: confirm with the full path.
        setDeleteConfirmTargets([project]);
        return;
      }
      deleteProject(project.id);
      toast.success(`已删除「${project.name}」`);
    },
    [deleteProject],
  );

  const handleConfirmExternalDelete = useCallback(async () => {
    const targets = deleteConfirmTargets ?? [];
    if (targets.length === 0) return;
    setIsDeletingProjects(true);
    try {
      const removed = await deleteProjectsOrchestrated(targets);
      if (removed > 0) {
        toast.success(`已删除 ${removed} 个项目`);
      }
      setDeleteConfirmTargets(null);
      setSelectedIds(new Set());
      setSelectionMode(false);
    } finally {
      setIsDeletingProjects(false);
    }
  }, [deleteConfirmTargets, deleteProjectsOrchestrated]);

  // ==================== Batch Delete ====================

  const handleBatchDelete = useCallback(async () => {
    const targets = projects.filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    const removed = await deleteProjectsOrchestrated(targets);
    if (removed > 0) {
      toast.success(`已删除 ${removed} 个项目`);
    }
    setSelectedIds(new Set());
    setBatchDeleteConfirm(false);
    setSelectionMode(false);
  }, [projects, selectedIds, deleteProjectsOrchestrated]);

  // ==================== Rename ====================

  const openRenameDialog = useCallback((id: string, name: string) => {
    setRenameTarget({ id, name });
    setRenameValue(name);
    setRenameDialogOpen(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const newName = renameValue.trim();
    const target = projects.find((p) => p.id === renameTarget.id);
    if (target?.location) {
      const folderBridge = getProjectFolderBridge();
      if (!folderBridge) {
        toast.error("重命名外部项目需要桌面端环境");
        return;
      }
      const result = await folderBridge.rename(renameTarget.id, newName);
      if (!result.ok) {
        toast.error("重命名失败", { description: result.message });
        return;
      }
      // Keep the registry location in sync with the renamed folder.
      useProjectStore.setState((state) => ({
        projects: state.projects.map((p) =>
          p.id === renameTarget.id ? { ...p, location: result.location } : p,
        ),
      }));
    }
    renameProject(renameTarget.id, newName);
    setRenameDialogOpen(false);
    setRenameTarget(null);
    toast.success("项目已重命名");
  }, [renameTarget, renameValue, projects, renameProject]);

  // ==================== Duplicate ====================

  const handleDuplicate = useCallback(async (projectId: string) => {
    const source = projects.find((p) => p.id === projectId);
    if (!source) return;

    setDuplicatingId(projectId);

    try {
      const fs = getFileStorageBridge();
      if (!fs) {
        toast.warning('文件存储不可用，仅复制了项目名称');
        setDuplicatingId(null);
        return;
      }

      // The new project id is needed up-front: external copies register the
      // prepared folder under this id before any store data is written.
      const newProjectId = generateUUID();

      // STEP 0 (external source only): prepare the copy folder next to the source.
      // Candidate names 项目名 (副本), 项目名 (副本)-2/-3… (max 20 attempts) — this
      // flow has no rename entry, so conflicts auto-suffix instead of erroring.
      let copyLocation: string | undefined;
      let newProjectName = `${source.name} (副本)`;
      if (source.location) {
        const folderBridge = getProjectFolderBridge();
        if (!folderBridge) {
          toast.error("复制外部项目需要桌面端环境");
          return;
        }
        const parentDir = source.location.substring(0, source.location.lastIndexOf("/"));
        const baseName = `${source.name} (副本)`;
        for (let attempt = 1; attempt <= 20; attempt++) {
          const candidateName = attempt === 1 ? baseName : `${baseName}-${attempt}`;
          const prepared = await folderBridge.prepare(newProjectId, parentDir, candidateName);
          if (prepared.ok) {
            copyLocation = prepared.location;
            newProjectName = prepared.location.substring(prepared.location.lastIndexOf("/") + 1);
            break;
          }
          if (prepared.code !== "CONFLICT") {
            toast.error("创建副本文件夹失败", { description: prepared.message });
            return;
          }
        }
        if (!copyLocation) {
          toast.error(`副本文件夹命名冲突过多，请整理「${parentDir}」后重试`);
          return;
        }
      }

      // STEP 1: Ensure source project data is persisted to disk.
      // Per-project files (_p/{pid}/*.json) only exist after a store's setItem is called.
      // If data was loaded from legacy storage but never modified, the per-project files
      // won't exist. Force a switchProject to trigger rehydrate → state merge → persist write.
      const currentPid = useProjectStore.getState().activeProjectId;
      if (currentPid === projectId) {
        // switchProject would no-op for same ID. Temporarily deactivate to force full cycle.
        useProjectStore.getState().setActiveProject(null);
      }
      await switchProject(projectId);
      await waitForProjectStoreFile(fs, `_p/${projectId}/tts`);

      // STEP 2: The new project ID was generated up-front (see above).
      // CRITICAL: Do NOT call createProject() here — it would change
      // project-store's activeProjectId, which affects getActiveProjectId() used by
      // all storage adapters. Any pending persist writes could then route to the
      // wrong per-project file, overwriting the copied data.

      // STEP 3: Copy per-project files with project ID rewriting.
      // activeProjectId still points to the source project during this step.
      const copiedCount = await copyProjectScopedStoreFiles(
        fs,
        projectId,
        newProjectId,
      );

      // STEP 4: NOW add the project entry to project-store (after all files are copied).
      // Use setState directly to add the project WITHOUT changing activeProjectId.
      // This prevents any persist writes from being routed to the new project's files
      // before the copy is fully complete.
      const newProject: Project = {
        id: newProjectId,
        name: newProjectName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(copyLocation ? { location: copyLocation } : {}),
      };
      useProjectStore.setState((state) => ({
        projects: [newProject, ...state.projects],
      }));

      if (copiedCount > 0) {
        toast.success(`已复制项目「${source.name}」(${copiedCount} 个数据文件)`);
      } else {
        toast.warning('项目数据文件为空，仅复制了项目名称');
      }

      // STEP 5: Reset activeProjectId so the next project open triggers a full switchProject.
      useProjectStore.getState().setActiveProject(null);
    } catch (err) {
      console.error('[Duplicate] Failed:', err);
      toast.error(`复制项目数据失败: ${(err as Error).message}`);
    } finally {
      setDuplicatingId(null);
    }
  }, [projects]);

  // ==================== Helpers ====================

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
              <h2 className="dashboard-title text-3xl font-bold text-foreground">漫影工作室</h2>
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
                  className={cn(
                    "dashboard-project-card group relative bg-card border rounded-xl overflow-hidden transition-all duration-200",
                    selectionMode
                      ? isSelected
                        ? "border-primary ring-1 ring-primary/30 cursor-pointer"
                        : "border-border cursor-pointer hover:border-muted-foreground/30"
                      : "border-border hover:border-primary/50 cursor-pointer",
                  )}
                  onClick={() => {
                    if (selectionMode) {
                      toggleSelect(project.id);
                    } else {
                      handleOpenProject(project.id);
                    }
                  }}
                >
                  {/* Selection Checkbox */}
                  {selectionMode && (
                    <div className="absolute top-3 left-3 z-10">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(project.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-background/80 backdrop-blur-sm"
                      />
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
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-muted text-muted-foreground transition-all"
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
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleSingleDelete(project)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              删除
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
                <Button onClick={() => setShowNewProject(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  新建项目
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== Rename Dialog ==================== */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            placeholder="输入新名称..."
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>取消</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Batch Delete Confirm Dialog ==================== */}
      <Dialog open={batchDeleteConfirm} onOpenChange={setBatchDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认批量删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            即将删除 <span className="text-foreground font-medium">{selectedIds.size}</span> 个项目，
            此操作不可撤销。确定继续？
          </p>
          {projects.filter((p) => selectedIds.has(p.id) && p.location).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">以下外部项目的整个文件夹将被一并删除：</p>
              {projects
                .filter((p) => selectedIds.has(p.id) && p.location)
                .map((p) => (
                  <p
                    key={p.id}
                    className="text-xs font-mono text-destructive truncate"
                    title={p.location}
                  >
                    {p.location}
                  </p>
                ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteConfirm(false)}>取消</Button>
            <Button variant="destructive" onClick={handleBatchDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== External Delete Confirm Dialog ==================== */}
      <Dialog
        open={deleteConfirmTargets !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmTargets(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除项目文件夹</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            该项目位于外部位置，删除会移除列表条目并
            <span className="text-foreground font-medium">删除整个磁盘文件夹</span>
            （含所有分镜、时间线与导出数据），此操作不可撤销。
          </p>
          {deleteConfirmTargets?.map((project) => (
            <p
              key={project.id}
              className="text-xs font-mono text-destructive truncate"
              title={project.location}
            >
              {project.location}
            </p>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmTargets(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={handleConfirmExternalDelete}
              disabled={isDeletingProjects}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
