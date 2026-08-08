import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactKind, ArtifactStage, ArtifactState, DeletionPlan } from "@/types/artifacts";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  // shell.trashItem moves a file to the system Trash. In the unit test we model
  // the observable effect (the file leaves its original path) by unlinking it,
  // so the post-delete fs.access assertions still hold. The real handler uses
  // Electron's native trashItem (Finder/Recycle Bin) — see deletion service.
  shell: { trashItem: async (target: string) => { await fs.unlink(target); } },
}));
vi.mock("../ipc/files/file-storage-ipc", () => ({
  withFileStorageMutationLocks: async (_paths: readonly string[], action: () => Promise<unknown>) => action(),
}));
vi.mock("./artifact-inventory-service", () => ({
  scanProjectInventory: vi.fn(async () => ({
    success: true,
    data: { projectId: "project-fixture", artifacts: [], discrepancies: [], blockers: [], summary: {} },
  })),
}));

import { executeDeletion, queryRecovery, registerDeletionPlan } from "./artifact-deletion-service";
import { scanProjectInventory } from "./artifact-inventory-service";

const roots: string[] = [];

const emptySummary = {
  totalArtifacts: 0,
  byStage: {
    novel: 0, analysis: 0, script: 0, assets: 0, storyboard: 0, image: 0,
    voice: 0, production: 0, editing: 0, remotion: 0, export: 0,
    backup: 0, "media-library": 0,
  } satisfies Record<ArtifactStage, number>,
  byKind: {
    "novel-chapter": 0, "script-episode": 0, "script-scene": 0,
    "storyboard-item": 0, "storyboard-image-workflow": 0,
    "character-variant": 0, "scene-derivative": 0, "prop-derivative": 0,
    "base-character": 0, "base-scene": 0, "base-prop": 0,
    "tts-scene-voice-line": 0, "tts-voice-profile": 0, "tts-voice-binding": 0,
    "production-track": 0, "video-candidate": 0, "editing-project": 0,
    "editing-run": 0, "editing-render": 0, "remotion-manifest": 0,
    "remotion-job": 0, "remotion-audio": 0, "remotion-output": 0,
    "remotion-queue": 0, "remotion-current-slot": 0, "continuity-bible": 0,
    "agent-workflow-result": 0, "director-entity-extraction": 0,
    "director-plan": 0, "media-file": 0, "export-frame": 0,
    "export-segment": 0, "export-video": 0, "export-audio": 0,
    "export-report": 0,
  } satisfies Record<ArtifactKind, number>,
  byState: { active: 0, archived: 0, orphaned: 0, blocked: 0, unknown: 0 } satisfies Record<ArtifactState, number>,
  totalBytes: 0,
  deleteEligible: 0,
  retainDueToShared: 0,
  blockedByJobs: 0,
  blockedByUnknown: 0,
};

async function makeFixture() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-delete-"));
  roots.push(dataRoot);
  const projectRoot = path.join(dataRoot, "_p", "project-fixture");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "chapter-data.bin"), "chapter-bytes");
  await fs.writeFile(path.join(projectRoot, "novel.json"), JSON.stringify({ state: { chapters: [{ id: "chapter-fixture", chapterId: "chapter-fixture" }, { id: "chapter-keep", chapterId: "chapter-keep" }] } }));
  return { dataRoot, projectRoot };
}

function plan(): DeletionPlan {
  return {
    planId: "plan-fixture",
    schemaVersion: "1.0.0",
    projectId: "project-fixture",
    chapterId: "chapter-fixture",
    scope: "chapter",
    createdAt: 1,
    fingerprint: "fingerprint-fixture",
    deleteItems: [{ artifactId: "novel:novel-chapter:chapter-fixture", kind: "novel-chapter", stage: "novel", name: "第一章", physicalPath: "chapter-data.bin", bytes: 13 }],
    migrateItems: [],
    retainItems: [],
    blockerItems: [],
    backupImpact: [],
    byteTotals: { deleteBytes: 13, migrateBytes: 0, retainBytes: 0, totalBytes: 13 },
    confirmationRequired: { type: "chapter-id", value: "chapter-fixture" },
    executionAllowed: true,
  };
}

afterEach(async () => {
  while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("artifact deletion transaction", () => {
  it("deletes the selected chapter file and preserves the other chapter", async () => {
    const fixture = await makeFixture();
    const original = await fs.readFile(path.join(fixture.projectRoot, "novel.json"), "utf8");
    const registered = registerDeletionPlan(plan());
    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });
    expect(result.success).toBe(true);
    await expect(fs.access(path.join(fixture.projectRoot, "chapter-data.bin"))).rejects.toThrow();
    const rewritten = JSON.parse(await fs.readFile(path.join(fixture.projectRoot, "novel.json"), "utf8")) as { state: { chapters: Array<{ id: string }> } };
    expect(rewritten.state.chapters).toEqual([{ id: "chapter-keep", chapterId: "chapter-keep" }]);
    expect(original).not.toBe(await fs.readFile(path.join(fixture.projectRoot, "novel.json"), "utf8"));
    expect((await queryRecovery(fixture.dataRoot, "project-fixture")).success).toBe(true);
  });

  it("rejects a mismatched confirmation without writing", async () => {
    const fixture = await makeFixture();
    const before = await fs.readFile(path.join(fixture.projectRoot, "novel.json"), "utf8");
    const registered = registerDeletionPlan(plan());
    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "other-chapter" },
    });
    expect(result).toMatchObject({ success: false, error: "confirmation-mismatch" });
    const wrongConfirmationType = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "artifacts", artifactCount: 1 },
    });
    expect(wrongConfirmationType).toMatchObject({ success: false, error: "confirmation-mismatch" });
    expect(await fs.readFile(path.join(fixture.projectRoot, "novel.json"), "utf8")).toBe(before);
    await expect(fs.access(path.join(fixture.projectRoot, "chapter-data.bin"))).resolves.toBeUndefined();
  });

  it("rolls back a post-scan discrepancy and recovers the prepared transaction", async () => {
    const fixture = await makeFixture();
    const novelPath = path.join(fixture.projectRoot, "novel.json");
    const chapterPath = path.join(fixture.projectRoot, "chapter-data.bin");
    const originalNovel = await fs.readFile(novelPath, "utf8");
    vi.mocked(scanProjectInventory).mockResolvedValueOnce({
      success: true,
      data: {
        projectId: "project-fixture",
        artifacts: [],
        discrepancies: [{ type: "live-vs-disk", description: "forced discrepancy", affectedArtifacts: [] }],
        blockers: [],
        summary: emptySummary,
      },
    });

    const registered = registerDeletionPlan(plan());
    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: false, error: "post-scan-orphans", journalState: "prepared" });
    await expect(fs.readFile(chapterPath, "utf8")).resolves.toBe("chapter-bytes");
    await expect(fs.readFile(novelPath, "utf8")).resolves.toBe(originalNovel);
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).resolves.toBeUndefined();

    const recovery = await queryRecovery(fixture.dataRoot, "project-fixture");
    expect(recovery).toMatchObject({ success: true, data: { journalState: "none", bundleExists: false } });
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-plan-fixture.bundle.json"))).rejects.toThrow();
  });
});
