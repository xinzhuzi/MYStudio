import type { StateStorage } from "zustand/middleware";
import { fileStorage } from "./indexed-db-storage";
import { useProjectStore } from "@/stores/project/project-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { STUDIO_WORKFLOW_SHARD_DIR, buildAttributionContextFromState, chapterKeyOfDomainItem, isFullNovelChapter, mergeStudioWorkflowShards, parseStudioWorkflowShardManifest } from "./studio-workflow-shards";
import { MergeFn, SplitFn } from "./storage-project-sharded";


export function isSafeProjectId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

/**
 * Get current activeProjectId from project-store.
 * MUST be called synchronously (before any await) to avoid race conditions.
 */
export function getActiveProjectId(): string | null {
  try {
    const projectId = useProjectStore.getState().activeProjectId;
    return isSafeProjectId(projectId) ? projectId : null;
  } catch {
    return null;
  }
}

/**
 * Get resource sharing settings from app-settings-store.
 */
export function getResourceSharing(): { shareCharacters: boolean; shareScenes: boolean; shareMedia: boolean } {
  try {
    return useAppSettingsStore.getState().resourceSharing;
  } catch {
    return { shareCharacters: true, shareScenes: true, shareMedia: true };
  }
}

/**
 * Get all project IDs from project-store.
 */
export function getAllProjectIds(): string[] {
  try {
    return useProjectStore.getState().projects.map(p => p.id).filter(isSafeProjectId);
  } catch {
    return [];
  }
}

// ==================== Project-Scoped Storage ====================

/**
 * Creates a StateStorage that routes data to _p/{activeProjectId}/{storeName}.json
 * Used for stores that are entirely project-scoped (script, director, timeline).
 * 
 * On getItem: reads from _p/{pid}/{storeName}, falls back to legacy key if not migrated
 * On setItem: writes to _p/{pid}/{storeName}
 */
export function createProjectScopedStorage(storeName: string): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      // 等待 project-store 完成 rehydration，确保拿到正确的 activeProjectId
      // 否则启动时可能读到默认值 "default-project"，导致读错文件
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
      }

      const pid = getActiveProjectId();
      
      if (!pid) {
        console.warn(`[ProjectStorage] No activeProjectId, falling back to legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      const projectKey = `_p/${pid}/${storeName}`;
      
      // Try project-scoped path first
      const projectData = await fileStorage.getItem(projectKey);
      if (projectData) {
        return projectData;
      }

      // Fall back to legacy monolithic file (pre-migration)
      return fileStorage.getItem(name);
    },

    setItem: async (name: string, value: string): Promise<void> => {
      // Extract the intended project ID from the data being persisted.
      // This ensures data is always written to the correct per-project file,
      // even if getActiveProjectId() returns a different value due to race conditions
      // (e.g., during app startup when project-store hasn't rehydrated yet,
      //  or during project duplication when createProject changes the active ID).
      let dataProjectId: string | null = null;
      try {
        const parsed = JSON.parse(value);
        const state = parsed?.state ?? parsed;
        if (state && typeof state === 'object' && isSafeProjectId(state.activeProjectId)) {
          dataProjectId = state.activeProjectId;
        }
      } catch {
        // If we can't parse the value, fall back to getActiveProjectId()
      }

      const pid = dataProjectId || getActiveProjectId();
      
      if (!pid) {
        // No project active, save to legacy location
        await fileStorage.setItem(name, value);
        return;
      }

      // Log a warning if there's a mismatch (indicates a race condition was avoided)
      const routerPid = getActiveProjectId();
      if (dataProjectId && routerPid && dataProjectId !== routerPid) {
        console.warn(
          `[ProjectStorage] Routing mismatch for ${storeName}: data.pid=${dataProjectId.substring(0, 8)}, ` +
          `router.pid=${routerPid.substring(0, 8)}. Using data.pid to prevent cross-project overwrite.`
        );
      }

      const projectKey = `_p/${pid}/${storeName}`;
      await fileStorage.setItem(projectKey, value);
    },

    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      if (!pid) {
        await fileStorage.removeItem(name);
        return;
      }
      const projectKey = `_p/${pid}/${storeName}`;
      await fileStorage.removeItem(projectKey);
    },
  };
}

// ==================== Studio Workflow Sharded Storage ====================

/** manifest 里的磁盘文件名（含 .json）→ fileStorage 虚拟键（IPC 层会再补 .json）。 */

export function createSplitStorage<T = unknown>(
  storeName: string,
  splitFn: SplitFn<T>,
  mergeFn: MergeFn<T>,
  sharingKey?: 'shareCharacters' | 'shareScenes' | 'shareMedia',
): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      // 等待 project-store 完成 rehydration
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
      }

      const pid = getActiveProjectId();
      
      if (!pid) {
        console.warn(`[SplitStorage] No activeProjectId, falling back to legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      const projectKey = `_p/${pid}/${storeName}`;
      const sharedKey = `_shared/${storeName}`;
      
      // Try to read current project's data
      const projectRaw = await fileStorage.getItem(projectKey);
      
      // If project file doesn't exist, try legacy file (pre-migration)
      if (!projectRaw) {
        return fileStorage.getItem(name);
      }

      // Check if cross-project sharing is enabled
      let sharingEnabled = false;
      if (sharingKey) {
        const sharing = getResourceSharing();
        sharingEnabled = sharing[sharingKey];
      }

      try {
        const projectState = JSON.parse(projectRaw);
        const projectPayload = projectState?.state ?? projectState;

        if (sharingEnabled) {
          // Cross-project sharing ON: load ALL projects' data + shared
          const allPids = getAllProjectIds();
          const otherPayloads: T[] = [];
          
          for (const otherPid of allPids) {
            if (otherPid === pid) continue; // Current project already loaded
            const otherKey = `_p/${otherPid}/${storeName}`;
            try {
              const otherRaw = await fileStorage.getItem(otherKey);
              if (otherRaw) {
                const otherParsed = JSON.parse(otherRaw);
                otherPayloads.push(otherParsed?.state ?? otherParsed);
              }
            } catch {
              // Skip corrupted project files
            }
          }

          // Load shared data (items without projectId)
          let sharedPayload: T | null = null;
          try {
            const sharedRaw = await fileStorage.getItem(sharedKey);
            if (sharedRaw) {
              const sharedParsed = JSON.parse(sharedRaw);
              sharedPayload = sharedParsed?.state ?? sharedParsed;
            }
          } catch {}

          // Merge: shared → other projects → current project (last gets priority for currentFolderId etc.)
          let merged: T = mergeFn(null, sharedPayload);
          for (const pd of otherPayloads) {
            merged = mergeFn(pd, merged);
          }
          merged = mergeFn(projectPayload, merged);

          return JSON.stringify({
            state: merged,
            version: projectState?.version ?? 0,
          });
        } else {
          // Cross-project sharing OFF: only current project's data
          return JSON.stringify({
            state: projectPayload,
            version: projectState?.version ?? 0,
          });
        }
      } catch (error) {
        console.error(`[SplitStorage] Failed to parse/merge ${storeName}:`, error);
        return projectRaw;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      const pid = getActiveProjectId();
      
      if (!pid) {
        await fileStorage.setItem(name, value);
        return;
      }

      try {
        const parsed = JSON.parse(value);
        const state = parsed.state ?? parsed;
        const version = parsed.version ?? 0;

        // Collect ALL unique projectIds from the state.
        // When sharing is ON, the store may contain items from other projects
        // that were modified (e.g. adding a variation to a character from another project).
        // We must write each project's data back to its own file.
        const knownProjectIds = new Set(getAllProjectIds());
        knownProjectIds.add(pid);
        const allPids = new Set<string>([pid]);
        for (const val of Object.values(state as Record<string, unknown>)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              const itemRecord = item && typeof item === 'object'
                ? item as { projectId?: unknown }
                : null;
              if (itemRecord && isSafeProjectId(itemRecord.projectId) &&
                  knownProjectIds.has(itemRecord.projectId)) {
                allPids.add(itemRecord.projectId);
              }
            }
          }
        }

        // Write each project's data to its respective file
        for (const projectId of allPids) {
          const { projectData } = splitFn(state as T, projectId);
          const key = `_p/${projectId}/${storeName}`;
          const payload = JSON.stringify({ state: projectData, version });
          await fileStorage.setItem(key, payload);
        }

        // Write shared data (items without projectId)
        const { sharedData } = splitFn(state as T, pid);
        const sharedKey = `_shared/${storeName}`;
        const sharedPayload = JSON.stringify({ state: sharedData, version });
        await fileStorage.setItem(sharedKey, sharedPayload);
        
      } catch (error) {
        console.error(`[SplitStorage] Failed to split ${storeName}, saving to legacy:`, error);
        await fileStorage.setItem(name, value);
      }
    },

    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      if (!pid) {
        await fileStorage.removeItem(name);
        return;
      }
      const projectKey = `_p/${pid}/${storeName}`;
      await fileStorage.removeItem(projectKey);
      // Note: shared data is NOT removed when a single project's data is removed
    },
  };
}

export type ProjectFilesTextBridge = {
  writeText?: (key: string, value: string) => Promise<unknown>;
  readText?: (payload: { projectId: string; relativePath: string }) =>
    Promise<{ success?: boolean; text?: string; error?: string } | string | null>;
};


export async function loadStudioChapterWorkspace(
  pid: string,
  chapterId: string,
): Promise<{ novelChapter: unknown; domains: Record<string, unknown[]> } | null> {
  if (!isSafeProjectId(pid)) return null;
  const prefix = `_p/${pid}/${STUDIO_WORKFLOW_SHARD_DIR}`;
  const manifestRaw = await fileStorage.getItem(`${prefix}/manifest`);
  if (!manifestRaw) return null;
  const manifest = parseStudioWorkflowShardManifest(manifestRaw);
  if (!manifest) return null;
  const chapterShards = manifest.shards.filter((name) => name.startsWith(`chapters/${chapterId}/`));
  const sharedShards = manifest.shards.filter((name) => /-shared-\d{3}-/.test(name));
  const contents: string[] = [];
  for (const shardName of [...chapterShards, ...sharedShards]) {
    const raw = await fileStorage.getItem(`${prefix}/${shardName.replace(/\.json$/, "")}`);
    if (typeof raw !== 'string') continue;
    contents.push(raw);
  }
  if (contents.length === 0) return null;
  const merged = mergeStudioWorkflowShards(contents);
  return {
    novelChapter: (merged.state.novelChapters as unknown[] | undefined)?.[0] ?? null,
    domains: merged.state as Record<string, unknown[]>,
  };
}

/** 共享条目判定（switchChapter 保留无章归属条目用） */
export function isSharedDomainItem(domainKey: string, item: unknown, state: Record<string, unknown>): boolean {
  return chapterKeyOfDomainItem(domainKey, item, buildAttributionContextFromState(state)) === null;
}

export { isFullNovelChapter };


export type { MergeFn, SplitFn } from "./storage-project-sharded";
export { createStudioWorkflowShardedStorage, ensureBackupsReadme, ensureProjectRootReadme, ensureReadmeMatches, ensureStudioWorkflowReadme } from "./storage-project-sharded";
