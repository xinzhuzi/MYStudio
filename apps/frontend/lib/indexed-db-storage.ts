// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * File Storage Adapter for Zustand
 * Uses Electron's file system for unlimited storage
 * Falls back to localStorage in browser
 */

import type { StateStorage } from 'zustand/middleware';

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

export const fileStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    console.log(`[Storage] getItem: ${name}, isElectron: ${isElectron()}`);
    if (isElectron()) {
      try {
        // Get data from all sources
        const fileData = await window.fileStorage!.getItem(name);
        const legacyName = getLegacyStorageKey(name);
        const legacyFileData = !fileData && legacyName ? await window.fileStorage!.getItem(legacyName) : null;
        const browserStorage = getBrowserStorage();
        const localData = browserStorage?.getItem(name) ?? null;
        const legacyLocalData = legacyName ? browserStorage?.getItem(legacyName) ?? null : null;
        let idbData: string | null = null;
        let legacyIdbData: string | null = null;
        try {
          idbData = await getFromIndexedDB(name);
          legacyIdbData = legacyName ? await getFromIndexedDB(legacyName) : null;
        } catch (e) {
          // IndexedDB not available
        }
        
        const resolvedFileData = fileData || legacyFileData;
        const resolvedLocalData = localData || legacyLocalData;
        const resolvedIdbData = idbData || legacyIdbData;

        console.log(`[Storage] Data sizes for ${name}: file=${resolvedFileData?.length || 0}, local=${resolvedLocalData?.length || 0}, idb=${resolvedIdbData?.length || 0}`);
        
        // Determine which data source has the richest data
        const fileHasData = hasRichData(resolvedFileData);
        const localHasData = hasRichData(resolvedLocalData);
        const idbHasData = hasRichData(resolvedIdbData);
        
        console.log(`[Storage] Rich data check for ${name}: file=${fileHasData}, local=${localHasData}, idb=${idbHasData}`);
        
        // Priority: localStorage > IndexedDB > file (for migration)
        // If localStorage or IndexedDB has richer data, migrate it
        if (localHasData && !fileHasData) {
          console.log(`[Storage] Migrating ${name} from localStorage to file storage (richer data)...`);
          await window.fileStorage!.setItem(name, resolvedLocalData!);
          browserStorage?.removeItem(name);
          if (legacyName) browserStorage?.removeItem(legacyName);
          console.log(`[Storage] Migration complete for ${name}`);
          return resolvedLocalData;
        }
        
        if (idbHasData && !fileHasData && !localHasData) {
          console.log(`[Storage] Migrating ${name} from IndexedDB to file storage (richer data)...`);
          await window.fileStorage!.setItem(name, resolvedIdbData!);
          await removeFromIndexedDB(name);
          if (legacyName) await removeFromIndexedDB(legacyName);
          console.log(`[Storage] Migration complete for ${name}`);
          return resolvedIdbData;
        }
        
        // Clean up old data if file storage has the data
        if (fileHasData) {
          if (localData) {
            console.log(`[Storage] Cleaning up localStorage for ${name}`);
            browserStorage?.removeItem(name);
          }
          if (idbData) {
            console.log(`[Storage] Cleaning up IndexedDB for ${name}`);
            await removeFromIndexedDB(name);
          }
          if (legacyFileData && !fileData && legacyName) {
            console.log(`[Storage] Migrating legacy file ${legacyName} to ${name}`);
            const renamed = await window.fileStorage!.renameItem?.(legacyName, name);
            if (!renamed) await window.fileStorage!.setItem(name, legacyFileData);
          }
          return resolvedFileData;
        }
        
        // Return whatever we have
        return resolvedFileData || resolvedLocalData || resolvedIdbData || null;
      } catch (error) {
        console.error('File storage getItem error:', error);
      }
    }
    // Fallback to localStorage (browser mode)
    return getBrowserStorage()?.getItem(name) ?? null;
  },

  setItem: async (name: string, value: string): Promise<void> => {
    console.log(`[Storage] setItem: ${name}, size: ${value.length} chars, isElectron: ${isElectron()}`);
    if (isElectron()) {
      try {
        const result = await window.fileStorage!.setItem(name, value);
        console.log(`[Storage] File save result for ${name}:`, result);
        return;
      } catch (error) {
        console.error('[Storage] File storage setItem error:', error);
      }
    }
    // Fallback to localStorage
    try {
      getBrowserStorage()?.setItem(name, value);
    } catch (error) {
      console.error('localStorage setItem error:', error);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (isElectron()) {
      try {
        await window.fileStorage!.removeItem(name);
        return;
      } catch (error) {
        console.error('File storage removeItem error:', error);
      }
    }
    getBrowserStorage()?.removeItem(name);
  },
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
