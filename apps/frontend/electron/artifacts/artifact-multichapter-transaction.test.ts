import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  // shell.trashItem moves a file to the system Trash; in the unit test we model
  // the observable effect (the file leaves its original path) by unlinking it.
  shell: { trashItem: async (target: string) => { await fs.unlink(target); } },
}));
vi.mock("../ipc/files/file-storage-ipc", () => ({
  withFileStorageMutationLocks: async (_paths: readonly string[], action: () => Promise<unknown>) => action(),
}));

import { scanProjectInventory } from "./artifact-inventory-service";
import { buildDeletionPlan } from "@/lib/artifacts/artifact-dependency-graph";
import { executeDeletion, registerDeletionPlan } from "./artifact-deletion-service";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("generated multi-chapter artifact transaction", () => {
  it("removes one chapter while preserving the other chapter and shared physical data", async () => {
    vi.stubGlobal("fetch", undefined);
    const suffix = Math.random().toString(36).slice(2, 10);
    const projectId = `project-${suffix}`;
    const chapterA = `chapter-${suffix}-a`;
    const chapterB = `chapter-${suffix}-b`;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-multichapter-transaction-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", projectId);
    await fs.mkdir(path.join(projectRoot, "workflow-images", "storyboards", chapterA), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "workflow-images", "storyboards", chapterB), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "workflow-images", "assets", "shared"), { recursive: true });

    const state = {
      projectId,
      state: {
        novelChapters: [
          { id: chapterA, title: "Generated A" },
          { id: chapterB, title: "Generated B" },
        ],
        scriptData: {
          episodes: [
            { id: chapterA, index: 1, sceneIds: [] },
            { id: chapterB, index: 2, sceneIds: [] },
          ],
        },
      },
      version: 1,
    };
    const stateText = JSON.stringify(state, null, 2);
    await fs.writeFile(path.join(projectRoot, "studio.json"), stateText);
    await fs.writeFile(path.join(projectRoot, "history.bak"), stateText);
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", chapterA, "shot.png"), "chapter-a-image");
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", chapterB, "shot.png"), "chapter-b-image");
    const sharedPath = path.join(projectRoot, "workflow-images", "assets", "shared", "character.png");
    await fs.writeFile(sharedPath, "shared-character-image");

    const untouchedChapterBytes = await fs.readFile(path.join(projectRoot, "workflow-images", "storyboards", chapterB, "shot.png"));
    const untouchedSharedBytes = await fs.readFile(sharedPath);
    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterA);
    expect(planned.valid).toBe(true);
    expect(planned.plan.executionAllowed).toBe(true);
    expect(planned.plan.backupImpact).toEqual([
      expect.objectContaining({ filePath: "history.bak", action: "rewrite" }),
    ]);
    const registered = registerDeletionPlan(planned.plan);

    const result = await executeDeletion({ dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: chapterA },
    });

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(projectRoot, "workflow-images", "storyboards", chapterA, "shot.png"))).rejects.toThrow();
    await expect(fs.readFile(path.join(projectRoot, "workflow-images", "storyboards", chapterB, "shot.png"))).resolves.toEqual(untouchedChapterBytes);
    await expect(fs.readFile(sharedPath)).resolves.toEqual(untouchedSharedBytes);

    const remainingState = JSON.parse(await fs.readFile(path.join(projectRoot, "studio.json"), "utf8")) as { state: { novelChapters: Array<{ id: string }>; scriptData: { episodes: Array<{ id: string }> } } };
    expect(remainingState.state.novelChapters.map((chapter) => chapter.id)).toEqual([chapterB]);
    expect(remainingState.state.scriptData.episodes.map((episode) => episode.id)).toEqual([chapterB]);
    const remainingBackup = JSON.parse(await fs.readFile(path.join(projectRoot, "history.bak"), "utf8")) as { state: { novelChapters: Array<{ id: string }> } };
    expect(remainingBackup.state.novelChapters.map((chapter) => chapter.id)).toEqual([chapterB]);
    await expect(fs.access(path.join(projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(projectRoot, `.artifact-delete-${registered.planId}.bundle.json`))).rejects.toThrow();

    const postInventory = await scanProjectInventory(dataRoot, projectId, chapterA);
    expect(postInventory.success).toBe(true);
    if (!postInventory.success) return;
    expect(postInventory.data.artifacts).toHaveLength(0);
    expect(postInventory.data.discrepancies).toHaveLength(0);
  });
});
