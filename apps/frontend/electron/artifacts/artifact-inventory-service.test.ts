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
  vi.unstubAllGlobals();
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

  it("rewrites Daojie chapter-2 assets without changing chapter-1 or project metadata", async () => {
    const fixturePath = path.resolve(process.cwd(), "frontend/electron/artifacts/__fixtures__/mixed-backup-sample-v1.json");
    const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as Record<string, any>;
    const chapterOneBefore = JSON.stringify(raw.chapters["chapter-1"]);
    const projectEnvelopeBefore = JSON.stringify(raw.projectEnvelope);
    const rewritten = rewriteRegisteredBackup(raw, "chapter-2", new Set(["chapter-2"]));
    const value = rewritten.value as Record<string, any>;

    expect(value.chapters["chapter-2"]).toBeUndefined();
    expect(JSON.stringify(value.chapters["chapter-1"])).toBe(chapterOneBefore);
    expect(JSON.stringify(value.projectEnvelope)).toBe(projectEnvelopeBefore);
    expect(value["studio-store.json"].novelChapters.map((chapter: { id: string }) => chapter.id)).toEqual(["chapter-1"]);
    expect(value.assets.chars["assets_chars_chapter2-v3.json"]).toBeUndefined();
    expect(value.assets.chars["assets_chars.json"].characters.map((record: { id: string }) => record.id)).toEqual([
      "char-shared-a1b2c3",
      "char-shared-b2c3d4",
    ]);
    expect(value.continuity["continuity_chapter2.json"]).toBeUndefined();
    expect(value.exports["exports_manifest.json"].versions.every(
      (version: { chapters: string[] }) => !version.chapters.includes("chapter-2"),
    )).toBe(true);
  });

  it("rejects unknown Zustand payloads and future Daojie backup versions", async () => {
    expect(findBackupDecoder({ projectId: "project-opaque", state: { opaqueRecords: [] } })).toBeNull();
    const fixturePath = path.resolve(process.cwd(), "frontend/electron/artifacts/__fixtures__/mixed-backup-sample-v1.json");
    const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as Record<string, unknown>;
    expect(findBackupDecoder({ ...raw, _version: "2.0.0" })).toBeNull();
  });

  it("decodes agentWorkData-only Zustand snapshots using episode ownership", () => {
    const work = {
      id: "work-target",
      key: "entityExtraction",
      episodeId: "chapter-target",
      data: '{"episodeId":"chapter-decoy","id":"opaque-payload"}',
      createdAt: 1,
      updatedAt: 2,
    };
    const raw = { state: { agentWorkData: [work] }, version: 0 };

    const decoder = findBackupDecoder(raw);
    expect(decoder?.formatName).toBe("zustand-project-state");
    expect(decoder?.decode(raw).artifacts).toEqual([{
      projectId: "",
      chapterId: "chapter-target",
      stage: "analysis",
      data: work,
    }]);
    expect(findBackupDecoder({ state: { agentWorkData: work }, version: 0 })).toBeNull();
  });

  it("rewrites target agent work while preserving its sibling and opaque data", () => {
    const target = {
      id: "work-target",
      key: "entityExtraction",
      episodeId: "chapter-target",
      data: "target output",
      createdAt: 1,
      updatedAt: 2,
    };
    const sibling = {
      id: "work-sibling",
      key: "scriptPlan",
      episodeId: "chapter-sibling",
      data: '{"episodeId":"chapter-target","id":"work-target"}',
      createdAt: 3,
      updatedAt: 4,
    };
    const raw = { state: { agentWorkData: [target, sibling] }, version: 0 };
    const siblingBefore = JSON.stringify(sibling);

    const rewritten = rewriteRegisteredBackup(raw, "chapter-target", new Set(["work-target"]));
    const state = (rewritten.value as { state: { agentWorkData: unknown[] } }).state;

    expect(rewritten.changed).toBe(true);
    expect(state.agentWorkData).toEqual([sibling]);
    expect(JSON.stringify(state.agentWorkData[0])).toBe(siblingBefore);
    expect(raw.state.agentWorkData).toEqual([target, sibling]);
  });

  it("removes chapter-keyed mixed-backup maps while preserving sibling keys", () => {
    const siblingProjection = { opaque: "sibling" };
    const raw = {
      state: {
        novelChapters: [
          { id: "chapter-target", title: "Target" },
          { id: "chapter-sibling", title: "Sibling" },
        ],
        resultsByChapter: {
          "chapter-target": { opaque: "target" },
          "chapter-sibling": siblingProjection,
        },
      },
      version: 1,
    };

    const rewritten = rewriteRegisteredBackup(raw, "chapter-target", new Set(["chapter-target"]));
    const results = (rewritten.value as typeof raw).state.resultsByChapter;
    expect(results["chapter-target"]).toBeUndefined();
    expect(results["chapter-sibling"]).toEqual(siblingProjection);
    expect(raw.state.resultsByChapter["chapter-target"]).toEqual({ opaque: "target" });
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
    // 布局契约表驱动分类(store v1 / hyperframes 根 / 设定集根)
    await fs.mkdir(path.join(projectRoot, "store", "studio-workflow", "chapters"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "store", "studio-workflow", "chapters", "chapter-fixture.json"), "{}");
    await fs.mkdir(path.join(projectRoot, "hyperframes", "chapter-fixture"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "hyperframes", "chapter-fixture", "seg-001.mp4"), "seg");
    await fs.mkdir(path.join(projectRoot, "assets", "files", "character"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "assets", "files", "character", "a.png"), "png");
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
    // 章节隔离语义:凡带章号者必属目标章;公共资源根(assets/store 全局件)允许无章号
    expect(chapter.data.artifacts.every((artifact) => artifact.chapterId == null || artifact.chapterId === "chapter-fixture")).toBe(true);
    expect(chapter.data.artifacts.some((artifact) => artifact.name === "shot-001.png")).toBe(true);
    expect(chapter.data.discrepancies).toHaveLength(0);

    // 布局契约表驱动分类:store→project-store;hyperframes→production;assets→assets
    // 未识别 JSON 的 physicalRefs 为空(记录即文件),按 id 内嵌路径匹配
    const storeStage = full.data.artifacts.filter((artifact) =>
      artifact.id.includes("store/studio-workflow/chapters"));
    expect(storeStage.length).toBeGreaterThan(0);
    expect(storeStage.every((artifact) => artifact.stage === "project-store")).toBe(true);
    const hyperStage = full.data.artifacts.filter((artifact) =>
      artifact.physicalRefs.some((ref) => ref.path.includes("hyperframes/")));
    expect(hyperStage.length).toBeGreaterThan(0);
    expect(hyperStage.every((artifact) => artifact.stage === "production")).toBe(true);
    const assetStage = full.data.artifacts.filter((artifact) =>
      artifact.physicalRefs.some((ref) => ref.path.includes("assets/files/")));
    expect(assetStage.length).toBeGreaterThan(0);
    expect(assetStage.every((artifact) => artifact.stage === "assets")).toBe(true);
  });

  it("does not split per-shot workflow dirs into pseudo chapters (chapter segment stops at digits)", async () => {    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-shotdir-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-shotdir");
    await fs.mkdir(path.join(projectRoot, "workflow-images", "storyboard-flow-chapter-001-017"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboard-flow-chapter-001-017", "gen-001.png"), "fixture-image");
    await fs.mkdir(path.join(projectRoot, "workflow-images", "chapter-001", "storyboard-flow-chapter-001-043"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "workflow-images", "chapter-001", "storyboard-flow-chapter-001-043", "gen-002.png"), "fixture-image");
    await fs.mkdir(path.join(projectRoot, "video-use", "chapter-001-archive-20260816"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "video-use", "chapter-001-archive-20260816", "r2.mp4"), "fixture-video");

    const result = await scanProjectInventory(dataRoot, "project-shotdir");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const imageArtifacts = result.data.artifacts.filter((artifact) => artifact.stage === "image");
    expect(imageArtifacts.length).toBe(2);
    // 每镜目录名里的 chapter-001-017 不能被当成独立章：章段只取数字前缀。
    expect(imageArtifacts.every((artifact) => artifact.chapterId === "chapter-001")).toBe(true);
    expect(result.data.artifacts.some((artifact) => artifact.chapterId === "chapter-001-017")).toBe(false);
    // 归档/续写衍生目录同样归入数字章号，不再分裂出第二个“第 1 章”。
    expect(result.data.artifacts.find((artifact) => artifact.name === "r2.mp4")?.chapterId).toBe("chapter-001");
  });

  it("excludes backup-only disk artifacts from missing-index discrepancies", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-backup-disc-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-backup-disc");
    await fs.mkdir(projectRoot, { recursive: true });
    // 仅备份：无解码器的 .bak 残留 → 不入 missing-index。历史快照本就不
    // 在结构化状态里，计入会被 applyInventoryDiscrepancyBlockers 全数转成
    // 删除计划硬阻塞，用户将无法从应用内删除任何东西。
    await fs.writeFile(path.join(projectRoot, "editing.json.bak-session-heal"), JSON.stringify({ random: true }));

    const result = await scanProjectInventory(dataRoot, "project-backup-disc");
    expect(result.success).toBe(true);
    if (!result.success) return;
    // 备份产物本身仍在盘点里（进“备份”桶），只是不再制造盘面不一致。
    expect(result.data.artifacts.some((artifact) => artifact.name === "未识别备份: editing.json.bak-session-heal")).toBe(true);
    expect(result.data.discrepancies).toHaveLength(0);
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

  it("deletes an unregistered backup when its path is chapter-scoped", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-unknown-backup-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-unknown-backup");
    await fs.mkdir(path.join(projectRoot, "backups"), { recursive: true });
    const backupPath = path.join(projectRoot, "backups", "chapter-9001-unregistered.json.codex-test");
    await fs.writeFile(backupPath, JSON.stringify({ opaque: true, records: [{ value: "not-decoded" }] }));

    const inventory = await scanProjectInventory(dataRoot, "project-unknown-backup", "chapter-9001");
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const unknown = inventory.data.artifacts.find((artifact) =>
      artifact.physicalRefs.some((ref) => ref.path === "backups/chapter-9001-unregistered.json.codex-test"),
    );
    expect(unknown).toMatchObject({
      state: "active",
      deletePolicy: "delete-exclusive-downstream",
      chapterId: "chapter-9001",
    });
    expect(unknown?.physicalRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "backup" }),
    ]));

    const planned = buildDeletionPlan(inventory.data.artifacts, [], "chapter-9001");
    expect(planned.valid).toBe(true);
    expect(planned.plan.executionAllowed).toBe(true);
    expect(planned.plan.blockerItems).toHaveLength(0);
    expect(planned.plan.deleteItems.some((item) => item.physicalPath?.endsWith("chapter-9001-unregistered.json.codex-test"))).toBe(true);
    await expect(fs.access(backupPath)).resolves.toBeUndefined();
  });

  it("blocks unregistered chapter JSON and mixed backups while retaining chapter-only backup deletion", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-unknown-scope-"));
    roots.push(dataRoot);
    const projectId = "project-unknown-scope";
    const chapterId = "chapter-9005";
    const projectRoot = path.join(dataRoot, "_p", projectId);
    const chapterJson = path.join(projectRoot, "remotion", "jobs", chapterId, "current.json");
    const mixedBackup = path.join(projectRoot, "history.json.bak");
    const chapterBackup = path.join(projectRoot, "backups", `${chapterId}-continuity`, "characters.json");
    await fs.mkdir(path.dirname(chapterJson), { recursive: true });
    await fs.mkdir(path.dirname(chapterBackup), { recursive: true });
    await fs.writeFile(chapterJson, JSON.stringify({ jobId: `job-${chapterId}`, opaque: true }));
    await fs.writeFile(mixedBackup, JSON.stringify({
      snapshots: {
        [chapterId]: { opaque: "target" },
        "chapter-9006": { opaque: "sibling" },
      },
    }));
    await fs.writeFile(chapterBackup, JSON.stringify({ opaque: true }));

    const inventory = await scanProjectInventory(dataRoot, projectId);
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const recordsForPath = (relativePath: string) => inventory.data.artifacts.filter((artifact) =>
      artifact.physicalRefs.some((ref) => ref.path === relativePath),
    );
    const chapterJsonRelative = path.relative(projectRoot, chapterJson);
    const mixedBackupRelative = path.relative(projectRoot, mixedBackup);
    const chapterBackupRelative = path.relative(projectRoot, chapterBackup);
    expect(recordsForPath(chapterJsonRelative)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chapterId,
        state: "unknown",
        deletePolicy: "blocker-missing-ownership",
      }),
    ]));
    expect(recordsForPath(mixedBackupRelative)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chapterId,
        stage: "backup",
        state: "unknown",
        deletePolicy: "blocker-missing-ownership",
      }),
      expect.objectContaining({
        chapterId: "chapter-9006",
        state: "unknown",
        deletePolicy: "blocker-missing-ownership",
      }),
    ]));
    expect(recordsForPath(chapterBackupRelative)).toEqual([
      expect.objectContaining({
        chapterId,
        stage: "backup",
        state: "active",
        deletePolicy: "delete-exclusive-downstream",
      }),
    ]);
    expect(inventory.data.summary.blockedByUnknown).toBe(3);

    const planned = buildDeletionPlan(inventory.data.artifacts, [], chapterId);
    expect(planned.valid).toBe(false);
    expect(planned.plan.executionAllowed).toBe(false);
    expect(planned.plan.blockerItems.map((item) => item.physicalPath)).toEqual(expect.arrayContaining([
      chapterJsonRelative,
      mixedBackupRelative,
    ]));
    expect(planned.plan.backupImpact).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: chapterBackupRelative, action: "delete" }),
    ]));
  });

  it("surfaces visual-continuity snapshots as backup impact while preserving sibling chapters", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-vc-backup-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-vc");
    await fs.mkdir(projectRoot, { recursive: true });

    const state = {
      projectId: "project-vc",
      state: {
        novelChapters: [
          { id: "chapter-vc", title: "VC chapter" },
          { id: "chapter-keep", title: "Sibling chapter" },
        ],
      },
      version: 1,
    };
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify(state));

    const snapshotDir = path.join(
      projectRoot,
      "visual-continuity-backups",
      "storyboard-promotion-20260807T103601978677Z-5e481542ae94",
    );
    await fs.mkdir(snapshotDir, { recursive: true });
    const snapshotPath = path.join(snapshotDir, "studio-workflow-store.json");
    const snapshotRelativePath = path.relative(projectRoot, snapshotPath);
    const opaqueSnapshotPath = path.join(snapshotDir, "opaque.snapshot");
    const opaqueSnapshotRelativePath = path.relative(projectRoot, opaqueSnapshotPath);
    await fs.writeFile(snapshotPath, JSON.stringify(state));
    await fs.writeFile(opaqueSnapshotPath, JSON.stringify({ opaque: true }));

    expect(findBackupDecoder(state)?.formatName).toBe("zustand-project-state");

    const fullInventory = await scanProjectInventory(dataRoot, "project-vc");
    expect(fullInventory.success).toBe(true);
    if (!fullInventory.success) return;
    const siblingArtifact = fullInventory.data.artifacts.find((artifact) => artifact.chapterId === "chapter-keep");
    expect(siblingArtifact?.physicalRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "backup", path: snapshotRelativePath }),
    ]));
    const opaqueSnapshot = fullInventory.data.artifacts.find((artifact) =>
      artifact.physicalRefs.some((ref) => ref.path === opaqueSnapshotRelativePath),
    );
    expect(opaqueSnapshot?.physicalRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "backup", path: opaqueSnapshotRelativePath }),
    ]));

    const inventory = await scanProjectInventory(dataRoot, "project-vc", "chapter-vc");
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;

    const chapterArtifact = inventory.data.artifacts.find((artifact) => artifact.chapterId === "chapter-vc");
    expect(chapterArtifact).toBeDefined();
    expect(inventory.data.artifacts.every((artifact) => artifact.chapterId === "chapter-vc")).toBe(true);
    expect(chapterArtifact?.physicalRefs.map((ref) => `${ref.type}:${ref.path}`).sort()).toEqual([
      `backup:${snapshotRelativePath}`,
      "project-file:studio.json",
    ]);

    const planned = buildDeletionPlan(inventory.data.artifacts, [], "chapter-vc");
    expect(planned.valid).toBe(true);
    expect(planned.plan.backupImpact).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: snapshotRelativePath, action: "rewrite" }),
    ]));

    const rewritten = rewriteRegisteredBackup(
      state,
      "chapter-vc",
      new Set(planned.plan.deleteItems.map((item) => item.artifactId)),
    );
    expect((rewritten.value as typeof state).state.novelChapters).toEqual([
      { id: "chapter-keep", title: "Sibling chapter" },
    ]);
  });

  it("filters TTS blockers to the requested chapter while retaining unowned active jobs", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-tts-blockers-"));
    roots.push(dataRoot);
    const projectId = "project-tts-blockers";
    const projectRoot = path.join(dataRoot, "_p", projectId);
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify({
      state: {
        novelChapters: [
          { id: "chapter-a", title: "A" },
          { id: "chapter-b", title: "B" },
        ],
      },
      version: 1,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        generations: [
          { id: "tts-a", projectId, chapterId: "chapter-a", status: "generating" },
          { id: "tts-b", projectId, chapterId: "chapter-b", status: "queued" },
          { id: "tts-unowned", projectId, status: "generating" },
        ],
      }),
    })));

    const inventory = await scanProjectInventory(dataRoot, projectId, "chapter-a");
    expect(inventory.success).toBe(true);
    if (!inventory.success) return;
    expect(inventory.data.blockers.map((blocker) => blocker.jobId).sort()).toEqual([
      "tts-a",
      "tts-unowned",
    ]);
  });
});
