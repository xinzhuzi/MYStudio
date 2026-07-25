import { afterEach, describe, expect, it } from "vitest";
import {
  getStorageManagerBridge,
  type StorageManagerBridge,
} from "./storage-manager";

describe("getStorageManagerBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getStorageManagerBridge()).toBeUndefined();
  });

  it("returns the preload bridge without reshaping its contract", () => {
    const bridge: StorageManagerBridge = {
      getPaths: async () => ({
        basePath: "/data",
        projectPath: "/data/projects",
        mediaPath: "/data/media",
        skillsPath: "/data/skills",
        cachePath: "/data/cache",
      }),
      selectDirectory: async () => null,
      validateDataDir: async () => ({ valid: true }),
      moveData: async () => ({ success: true }),
      linkData: async () => ({ success: true }),
      exportData: async () => ({ success: true }),
      importData: async () => ({ success: true }),
      getCacheSize: async () => ({ total: 0, details: [] }),
      clearCache: async () => ({ success: true }),
      updateConfig: async () => true,
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { storageManager: bridge },
    });

    expect(getStorageManagerBridge()).toBe(bridge);
  });
});
