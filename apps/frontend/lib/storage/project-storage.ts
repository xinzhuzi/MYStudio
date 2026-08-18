// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Project-Scoped Storage Adapters for Zustand
 * 
 * Routes store data to per-project files under _p/{projectId}/
 * and shared data to _shared/
 */

import type { StateStorage } from 'zustand/middleware';
import { fileStorage } from './indexed-db-storage';
import { useProjectStore } from '@/stores/project/project-store';
import { useAppSettingsStore } from '@/stores/app/app-settings-store';
import {
  buildAttributionContextFromState,
  chapterKeyOfDomainItem,
  isFullNovelChapter,
  md5Utf8,
  mergeStudioWorkflowShards,
  parseStudioWorkflowShardManifest,
  planStudioWorkflowShards,
  STUDIO_WORKFLOW_SHARD_DIR,
  type StudioWorkflowDomainGeneration,
  type StudioWorkflowShardManifest,
} from './studio-workflow-shards';
// 权威模板原样打进渲染包（?raw 内联字符串）；与仓内 assets/docs 同源
import readmeTemplate from '@/assets/docs/studio-workflow/README.md?raw';
import projectReadmeTemplate from '@/assets/docs/project/README.md?raw';
import backupsReadmeTemplate from '@/assets/docs/backups/README.md?raw';

// ==================== Helpers ====================

function isSafeProjectId(value: unknown): value is string {
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
function getActiveProjectId(): string | null {
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
function getResourceSharing(): { shareCharacters: boolean; shareScenes: boolean; shareMedia: boolean } {
  try {
    return useAppSettingsStore.getState().resourceSharing;
  } catch {
    return { shareCharacters: true, shareScenes: true, shareMedia: true };
  }
}

/**
 * Get all project IDs from project-store.
 */
function getAllProjectIds(): string[] {
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
function shardFileKeyPrefix(pid: string): string {
  return `_p/${pid}/${STUDIO_WORKFLOW_SHARD_DIR}`;
}

function shardKeyForFile(pid: string, shardFileName: string): string {
  return `${shardFileKeyPrefix(pid)}/${shardFileName.replace(/\.json$/, "")}`;
}

async function fileStorageKeyExists(key: string): Promise<boolean> {
  const bridge = typeof window !== 'undefined' ? window.fileStorage : undefined;
  if (bridge?.exists) {
    try {
      return await bridge.exists(key);
    } catch {
      // falls through to content probe
    }
  }
  return Boolean(await fileStorage.getItem(key));
}

/**
 * 串行化分片写入：zustand persist 的相邻 setItem 可能交叠。分片+manifest 是
 * 多文件一代写入，必须整代完成后才进入下一代，否则 manifest 会指向混合代分片。
 */
function createWriteSerializer(): (action: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (action) => {
    const run = tail.then(action, action);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Creates a StateStorage for the studio-workflow store that persists the
 * envelope as ≤512KB domain shards under `_p/{pid}/studio-workflow/`
 * (manifest-driven), falling back to the legacy single file while a project
 * has not been migrated yet.
 *
 * - getItem: manifest 存在 → 按 manifest 合并分片；任一分片缺失/损坏 → 回退
 *   项目级旧单文件 → 根级 legacy 键（与 createProjectScopedStorage 相同链路）
 * - setItem: 拆片写入（单条超限独占一片，绝不截断）→ manifest 最后原子换新 →
 *   旧单文件改名 `studio-workflow-store.bak-sharded-<ts>` 保留 → 清理未列出孤儿
 */
/** 增量写缓存：上一代分片（按 pid 隔离）。文件名含内容指纹且比对到内容串，未变分片零重写。 */
interface PreviousShardGeneration {
  pid: string;
  manifest: StudioWorkflowShardManifest;
  filesByName: Map<string, string>;
}

export function createStudioWorkflowShardedStorage(
  storeName: string,
  options: {
    /** live state 注入（studio-store 传延迟求值 getter，避免反向 import 成环） */
    getLiveState?: () => unknown;
    /** 每 N 次保存强制全量自愈（默认 50；测试可覆写） */
    fullSaveEvery?: number;
    /** 测试/重置专用：允许空工作区覆写非空磁盘分片库（默认拒绝） */
    allowEmptyOverwrite?: boolean;
  } = {},
): StateStorage {
  const serializeWrite = createWriteSerializer();
  let previousGeneration: PreviousShardGeneration | null = null;
  // CPU 增量缓存（08-18 store-cpu-incremental）：域级复用按 pid 隔离；条目 WeakMap 跨 pid 安全
  const itemCache = new WeakMap<object, string>();
  let domainCache: Map<string, StudioWorkflowDomainGeneration> | null = null;
  let domainCachePid: string | null = null;
  let saveCounter = 0;
  let lastVersion: number | null = null;
  // 读链损坏标志：manifest 在场但分片缺失/损坏（getItem 已 throw）→ 本会话后续
  // 空工作区保存视为事故形态拒绝；健康读链上的合法重置（resetStudioWorkflow）不受影响
  let hydrationDamaged = false;
  const envFullSaveEvery = Number.parseInt(process.env.MYSTUDIO_SHARD_FULL_SAVE_EVERY ?? "", 10);
  const fullSaveEvery = options.fullSaveEvery ?? (Number.isFinite(envFullSaveEvery) ? envFullSaveEvery : 50);

  const readMergedShards = async (pid: string): Promise<string | null> => {
    const manifestRaw = await fileStorage.getItem(`${shardFileKeyPrefix(pid)}/manifest`);
    if (!manifestRaw) return null;
    const manifest = parseStudioWorkflowShardManifest(manifestRaw);
    if (!manifest) {
      throw new Error('studio-workflow manifest 无法解析');
    }
    if (manifest.chapterIndex !== undefined) {
      // 窗口化 v1 读：只读项目级分片 + 激活章分片（启动 O(窗口)，与总章数无关）
      const active = typeof manifest.activeChapterId === 'string' && manifest.activeChapterId
        ? manifest.activeChapterId
        : manifest.chapterIndex.find((entry) => typeof entry.id === 'string')?.id ?? null;
      const wanted = manifest.shards.filter((shardName) => {
        if (!shardName.startsWith('chapters/')) return true;
        return shardName.split('/')[1] === active;
      });
      const contents: string[] = [];
      for (const shardName of wanted) {
        const raw = await fileStorage.getItem(shardKeyForFile(pid, shardName));
        if (typeof raw !== 'string') {
          throw new Error(`studio-workflow 分片缺失: ${shardName}`);
        }
        contents.push(raw);
      }
      const merged = mergeStudioWorkflowShards(contents);
      const mergedChapters = merged.state.novelChapters;
      const novelChapters = manifest.chapterIndex.map((entry) => {
        if (entry.id === active && Array.isArray(mergedChapters)) {
          const full = mergedChapters.find((chapter) => (
            chapter && typeof chapter === 'object' && (chapter as Record<string, unknown>).id === active
          ));
          if (full) return full;
        }
        return entry;
      });
      // activeChapterId 必须放进 state——zustand persist 只 merge 信封的 state，顶层附加键会被丢弃
      return JSON.stringify({
        state: { ...merged.state, novelChapters, activeChapterId: active },
        version: manifest.version,
      });
    }
    const contents: string[] = [];
    for (const shardName of manifest.shards) {
      const raw = await fileStorage.getItem(shardKeyForFile(pid, shardName));
      if (typeof raw !== 'string') {
        throw new Error(`studio-workflow 分片缺失: ${shardName}`);
      }
      contents.push(raw);
    }
    const merged = mergeStudioWorkflowShards(contents);
    return JSON.stringify({ state: merged.state, version: manifest.version });
  };

  return {
    getItem: async (name: string): Promise<string | null> => {
      // 等待 project-store 完成 rehydration，确保拿到正确的 activeProjectId
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
        console.warn(`[StudioWorkflowShardedStorage] No activeProjectId, falling back to legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      try {
        const merged = await readMergedShards(pid);
        if (merged !== null) {
          hydrationDamaged = false;
          return merged;
        }
      } catch (error) {
        hydrationDamaged = true;
        console.error('[StudioWorkflowShardedStorage] 分片读取失败，回退旧单文件:', error);
      }

      const projectKey = `_p/${pid}/${storeName}`;
      const projectData = await fileStorage.getItem(projectKey);
      if (projectData) return projectData;
      return fileStorage.getItem(name);
    },

    setItem: async (name: string, value: string): Promise<void> => {
      const dataProjectId = extractStudioWorkflowDataProjectId(value);
      const pid = dataProjectId || getActiveProjectId();

      if (!pid) {
        // No project active, save to legacy location
        await fileStorage.setItem(name, value);
        return;
      }

      const routerPid = getActiveProjectId();
      if (dataProjectId && routerPid && dataProjectId !== routerPid) {
        console.warn(
          `[StudioWorkflowShardedStorage] Routing mismatch for ${storeName}: data.pid=${dataProjectId.substring(0, 8)}, ` +
          `router.pid=${routerPid.substring(0, 8)}. Using data.pid to prevent cross-project overwrite.`
        );
      }

      await serializeWrite(async () => {
        let skipOrphanCleanup = false;
        saveCounter += 1;
        // 版本探针：zustand 信封为紧凑 JSON、version 位于尾部——尾部切片正则，免全量 parse 判版本
        const versionProbe = /"version":\s*(-?\d+)\s*}\s*$/.exec(value.slice(-64));
        const probedVersion = versionProbe ? Number.parseInt(versionProbe[1]!, 10) : null;
        if (probedVersion === null || probedVersion !== lastVersion) {
          // 版本变化（迁移跑过）→ 域缓存必须失效（分片内容含 version，复用会写错代）
          domainCache = null;
        }
        const forceFull = saveCounter % fullSaveEvery === 0;
        const canIncremental = Boolean(options.getLiveState);
        if (canIncremental && !domainCache) domainCache = new Map();
        const domainCachePidMismatch = domainCachePid !== pid;
        if (domainCachePidMismatch) domainCache = canIncremental ? new Map() : null;
        let plan;
        try {
          // 空态覆写守卫（script-store 同款事故形态）：value 无任何章/分镜/任务而磁盘
          // manifest 存在且非空 → 这是读链损坏后的空 hydrate，拒写防整库覆写
          try {
            const probe = JSON.parse(value) as { state?: Record<string, unknown> };
            const st = probe.state ?? {};
            const isEmptyWorkspace = (Array.isArray(st.novelChapters) ? st.novelChapters.length === 0 : true)
              && (Array.isArray(st.storyboards) ? st.storyboards.length === 0 : true)
              && (Array.isArray(st.mediaTasks) ? st.mediaTasks.length === 0 : true);
            if (isEmptyWorkspace && hydrationDamaged) {
              const diskManifestRaw = await fileStorage.getItem(`${shardFileKeyPrefix(pid)}/manifest`);
              const diskManifest = diskManifestRaw ? parseStudioWorkflowShardManifest(diskManifestRaw) : null;
              if (diskManifest && diskManifest.shards.length > 0 && !options.allowEmptyOverwrite) {
                console.error('[StudioWorkflowShardedStorage] 拒绝空态覆写：磁盘分片库非空(' + diskManifest.shards.length + ' 片)而保存值为空工作区——读链可能损坏，需人工核查');
                return;
              }
            }
          } catch (error) {
            if (error instanceof SyntaxError) throw error; // value 本身坏→走既有回退
          }
          plan = planStudioWorkflowShards(value, {
            getLiveState: canIncremental ? options.getLiveState : undefined,
            itemCache,
            domainCache: canIncremental && domainCache ? domainCache : undefined,
            refreshItemCache: forceFull || undefined,
            emitChapterIndex: true,
          });
          // 窗口化 v1 写：归档章分片名抄录——窗口 state 只含激活章条目，磁盘上
          // 其他章的既有分片（stamp 命名不可变）按名并入本代 manifest，孤儿清理不误删
          try {
            const activeId = plan.manifest.activeChapterId ?? null;
            if (plan.manifest.chapterIndex !== undefined) {
              const diskManifestRaw = previousGeneration
                ? null
                : await fileStorage.getItem(`${shardFileKeyPrefix(pid)}/manifest`);
              const diskManifest = previousGeneration?.manifest
                ?? (diskManifestRaw ? parseStudioWorkflowShardManifest(diskManifestRaw) : null);
              if (diskManifest) {
                const listed = new Set(plan.manifest.shards);
                for (const shardName of diskManifest.shards) {
                  if (!shardName.startsWith('chapters/')) continue;
                  if (shardName.split('/')[1] === activeId) continue;
                  if (listed.has(shardName)) continue;
                  plan.manifest.shards.push(shardName);
                  listed.add(shardName);
                }
              }
            }
          } catch (error) {
            // 数据安全：抄录失败时必须跳过本次孤儿清理——否则未并入 manifest 的
            // 归档章分片会被清理当孤儿删除（丢他章数据）
            skipOrphanCleanup = true;
            console.error('[StudioWorkflowShardedStorage] 归档章分片名抄录失败，本次跳过孤儿清理（下次保存重试）:', error);
          }
        } catch (error) {
          console.error('[StudioWorkflowShardedStorage] 分片规划失败，回退旧单文件写:', error);
          await fileStorage.setItem(`_p/${pid}/${storeName}`, value);
          previousGeneration = null;
          domainCache = null;
          return;
        }
        domainCachePid = pid;
        lastVersion = plan.manifest.version;
        if (forceFull) {
          console.warn('[StudioWorkflowShardedStorage] 周期性全量自愈保存（覆盖原地突变漂移）');
        }
        if (plan.oversizedFiles.length > 0) {
          console.warn(
            `[StudioWorkflowShardedStorage] 单条数据超过 512KB 预算，独占分片: ${plan.oversizedFiles.join(', ')}`
          );
        }

        const prefix = shardFileKeyPrefix(pid);
        // 增量写（08-18）：与上一代（同 pid）逐片比对「文件名+内容串」——未变化的
        // 分片已在新旧两代 manifest 中同名存在且内容一致，跳过重写；改一章只写
        // 该章新文件。名同内容异（指纹碰撞，概率 ~2^-32）按变更处理原地重写。
        // 应用重启/切项目后缓存为空 → 首次保存退化为全量，正确性不受影响。
        // manifest 最后原子换新——中途崩溃时旧 manifest 仍指向完整旧代。
        const previous = previousGeneration && previousGeneration.pid === pid
          ? previousGeneration
          : null;
        for (const file of plan.files) {
          if (previous && previous.filesByName.get(file.name) === file.content) continue;
          await fileStorage.setItem(shardKeyForFile(pid, file.name), file.content);
        }
        const manifestContent = JSON.stringify(plan.manifest, null, 2);
        const previousManifestContent = previous
          ? JSON.stringify(previous.manifest, null, 2)
          : null;
        if (manifestContent !== previousManifestContent) {
          await fileStorage.setItem(`${prefix}/manifest`, manifestContent);
        }
        previousGeneration = {
          pid,
          manifest: plan.manifest,
          filesByName: new Map(plan.files.map((file) => [file.name, file.content])),
        };

        // 旧单文件改名保留进 backups/store/（只改名不删；已改名过则为空操作）
        const legacyKey = `_p/${pid}/${storeName}`;
        try {
          if (await fileStorageKeyExists(legacyKey)) {
            const bridge = typeof window !== 'undefined' ? window.fileStorage : undefined;
            const renamed = bridge?.renameItem
              ? await bridge.renameItem(
                  legacyKey,
                  `_p/${pid}/backups/store/${storeName}.bak-sharded-${Date.now()}`,
                )
              : false;
            if (!renamed) {
              console.warn('[StudioWorkflowShardedStorage] 旧单文件改名未执行（renameItem 不可用），文件保留原位');
            }
          }
        } catch (error) {
          console.warn('[StudioWorkflowShardedStorage] 旧单文件改名失败（数据已在分片中，文件保留）:', error);
        }

        // 清理未被 manifest 列出的孤儿分片（上一代 stamp 文件；章文件在 chapters/ 子目录，
        // 用现有 listDirs+listKeys IPC 组合嵌套扫描，不新增 readdir 通道）
        if (skipOrphanCleanup) {
          console.warn('[StudioWorkflowShardedStorage] 孤儿清理已跳过（归档抄录未确认）');
        }
        try {
          if (skipOrphanCleanup) throw new Error('skip');
          const bridge = typeof window !== 'undefined' ? window.fileStorage : undefined;
          if (bridge?.listKeys && bridge?.listDirs) {
            const listed = new Set<string>(plan.manifest.shards.map((fileName) => fileName.replace(/\.json$/, '')));
            const isListed = (relativePath: string) => relativePath === 'manifest' || listed.has(relativePath);
            // 根层：core/materials/shared 桶等
            for (const key of await bridge.listKeys(prefix)) {
              const relativePath = key.slice(prefix.length + 1);
              if (!isListed(relativePath)) await fileStorage.removeItem(key);
            }
            // 子目录：只有 chapters/ 是合法目录；未引用的章目录整目录回收，已引用章目录内清孤儿
            const manifestedRelativePaths: string[] = [...listed];
            const manifestedChapters = new Set<string>(
              manifestedRelativePaths
                .filter((relativePath) => relativePath.startsWith('chapters/'))
                .map((relativePath) => relativePath.split('/')[1]),
            );
            for (const dirName of await bridge.listDirs(prefix)) {
              if (dirName !== 'chapters') {
                await bridge.removeDir?.(`${prefix}/${dirName}`);
                continue;
              }
              const chaptersPrefix = `${prefix}/chapters`;
              for (const chapterId of await bridge.listDirs(chaptersPrefix)) {
                const chapterPrefix = `${chaptersPrefix}/${chapterId}`;
                if (!manifestedChapters.has(chapterId)) {
                  await bridge.removeDir?.(chapterPrefix);
                  continue;
                }
                for (const key of await bridge.listKeys(chapterPrefix)) {
                  const relativePath = key.slice(prefix.length + 1);
                  if (!isListed(relativePath)) await fileStorage.removeItem(key);
                }
              }
            }
          }
        } catch (error) {
          console.warn('[StudioWorkflowShardedStorage] 孤儿分片清理失败（不影响读取）:', error);
        }

        // 自述文档（权威模板逐字拷贝）：每次保存 md5 校验，缺失/漂移即自动覆盖修复
        // —— studio-workflow/README.md（分片目录）与项目根 README.md（全目录介绍）
        await ensureStudioWorkflowReadme(pid);
        await ensureProjectRootReadme(pid);
        await ensureBackupsReadme(pid);
      });
    },

    removeItem: async (name: string): Promise<void> => {
      previousGeneration = null;
      const pid = getActiveProjectId();
      if (!pid) {
        await fileStorage.removeItem(name);
        return;
      }
      const prefix = shardFileKeyPrefix(pid);
      const manifestRaw = await fileStorage.getItem(`${prefix}/manifest`);
      if (manifestRaw) {
        const manifest = parseStudioWorkflowShardManifest(manifestRaw);
        if (manifest) {
          for (const shardName of manifest.shards) {
            await fileStorage.removeItem(shardKeyForFile(pid, shardName));
          }
        }
      }
      await fileStorage.removeItem(`${prefix}/manifest`);
      const bridge = typeof window !== 'undefined' ? window.fileStorage : undefined;
      try {
        await bridge?.removeDir?.(prefix);
      } catch {
        // best-effort：逐文件删除已覆盖 manifest 记录的分片
      }
      await fileStorage.removeItem(`_p/${pid}/${storeName}`);
      await fileStorage.removeItem(name);
    },
  };
}

/** studio-workflow state 本身不含 activeProjectId；预留防御位（与其他 store 同构）。 */
function extractStudioWorkflowDataProjectId(value: string): string | null {
  try {
    const parsed = JSON.parse(value);
    const state = parsed?.state ?? parsed;
    if (state && typeof state === 'object' && isSafeProjectId(state.activeProjectId)) {
      return state.activeProjectId;
    }
  } catch {
    // fall through
  }
  return null;
}

// ==================== Split Storage ====================

/**
 * Split/merge function types for flat-array stores.
 * splitFn: takes the persisted state object and splits it into project-specific and shared parts
 * mergeFn: merges project-specific and shared data back into a single state object
 */
export type SplitFn<T = unknown> = (state: T, projectId: string) => { projectData: T; sharedData: T };
export type MergeFn<T = unknown> = (projectData: T | null, sharedData: T | null) => T;

/**
 * Creates a StateStorage that splits flat-array data between:
 * - _p/{activeProjectId}/{storeName}.json (project-specific items)
 * - _shared/{storeName}.json (shared/global items)
 * 
 * Used for stores with flat arrays that have projectId fields (media, characters, scenes).
 * 
 * @param storeName - Base name for the storage files
 * @param splitFn - Function to split state into project and shared parts
 * @param mergeFn - Function to merge project and shared parts back together
 * @param sharingKey - Optional key in resourceSharing settings to check (e.g., 'shareCharacters')
 */
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

type ProjectFilesTextBridge = {
  writeText?: (key: string, value: string) => Promise<unknown>;
  readText?: (payload: { projectId: string; relativePath: string }) =>
    Promise<{ success?: boolean; text?: string; error?: string } | string | null>;
};

function getProjectFilesBridge(): ProjectFilesTextBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as { projectFiles?: ProjectFilesTextBridge }).projectFiles
    : undefined;
}

/** 模板守护通用实现：读取 relativePath，与模板逐字比对，不一致（含缺失）即覆盖。 */
async function ensureReadmeMatches(
  pid: string,
  relativePath: string,
  template: string,
  label: string,
): Promise<void> {
  try {
    const bridge = getProjectFilesBridge();
    if (!bridge?.writeText) return;
    const existing = await bridge.readText?.({ projectId: pid, relativePath });
    const existingText = typeof existing === 'string'
      ? existing
      : existing?.success && typeof existing.text === 'string'
        ? existing.text
        : null;
    if (existingText !== null && existingText === template) return;
    if (existingText !== null) {
      console.warn(
        `[StudioWorkflowShardedStorage] ${label} 与权威模板不一致(md5: 现场=${md5Utf8(existingText)} 模板=${md5Utf8(template)})，自动覆盖修复`
      );
    }
    await bridge.writeText(`_p/${pid}/${relativePath}`, template);
  } catch (error) {
    console.warn(`[StudioWorkflowShardedStorage] ${label} 校验/修复失败（不影响数据）:`, error);
  }
}

/**
 * README.md 守护：项目 studio-workflow/ 下的自述文档必须与仓内权威模板逐字一致。
 * 每次分片保存后校验 md5——缺失或内容漂移（手改/损坏）→ 用模板覆盖修复。
 */
async function ensureStudioWorkflowReadme(pid: string): Promise<void> {
  await ensureReadmeMatches(
    pid,
    `${STUDIO_WORKFLOW_SHARD_DIR}/README.md`,
    readmeTemplate,
    'studio-workflow/README.md',
  );
}

/**
 * 项目根 README.md 守护：全目录介绍文档（仓内权威模板 assets/docs/project/README.md），
 * 创建项目时预写、每次分片保存后校验自愈——与 studio-workflow README 同一套机制。
 */
async function ensureProjectRootReadme(pid: string): Promise<void> {
  await ensureReadmeMatches(pid, 'README.md', projectReadmeTemplate, '项目根 README.md');
}

/**
 * backups/README.md 守护：备份统一目录的自述（分类规划表），
 * 与其他自述文档同一套机制（创建项目预写 + 每次保存校验自愈）。
 */
async function ensureBackupsReadme(pid: string): Promise<void> {
  await ensureReadmeMatches(pid, 'backups/README.md', backupsReadmeTemplate, 'backups/README.md');
}


/**
 * 窗口化 v1：装载指定章的工作区（switchChapter 用）。
 * 读 manifest → 该章分片 + 根层 shared 桶分片 → 按域返回该章条目；
 * 返回 null=无分片布局/章无分片（调用方回退索引条目）。
 */
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
