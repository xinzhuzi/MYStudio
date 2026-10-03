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

// react-resizable-panels 4(1003 B3)在挂载布局效应里无条件 new window.ResizeObserver
// (dist:1953),jsdom 无该构造器直接 TypeError:n is not a constructor;真浏览器原生具备,
// 仅测试环境补无操作桩(与上方 localStorage 桩同款定位:环境垫片,非业务代码)
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as typeof globalThis & { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}
