// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// 自述模板（权威源 assets/docs/）：studio-workflow 分片目录 + 项目根全目录介绍
import readmeTemplate from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadmeTemplate from '@/assets/docs/project/README.md?raw';
import backupsReadmeTemplate from '@/assets/docs/backups/README.md?raw';
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";
import { getFileStorageBridge } from "@/lib/bridge/file-storage";
import { generateUUID } from "@/lib/utils";

export const DEFAULT_FPS = 30;

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 项目根绝对路径;缺省 = legacy 位置(应用数据目录 _p/<id>)。仅用于展示/编排,主进程以位置表为解析权威。 */
  location?: string;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  createProject: (name?: string, location?: string, id?: string) => Project;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  ensureDefaultProject: () => void;
  /** 二期导入:把主进程已挂接的外部项目追加进注册表(不改 activeProjectId)。 */
  importProject: (input: { id: string; name: string; location: string; createdAt?: number }) => Project;
  /** 二期移动:同步注册表中的项目位置(projects 与 activeProject 命中时)。 */
  setProjectLocation: (id: string, location: string) => void;
}

type FileStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  listDirs?: (prefix: string) => Promise<string[]>;
};

const projectStorage: StateStorage = {
  getItem: (name) => typeof window === "undefined" ? null : fileStorage.getItem(name),
  setItem: (name, value) => typeof window === "undefined" ? undefined : fileStorage.setItem(name, value),
  removeItem: (name) => typeof window === "undefined" ? undefined : fileStorage.removeItem(name),
};

// Default project for desktop app
const DEFAULT_PROJECT: Project = {
  id: "default-project",
  name: "漫影工作室项目",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.createdAt === "number" &&
    typeof project.updatedAt === "number" &&
    (project.location === undefined || typeof project.location === "string")
  );
}

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

      createProject: (name, location, id) => {
        const newProject: Project = {
          id: id ?? generateUUID(),
          name: name?.trim() || `新项目 ${new Date().toLocaleDateString('zh-CN')}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(location ? { location } : {}),
        };
        set((state) => ({
          projects: [newProject, ...state.projects],
          // 不在这里设置 activeProjectId —— 由 switchProject() 统一处理
          // 避免 switchProject 因 ID 已相同而跳过 rehydration
        }));
        // 创建项目即预写自述文档（权威模板；后续每次分片保存 md5 校验自愈）：
        // 项目根 README.md（全目录介绍）+ studio-workflow/README.md（分片目录）
        try {
          const projectFilesBridge = typeof window !== 'undefined'
            ? (window as { projectFiles?: { writeText?: (key: string, value: string) => Promise<unknown> } }).projectFiles
            : undefined;
          projectFilesBridge?.writeText?.(
            `_p/${newProject.id}/README.md`,
            projectReadmeTemplate,
          )?.catch?.(() => undefined);
          projectFilesBridge?.writeText?.(
            `_p/${newProject.id}/studio-workflow/README.md`,
            readmeTemplate,
          )?.catch?.(() => undefined);
          projectFilesBridge?.writeText?.(
            `_p/${newProject.id}/backups/README.md`,
            backupsReadmeTemplate,
          )?.catch?.(() => undefined);
        } catch {
          // best-effort：缺失由分片保存钩子补写
        }
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
        const storage = getFileStorageBridge();
        if (storage?.removeDir) {
          storage.removeDir(`_p/${id}`).catch((err: unknown) =>
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

      importProject: (input) => {
        const project: Project = {
          id: input.id,
          name: input.name,
          createdAt: input.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          location: input.location,
        };
        // 对齐复制流程 STEP 4 的理由:仅追加注册表条目,不改 activeProjectId ——
        // storage adapters 按 activeProjectId 路由持久化写入,导入过程中若提前
        // 切到新项目,未完成的 persist 写入会落到新项目的 per-project 文件。
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },

      setProjectLocation: (id, location) => {
        // 移动只改位置,不触碰 updatedAt(非内容编辑,不重排列表排序)。
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, location } : p,
          ),
          activeProject:
            state.activeProject?.id === id
              ? { ...state.activeProject, location }
              : state.activeProject,
        }));
      },
    }),
    {
      name: "mystudio-project-store",
      storage: createJSONStorage(() => projectStorage),
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
      migrate: (persisted: unknown) => {
        const candidate = persisted as Partial<ProjectStore> | null;
        if (Array.isArray(candidate?.projects) && candidate.projects.length > 0) {
          return candidate;
        }
        return {
          projects: [DEFAULT_PROJECT],
          activeProjectId: DEFAULT_PROJECT.id,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // `migrate` is skipped when the persisted version already matches.
        // Normalize same-version payloads before any array methods run.
        const projects = Array.isArray(state.projects)
          ? state.projects.filter(isProject)
          : [];
        if (projects.length === 0) projects.push(DEFAULT_PROJECT);
        state.projects = projects;
        const project =
          projects.find((p) => p.id === state.activeProjectId) ||
          projects[0] ||
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
  const storage = getFileStorageBridge();
  if (!storage?.listDirs) return;

  try {
    // 列出 _p/ 下所有子目录名（每个子目录名就是一个 projectId）
    const diskProjectIds = await storage.listDirs('_p');
    if (!diskProjectIds || diskProjectIds.length === 0) return;

    const { projects } = useProjectStore.getState();
    const knownIds = new Set(projects.map((p) => p.id));

    const missingIds = diskProjectIds.filter((id) => !knownIds.has(id));
    if (missingIds.length === 0) return;


    const recoveredProjects = await Promise.all(
      missingIds.map((pid) => recoverProjectFromDisk(pid, storage))
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
    }
  } catch (err) {
    console.error('[ProjectStore] discoverProjectsFromDisk error:', err);
  }
}
