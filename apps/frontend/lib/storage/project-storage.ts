import type { StateStorage } from "zustand/middleware";
import { fileStorage } from "./indexed-db-storage";
import { persistWithStatus, reportPersistenceFailure, clearPersistenceFailure } from "./persistence-status";
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
  type Scope = { pid: string; mode: string; projects: Map<string, T | null>; shared: boolean; sharedBase: T | null };
  let scope: Scope | null = null;
  let generation = 0;
  let readInFlight: { name: string; pid: string; mode: string; promise: Promise<string | null> } | null = null;
  const mode = () => sharingKey && getResourceSharing()[sharingKey] ? 'all' : 'own';
  const decode = (raw: string) => {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error(`资源文件格式无效：${storeName}`);
    return { state: (parsed.state ?? parsed) as T, version: parsed.version ?? 0 };
  };
  // Other projects retain their own selection/settings; only resource arrays change.
  const preserveMetadata = (next: T, previous: T | null): T => {
    if (!previous) return next;
    const arrays = Object.fromEntries(Object.entries(next as object).filter(([, value]) => Array.isArray(value)));
    return { ...previous, ...arrays };
  };
  return {
    getItem: async function readItem(name: string, scopeRetries = 0): Promise<string | null> {
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => { unsub(); resolve(); });
        });
      }
      const pid = getActiveProjectId();
      const currentMode = mode();
      if (!pid) {
        ++generation;
        scope = null;
        readInFlight = null;
        return fileStorage.getItem(name);
      }
      if (readInFlight?.name === name && readInFlight.pid === pid && readInFlight.mode === currentMode) {
        return readInFlight.promise;
      }
      const epoch = ++generation;
      scope = null;
      const promise = (async () => {
        const loaded: Scope = { pid, mode: currentMode, projects: new Map(), shared: false, sharedBase: null };
        try {
          const raw = await fileStorage.getItem(`_p/${pid}/${storeName}`);
          let current: T | null = null;
          let legacyState: T | null = null;
          let version = 0;
          if (raw !== null) {
            const decoded = decode(raw); current = decoded.state; version = decoded.version;
          } else {
            const legacy = await fileStorage.getItem(name);
            if (legacy !== null) {
              const decoded = decode(legacy); version = decoded.version;
              legacyState = decoded.state;
              current = splitFn(decoded.state, pid).projectData;
              // Keep legacy shared data only when that scope is actually visible.
              if (currentMode !== 'own') loaded.sharedBase = splitFn(decoded.state, pid).sharedData;
            }
          }
          loaded.projects.set(pid, current);
          let merged: T = mergeFn(null, null);
          if (currentMode === 'all') {
            for (const otherPid of getAllProjectIds()) {
              if (otherPid === pid) continue;
              try {
                const otherRaw = await fileStorage.getItem(`_p/${otherPid}/${storeName}`);
                const other = otherRaw === null ? (legacyState === null ? null : splitFn(legacyState, otherPid).projectData) : decode(otherRaw).state;
                loaded.projects.set(otherPid, other);
                clearPersistenceFailure(`split-read:${storeName}:${otherPid}`);
                merged = mergeFn(other, merged);
              } catch (error) {
                reportPersistenceFailure({ key: `split-read:${storeName}:${otherPid}`, operation: 'read', message: `资源未加载，已保护原文件：${storeName}/${otherPid}（${String(error)}）` });
              }
            }
          }
          if (currentMode !== 'own') {
            try {
              const sharedRaw = await fileStorage.getItem(`_shared/${storeName}`);
              const shared = sharedRaw === null ? loaded.sharedBase : decode(sharedRaw).state;
              loaded.sharedBase = shared; loaded.shared = true;
              clearPersistenceFailure(`split-read:${storeName}:shared`);
              // Preserve established ordering: shared, other projects, current.
              merged = mergeFn(merged, shared);
            } catch (error) {
              reportPersistenceFailure({ key: `split-read:${storeName}:shared`, operation: 'read', message: `共享资源未加载，已保护原文件：${storeName}（${String(error)}）` });
            }
          }
          merged = mergeFn(current, merged);
          if (epoch !== generation || pid !== getActiveProjectId() || currentMode !== mode()) {
            // Disk discovery/settings hydration can change the initial scope without
            // issuing a newer store hydration. Read that scope once, never reuse
            // the old payload or retry an explicitly superseded request.
            if (epoch === generation && scopeRetries === 0) return readItem(name, 1);
            throw new Error(`资源加载期间项目或共享设置已变化，请重新加载（${storeName}: request=${epoch}/${generation}, project=${pid}/${getActiveProjectId()}, sharing=${currentMode}/${mode()}）`);
          }
          scope = loaded;
          clearPersistenceFailure(`split-read:${storeName}:${pid}`);
          return JSON.stringify({ state: merged, version });
        } catch (error) {
          if (epoch === generation) reportPersistenceFailure({ key: `split-read:${storeName}:${pid}`, operation: 'read', message: `资源读取失败，已阻止覆盖：${storeName}/${pid}` });
          throw error;
        }
      })();
      const flight = { name, pid, mode: currentMode, promise };
      readInFlight = flight;
      try {
        return await promise;
      } finally {
        if (readInFlight === flight) readInFlight = null;
      }
    },
    setItem: (name: string, value: string): Promise<void> => {
      const pid = getActiveProjectId();
      const captured = scope;
      const epoch = generation;
      return persistWithStatus(`split:${storeName}`, async () => {
        if (!pid) { await fileStorage.setItem(name, value); return; }
        if (!captured || captured.pid !== pid || captured.mode !== mode() || epoch !== generation || captured !== scope || getActiveProjectId() !== pid) {
          throw new Error(`资源范围已变化或尚未加载，已阻止保存：${storeName}`);
        }
        const { state, version } = decode(value);
        const assertScope = () => {
          if (captured !== scope || epoch !== generation || getActiveProjectId() !== pid || captured.mode !== mode()) {
            throw new Error(`资源保存期间范围已变化，已停止后续写入：${storeName}`);
          }
        };
        for (const [projectId, previous] of captured.projects) {
          assertScope();
          if (!getAllProjectIds().includes(projectId) && projectId !== pid) continue;
          const { projectData } = splitFn(state, projectId);
          const data = projectId === pid ? projectData : preserveMetadata(projectData, previous);
          await fileStorage.setItem(`_p/${projectId}/${storeName}`, JSON.stringify({ state: data, version }));
        }
        if (captured.shared) {
          assertScope();
          const { sharedData } = splitFn(state, pid);
          await fileStorage.setItem(`_shared/${storeName}`, JSON.stringify({ state: preserveMetadata(sharedData, captured.sharedBase), version }));
        }
      });
    },
    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      await fileStorage.removeItem(pid ? `_p/${pid}/${storeName}` : name);
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
