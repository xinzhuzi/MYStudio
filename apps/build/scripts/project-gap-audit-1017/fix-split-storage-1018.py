from pathlib import Path
p=Path('apps/frontend/lib/storage/project-storage.ts')
s=p.read_text().replace('import { fileStorage } from "./indexed-db-storage";', 'import { fileStorage } from "./indexed-db-storage";\nimport { persistWithStatus, reportPersistenceFailure, clearPersistenceFailure } from "./persistence-status";')
a=s.index('  return {',s.index('export function createSplitStorage'))
b=s.index('\nexport type ProjectFilesTextBridge',a)
s=s[:a]+'''  type Scope = { pid: string; mode: string; projects: Map<string, T | null>; shared: boolean; sharedBase: T | null };
  let scope: Scope | null = null;
  let generation = 0;
  const mode = () => sharingKey ? (getResourceSharing()[sharingKey] ? 'all' : 'own') : 'shared';
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
    getItem: async (name: string): Promise<string | null> => {
      const epoch = ++generation;
      scope = null;
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => { unsub(); resolve(); });
        });
      }
      const pid = getActiveProjectId();
      if (!pid) return fileStorage.getItem(name);
      const currentMode = mode();
      const loaded: Scope = { pid, mode: currentMode, projects: new Map(), shared: false, sharedBase: null };
      try {
        const raw = await fileStorage.getItem(`_p/${pid}/${storeName}`);
        let current: T | null = null;
        let version = 0;
        if (raw !== null) {
          const decoded = decode(raw); current = decoded.state; version = decoded.version;
        } else {
          const legacy = await fileStorage.getItem(name);
          if (legacy !== null) {
            const decoded = decode(legacy); version = decoded.version;
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
              const other = otherRaw === null ? null : decode(otherRaw).state;
              loaded.projects.set(otherPid, other);
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
            // Preserve established ordering: shared, other projects, current.
            merged = mergeFn(merged, shared);
          } catch (error) {
            reportPersistenceFailure({ key: `split-read:${storeName}:shared`, operation: 'read', message: `共享资源未加载，已保护原文件：${storeName}（${String(error)}）` });
          }
        }
        merged = mergeFn(current, merged);
        if (epoch !== generation || pid !== getActiveProjectId() || currentMode !== mode()) throw new Error('资源加载期间项目或共享设置已变化，请重新加载');
        scope = loaded;
        clearPersistenceFailure(`split-read:${storeName}:${pid}`);
        return JSON.stringify({ state: merged, version });
      } catch (error) {
        reportPersistenceFailure({ key: `split-read:${storeName}:${pid}`, operation: 'read', message: `资源读取失败，已阻止覆盖：${storeName}/${pid}` });
        throw error;
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
        for (const [projectId, previous] of captured.projects) {
          if (!getAllProjectIds().includes(projectId) && projectId !== pid) continue;
          const { projectData } = splitFn(state, projectId);
          const data = projectId === pid ? projectData : preserveMetadata(projectData, previous);
          await fileStorage.setItem(`_p/${projectId}/${storeName}`, JSON.stringify({ state: data, version }));
        }
        if (captured.shared) {
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
''' + s[b:]
p.write_text(s)
