import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listSkills: vi.fn(async () => [{ relativePath: "cinema/SKILL.md" }]),
  listManuals: vi.fn(async () => [{ stylePath: "cinema" }]),
  resetSync: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("../studio-skills-storage", () => ({
  createStoredStudioSkillFile: vi.fn(),
  deleteStoredStudioSkillFile: vi.fn(),
  ensureStudioSkillsSynced: vi.fn(async () => undefined),
  listStoredStudioSkillFiles: mocks.listSkills,
  readStoredStudioSkillText: vi.fn(),
  resetStudioSkillsSyncState: mocks.resetSync,
  restoreStoredStudioSkillFile: vi.fn(),
  resolveStoredStudioSkillPath: vi.fn(() => ({ targetPath: "/skills/cinema/SKILL.md" })),
  writeStoredStudioSkillText: vi.fn(),
}));

vi.mock("../studio-visual-manuals-storage", () => ({
  createStoredVisualManual: vi.fn(),
  duplicateStoredVisualManual: vi.fn(),
  listStoredVisualManuals: mocks.listManuals,
  readStoredVisualManual: vi.fn(),
  writeStoredVisualManualImages: vi.fn(),
  writeStoredVisualManual: vi.fn(),
}));

import { registerStudioContentIpcHandlers } from "./studio-content-ipc";

describe("registerStudioContentIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerStudioContentIpcHandlers({
      getSkillsRoot: () => "/skills",
      getStudioSkillSyncOptions: () => ({ sourceRoot: "/source", storageRoot: "/skills" }),
      makeStudioSkillFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });
  });

  it("registers all skill and visual-manual channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "studio-skill-create-text",
      "studio-skill-delete-text",
      "studio-skill-list",
      "studio-skill-read-text",
      "studio-skill-restore-text",
      "studio-skill-write-text",
      "studio-visual-manual-create",
      "studio-visual-manual-duplicate",
      "studio-visual-manual-list",
      "studio-visual-manual-read",
      "studio-visual-manual-write",
      "studio-visual-manual-write-images",
    ]);
  });

  it("caches visual manuals until an explicit refresh", async () => {
    const list = mocks.handlers.get("studio-visual-manual-list");
    await list?.({}, undefined);
    await list?.({}, undefined);
    expect(mocks.listManuals).toHaveBeenCalledTimes(1);

    await list?.({}, { refresh: true });
    expect(mocks.resetSync).toHaveBeenCalledTimes(1);
    expect(mocks.listManuals).toHaveBeenCalledTimes(2);
  });
});
