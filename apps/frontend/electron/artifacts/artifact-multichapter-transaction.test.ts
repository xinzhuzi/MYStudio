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
  it("runs scan -> plan -> execute with chapter isolation and zero residue", async () => {
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
    await fs.mkdir(path.join(projectRoot, "exports", chapterA), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "exports", chapterB), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "remotion", chapterA), { recursive: true });
    await fs.mkdir(path.join(projectRoot, "remotion", chapterB), { recursive: true });
    await fs.mkdir(path.join(projectRoot, chapterA), { recursive: true });
    await fs.mkdir(path.join(projectRoot, chapterB), { recursive: true });

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
    await fs.writeFile(path.join(projectRoot, `${projectId}-history.json`), JSON.stringify({ ...state, timestamp: 1 }, null, 2));
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", chapterA, "shot.png"), "chapter-a-image");
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", chapterB, "shot.png"), "chapter-b-image");
    await fs.writeFile(path.join(projectRoot, "exports", chapterA, "final.mp4"), "chapter-a-export");
    await fs.writeFile(path.join(projectRoot, "exports", chapterB, "final.mp4"), "chapter-b-export");
    await fs.writeFile(path.join(projectRoot, "remotion", chapterA, "final.mp4"), "chapter-a-remotion");
    await fs.writeFile(path.join(projectRoot, "remotion", chapterB, "final.mp4"), "chapter-b-remotion");
    await fs.writeFile(path.join(projectRoot, chapterA, "novel.md"), "chapter-a-novel-file");
    await fs.writeFile(path.join(projectRoot, chapterB, "novel.md"), "chapter-b-novel-file");

    const sharedPaths = ["character", "scene", "prop"].map((kind) =>
      path.join(projectRoot, "workflow-images", "assets", "shared", `${kind}.png`),
    );
    for (const sharedPath of sharedPaths) await fs.writeFile(sharedPath, `shared-${path.basename(sharedPath)}`);

    const retainedPaths = [
      path.join(projectRoot, "workflow-images", "storyboards", chapterB, "shot.png"),
      path.join(projectRoot, "exports", chapterB, "final.mp4"),
      path.join(projectRoot, "remotion", chapterB, "final.mp4"),
      path.join(projectRoot, chapterB, "novel.md"),
      ...sharedPaths,
    ];
    const retainedBytes = new Map(await Promise.all(retainedPaths.map(async (file) => [file, await fs.readFile(file)] as const)));
    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterA);
    expect(planned.valid).toBe(true);
    expect(planned.plan.executionAllowed).toBe(true);
    expect(planned.plan.backupImpact.map((impact) => impact.filePath).sort()).toEqual([
      "history.bak",
    ]);
    expect(planned.plan.backupImpact.every((impact) => impact.action === "rewrite")).toBe(true);
    const registered = registerDeletionPlan(planned.plan);

    const result = await executeDeletion({ dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: chapterA },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const targetPath of [
      path.join(projectRoot, "workflow-images", "storyboards", chapterA, "shot.png"),
      path.join(projectRoot, "exports", chapterA, "final.mp4"),
      path.join(projectRoot, "remotion", chapterA, "final.mp4"),
      path.join(projectRoot, chapterA, "novel.md"),
    ]) await expect(fs.readFile(targetPath)).rejects.toThrow();
    for (const retainedPath of retainedPaths) {
      await expect(fs.readFile(retainedPath)).resolves.toEqual(retainedBytes.get(retainedPath));
    }

    const remainingState = JSON.parse(await fs.readFile(path.join(projectRoot, "studio.json"), "utf8")) as { state: { novelChapters: Array<{ id: string }>; scriptData: { episodes: Array<{ id: string }> } } };
    expect(remainingState.state.novelChapters.map((chapter) => chapter.id)).toEqual([chapterB]);
    expect(remainingState.state.scriptData.episodes.map((episode) => episode.id)).toEqual([chapterB]);
    for (const backupFile of ["history.bak", `${projectId}-history.json`]) {
      const remainingBackup = JSON.parse(await fs.readFile(path.join(projectRoot, backupFile), "utf8")) as {
        state: { novelChapters: Array<{ id: string }>; scriptData: { episodes: Array<{ id: string }> } };
      };
      expect(remainingBackup.state.novelChapters.map((chapter) => chapter.id)).toEqual([chapterB]);
      expect(remainingBackup.state.scriptData.episodes.map((episode) => episode.id)).toEqual([chapterB]);
    }
    expect(result.data.backupsModified.sort()).toEqual(["history.bak"]);
    expect(result.data.postScan).toEqual({
      orphanRecords: 0,
      invalidPaths: 0,
      residualChapterFiles: 0,
      backupResidue: 0,
      crossProjectLeak: 0,
      transactionResidue: 0,
    });
    await expect(fs.access(path.join(projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(projectRoot, `.artifact-delete-${registered.planId}.bundle.json`))).rejects.toThrow();

    const postInventory = await scanProjectInventory(dataRoot, projectId, chapterA);
    expect(postInventory.success).toBe(true);
    if (!postInventory.success) return;
    expect(postInventory.data.artifacts).toHaveLength(0);
    expect(postInventory.data.discrepancies).toHaveLength(0);
    expect(postInventory.data.blockers).toHaveLength(0);
    expect(postInventory.data.summary.totalArtifacts).toBe(0);
  });
});
