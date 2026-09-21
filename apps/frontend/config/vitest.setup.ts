function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string) {
      items.delete(String(key));
    },
    setItem(key: string, value: string) {
      items.set(String(key), String(value));
    },
  };
}

function hasStorageMethods(value: unknown): value is Storage {
  const storage = value as Partial<Storage> | undefined;
  return Boolean(
    storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function",
  );
}

// Vitest 1.x aliases window to global and may retain Node's native getter.
// Get jsdom's own storage directly to preserve its origin and DOM semantics.
const currentStorage = (globalThis as typeof globalThis & {
  jsdom?: { window: { localStorage: Storage } };
}).jsdom?.window.localStorage;

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: hasStorageMethods(currentStorage) ? currentStorage : createMemoryStorage(),
});
