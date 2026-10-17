// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * File Storage Adapter for Zustand
 * Uses Electron's file system for unlimited storage
 * Falls back to localStorage in browser
 */

import type { StateStorage } from 'zustand/middleware';
import { clearPersistenceFailure, persistWithStatus, reportPersistenceFailure } from './persistence-status';

// Type declarations for the fileStorage API exposed by preload
declare global {
  interface Window {
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      renameItem?: (fromKey: string, toKey: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      listDirs: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
  }
}

const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.fileStorage;
};

const getBrowserStorage = (): Storage | null => {
  return typeof localStorage === 'undefined' ? null : localStorage;
};

const LEGACY_STORAGE_PREFIX = ["mo", "yin"].join("");
const LEGACY_INDEXED_DB_NAME = `${LEGACY_STORAGE_PREFIX}-creator-db`;

function legacyStorageKey(suffix: string) {
  return `${LEGACY_STORAGE_PREFIX}-${suffix}`;
}

const LEGACY_STORAGE_KEYS: Record<string, string> = {
  "mystudio-app-settings": legacyStorageKey("app-settings"),
  "mystudio-character-library": legacyStorageKey("character-library"),
  "mystudio-custom-styles": legacyStorageKey("custom-styles"),
  "mystudio-director-store": legacyStorageKey("director-store"),
  "mystudio-freedom": legacyStorageKey("freedom"),
  "mystudio-media-store": legacyStorageKey("media-store"),
  "mystudio-project-audio": legacyStorageKey("tts-local-audio"),
  "mystudio-project-store": legacyStorageKey("project-store"),
  "mystudio-props-library": legacyStorageKey("props-library"),
  "mystudio-scene-store": legacyStorageKey("scene-store"),
  "mystudio-sclass-store": legacyStorageKey("sclass-store"),
  "mystudio-script-store": legacyStorageKey("script-store"),
  "mystudio-theme": legacyStorageKey("theme"),
  "mystudio-timeline-store": legacyStorageKey("timeline-store"),
  "mystudio-tts-store": legacyStorageKey("tts-store"),
};

function getLegacyStorageKey(name: string): string | undefined {
  return LEGACY_STORAGE_KEYS[name];
}

// Check if data has meaningful content (not just empty state)
const hasRichData = (jsonStr: string | null): boolean => {
  if (!jsonStr) return false;
  try {
    const data = JSON.parse(jsonStr);
    const state = data.state || data;
    
    // Check common store patterns for meaningful data
    if (state.projects && Array.isArray(state.projects) && state.projects.length > 1) return true;
    if (state.splitScenes && Array.isArray(state.splitScenes) && state.splitScenes.length > 0) return true;
    if (state.scenes && Array.isArray(state.scenes) && state.scenes.length > 0) return true;
    if (state.episodes && Array.isArray(state.episodes) && state.episodes.length > 0) return true;
    if (state.characters && Array.isArray(state.characters) && state.characters.length > 0) return true;
    if (state.media && Array.isArray(state.media) && state.media.length > 0) return true;
    
    // For director store, check nested project data
    if (state.projects && typeof state.projects === 'object') {
      for (const projectId of Object.keys(state.projects)) {
        const proj = state.projects[projectId];
        if (proj.splitScenes && proj.splitScenes.length > 0) return true;
        if (proj.screenplay) return true;
      }
    }
    
    // Check data size as fallback (more than 1KB likely has real data)
    return jsonStr.length > 1000;
  } catch {
    return jsonStr.length > 1000;
  }
};

const unreadableKeys = new Set<string>();

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
    if (entry.value !== null && sameStoredValue(browser?.getItem(entry.key) ?? null, source)) browser?.removeItem(entry.key);
  }
  for (const entry of idbs) {
    if (entry.value !== null && sameStoredValue(await getFromIndexedDB(entry.key), source)) await removeFromIndexedDB(entry.key);
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

// Helper to get data from IndexedDB (for migration)
const getFromIndexedDB = (name: string): Promise<string | null> => {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('zustand-storage')) {
          resolve(null);
          return;
        }
        const transaction = db.transaction('zustand-storage', 'readonly');
        const store = transaction.objectStore('zustand-storage');
        const getRequest = store.get(name);
        getRequest.onerror = () => resolve(null);
        getRequest.onsuccess = () => resolve(getRequest.result ?? null);
      };
    } catch {
      resolve(null);
    }
  });
};

const removeFromIndexedDB = (name: string): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    try {
      const request = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('zustand-storage')) {
          resolve();
          return;
        }
        const transaction = db.transaction('zustand-storage', 'readwrite');
        const store = transaction.objectStore('zustand-storage');
        store.delete(name);
        resolve();
      };
    } catch {
      resolve();
    }
  });
};

// Migration helper (kept for backward compatibility, but migration now happens in getItem)
export const migrateFromLocalStorage = async (_key: string): Promise<void> => {
  // Migration now happens automatically in fileStorage.getItem
};

// For backward compatibility
export const indexedDBStorage = fileStorage;
