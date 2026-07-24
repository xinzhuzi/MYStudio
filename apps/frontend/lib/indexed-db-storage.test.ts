/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileStorage } from "./indexed-db-storage";
import { migrateToProjectStorage, recoverFromLegacy } from "./storage-migration";

describe("fileStorage legacy MYStudio key migration", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (typeof window !== "undefined") {
      Reflect.deleteProperty(window, "fileStorage");
    }
  });

  function installElectronStorage(initial: Record<string, string>) {
    const values = new Map(Object.entries(initial));
    const getItem = vi.fn(async (key: string) => values.get(key) ?? null);
    const setItem = vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return true;
    });
    Object.defineProperty(window, "fileStorage", {
      configurable: true,
      value: {
        getItem,
        setItem,
        removeItem: vi.fn(async (key: string) => values.delete(key)),
        renameItem: vi.fn(async (fromKey: string, toKey: string) => {
          const value = values.get(fromKey);
          if (value === undefined) return false;
          values.set(toKey, value);
          values.delete(fromKey);
          return true;
        }),
        exists: vi.fn(async (key: string) => values.has(key)),
        listKeys: vi.fn(async () => []),
        listDirs: vi.fn(async () => []),
        removeDir: vi.fn(async () => true),
      },
    });
    return { values, setItem };
  }

  it("does not throw when browser storage globals are unavailable", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("localStorage", undefined);

    await expect(fileStorage.getItem("mystudio-project-store")).resolves.toBeNull();
    await expect(fileStorage.setItem("mystudio-project-store", "{}"))
      .resolves.toBeUndefined();
    await expect(fileStorage.removeItem("mystudio-project-store"))
      .resolves.toBeUndefined();
  });

  it("skips migrations when window is unavailable", async () => {
    vi.stubGlobal("window", undefined);

    await expect(migrateToProjectStorage()).resolves.toBeUndefined();
    await expect(recoverFromLegacy()).resolves.toBeUndefined();
  });

  it("renames legacy root store files to mystudio names", async () => {
    const legacyPayload = JSON.stringify({
      state: {
        projects: [
          { id: "p1", name: "旧项目", createdAt: 1, updatedAt: 1 },
          { id: "p2", name: "旧项目 2", createdAt: 2, updatedAt: 2 },
        ],
        activeProjectId: "p1",
      },
      version: 0,
    });
    const getItem = vi.fn(async (key: string) => {
      if (key === "mystudio-project-store") return null;
      if (key === "mo" + "yin-project-store") return legacyPayload;
      return null;
    });
    const renameItem = vi.fn(async () => true);
    Object.defineProperty(window, "fileStorage", {
      configurable: true,
      value: {
        getItem,
        setItem: vi.fn(async () => true),
        removeItem: vi.fn(async () => true),
        renameItem,
        exists: vi.fn(async () => false),
        listKeys: vi.fn(async () => []),
        listDirs: vi.fn(async () => []),
        removeDir: vi.fn(async () => true),
      },
    });

    await expect(fileStorage.getItem("mystudio-project-store")).resolves.toBe(legacyPayload);

    expect(getItem).toHaveBeenCalledWith("mystudio-project-store");
    expect(getItem).toHaveBeenCalledWith("mo" + "yin-project-store");
    expect(renameItem).toHaveBeenCalledWith("mo" + "yin-project-store", "mystudio-project-store");
  });

  it("does not migrate unknown legacy project keys", async () => {
    const { values, setItem } = installElectronStorage({
      "mystudio-project-store": JSON.stringify({
        state: {
          projects: [{ id: "p1" }],
          activeProjectId: "p1",
        },
      }),
      "mystudio-script-store": JSON.stringify({
        state: {
          projects: {
            p1: { rawScript: "known project script" },
            "../outside": { rawScript: "unknown project script" },
          },
        },
      }),
    });

    await migrateToProjectStorage();

    expect(values.has("_p/p1/script")).toBe(true);
    expect(values.has("_p/../outside/script")).toBe(false);
    expect(setItem).toHaveBeenCalledWith("_p/_migrated", expect.any(String));
  });

  it("does not mark migration complete after a malformed legacy store", async () => {
    const { values } = installElectronStorage({
      "mystudio-project-store": JSON.stringify({
        state: {
          projects: [{ id: "p1" }],
          activeProjectId: "p1",
        },
      }),
      "mystudio-script-store": "{ malformed",
    });

    await migrateToProjectStorage();

    expect(values.has("_p/_migrated")).toBe(false);
  });

  it("marks an empty project index as migrated without creating project files", async () => {
    const { values } = installElectronStorage({
      "mystudio-project-store": JSON.stringify({ state: { projects: [] } }),
    });

    await migrateToProjectStorage();

    expect(values.has("_p/_migrated")).toBe(true);
    expect([...values.keys()].filter((key) => key.startsWith("_p/") && key !== "_p/_migrated"))
      .toEqual([]);
  });

  it("recovers only richer data for known projects from legacy stores", async () => {
    const currentP1 = JSON.stringify({
      state: { activeProjectId: "p1", projectData: {} },
    });
    const currentP2 = JSON.stringify({
      state: {
        activeProjectId: "p2",
        projectData: {},
      },
    });
    const currentP3 = JSON.stringify({
      state: {
        activeProjectId: "p3",
        projectData: { rawScript: "already has a rich script" },
      },
    });
    const { values, setItem } = installElectronStorage({
      "_p/_migrated": JSON.stringify({ version: 1 }),
      "mystudio-project-store": JSON.stringify({
        state: { projects: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] },
      }),
      "mystudio-script-store": JSON.stringify({
        state: {
          projects: {
            p1: { rawScript: "1234567890" },
            p2: { rawScript: "12345678901" },
            p3: { rawScript: "legacy rich script" },
            unknown: { rawScript: "unknown project script" },
          },
        },
        version: 3,
      }),
      "_p/p1/script": currentP1,
      "_p/p2/script": currentP2,
      "_p/p3/script": currentP3,
    });

    await recoverFromLegacy();

    expect(values.get("_p/p1/script")).toBe(currentP1);
    expect(JSON.parse(values.get("_p/p2/script") ?? "{}").state.projectData.rawScript)
      .toBe("12345678901");
    expect(values.get("_p/p3/script")).toBe(currentP3);
    expect(values.has("_p/unknown/script")).toBe(false);
    expect(setItem).toHaveBeenCalledWith("_p/p2/script", expect.any(String));
  });
});
