import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { scanProjectInventory } from "./artifact-inventory-service";
import { findBackupDecoder, rewriteRegisteredBackup } from "./backup-decoder-registry";
import { buildDeletionPlan } from "@/lib/artifacts/artifact-dependency-graph";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("artifact inventory persisted project state", () => {
  it("decodes and round-trips the checked-in Daojie mixed-backup shape", async () => {
    const fixturePath = path.resolve(process.cwd(), "frontend/electron/artifacts/__fixtures__/mixed-backup-sample-v1.json");
    const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as Record<string, any>;
    expect(findBackupDecoder(raw)?.formatName).toBe("daojie-multichapter-mixed-json");

    const untouchedChapter = JSON.stringify(raw.chapters["chapter-2"]);
    const rewritten = rewriteRegisteredBackup(raw, "chapter-1", new Set(["chapter-1"]));
    expect((rewritten.value as Record<string, any>).chapters["chapter-1"]).toBeUndefined();
    expect(JSON.stringify((rewritten.value as Record<string, any>).chapters["chapter-2"])).toBe(untouchedChapter);
  });

  it("decodes Zustand project files and keeps chapter filters isolated", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-inventory-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-fixture");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify({
      state: {
        novelChapters: [
          { id: "chapter-fixture", index: 1, title: "第一章" },
          { id: "chapter-keep", index: 2, title: "第二章" },
        ],
      },
      version: 0,
    }));
    await fs.writeFile(path.join(projectRoot, "script.json"), JSON.stringify({
      state: {
        projects: {
          "project-fixture": {
            scriptData: {
              episodes: [
                { id: "chapter-fixture", index: 1, title: "第一章剧本" },
                { id: "chapter-keep", index: 2, title: "第二章剧本" },
              ],
            },
          },
        },
      },
      version: 0,
    }));
    await fs.writeFile(path.join(projectRoot, "project-history.bak"), JSON.stringify({
      projectId: "project-fixture",
      state: {
        novelChapters: [
          { id: "chapter-fixture", title: "第一章备份" },
          { id: "chapter-keep", title: "第二章备份" },
        ],
      },
      timestamp: 1,
    }));
    await fs.mkdir(path.join(projectRoot, "workflow-images", "storyboards", "chapter-fixture"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", "chapter-fixture", "shot-001.png"), "fixture-image");
    await fs.writeFile(path.join(projectRoot, "artifacts.json"), JSON.stringify({
      version: 1,
      overlays: {
        "novel:media-file:project-fixture-chapter-fixture": {
          name: "第一章覆盖名称",
          tags: ["checked"],
          updatedAt: 1,
        },
      },
    }));

    const full = await scanProjectInventory(dataRoot, "project-fixture");
    expect(full.success).toBe(true);
    if (!full.success) return;
    expect(full.data.artifacts.filter((artifact) => artifact.chapterId === "chapter-fixture").length).toBeGreaterThan(0);
    expect(full.data.artifacts.filter((artifact) => artifact.chapterId === "chapter-keep").length).toBeGreaterThan(0);
    expect(full.data.artifacts.some((artifact) => artifact.metadata?.name === "第一章覆盖名称")).toBe(true);
    expect(full.data.artifacts.some((artifact) => /^(novel|analysis|script|storyboard|production):media-file:/.test(artifact.id))).toBe(false);
    expect(full.data.artifacts.some((artifact) => artifact.kind === "novel-chapter" && artifact.chapterId === "chapter-fixture")).toBe(true);

    const chapter = await scanProjectInventory(dataRoot, "project-fixture", "chapter-fixture");
    expect(chapter.success).toBe(true);
    if (!chapter.success) return;
    expect(chapter.data.artifacts.every((artifact) => artifact.chapterId === "chapter-fixture")).toBe(true);
    expect(chapter.data.artifacts.some((artifact) => artifact.name === "shot-001.png")).toBe(true);
    expect(chapter.data.discrepancies).toHaveLength(0);
  });

  it("merges duplicate logical IDs across active and backup sources with complete physical coverage", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-physical-refs-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-refs");
    await fs.mkdir(projectRoot, { recursive: true });

    const state = {
      projectId: "project-refs",
      state: {
        novelChapters: [{ id: "chapter-refs", title: "Physical refs" }],
      },
      version: 1,
    };
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify(state));
    await fs.writeFile(path.join(projectRoot, "history.bak"), JSON.stringify(state));
    await fs.writeFile(path.join(projectRoot, "project-refs-history.json"), JSON.stringify({
      ...state,
      timestamp: 1,
    }));

    const inventory = await scanProjectInventory(dataRoot, "project-refs", "chapter-refs");
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const chapterArtifact = inventory.data.artifacts.find((artifact) => artifact.chapterId === "chapter-refs");
    expect(chapterArtifact).toBeDefined();
    const refs = chapterArtifact?.physicalRefs ?? [];
    expect(refs.map((ref) => `${ref.type}:${ref.path}`).sort()).toEqual([
      "backup:history.bak",
      "project-file:project-refs-history.json",
      "project-file:studio.json",
    ]);
    expect(inventory.data.artifacts.filter((artifact) => artifact.id === chapterArtifact?.id)).toHaveLength(1);

    const planned = buildDeletionPlan(inventory.data.artifacts, [], "chapter-refs");
    expect(planned.valid).toBe(true);
    expect(planned.plan.backupImpact.map((impact) => impact.filePath).sort()).toEqual([
      "history.bak",
    ]);
    expect(planned.plan.backupImpact.some((impact) => impact.filePath === "studio.json")).toBe(false);
    const plannedArtifact = planned.plan.deleteItems.find((item) => item.artifactId === chapterArtifact?.id);
    expect(plannedArtifact?.physicalRefs?.map((ref) => `${ref.type}:${ref.path}`).sort()).toEqual([
      "backup:history.bak",
      "project-file:project-refs-history.json",
      "project-file:studio.json",
    ]);
  });

  it("skips whole-store snapshot dirs (visual-continuity-backups) so they don't duplicate live artifacts", async () => {
    // The daojie promote pipeline writes whole-store snapshots under
    // visual-continuity-backups/<promotion-id>/studio-workflow-store.json.
    // Those snapshots are plain .json (no .bak/.codex suffix), so without a
    // directory-level skip they get classified kind:"json" (LIVE), decoded into
    // a full duplicate artifact set, and surface in the product popup as extra
    // physical files. The scanner must treat the whole snapshot dir as a backup
    // root and never decode its contents as live stores.
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-vc-backup-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-vc");
    await fs.mkdir(projectRoot, { recursive: true });

    const state = {
      projectId: "project-vc",
      state: {
        novelChapters: [{ id: "chapter-vc", title: "VC chapter" }],
      },
      version: 1,
    };
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify(state));

    // The offending whole-store snapshot directory the daojie pipeline creates.
    const snapshotDir = path.join(
      projectRoot,
      "visual-continuity-backups",
      "storyboard-promotion-20260807T103601978677Z-5e481542ae94",
    );
    await fs.mkdir(snapshotDir, { recursive: true });
    await fs.writeFile(path.join(snapshotDir, "studio-workflow-store.json"), JSON.stringify(state));

    const inventory = await scanProjectInventory(dataRoot, "project-vc", "chapter-vc");
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const chapterArtifact = inventory.data.artifacts.find((artifact) => artifact.chapterId === "chapter-vc");
    expect(chapterArtifact).toBeDefined();
    const refs = chapterArtifact?.physicalRefs ?? [];

    // The live store must be the ONLY physical ref — the snapshot copy must NOT
    // appear as a live project-file ref (it lives under visual-continuity-backups).
    expect(refs.some((ref) => ref.path.includes("visual-continuity-backups"))).toBe(false);
    expect(refs.map((ref) => `${ref.type}:${ref.path}`).sort()).toEqual([
      "project-file:studio.json",
    ]);

    // The snapshot directory must not contribute any artifacts of its own.
    expect(inventory.data.artifacts.some((artifact) =>
      (artifact.physicalRefs ?? []).some((ref) => ref.path.includes("visual-continuity-backups")),
    )).toBe(false);
  });
});
