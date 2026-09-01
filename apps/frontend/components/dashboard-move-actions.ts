/**
 * Dashboard 项目移动钩子——handleMoveStart/handleCancelMove(OQ3 跨目录移动)。
 * Dashboard 四期拆出,体逐字保留;组件 state 经 ctx 注入。
 */
import { useCallback, useEffect } from "react";
import type { Project } from "@/stores/project/project-store";
import type { ProjectFolderMoveResult } from "@/types/electron";
import { MOVE_INFLIGHT_PROBE_PROJECT_ID, MOVE_ERROR_HINTS } from "./Dashboard";
import { toast } from "sonner";
import { getProjectFolderBridge } from "@/lib/bridge/project-folder";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { useProjectStore } from "@/stores/project/project-store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDashboardMoveActions(ctx: any) {
  const { moveTarget, setMoveTarget, setMovePhase, setMoveProgress, setActiveProject, setProjectLocation, setHighlightProjectId, projectLocationDefaults, setProjectLocationDefaults, movePhase } = ctx;

  const handleMoveStart = useCallback(async () => {
    const project = moveTarget;
    if (!project) return;
    const storage = getStorageManagerBridge();
    const folderBridge = getProjectFolderBridge();
    if (!storage?.selectDirectory || !folderBridge?.move) {
      toast.error("移动项目需要桌面端环境");
      return;
    }

    const defaultPath = project.location
      ? project.location.substring(0, project.location.lastIndexOf("/"))
      : projectLocationDefaults.lastParentDir || undefined;
    const targetParentDir = await storage.selectDirectory(defaultPath);
    if (!targetParentDir) return; // Picker dismissed; stay on the confirm step.

    // OQ3: moving the currently open project is allowed, but only when no
    // render jobs are in flight (same judgment as project-switcher).
    const wasActive = useProjectStore.getState().activeProjectId === project.id;
    if (wasActive) {
      const queue = typeof window !== "undefined" ? window.remotionQueue : undefined;
      if (queue?.canSwitchProject) {
        const decision = await queue.canSwitchProject(MOVE_INFLIGHT_PROBE_PROJECT_ID);
        if (!decision.allowed) {
          toast.error("Remotion 任务仍在运行，暂不能移动项目", {
            description: decision.jobIds.join(", "),
          });
          return;
        }
      }
      useProjectStore.getState().setActiveProject(null);
    }

    setMovePhase("moving");
    setMoveProgress(null);
    let result: ProjectFolderMoveResult;
    try {
      result = await folderBridge.move(project.id, project.name, targetParentDir);
    } catch (err) {
      result = {
        ok: false,
        code: "MOVE_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      setMoveTarget(null);
      setMoveProgress(null);
    }

    if (result.ok) {
      setProjectLocation(project.id, result.location);
      setProjectLocationDefaults({ lastParentDir: targetParentDir });
      if (wasActive) setActiveProject(project.id);
      toast.success(`已移动「${project.name}」到新位置`, { description: result.location });
      return;
    }
    // 失败/取消:先恢复 active,再提示。
    if (wasActive) setActiveProject(project.id);
    if (result.code === "CANCELLED") {
      toast.warning("已取消移动项目");
      return;
    }
    const hint = MOVE_ERROR_HINTS[result.code];
    toast.error("移动项目失败", {
      description: result.message ? `${hint}：${result.message}` : hint,
    });
  }, [
    moveTarget,
    projectLocationDefaults.lastParentDir,
    setMovePhase,
    setMoveProgress,
    setMoveTarget,
    setProjectLocation,
    setProjectLocationDefaults,
    setActiveProject,
  ]);

  const handleCancelMove = useCallback(async () => {
    const project = moveTarget;
    const bridge = getProjectFolderBridge();
    if (!project || !bridge?.cancelMove) return;
    try {
      await bridge.cancelMove(project.id);
    } catch (err) {
      toast.error("取消移动失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [moveTarget]);

  // ==================== Import (二期挂接已有项目文件夹) ====================

  const highlightProjectCard = useCallback((projectId: string) => {
    setHighlightProjectId(projectId);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-project-card="${projectId}"]`)
        ?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    });
    window.setTimeout(() => setHighlightProjectId(null), 2000);
  }, [setHighlightProjectId]);

  // Subscribe for the whole lifetime of the move dialog (not just the moving
  // phase) so no early progress frame is missed between dialog open and the
  // move() invoke.
  useEffect(() => {
    if (!moveTarget) return;
    const bridge = getProjectFolderBridge();
    const unsubscribe = bridge?.onMoveProgress?.((event) => {
      if (event.projectId !== moveTarget.id) return;
      setMoveProgress(event);
    });
    return () => unsubscribe?.();
  }, [moveTarget, setMoveProgress]);

  // ==================== Move (OQ3) ====================

  const openMoveDialog = useCallback((project: Project) => {
    setMoveTarget(project);
    setMovePhase("confirm");
    setMoveProgress(null);
  }, [setMovePhase, setMoveProgress, setMoveTarget]);

  const closeMoveDialog = useCallback(() => {
    // While moving, dismissal goes through the cancel button (cancelMove);
    // the pending move() promise owns closing the dialog.
    if (movePhase === "moving") return;
    setMoveTarget(null);
    setMoveProgress(null);
  }, [movePhase, setMoveProgress, setMoveTarget]);

  return { handleMoveStart, handleCancelMove, highlightProjectCard, openMoveDialog, closeMoveDialog };
}
