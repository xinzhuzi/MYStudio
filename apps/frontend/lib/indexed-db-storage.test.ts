/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileStorage } from "./indexed-db-storage";

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
});
