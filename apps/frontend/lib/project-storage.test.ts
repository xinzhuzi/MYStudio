import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { fileStorage } from "./indexed-db-storage";
import { createProjectScopedStorage, createSplitStorage } from "./project-storage";

type MockProjectState = {
  activeProjectId: string | null;
  projects: Array<{ id: string }>;
};

type TestItem = {
  id: string;
  projectId?: string;
};

type TestState = {
  items: TestItem[];
  currentFolderId?: string;
};

const storageMocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  const projectState: MockProjectState = {
    activeProjectId: "p1",
    projects: [{ id: "p1" }, { id: "p2" }],
  };
  const resourceSharing = {
    shareCharacters: true,
    shareScenes: true,
    shareMedia: true,
  };
  return {
    values,
    projectState,
    resourceSharing,
    hydrated: true,
    hydrationCallbacks: [] as Array<() => void>,
  };
});

vi.mock("./indexed-db-storage", () => ({
  fileStorage: {
    getItem: vi.fn(async (key: string) => storageMocks.values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storageMocks.values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storageMocks.values.delete(key);
    }),
  },
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: {
    getState: () => storageMocks.projectState,
    persist: {
      hasHydrated: () => storageMocks.hydrated,
      onFinishHydration: (callback: () => void) => {
        storageMocks.hydrationCallbacks.push(callback);
        return () => {
          storageMocks.hydrationCallbacks = storageMocks.hydrationCallbacks.filter((item) => item !== callback);
        };
      },
    },
  },
}));

vi.mock("@/stores/app-settings-store", () => ({
  useAppSettingsStore: {
    getState: () => ({ resourceSharing: storageMocks.resourceSharing }),
  },
}));

beforeEach(() => {
  storageMocks.values.clear();
  storageMocks.projectState.activeProjectId = "p1";
  storageMocks.projectState.projects = [{ id: "p1" }, { id: "p2" }];
  storageMocks.resourceSharing.shareCharacters = true;
  storageMocks.resourceSharing.shareScenes = true;
  storageMocks.resourceSharing.shareMedia = true;
  storageMocks.hydrated = true;
  storageMocks.hydrationCallbacks = [];
  vi.clearAllMocks();
});

describe("createProjectScopedStorage", () => {
  it("reads project-scoped data before legacy data", async () => {
    storageMocks.values.set("_p/p1/director", "project-value");
    storageMocks.values.set("mystudio-director-store", "legacy-value");
    const storage = createProjectScopedStorage("director");

    await expect(storage.getItem("mystudio-director-store")).resolves.toBe("project-value");

    expect(fileStorage.getItem).toHaveBeenCalledWith("_p/p1/director");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("mystudio-director-store");
  });

  it("falls back to the legacy key when the project file is missing", async () => {
    storageMocks.values.set("mystudio-director-store", "legacy-value");
    const storage = createProjectScopedStorage("director");

    await expect(storage.getItem("mystudio-director-store")).resolves.toBe("legacy-value");

    expect(fileStorage.getItem).toHaveBeenCalledWith("_p/p1/director");
    expect(fileStorage.getItem).toHaveBeenCalledWith("mystudio-director-store");
  });

  it("waits for project hydration before reading the project file", async () => {
    storageMocks.hydrated = false;
    storageMocks.values.set("_p/p1/director", "project-value");
    const storage = createProjectScopedStorage("director");

    const pending = storage.getItem("mystudio-director-store");
    await Promise.resolve();

    expect(fileStorage.getItem).not.toHaveBeenCalled();
    expect(storageMocks.hydrationCallbacks).toHaveLength(1);

    storageMocks.hydrated = true;
    storageMocks.hydrationCallbacks[0]?.();

    await expect(pending).resolves.toBe("project-value");
    expect(fileStorage.getItem).toHaveBeenCalledWith("_p/p1/director");
  });

  it.each([
    { label: "missing", activeProjectId: null },
    { label: "unsafe", activeProjectId: "../bad" },
  ])("uses the legacy key when the active project id is $label", async ({ activeProjectId }) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storageMocks.projectState.activeProjectId = activeProjectId;
    storageMocks.values.set("mystudio-director-store", "legacy-value");
    const storage = createProjectScopedStorage("director");

    await expect(storage.getItem("mystudio-director-store")).resolves.toBe("legacy-value");
    await storage.setItem("mystudio-director-store", "next-legacy-value");
    expect(storageMocks.values.get("mystudio-director-store")).toBe("next-legacy-value");

    await storage.removeItem("mystudio-director-store");

    expect(storageMocks.values.has("mystudio-director-store")).toBe(false);
    expect(fileStorage.getItem).toHaveBeenCalledWith("mystudio-director-store");
    expect(fileStorage.setItem).toHaveBeenCalledWith("mystudio-director-store", "next-legacy-value");
    expect(fileStorage.removeItem).toHaveBeenCalledWith("mystudio-director-store");
    expect(Array.from(storageMocks.values.keys()).some((key) => key.startsWith("_p/"))).toBe(false);
    warnSpy.mockRestore();
  });

  it("uses the persisted payload project id instead of the active router id", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = createProjectScopedStorage("director");
    const value = JSON.stringify({ state: { activeProjectId: "p2", data: "owned-by-p2" }, version: 1 });

    await storage.setItem("mystudio-director-store", value);

    expect(storageMocks.values.get("_p/p2/director")).toBe(value);
    expect(storageMocks.values.has("_p/p1/director")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Routing mismatch for director"));
    warnSpy.mockRestore();
  });

  it("removes only the active project's scoped file", async () => {
    storageMocks.values.set("_p/p1/director", "p1-value");
    storageMocks.values.set("_p/p2/director", "p2-value");
    const storage = createProjectScopedStorage("director");

    await storage.removeItem("mystudio-director-store");

    expect(storageMocks.values.has("_p/p1/director")).toBe(false);
    expect(storageMocks.values.get("_p/p2/director")).toBe("p2-value");
    expect(fileStorage.removeItem).toHaveBeenCalledWith("_p/p1/director");
  });
});

describe("createSplitStorage", () => {
  function split(state: TestState, projectId: string) {
    return {
      projectData: {
        ...state,
        items: state.items.filter((item) => item.projectId === projectId),
      },
      sharedData: {
        ...state,
        items: state.items.filter((item) => !item.projectId),
      },
    };
  }

  function merge(projectData: TestState | null, base: TestState | null): TestState {
    return {
      items: [...(base?.items ?? []), ...(projectData?.items ?? [])],
      currentFolderId: projectData?.currentFolderId ?? base?.currentFolderId,
    };
  }

  function createTestStorage(): StateStorage {
    return createSplitStorage<TestState>("characters", split, merge, "shareCharacters");
  }

  it("merges shared, other-project, and current-project data when sharing is enabled", async () => {
    storageMocks.values.set("_p/p1/characters", JSON.stringify({
      state: { items: [{ id: "current", projectId: "p1" }], currentFolderId: "current-folder" },
      version: 7,
    }));
    storageMocks.values.set("_p/p2/characters", JSON.stringify({
      state: { items: [{ id: "other", projectId: "p2" }], currentFolderId: "other-folder" },
      version: 7,
    }));
    storageMocks.values.set("_shared/characters", JSON.stringify({
      state: { items: [{ id: "shared" }], currentFolderId: "shared-folder" },
      version: 7,
    }));

    const raw = await createTestStorage().getItem("mystudio-character-library");
    const parsed = JSON.parse(raw ?? "") as { state: TestState; version: number };

    expect(parsed.version).toBe(7);
    expect(parsed.state.items.map((item) => item.id)).toEqual(["shared", "other", "current"]);
    expect(parsed.state.currentFolderId).toBe("current-folder");
  });

  it("loads only the current project when resource sharing is disabled", async () => {
    storageMocks.resourceSharing.shareCharacters = false;
    storageMocks.values.set("_p/p1/characters", JSON.stringify({
      state: { items: [{ id: "current", projectId: "p1" }], currentFolderId: "current-folder" },
      version: 8,
    }));
    storageMocks.values.set("_p/p2/characters", JSON.stringify({
      state: { items: [{ id: "other", projectId: "p2" }], currentFolderId: "other-folder" },
      version: 8,
    }));
    storageMocks.values.set("_shared/characters", JSON.stringify({
      state: { items: [{ id: "shared" }], currentFolderId: "shared-folder" },
      version: 8,
    }));

    const raw = await createTestStorage().getItem("mystudio-character-library");
    const parsed = JSON.parse(raw ?? "") as { state: TestState; version: number };

    expect(parsed.version).toBe(8);
    expect(parsed.state.items.map((item) => item.id)).toEqual(["current"]);
    expect(parsed.state.currentFolderId).toBe("current-folder");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("_p/p2/characters");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("_shared/characters");
  });

  it("filters unsafe project ids and skips corrupt shared data during sharing reads", async () => {
    storageMocks.projectState.projects = [
      { id: "p1" },
      { id: "p2" },
      { id: "../bad" },
      { id: "" },
      { id: "p3\\bad" },
    ];
    storageMocks.values.set("_p/p1/characters", JSON.stringify({
      state: { items: [{ id: "current", projectId: "p1" }], currentFolderId: "current-folder" },
      version: 9,
    }));
    storageMocks.values.set("_p/p2/characters", "{bad json");
    storageMocks.values.set("_p/../bad/characters", JSON.stringify({
      state: { items: [{ id: "unsafe", projectId: "../bad" }] },
      version: 9,
    }));
    storageMocks.values.set("_shared/characters", "{bad shared");

    const raw = await createTestStorage().getItem("mystudio-character-library");
    const parsed = JSON.parse(raw ?? "") as { state: TestState; version: number };

    expect(parsed.version).toBe(9);
    expect(parsed.state.items.map((item) => item.id)).toEqual(["current"]);
    expect(fileStorage.getItem).toHaveBeenCalledWith("_p/p2/characters");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("_p/../bad/characters");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("_p//characters");
    expect(fileStorage.getItem).not.toHaveBeenCalledWith("_p/p3\\bad/characters");
  });

  it("writes only known safe project ids plus shared data", async () => {
    const value = JSON.stringify({
      state: {
        items: [
          { id: "current", projectId: "p1" },
          { id: "other", projectId: "p2" },
          { id: "unknown", projectId: "p3" },
          { id: "unsafe", projectId: "../bad" },
          { id: "shared" },
        ],
      },
      version: 3,
    });

    await createTestStorage().setItem("mystudio-character-library", value);

    expect(JSON.parse(storageMocks.values.get("_p/p1/characters") ?? "").state.items).toEqual([
      { id: "current", projectId: "p1" },
    ]);
    expect(JSON.parse(storageMocks.values.get("_p/p2/characters") ?? "").state.items).toEqual([
      { id: "other", projectId: "p2" },
    ]);
    expect(JSON.parse(storageMocks.values.get("_shared/characters") ?? "").state.items).toEqual([
      { id: "shared" },
    ]);
    expect(storageMocks.values.has("_p/p3/characters")).toBe(false);
    expect(storageMocks.values.has("_p/../bad/characters")).toBe(false);
  });

  it("removes only the active project file while preserving shared data", async () => {
    storageMocks.values.set("_p/p1/characters", "p1-value");
    storageMocks.values.set("_shared/characters", "shared-value");

    await createTestStorage().removeItem("mystudio-character-library");

    expect(storageMocks.values.has("_p/p1/characters")).toBe(false);
    expect(storageMocks.values.get("_shared/characters")).toBe("shared-value");
    expect(fileStorage.removeItem).toHaveBeenCalledWith("_p/p1/characters");
    expect(fileStorage.removeItem).not.toHaveBeenCalledWith("_shared/characters");
  });
});
