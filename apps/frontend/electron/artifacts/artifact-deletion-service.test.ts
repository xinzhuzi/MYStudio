import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactKind, ArtifactRecord, ArtifactStage, ArtifactState, DeletionPlan, Discrepancy } from "@/types/artifacts";

const lockCalls = vi.hoisted(() => [] as string[][]);

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  // shell.trashItem moves a file to the system Trash. In the unit test we model
  // the observable effect (the file leaves its original path) by unlinking it,
  // so the post-delete fs.access assertions still hold. The real handler uses
  // Electron's native trashItem (Finder/Recycle Bin) — see deletion service.
  shell: { trashItem: async (target: string) => { await fs.unlink(target); } },
}));
vi.mock("../ipc/files/file-storage-ipc", () => ({
  withFileStorageMutationLocks: async (paths: readonly string[], action: () => Promise<unknown>) => {
    lockCalls.push([...paths]);
    return action();
  },
}));
vi.mock("./artifact-inventory-service", () => ({
  scanProjectInventory: vi.fn(async () => ({
    success: true,
    data: { projectId: "project-fixture", artifacts: [], discrepancies: [], blockers: [], summary: {} },
  })),
}));

import { executeDeletion, queryRecovery, registerDeletionPlan } from "./artifact-deletion-service";
import { scanProjectInventory } from "./artifact-inventory-service";
import { buildDeletionPlan } from "@/lib/artifacts/artifact-dependency-graph";

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

function fixtureArtifact(): ArtifactRecord {
  return {
    id: "novel:novel-chapter:chapter-fixture",
    projectId: "project-fixture",
    chapterId: "chapter-fixture",
    stage: "novel",
    kind: "novel-chapter",
    state: "active",
    name: "第一章",
    createdAt: 1,
    updatedAt: 1,
    bytes: 13,
    physicalRefs: [{ type: "local-media", path: "chapter-data.bin", bytes: 13 }],
    upstreamIds: [],
    downstreamIds: [],
    deletePolicy: "delete-exclusive-downstream",
  };
}

function migrationArtifact(): ArtifactRecord {
  return {
    ...fixtureArtifact(),
    id: "assets:base-character:chapter-fixture-hero",
    stage: "assets",
    kind: "base-character",
    name: "共享角色原图",
    bytes: 11,
    physicalRefs: [{ type: "project-file", path: "workflow-images/generated/hero.png", bytes: 11 }],
    deletePolicy: "protected-base-asset",
  };
}

function inventory(
  artifacts: ArtifactRecord[] = [],
  discrepancies: Discrepancy[] = [],
) {
  return {
    success: true as const,
    data: {
      projectId: "project-fixture",
      artifacts,
      discrepancies,
      blockers: [],
      summary: emptySummary,
    },
  };
}

function plan(): DeletionPlan {
  const planned = buildDeletionPlan([fixtureArtifact()], [], "chapter-fixture");
  if (planned.errors.length > 0) throw new Error(planned.errors.join("; "));
  return { ...planned.plan, planId: "plan-fixture" };
}

async function writeRecoveryJournal(
  dataRoot: string,
  state: "prepared" | "commit-ready" | "committed",
  options: { includeBundle?: boolean; corruptBundleHash?: boolean } = {},
) {
  const projectRoot = path.join(dataRoot, "_p", "project-fixture");
  const restorePath = path.join(projectRoot, "recovery-target.json");
  const bundlePath = path.join(projectRoot, ".artifact-delete-recovery.bundle.json");
  const journalPath = path.join(projectRoot, ".artifact-delete-journal.json");
  const original = Buffer.from("original-recovery-state");
  await fs.writeFile(restorePath, "current-state");
  const captured = {
    file: restorePath,
    data: original.toString("base64"),
    mode: 0o100644,
    bytes: original.byteLength,
    sha256: createHash("sha256").update(original).digest("hex"),
  };
  const bundle = { schemaVersion: 1, files: [captured], migrations: [] };
  const bundleText = JSON.stringify(bundle);
  const preFingerprint = createHash("sha256").update(JSON.stringify([{
    file: captured.file,
    bytes: captured.bytes,
    sha256: captured.sha256,
    mode: captured.mode,
  }])).digest("hex");
  if (options.includeBundle !== false) await fs.writeFile(bundlePath, bundleText);
  const bundleSha256 = options.corruptBundleHash
    ? "0".repeat(64)
    : createHash("sha256").update(bundleText).digest("hex");
  await fs.writeFile(journalPath, JSON.stringify({
    schemaVersion: 1,
    state,
    planId: "recovery-plan",
    bundlePath,
    bundleSha256,
    preFingerprint,
    migrationManifest: [],
  }));
  return { projectRoot, restorePath, bundlePath, journalPath };
}

afterEach(async () => {
  lockCalls.length = 0;
  while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(scanProjectInventory).mockReset();
  vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) =>
    chapterId === undefined ? inventory([fixtureArtifact()]) : inventory(),
  );
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
    expect(vi.mocked(scanProjectInventory).mock.calls.at(-1)).toEqual([
      fixture.dataRoot,
      "project-fixture",
      "chapter-fixture",
      undefined,
      { projectLockAlreadyHeld: true },
    ]);
  });

  it("resolves project-file URLs during the post-delete integrity scan", async () => {
    const fixture = await makeFixture();
    const sharedPath = path.join(fixture.projectRoot, "workflow-images", "assets", "shared.png");
    await fs.mkdir(path.dirname(sharedPath), { recursive: true });
    await fs.writeFile(sharedPath, "shared-image");
    vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) => chapterId === undefined
      ? inventory([fixtureArtifact()])
      : ({
        success: true,
        data: {
        projectId: "project-fixture",
        artifacts: [{
          id: "storyboard:storyboard-item:shared",
          projectId: "project-fixture",
          chapterId: "chapter-keep",
          stage: "storyboard",
          kind: "storyboard-item",
          state: "active",
          name: "shared.png",
          createdAt: 1,
          updatedAt: 1,
          physicalRefs: [{
            type: "project-file",
            path: "project-file://project-fixture/workflow-images/assets/shared.png",
          }],
          upstreamIds: [],
          downstreamIds: [],
          deletePolicy: "retain-shared-reference",
        }],
        discrepancies: [],
        blockers: [],
        summary: emptySummary,
        },
      }));

    const registered = registerDeletionPlan(plan());
    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: true, data: { postScan: { invalidPaths: 0 } } });
    await expect(fs.access(sharedPath)).resolves.toBeUndefined();
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

  it("rejects a rebuilt inventory drift before creating transaction files", async () => {
    const fixture = await makeFixture();
    const registered = registerDeletionPlan(plan());
    vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) => {
      if (chapterId !== undefined) return inventory();
      const changed = fixtureArtifact();
      changed.bytes = 14;
      changed.physicalRefs = [{ type: "local-media", path: "chapter-data.bin", bytes: 14 }];
      return inventory([changed]);
    });

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toEqual({ success: false, error: "fingerprint-drift", journalState: "none" });
    await expect(fs.readFile(path.join(fixture.projectRoot, "chapter-data.bin"), "utf8")).resolves.toBe("chapter-bytes");
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-plan-fixture.bundle.json"))).rejects.toThrow();
  });

  it("copies a protected asset only after the prepared journal exists", async () => {
    const fixture = await makeFixture();
    const source = path.join(fixture.projectRoot, "workflow-images", "generated", "hero.png");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "hero-pixels");
    const artifact = migrationArtifact();
    const planned = buildDeletionPlan([artifact], [artifact.id], "chapter-fixture");
    const registered = registerDeletionPlan({ ...planned.plan, planId: "plan-migration" });
    vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) =>
      chapterId === undefined ? inventory([artifact]) : inventory(),
    );
    const copyFile = vi.spyOn(fs, "copyFile").mockImplementation(async (from, to) => {
      await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).resolves.toBeUndefined();
      return vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
        .then((actual) => actual.copyFile(from, to));
    });

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "artifacts", artifactCount: 1 },
    });

    expect(result).toMatchObject({ success: true, journalState: "committed" });
    expect(copyFile).toHaveBeenCalledTimes(1);
    await expect(fs.access(source)).rejects.toThrow();
    const protectedFiles = await fs.readdir(path.join(fixture.projectRoot, "workflow-images", "assets", "protected"));
    expect(protectedFiles).toHaveLength(1);
    await expect(fs.readFile(path.join(fixture.projectRoot, "workflow-images", "assets", "protected", protectedFiles[0]), "utf8"))
      .resolves.toBe("hero-pixels");
    copyFile.mockRestore();
  });

  it("removes a newly copied protected asset when a later scan forces rollback", async () => {
    const fixture = await makeFixture();
    const source = path.join(fixture.projectRoot, "workflow-images", "generated", "hero.png");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "hero-pixels");
    const artifact = migrationArtifact();
    const planned = buildDeletionPlan([artifact], [artifact.id], "chapter-fixture");
    const registered = registerDeletionPlan({ ...planned.plan, planId: "plan-migration-rollback" });
    vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) =>
      chapterId === undefined
        ? inventory([artifact])
        : inventory([], [{ type: "live-vs-disk", description: "force rollback", affectedArtifacts: [] }]),
    );

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "artifacts", artifactCount: 1 },
    });

    expect(result).toEqual({ success: false, error: "post-scan-orphans", journalState: "none" });
    await expect(fs.readFile(source, "utf8")).resolves.toBe("hero-pixels");
    await expect(fs.readdir(path.join(fixture.projectRoot, "workflow-images", "assets", "protected"))).resolves.toEqual([]);
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-plan-migration-rollback.bundle.json"))).rejects.toThrow();
  });

  it("rolls back a post-scan discrepancy and recovers the prepared transaction", async () => {
    const fixture = await makeFixture();
    const novelPath = path.join(fixture.projectRoot, "novel.json");
    const chapterPath = path.join(fixture.projectRoot, "chapter-data.bin");
    const originalNovel = await fs.readFile(novelPath, "utf8");
    vi.mocked(scanProjectInventory).mockImplementation(async (_dataRoot, _projectId, chapterId) =>
      chapterId === undefined
        ? inventory([fixtureArtifact()])
        : inventory([], [{ type: "live-vs-disk", description: "forced discrepancy", affectedArtifacts: [] }]),
    );

    const registered = registerDeletionPlan(plan());
    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: false, error: "post-scan-orphans", journalState: "none" });
    await expect(fs.readFile(chapterPath, "utf8")).resolves.toBe("chapter-bytes");
    await expect(fs.readFile(novelPath, "utf8")).resolves.toBe(originalNovel);
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();

    const recovery = await queryRecovery(fixture.dataRoot, "project-fixture");
    expect(recovery).toMatchObject({ success: true, data: { journalState: "none", bundleExists: false } });
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-journal.json"))).rejects.toThrow();
    await expect(fs.access(path.join(fixture.projectRoot, ".artifact-delete-plan-fixture.bundle.json"))).rejects.toThrow();
  });

  it("fails closed when a codex backup is not part of the reviewed backup impact", async () => {
    const fixture = await makeFixture();
    const backupPath = path.join(fixture.projectRoot, "history.json.codex-test-backup");
    const backupText = JSON.stringify({ state: { chapters: [{ id: "chapter-fixture" }, { id: "chapter-keep" }] } });
    await fs.writeFile(backupPath, backupText);
    const registered = registerDeletionPlan(plan());

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: false, error: "post-scan-orphans", journalState: "none" });
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe(backupText);
  });

  it("fails closed instead of generically rewriting an unreviewed visual-continuity backup", async () => {
    const fixture = await makeFixture();
    const backupPath = path.join(
      fixture.projectRoot,
      "visual-continuity-backups",
      "snapshot-1",
      "studio-workflow-store.json",
    );
    const backupText = JSON.stringify({
      unregisteredRecords: [
        { id: "target-record", chapterId: "chapter-fixture" },
        { id: "retained-record", chapterId: "chapter-keep" },
      ],
    });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, backupText);
    const registered = registerDeletionPlan(plan());

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: false, error: "post-scan-orphans", journalState: "none" });
    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe(backupText);
    await expect(fs.readFile(path.join(fixture.projectRoot, "chapter-data.bin"), "utf8")).resolves.toBe("chapter-bytes");
  });

  it.each(["prepared", "commit-ready"] as const)("recovers a %s journal from its verified bundle", async (state) => {
    const fixture = await makeFixture();
    const recovery = await writeRecoveryJournal(fixture.dataRoot, state);

    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toMatchObject({
      success: true,
      data: { journalState: "none", bundleExists: false, bundleValid: true },
    });
    await expect(fs.readFile(recovery.restorePath, "utf8")).resolves.toBe("original-recovery-state");
    await expect(fs.access(recovery.bundlePath)).rejects.toThrow();
    await expect(fs.access(recovery.journalPath)).rejects.toThrow();
    expect(lockCalls).toContainEqual(expect.arrayContaining([
      path.join(fixture.projectRoot, ".artifact-delete-project.lock"),
      path.join(fixture.projectRoot, ".artifact-delete-journal.json"),
    ]));
  });

  it("treats a committed journal as success without restoring its bundle", async () => {
    const fixture = await makeFixture();
    const recovery = await writeRecoveryJournal(fixture.dataRoot, "committed");

    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toMatchObject({
      success: true,
      data: { journalState: "none", requiredAction: "none" },
    });
    await expect(fs.readFile(recovery.restorePath, "utf8")).resolves.toBe("current-state");
    await expect(fs.access(recovery.bundlePath)).rejects.toThrow();
    await expect(fs.access(recovery.journalPath)).rejects.toThrow();
  });

  it("blocks a prepared journal whose rollback bundle is missing", async () => {
    const fixture = await makeFixture();
    await writeRecoveryJournal(fixture.dataRoot, "prepared", { includeBundle: false });

    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toEqual({
      success: false,
      error: "bundle-corrupt",
    });
  });

  it("treats a commit-ready journal without a bundle as unrecoverable", async () => {
    const fixture = await makeFixture();
    await writeRecoveryJournal(fixture.dataRoot, "commit-ready", { includeBundle: false });

    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toMatchObject({
      success: false,
      error: "missing-bundle-at-commit-ready",
    });
  });

  it("blocks recovery when the rollback bundle hash is corrupt", async () => {
    const fixture = await makeFixture();
    await writeRecoveryJournal(fixture.dataRoot, "prepared", { corruptBundleHash: true });

    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toMatchObject({
      success: false,
      error: "bundle-corrupt",
    });
  });

  it("blocks mutation when the transaction journal is corrupt", async () => {
    const fixture = await makeFixture();
    await fs.writeFile(path.join(fixture.projectRoot, ".artifact-delete-journal.json"), "{");
    const registered = registerDeletionPlan(plan());

    const result = await executeDeletion({ dataRoot: fixture.dataRoot }, {
      planId: registered.planId,
      fingerprint: registered.fingerprint,
      confirmation: { type: "chapter", chapterId: "chapter-fixture" },
    });

    expect(result).toMatchObject({ success: false, error: "journal-transition-failed", journalState: "none" });
    await expect(fs.readFile(path.join(fixture.projectRoot, "chapter-data.bin"), "utf8")).resolves.toBe("chapter-bytes");
    await expect(queryRecovery(fixture.dataRoot, "project-fixture")).resolves.toMatchObject({ success: false, error: "journal-corrupt" });
  });
});
