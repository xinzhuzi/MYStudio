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

const LEGACY_STORAGE_KEYS: Record<string, string> = {
  "mystudio-app-settings": "moyin-app-settings",
  "mystudio-character-library": "moyin-character-library",
  "mystudio-custom-styles": "moyin-custom-styles",
  "mystudio-director-store": "moyin-director-store",
  "mystudio-freedom": "moyin-freedom",
  "mystudio-media-store": "moyin-media-store",
  "mystudio-project-audio": "moyin-tts-local-audio",
  "mystudio-project-store": "moyin-project-store",
  "mystudio-props-library": "moyin-props-library",
  "mystudio-scene-store": "moyin-scene-store",
  "mystudio-sclass-store": "moyin-sclass-store",
  "mystudio-script-store": "moyin-script-store",
  "mystudio-theme": "moyin-theme",
  "mystudio-timeline-store": "moyin-timeline-store",
  "mystudio-tts-store": "moyin-tts-store",
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
        const localData = localStorage.getItem(name);
        const legacyLocalData = legacyName ? localStorage.getItem(legacyName) : null;
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
          localStorage.removeItem(name);
          if (legacyName) localStorage.removeItem(legacyName);
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
            localStorage.removeItem(name);
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
    return localStorage.getItem(name);
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
      localStorage.setItem(name, value);
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
    localStorage.removeItem(name);
  },
};

// Helper to get data from IndexedDB (for migration)
const getFromIndexedDB = (name: string): Promise<string | null> => {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('moyin-creator-db', 1);
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
    try {
      const request = indexedDB.open('moyin-creator-db', 1);
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
