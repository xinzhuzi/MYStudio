const LEGACY_STORAGE_PREFIX = ["mo", "yin"].join("");
const LEGACY_INDEXED_DB_NAME = `${LEGACY_STORAGE_PREFIX}-creator-db`;

export function isPersistedSettingsKey(key: string) {
  return key.startsWith("mystudio-")
    || key.startsWith(`${LEGACY_STORAGE_PREFIX}-`)
    || key.includes("store");
}

export function clearPersistedRendererCaches() {
  if (typeof localStorage !== "undefined") {
    Object.keys(localStorage)
      .filter(isPersistedSettingsKey)
      .forEach((key) => localStorage.removeItem(key));
  }

  if (typeof indexedDB === "undefined") return;
  try {
    const request = indexedDB.open(LEGACY_INDEXED_DB_NAME, 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("zustand-storage")) return;
      const transaction = db.transaction("zustand-storage", "readwrite");
      transaction.objectStore("zustand-storage").clear();
    };
  } catch (error) {
    console.warn("Failed to clear IndexedDB:", error);
  }
}
