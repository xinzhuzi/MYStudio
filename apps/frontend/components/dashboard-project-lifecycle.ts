/**
 * Dashboard 项目生命周期钩子——创建(handleCreateProject/chooseParentDir)/
 * 复制(handleDuplicate 三步+novel 随行)/导入(handleImportProject)。
 * Dashboard 五期拆出,体逐字保留;组件 state 经 ctx 注入。
 */
import { useCallback } from "react";
import type { Project } from "@/stores/project/project-store";
import { copyProjectScopedStoreFiles, waitForProjectStoreFile } from "@/lib/project/project-duplication";
import { useProjectStore } from "@/stores/project/project-store";
import { getFileStorageBridge } from "@/lib/bridge/file-storage";
import { generateUUID } from "@/lib/utils";
import { switchProject } from "@/lib/project/project-switcher";
import { toast } from "sonner";
import { getProjectFolderBridge } from "@/lib/bridge/project-folder";
import { getStorageManagerBridge } from "@/lib/bridge/storage-manager";
import { IMPORT_ERROR_HINTS, initializeRemotionWorkspace } from "./Dashboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDashboardProjectLifecycle(ctx: any) {
  const { projects, setShowNewProject, newProjectName, setNewProjectName, newProjectParentDir, setNewProjectParentDir, setNewProjectError, createProject, importProject, setDuplicatingId, projectLocationDefaults, setProjectLocationDefaults, setActiveTab, highlightProjectCard } = ctx;

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
  }, [projectLocationDefaults.lastParentDir, setNewProjectError, setNewProjectParentDir]);

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

      // STEP 3.5: novel/ 子树随行（原著圣经 MEMORY.md/章节镜像/原著档案）。
      // 外部副本在 STEP 0 已注册位置、内部副本根=dataRoot/_p/<新id>，此时均可解析；
      // 失败只降级提示，不阻断 store 复制（无 novel/ 的项目是合法空操作）。
      const folderBridgeForCopy = getProjectFolderBridge();
      if (folderBridgeForCopy?.copyNovel) {
        try {
          const novelCopy = await folderBridgeForCopy.copyNovel(projectId, newProjectId);
          if (!novelCopy.ok) {
            toast.warning("原著文件未随副本复制", { description: novelCopy.message });
          }
        } catch (err) {
          toast.warning("原著文件未随副本复制", { description: (err as Error).message });
        }
      }

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
  }, [projects, setDuplicatingId]);

  const handleImportProject = useCallback(async () => {
    const storage = getStorageManagerBridge();
    const folderBridge = getProjectFolderBridge();
    if (!storage?.selectDirectory || !folderBridge?.importFolder) {
      toast.error("导入项目需要桌面端环境");
      return;
    }
    const folderPath = await storage.selectDirectory();
    if (!folderPath) return;
    const result = await folderBridge.importFolder(folderPath);
    if (result.ok) {
      importProject(result.project);
      toast.success(`已导入「${result.project.name}」`, { description: result.project.location });
      return;
    }
    if (result.code === "ALREADY_REGISTERED") {
      toast.warning("该项目已在列表中");
      if (result.existingProjectId) highlightProjectCard(result.existingProjectId);
      return;
    }
    const hint = IMPORT_ERROR_HINTS[result.code];
    toast.error("导入项目失败", {
      description: result.message ? `${hint}：${result.message}` : hint,
    });
  }, [importProject, highlightProjectCard]);


  return { handleChooseParentDir, handleCreateProject, handleDuplicate, handleImportProject };
}
