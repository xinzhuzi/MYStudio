from pathlib import Path
p=Path('apps/frontend/lib/storage/indexed-db-storage.ts')
s=p.read_text().replace("import type { StateStorage } from 'zustand/middleware';", "import type { StateStorage } from 'zustand/middleware';\nimport { clearPersistenceFailure, persistWithStatus, reportPersistenceFailure } from './persistence-status';")
a=s.index('export const fileStorage: StateStorage = {')
b=s.index('// Helper to get data from IndexedDB',a)
s=s[:a]+'''const unreadableKeys = new Set<string>();

function sameStoredValue(left: string | null, right: string): boolean {
  if (left === null) return false;
  try { return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right)); }
  catch { return left === right; }
}

async function confirmedWrite(name: string, value: string): Promise<void> {
  if (!await window.fileStorage!.setItem(name, value)) throw new Error(`文件保存失败：${name}`);
}

async function readElectronItem(name: string): Promise<string | null> {
  const bridge = window.fileStorage!;
  const fileData = await bridge.getItem(name);
  const legacyName = getLegacyStorageKey(name);
  const legacyFileData = fileData === null && legacyName ? await bridge.getItem(legacyName) : null;
  const browser = getBrowserStorage();
  const keys = legacyName ? [name, legacyName] : [name];
  const locals = keys.map(key => ({ key, value: browser?.getItem(key) ?? null }));
  const idbs = await Promise.all(keys.map(async key => ({ key, value: await getFromIndexedDB(key) })));
  const local = locals.find(entry => hasRichData(entry.value)) ?? locals.find(entry => entry.value !== null);
  const idb = idbs.find(entry => hasRichData(entry.value)) ?? idbs.find(entry => entry.value !== null);
  const disk = fileData ?? legacyFileData;
  const source = !hasRichData(disk) && hasRichData(local?.value ?? null) ? local!.value
    : !hasRichData(disk) && hasRichData(idb?.value ?? null) ? idb!.value
    : disk ?? local?.value ?? idb?.value ?? null;
  if (source === null) return null;

  // A legacy file is copied and verified before any source cleanup. Keeping the
  // old file avoids destructive rename before readback confirmation.
  if (fileData === null || !sameStoredValue(fileData, source)) {
    try {
      await persistWithStatus(name, async () => {
        await confirmedWrite(name, source);
        if (!sameStoredValue(await bridge.getItem(name), source)) throw new Error(`迁移回读不一致：${name}`);
      });
    } catch {
      // Hydrate from the intact source; the visible failed save remains retryable.
      return source;
    }
  }
  // Only remove an equivalent browser source. Conflicting historical copies stay.
  for (const entry of locals) {
    if (entry.value !== null && sameStoredValue(entry.value, source)) browser?.removeItem(entry.key);
  }
  for (const entry of idbs) {
    if (entry.value !== null && sameStoredValue(entry.value, source)) await removeFromIndexedDB(entry.key);
  }
  return source;
}

export const fileStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = isElectron() ? await readElectronItem(name) : getBrowserStorage()?.getItem(name) ?? null;
      unreadableKeys.delete(name);
      // A migration write failure must remain visible even though source hydration succeeded.
      clearPersistenceFailure(`read:${name}`);
      return value;
    } catch (error) {
      unreadableKeys.add(name);
      reportPersistenceFailure({ key: `read:${name}`, operation: 'read', message: `读取失败，已阻止覆盖：${name}` });
      throw error;
    }
  },
  setItem: (name: string, value: string): Promise<void> => persistWithStatus(name, async () => {
    if (unreadableKeys.has(name)) throw new Error(`读取尚未恢复，已阻止覆盖：${name}`);
    if (isElectron()) await confirmedWrite(name, value);
    else getBrowserStorage()?.setItem(name, value);
  }),
  removeItem: (name: string): Promise<void> => persistWithStatus(name, async () => {
    if (unreadableKeys.has(name)) throw new Error(`读取尚未恢复，已阻止移除：${name}`);
    if (isElectron()) {
      if (!await window.fileStorage!.removeItem(name)) throw new Error(`文件移除失败：${name}`);
    } else getBrowserStorage()?.removeItem(name);
  }),
};

''' + s[b:]
p.write_text(s)
