import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { fileStorage } from "./indexed-db-storage";
import {
  createProjectScopedStorage as facadeCreateProjectScopedStorage,
  createSplitStorage as facadeCreateSplitStorage,
} from "./project-storage";
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

vi.mock("@/stores/project/project-store", () => ({
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

vi.mock("@/stores/app/app-settings-store", () => ({
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
  it("keeps the root facade identical to canonical exports", () => {
    expect(facadeCreateProjectScopedStorage).toBe(createProjectScopedStorage);
    expect(facadeCreateSplitStorage).toBe(createSplitStorage);
  });

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

  it("keeps the scoped removal target when the active project changes during the async delete", async () => {
    storageMocks.values.set("_p/p1/director", "p1-value");
    storageMocks.values.set("_p/p2/director", "p2-value");
    let release!: () => void;
    vi.mocked(fileStorage.removeItem).mockImplementationOnce(async (key: string) => {
      await new Promise<void>((resolve) => { release = resolve; });
      storageMocks.values.delete(key);
    });

    const pending = createProjectScopedStorage("director").removeItem("mystudio-director-store");
    storageMocks.projectState.activeProjectId = "p2";
    release();
    await pending;

    expect(storageMocks.values.has("_p/p1/director")).toBe(false);
    expect(storageMocks.values.get("_p/p2/director")).toBe("p2-value");
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

    const storage = createTestStorage();
    await storage.getItem("mystudio-character-library");
    await storage.setItem("mystudio-character-library", value);

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

  it("keeps split-storage removal scoped to the project active at invocation", async () => {
    storageMocks.values.set("_p/p1/characters", "p1-value");
    storageMocks.values.set("_p/p2/characters", "p2-value");
    let release!: () => void;
    vi.mocked(fileStorage.removeItem).mockImplementationOnce(async (key: string) => {
      await new Promise<void>((resolve) => { release = resolve; });
      storageMocks.values.delete(key);
    });

    const pending = createTestStorage().removeItem("mystudio-character-library");
    storageMocks.projectState.activeProjectId = "p2";
    release();
    await pending;

    expect(storageMocks.values.has("_p/p1/characters")).toBe(false);
    expect(storageMocks.values.get("_p/p2/characters")).toBe("p2-value");
  });
});

it('keeps shared bytes unchanged when sharing is disabled and persists empty loaded projects', async () => {
  const split = (s: TestState, pid: string) => ({ projectData: { items: s.items.filter(i => i.projectId === pid) }, sharedData: { items: s.items.filter(i => !i.projectId) } });
  const merge = (a: TestState | null, b: TestState | null) => ({ items: [...(b?.items ?? []), ...(a?.items ?? [])] });
  const shared = JSON.stringify({ state: { items: [{ id: 'shared' }] } });
  storageMocks.values.set('_shared/characters', shared);
  storageMocks.values.set('_p/p1/characters', JSON.stringify({ state: { items: [] } }));
  storageMocks.values.set('_p/p2/characters', JSON.stringify({ state: { items: [{ id: 'last', projectId: 'p2' }] } }));
  storageMocks.resourceSharing.shareCharacters = false;
  const off = createSplitStorage('characters', split, merge, 'shareCharacters');
  await off.setItem('library', (await off.getItem('library'))!);
  expect(storageMocks.values.get('_shared/characters')).toBe(shared);
  storageMocks.resourceSharing.shareCharacters = true;
  const on = createSplitStorage('characters', split, merge, 'shareCharacters');
  const loaded = JSON.parse((await on.getItem('library'))!);
  loaded.state.items = loaded.state.items.filter((i: TestItem) => i.projectId !== 'p2');
  await on.setItem('library', JSON.stringify(loaded));
  expect(JSON.parse((await on.getItem('library'))!).state.items.some((i: TestItem) => i.id === 'last')).toBe(false);
});

function scopeStorage() {
  return createSplitStorage<TestState>('characters', (state, pid) => ({ projectData: { items: state.items.filter(i => i.projectId === pid) }, sharedData: { items: state.items.filter(i => !i.projectId) } }), (a, b) => ({ items: [...(b?.items ?? []), ...(a?.items ?? [])] }), 'shareCharacters');
}
it('shares concurrent startup reads after project hydration and permits saving the loaded result', async () => {
  storageMocks.hydrated = false;
  const storage = scopeStorage();
  const first = storage.getItem('library');
  const second = storage.getItem('library');
  storageMocks.hydrated = true;
  for (const finish of [...storageMocks.hydrationCallbacks]) finish();
  const results = await Promise.all([first, second]);
  expect(results[0]).toBe(results[1]);
  expect(vi.mocked(fileStorage.getItem).mock.calls.filter(([key]) => key === '_p/p1/characters')).toHaveLength(1);
  await expect(storage.setItem('library', results[0]!)).resolves.toBeUndefined();
});

it('rejects an older project read without invalidating a newer loaded scope', async () => {
  const storage = scopeStorage();
  let release!: () => void;
  vi.mocked(fileStorage.getItem).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return JSON.stringify({ state: { items: [{ id: 'old', projectId: 'p1' }] } });
  });
  const oldRead = Promise.resolve(storage.getItem('library'));
  const rejected = expect(oldRead).rejects.toThrow('变化');
  storageMocks.projectState.activeProjectId = 'p2';
  const loaded = await storage.getItem('library');
  release();
  await rejected;
  await expect(storage.setItem('library', loaded!)).resolves.toBeUndefined();
});
it.each(['project recovery', 'sharing hydration'])('reloads the current scope once after %s changes it during the first read', async reason => {
  storageMocks.values.set('_p/p1/characters', JSON.stringify({ state: { items: [{ id: 'one', projectId: 'p1' }] } }));
  storageMocks.values.set('_p/p2/characters', JSON.stringify({ state: { items: [{ id: 'two', projectId: 'p2' }] } }));
  storageMocks.values.set('_shared/characters', JSON.stringify({ state: { items: [{ id: 'global' }] } }));
  const storage = scopeStorage();
  vi.mocked(fileStorage.getItem).mockImplementationOnce(async key => {
    if (reason === 'project recovery') storageMocks.projectState.activeProjectId = 'p2';
    else storageMocks.resourceSharing.shareCharacters = false;
    return storageMocks.values.get(key) ?? null;
  });
  const loaded = (await storage.getItem('library'))!;
  if (reason === 'sharing hydration') expect(JSON.parse(loaded).state.items).toEqual([{ id: 'one', projectId: 'p1' }]);
  await expect(storage.setItem('library', loaded)).resolves.toBeUndefined();
  const currentKey = reason === 'project recovery' ? '_p/p2/characters' : '_p/p1/characters';
  expect(fileStorage.setItem).toHaveBeenCalledWith(currentKey, expect.any(String));
});
it('bounds automatic scope reloads and still blocks saving an unstable scope', async () => {
  storageMocks.resourceSharing.shareCharacters = false;
  const storage = scopeStorage();
  const changeScope = async () => {
    storageMocks.projectState.activeProjectId = storageMocks.projectState.activeProjectId === 'p1' ? 'p2' : 'p1';
    return JSON.stringify({ state: { items: [] } });
  };
  vi.mocked(fileStorage.getItem).mockImplementationOnce(changeScope).mockImplementationOnce(changeScope);
  await expect(storage.getItem('library')).rejects.toThrow('变化');
  expect(fileStorage.getItem).toHaveBeenCalledTimes(2);
  await expect(storage.setItem('library', JSON.stringify({ state: { items: [] } }))).rejects.toThrow('范围');
  expect(fileStorage.setItem).not.toHaveBeenCalled();
});
it('protects unreadable scopes while allowing loaded project saves', async () => {
  storageMocks.values.set('_p/p1/characters', JSON.stringify({ state: { items: [{ id: 'own', projectId: 'p1' }] } }));
  storageMocks.values.set('_p/p2/characters', '{corrupt');
  storageMocks.values.set('_shared/characters', '{corrupt-shared');
  const storage = scopeStorage();
  const state = (await storage.getItem('library'))!;
  await storage.setItem('library', state);
  expect(storageMocks.values.get('_p/p2/characters')).toBe('{corrupt');
  expect(storageMocks.values.get('_shared/characters')).toBe('{corrupt-shared');
});
it('rejects saves across project or sharing switches until scope is reloaded', async () => {
  const storage = scopeStorage();
  const value = (await storage.getItem('library'))!;
  storageMocks.projectState.activeProjectId = 'p2';
  await expect(storage.setItem('library', value)).rejects.toThrow('范围');
  expect(fileStorage.setItem).not.toHaveBeenCalled();
  storageMocks.projectState.activeProjectId = 'p1';
  storageMocks.resourceSharing.shareCharacters = false;
  await expect(storage.setItem('library', value)).rejects.toThrow('范围');
  expect(fileStorage.setItem).not.toHaveBeenCalled();
});
it('loads visible shared resources even when a new project has no file', async () => {
  storageMocks.values.set('_shared/characters', JSON.stringify({ state: { items: [{ id: 'global' }] } }));
  const storage = scopeStorage();
  const loaded = JSON.parse((await storage.getItem('library'))!);
  expect(loaded.state.items).toEqual([{ id: 'global' }]);
});
it('propagates save failures without writing a legacy fallback', async () => {
  const storage = scopeStorage();
  const value = (await storage.getItem('library'))!;
  vi.mocked(fileStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(storage.setItem('library', value)).rejects.toThrow('disk full');
  expect(fileStorage.setItem).not.toHaveBeenCalledWith('library', expect.anything());
});

it('loads and persists all visible projects from an intact legacy monolith', async () => {
  const legacy = JSON.stringify({ state: { items: [{ id: 'own', projectId: 'p1' }, { id: 'other', projectId: 'p2' }, { id: 'shared' }] } });
  storageMocks.values.set('library', legacy);
  const storage = scopeStorage();
  const value = (await storage.getItem('library'))!;
  expect(JSON.parse(value).state.items.map((item: TestItem) => item.id).sort()).toEqual(['other', 'own', 'shared']);
  await storage.setItem('library', value);
  expect(JSON.parse(storageMocks.values.get('_p/p2/characters')!).state.items).toEqual([{ id: 'other', projectId: 'p2' }]);
  expect(storageMocks.values.get('library')).toBe(legacy);
});

it('stops later target writes when project changes during an awaited save', async () => {
  const shared = JSON.stringify({ state: { items: [{ id: 'shared' }] } });
  storageMocks.values.set('_shared/characters', shared);
  const storage = scopeStorage();
  const value = (await storage.getItem('library'))!;
  let release!: () => void;
  vi.mocked(fileStorage.setItem).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; });
  });
  const pending = storage.setItem('library', value);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  storageMocks.projectState.activeProjectId = 'p2';
  release();
  await expect(pending).rejects.toThrow('范围');
  expect(fileStorage.setItem).toHaveBeenCalledTimes(1);
  expect(storageMocks.values.get('_shared/characters')).toBe(shared);
});
