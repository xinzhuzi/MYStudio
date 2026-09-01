/**
 * Dashboard 项目操作钩子——打开项目/全选/批量删除/重命名。
 * Dashboard 三期拆出,体逐字保留;组件 state 经 ctx 注入。
 */
import { useCallback, useEffect } from "react";
import type { Project } from "@/stores/project/project-store";
import { useProjectStore } from "@/stores/project/project-store";
import { SELECT_HOLD_MS, SELECT_HOLD_CANCEL_DISTANCE_PX } from "./Dashboard";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { switchProject } from "@/lib/project/project-switcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDashboardProjectActions(ctx: any) {
  const { projects, selectionMode, setSelectionMode, selectedIds, setSelectedIds, setBatchDeleteConfirm, setRenameDialogOpen, renameTarget, setRenameTarget, renameValue, setRenameValue, getProjectFolderBridge, initializeRemotionWorkspace, setActiveTab, holdSelectTimerRef, holdSelectStartRef, setHoldSelectProjectId, holdSelectFiredRef, deleteProject, renameProject } = ctx;

  const handleOpenProject = async (projectId: string) => {
    if (selectionMode) return; // Don't open in selection mode
    const project = projects.find((p) => p.id === projectId);
    if (project?.location) {
      const folderBridge = getProjectFolderBridge();
      if (folderBridge) {
        const status = await folderBridge.status(projectId);
        if (!status.exists) {
          toast.error("项目文件夹不存在，无法打开", {
            description: `${status.location ?? project.location}——可在项目列表使用「导入项目」重新挂接该文件夹`,
          });
          return;
        }
      }
    }
    // force:启动恢复的活跃项目可能存在 store 水合竞态(空数据),显式打开须走完整 rehydrate
    await switchProject(projectId, { force: true });
    await initializeRemotionWorkspace(projectId);
    setActiveTab("overview");
  };

  // ==================== Selection ====================

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set()); // Clear on exit
      return !prev;
    });
  }, [setSelectedIds, setSelectionMode]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setSelectedIds]);

  const cancelHoldSelect = useCallback(() => {
    if (holdSelectTimerRef.current !== null) {
      window.clearTimeout(holdSelectTimerRef.current);
      holdSelectTimerRef.current = null;
    }
    holdSelectStartRef.current = null;
    setHoldSelectProjectId(null);
  }, [holdSelectStartRef, holdSelectTimerRef, setHoldSelectProjectId]);

  const startHoldSelect = useCallback(
    (projectId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectionMode || event.button !== 0 || holdSelectTimerRef.current !== null) return;
      holdSelectFiredRef.current = false;
      holdSelectStartRef.current = { x: event.clientX, y: event.clientY };
      setHoldSelectProjectId(projectId);
      holdSelectTimerRef.current = window.setTimeout(() => {
        holdSelectTimerRef.current = null;
        setHoldSelectProjectId(null);
        holdSelectFiredRef.current = true;
        toggleSelect(projectId);
      }, SELECT_HOLD_MS);
    },
    [
      holdSelectFiredRef,
      holdSelectStartRef,
      holdSelectTimerRef,
      selectionMode,
      setHoldSelectProjectId,
      toggleSelect,
    ],
  );

  const moveHoldSelect = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (holdSelectTimerRef.current === null || holdSelectStartRef.current === null) return;
      const dx = event.clientX - holdSelectStartRef.current.x;
      const dy = event.clientY - holdSelectStartRef.current.y;
      if (Math.hypot(dx, dy) > SELECT_HOLD_CANCEL_DISTANCE_PX) cancelHoldSelect();
    },
    [cancelHoldSelect, holdSelectStartRef, holdSelectTimerRef],
  );

  // 卸载时清掉在途的长按计时器
  useEffect(() => () => {
    if (holdSelectTimerRef.current !== null) {
      window.clearTimeout(holdSelectTimerRef.current);
    }
  }, [holdSelectTimerRef]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === projects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(projects.map((p) => p.id)));
    }
  }, [projects, selectedIds.size, setSelectedIds]);

  // ==================== Delete (management-mode batch path only) ====================

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
    [deleteProject, getProjectFolderBridge],
  );

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
  }, [
    projects,
    selectedIds,
    deleteProjectsOrchestrated,
    setBatchDeleteConfirm,
    setSelectedIds,
    setSelectionMode,
  ]);

  // ==================== Rename ====================
  const openRenameDialog = useCallback((id: string, name: string) => {
    setRenameTarget({ id, name });
    setRenameValue(name);
    setRenameDialogOpen(true);
  }, [setRenameDialogOpen, setRenameTarget, setRenameValue]);

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
  }, [
    renameTarget,
    renameValue,
    projects,
    getProjectFolderBridge,
    renameProject,
    setRenameDialogOpen,
    setRenameTarget,
  ]);

  // ==================== Duplicate ====================

  return { handleOpenProject, handleSelectAll, handleBatchDelete, handleRename, openRenameDialog, toggleSelectionMode, toggleSelect, startHoldSelect, moveHoldSelect, cancelHoldSelect };
}
