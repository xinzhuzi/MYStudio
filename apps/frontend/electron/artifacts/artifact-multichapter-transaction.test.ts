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

  it("removes a registered chapter-scoped snapshot instead of leaving its top-level chapter record", async () => {
    vi.stubGlobal("fetch", undefined);
    const suffix = Math.random().toString(36).slice(2, 8);
    const projectId = `snapshot-${suffix}`;
    const chapterA = `chapter-${suffix}-a`;
    const chapterB = `chapter-${suffix}-b`;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-chapter-snapshot-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", projectId);
    await fs.mkdir(path.join(projectRoot, chapterA), { recursive: true });
    await fs.mkdir(path.join(projectRoot, chapterB), { recursive: true });
    const snapshot = (chapterId: string) => ({
      _artifactFormat: "mystudio-chapter-artifact-snapshot",
      projectId,
      chapterId,
      stage: "remotion",
      manifestId: `manifest-${chapterId}`,
      jobs: [{ jobId: `job-${chapterId}`, chapterId, status: "succeeded" }],
    });
    await fs.writeFile(path.join(projectRoot, chapterA, "remotion.json"), JSON.stringify(snapshot(chapterA), null, 2));
    await fs.writeFile(path.join(projectRoot, chapterB, "remotion.json"), JSON.stringify(snapshot(chapterB), null, 2));

    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;
    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterA);
    expect(planned.valid).toBe(true);
    expect(planned.plan.blockerItems).toHaveLength(0);
    expect(planned.plan.deleteItems.some((item) => item.physicalPath === `${chapterA}/remotion.json`)).toBe(true);
    const registered = registerDeletionPlan(planned.plan);
    await expect(executeDeletion({ dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: chapterA },
    })).resolves.toMatchObject({
      success: true,
      data: { postScan: { residualChapterFiles: 0, transactionResidue: 0 } },
    });
    await expect(fs.access(path.join(projectRoot, chapterA, "remotion.json"))).rejects.toThrow();
    await expect(fs.access(path.join(projectRoot, chapterB, "remotion.json"))).resolves.toBeUndefined();
  });

  // Unknown persisted JSON remains fail-closed even when its path names the
  // chapter. Only a clearly chapter-scoped backup may be deleted as an opaque
  // whole-file snapshot.
  it("blocks chapter-scoped JSON with no decoder but plans its chapter-only backup", async () => {
    vi.stubGlobal("fetch", undefined);
    const suffix = Math.random().toString(36).slice(2, 8);
    const projectId = `nodecoder-${suffix}`;
    // Numeric chapter ids match the production format (chapter-NNN) that the
    // inventory path-inference regex recognises.
    const chapterA = `chapter-9001`;
    const chapterB = `chapter-9002`;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-nodecoder-transaction-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", projectId);

    // Chapter-scoped JSON whose structure matches NO registered decoder:
    // remotion render manifest + continuity-bible backup snapshot.
    const remotionManifestA = path.join(projectRoot, "remotion", "jobs", "shot", chapterA, `sb-${chapterA}-001`, "current.json");
    const remotionManifestB = path.join(projectRoot, "remotion", "jobs", "shot", chapterB, `sb-${chapterB}-001`, "current.json");
    const bibleBackupA = path.join(projectRoot, "backups", `${chapterA}-continuity-bible`, "20260101T000000000000Z", "characters.json");
    const projectLevelJson = path.join(projectRoot, "media-library-state.json");
    await fs.mkdir(path.dirname(remotionManifestA), { recursive: true });
    await fs.mkdir(path.dirname(remotionManifestB), { recursive: true });
    await fs.mkdir(path.dirname(bibleBackupA), { recursive: true });
    // Manifest shape: schemaVersion/projectId/jobId/outputPath/sha256 — no key
    // any registered decoder matches.
    const manifest = (ch: string) => JSON.stringify({
      schemaVersion: 1, projectId, target: "shot", jobId: `job-${ch}`,
      outputPath: `out/${ch}.mp4`, sha256: "deadbeef", startedAt: 1, completedAt: 2,
    });
    await fs.writeFile(remotionManifestA, manifest(chapterA));
    await fs.writeFile(remotionManifestB, manifest(chapterB));
    await fs.writeFile(bibleBackupA, JSON.stringify({ characters: [{ id: "x" }] }));
    // Project-level JSON with no chapter segment and no decoder match is also
    // represented as a blocker, even though it is outside chapter A.
    await fs.writeFile(projectLevelJson, JSON.stringify({ unknownToplevel: true }));

    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterA);
    expect(planned.valid).toBe(false);
    expect(planned.plan.executionAllowed).toBe(false);
    expect(planned.plan.blockerItems.some((item) => item.physicalPath === path.relative(projectRoot, remotionManifestA))).toBe(true);
    expect(planned.plan.deleteItems.some((item) => item.physicalPath === path.relative(projectRoot, bibleBackupA))).toBe(true);
    expect(planned.plan.backupImpact).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: path.relative(projectRoot, bibleBackupA), action: "delete" }),
    ]));

    const registered = registerDeletionPlan(planned.plan);
    const result = await executeDeletion({ dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: chapterA },
    });
    expect(result).toMatchObject({ success: false, error: "post-scan-orphans", journalState: "none" });

    // A blocked plan performs zero writes, including to the otherwise eligible
    // chapter-only backup.
    await expect(fs.access(remotionManifestA)).resolves.toBeUndefined();
    await expect(fs.access(bibleBackupA)).resolves.toBeUndefined();
    await expect(fs.access(remotionManifestB)).resolves.toBeUndefined();
    // Project-level JSON is retained (not in the deleted chapter's scope).
    await expect(fs.access(projectLevelJson)).resolves.toBeUndefined();
  });

  // Regression (08-04 slice 10): project-level JSON with no chapter segment
  // and no decoder match must stay a blocker so the downgrade does not let a
  // chapter deletion silently drop shared project-level files.
  it("keeps project-level no-decoder JSON as a deletion blocker", async () => {
    vi.stubGlobal("fetch", undefined);
    const suffix = Math.random().toString(36).slice(2, 8);
    const projectId = `nodecoder-blocker-${suffix}`;
    const chapterA = `chapter-9003`;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-nodecoder-blocker-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", projectId);
    const projectLevelJson = path.join(projectRoot, "media-library-state.json");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(projectLevelJson, JSON.stringify({ unknownToplevel: true }));

    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    // Project-level no-decoder JSON keeps blocker-missing-ownership (never
    // downgraded) and is outside any chapter, so a chapter-A plan neither
    // deletes it nor blocks on it.
    const projectLevelArtifact = inventory.data.artifacts.find((a) =>
      a.physicalRefs.some((ref) => ref.path === "media-library-state.json"),
    );
    expect(projectLevelArtifact?.deletePolicy).toBe("blocker-missing-ownership");
    expect(projectLevelArtifact?.state).toBe("unknown");
    expect(projectLevelArtifact?.chapterId).toBeUndefined();

    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterA);
    expect(planned.plan.deleteItems.some((d) => d.artifactId === projectLevelArtifact?.id)).toBe(false);
    expect(planned.plan.blockerItems.some((b) => b.artifactId === projectLevelArtifact?.id)).toBe(false);
  });
});
