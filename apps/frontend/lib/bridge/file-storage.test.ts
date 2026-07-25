import { describe, expect, it } from "vitest";
import { getFileStorageBridge } from "./file-storage";

describe("getFileStorageBridge", () => {
  it("returns undefined during SSR", () => {
    const previousWindow = globalThis.window;
    Reflect.deleteProperty(globalThis, "window");

    try {
      expect(getFileStorageBridge()).toBeUndefined();
    } finally {
      (globalThis as unknown as { window: Window | undefined }).window = previousWindow;
    }
  });

  it("returns the exact preload bridge identity", () => {
    const previousWindow = globalThis.window;
    const bridge = {
      getItem: async () => null,
      setItem: async () => true,
      removeItem: async () => true,
      exists: async () => true,
      listKeys: async () => [],
      listDirs: async () => [],
      removeDir: async () => true,
    } satisfies NonNullable<Window["fileStorage"]>;
    (globalThis as unknown as { window: Window }).window = { fileStorage: bridge } as unknown as Window;

    try {
      expect(getFileStorageBridge()).toBe(bridge);
    } finally {
      (globalThis as unknown as { window: Window | undefined }).window = previousWindow;
    }
  });
});
