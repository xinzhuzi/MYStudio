import { describe, expect, it, vi } from "vitest";

const { handlers, existsSync, mkdirSync } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    emit: vi.fn(() => true),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
  },
}));
vi.mock("node:fs", () => ({
  default: {
    existsSync,
    mkdirSync,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {},
  },
}));

import { createStorageManager } from "./storage-manager";

describe("createStorageManager", () => {
  it("keeps default paths project-scoped and registers the complete storage channel set", async () => {
    const manager = createStorageManager({ userDataPath: "/user-data" });
    manager.registerIpcHandlers({ getStudioManualsSourceRoot: () => "/manuals" });
    expect(await handlers.get("storage-get-paths")?.()).toEqual({
      basePath: "/user-data",
      projectPath: "/user-data/projects",
      mediaPath: "/user-data/media",
      skillsPath: "/user-data/skills",
      cachePath: "/user-data/Cache",
    });
    expect(handlers.size).toBe(19);
  });
});
