import { describe, expect, it, vi } from "vitest";
import { discoverProjectsFromDisk, recoverProjectFromDisk, useProjectStore } from "./project-store";

describe("project disk recovery", () => {
  it("skips disk discovery outside the renderer environment", async () => {
    const previousWindow = globalThis.window;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Reflect.deleteProperty(globalThis, "window");

    try {
      await expect(discoverProjectsFromDisk()).resolves.toBeUndefined();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { window: Window | undefined }).window = previousWindow;
      consoleError.mockRestore();
    }
  });

  it("reads current per-project script and director keys", async () => {
    const getItem = vi.fn(async (key: string) => {
      if (key === "_p/p-current/script") {
        return JSON.stringify({
          state: {
            projects: {
              "p-current": { title: "道劫项目" },
            },
          },
        });
      }
      if (key === "_p/p-current/director") {
        return JSON.stringify({
          state: {
            projects: {
              "p-current": { screenplay: "矿场醒来，风雪压低矿棚。" },
            },
          },
        });
      }
      return null;
    });

    const project = await recoverProjectFromDisk("p-current", { getItem });

    expect(project).toMatchObject({
      id: "p-current",
      name: "道劫项目",
    });
    expect(getItem).toHaveBeenCalledWith("_p/p-current/script");
    expect(getItem).not.toHaveBeenCalledWith("_p/p-current/script-store");
  });

  it("falls back to legacy per-project key names", async () => {
    const getItem = vi.fn(async (key: string) => {
      if (key === "_p/p-legacy/script-store") {
        return JSON.stringify({
          state: {
            projects: {
              "p-legacy": { title: "旧项目" },
            },
          },
        });
      }
      return null;
    });

    const project = await recoverProjectFromDisk("p-legacy", { getItem });

    expect(project.name).toBe("旧项目");
    expect(getItem).toHaveBeenCalledWith("_p/p-legacy/script");
    expect(getItem).toHaveBeenCalledWith("_p/p-legacy/script-store");
  });

  it("activates the first recovered disk project when only the default project exists", async () => {
    const previousLocalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    useProjectStore.setState({
      projects: [{
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      }],
      activeProjectId: "default-project",
      activeProject: {
        id: "default-project",
        name: "漫影工作室项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    const previousWindow = globalThis.window;
    (globalThis as unknown as { window: Window & { fileStorage?: unknown } }).window = {
      fileStorage: {
        listDirs: vi.fn(async () => ["p-disk"]),
        setItem: vi.fn(async () => undefined),
        getItem: vi.fn(async (key: string) => {
          if (key === "_p/p-disk/script") {
            return JSON.stringify({
              state: {
                projects: {
                  "p-disk": { title: "磁盘项目" },
                },
              },
            });
          }
          return null;
        }),
      },
    } as Window & { fileStorage?: unknown };

    try {
      await discoverProjectsFromDisk();
    } finally {
      (globalThis as unknown as { window: Window | undefined }).window = previousWindow;
      (globalThis as unknown as { localStorage: Storage | undefined }).localStorage = previousLocalStorage;
    }

    const state = useProjectStore.getState();
    expect(state.projects.map((project) => project.id)).toContain("p-disk");
    expect(state.activeProjectId).toBe("p-disk");
    expect(state.activeProject?.name).toBe("磁盘项目");
  });

  it("keeps the active real project when discovering additional disk projects", async () => {
    const previousLocalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    useProjectStore.setState({
      projects: [
        {
          id: "p-active",
          name: "当前项目",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeProjectId: "p-active",
      activeProject: {
        id: "p-active",
        name: "当前项目",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    const previousWindow = globalThis.window;
    (globalThis as unknown as { window: Window & { fileStorage?: unknown } }).window = {
      fileStorage: {
        listDirs: vi.fn(async () => ["p-active", "p-extra"]),
        setItem: vi.fn(async () => undefined),
        getItem: vi.fn(async (key: string) => {
          if (key === "_p/p-extra/script") {
            return JSON.stringify({
              state: {
                projects: {
                  "p-extra": { title: "额外项目" },
                },
              },
            });
          }
          return null;
        }),
      },
    } as Window & { fileStorage?: unknown };

    try {
      await discoverProjectsFromDisk();
    } finally {
      (globalThis as unknown as { window: Window | undefined }).window = previousWindow;
      (globalThis as unknown as { localStorage: Storage | undefined }).localStorage = previousLocalStorage;
    }

    const state = useProjectStore.getState();
    expect(state.projects.map((project) => project.id)).toContain("p-extra");
    expect(state.activeProjectId).toBe("p-active");
    expect(state.activeProject?.name).toBe("当前项目");
  });
});
