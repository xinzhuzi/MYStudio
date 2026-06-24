// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";
import { generateUUID } from "@/lib/utils";

export const DEFAULT_FPS = 30;

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  createProject: (name?: string) => Project;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  ensureDefaultProject: () => void;
}

type FileStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  listDirs?: (prefix: string) => Promise<string[]>;
};

// Default project for desktop app
const DEFAULT_PROJECT: Project = {
  id: "default-project",
  name: "漫影工作室项目",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [DEFAULT_PROJECT],
      activeProjectId: DEFAULT_PROJECT.id,
      activeProject: DEFAULT_PROJECT,

      ensureDefaultProject: () => {
        const { projects, activeProjectId } = get();
        if (projects.length === 0) {
          set({
            projects: [DEFAULT_PROJECT],
            activeProjectId: DEFAULT_PROJECT.id,
            activeProject: DEFAULT_PROJECT,
          });
          return;
        }
        if (!activeProjectId) {
          set({
            activeProjectId: projects[0].id,
            activeProject: projects[0],
          });
        }
      },

      createProject: (name) => {
        const newProject: Project = {
          id: generateUUID(),
          name: name?.trim() || `新项目 ${new Date().toLocaleDateString('zh-CN')}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({
          projects: [newProject, ...state.projects],
          // 不在这里设置 activeProjectId —— 由 switchProject() 统一处理
          // 避免 switchProject 因 ID 已相同而跳过 rehydration
        }));
        return newProject;
      },

      renameProject: (id, name) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p
          ),
          activeProject:
            state.activeProject?.id === id
              ? { ...state.activeProject, name, updatedAt: Date.now() }
              : state.activeProject,
        }));
      },

      deleteProject: (id) => {
        set((state) => {
          const remaining = state.projects.filter((p) => p.id !== id);
          const nextActive =
            state.activeProjectId === id ? remaining[0] || null : state.activeProject;
          return {
            projects: remaining,
            activeProjectId: nextActive?.id || null,
            activeProject: nextActive,
          };
        });
        // Clean up per-project storage directory
        if (window.fileStorage?.removeDir) {
          window.fileStorage.removeDir(`_p/${id}`).catch((err: unknown) =>
            console.warn(`[ProjectStore] Failed to remove project dir _p/${id}:`, err)
          );
        }
      },

      setActiveProject: (id) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === id) || null;
          return {
            activeProjectId: project?.id || null,
            activeProject: project,
          };
        });
      },
    }),
    {
      name: "mystudio-project-store",
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
      migrate: (persisted: unknown) => {
        const candidate = persisted as Partial<ProjectStore> | null;
        if (candidate?.projects && candidate.projects.length > 0) {
          return candidate;
        }
        return {
          projects: [DEFAULT_PROJECT],
          activeProjectId: DEFAULT_PROJECT.id,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const project =
          state.projects.find((p) => p.id === state.activeProjectId) ||
          state.projects[0] ||
          null;
        state.activeProjectId = project?.id || null;
        state.activeProject = project;

        // 异步扫描磁盘上 _p/ 目录，将遗漏的项目恢复到列表中
        // 解决路径切换/导入/迁移后项目列表为空的问题
        discoverProjectsFromDisk().catch((err) =>
          console.warn('[ProjectStore] Disk discovery failed:', err)
        );
      },
    }
  )
);

/**
 * 扫描磁盘上 _p/ 目录下的实际项目文件夹，
 * 将未在 projects 列表中注册的项目自动恢复。
 * 
 * 解决以下场景：
 * - 更改存储路径并迁移数据后，前端 store 未 reload，或 mystudio-project-store.json
 *   中的 projects 列表不完整（旧版本、手动复制等）
 * - 导入数据后 mystudio-project-store.json 缺失或不含新项目
 * - 换电脑后指向旧数据目录，projects 列表为空
 */
export async function recoverProjectFromDisk(pid: string, storage: FileStorageLike): Promise<Project> {
  let name = `恢复的项目 (${pid.substring(0, 8)})`;
  const createdAt = Date.now();

  // Prefer current per-project keys, then fall back to older key names.
  for (const key of [`_p/${pid}/script`, `_p/${pid}/script-store`]) {
    try {
      const scriptRaw = await storage.getItem(key);
      if (!scriptRaw) continue;
      const parsed = JSON.parse(scriptRaw);
      const state = parsed?.state ?? parsed;
      if (state?.projects?.[pid]?.title) {
        name = state.projects[pid].title;
        break;
      }
    } catch { /* ignore */ }
  }

  for (const key of [`_p/${pid}/director`, `_p/${pid}/director-store`]) {
    try {
      const directorRaw = await storage.getItem(key);
      if (!directorRaw) continue;
      const parsed = JSON.parse(directorRaw);
      const state = parsed?.state ?? parsed;
      if (state?.projects?.[pid]?.screenplay) {
        const screenplay = state.projects[pid].screenplay;
        if (name.includes('恢复的项目') && screenplay) {
          const preview = screenplay.substring(0, 20).replace(/\n/g, ' ').trim();
          if (preview) name = preview + '...';
        }
        break;
      }
    } catch { /* ignore */ }
  }

  return {
    id: pid,
    name,
    createdAt,
    updatedAt: Date.now(),
  };
}

export async function discoverProjectsFromDisk(): Promise<void> {
  if (!window.fileStorage?.listDirs) return;

  try {
    // 列出 _p/ 下所有子目录名（每个子目录名就是一个 projectId）
    const diskProjectIds = await window.fileStorage.listDirs('_p');
    if (!diskProjectIds || diskProjectIds.length === 0) return;

    const { projects } = useProjectStore.getState();
    const knownIds = new Set(projects.map((p) => p.id));

    const missingIds = diskProjectIds.filter((id) => !knownIds.has(id));
    if (missingIds.length === 0) return;

    console.log(
      `[ProjectStore] Found ${missingIds.length} projects on disk not in store:`,
      missingIds.map((id) => id.substring(0, 8))
    );

    const recoveredProjects = await Promise.all(
      missingIds.map((pid) => recoverProjectFromDisk(pid, window.fileStorage!))
    );

    if (recoveredProjects.length > 0) {
      useProjectStore.setState((state) => ({
        projects: [...state.projects, ...recoveredProjects],
        ...(state.projects.length === 1 && state.projects[0]?.id === DEFAULT_PROJECT.id
          ? {
              activeProjectId: recoveredProjects[0]?.id ?? state.activeProjectId,
              activeProject: recoveredProjects[0] ?? state.activeProject,
            }
          : {}),
      }));
      console.log(
        `[ProjectStore] Recovered ${recoveredProjects.length} projects from disk:`,
        recoveredProjects.map((p) => `${p.id.substring(0, 8)}:${p.name}`)
      );
    }
  } catch (err) {
    console.error('[ProjectStore] discoverProjectsFromDisk error:', err);
  }
}
