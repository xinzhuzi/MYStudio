// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceMemoryService } from "./source-memory-service";
import { sha256Of } from "./source-memory-index";
import type { SourceMemoryStagedRecord } from "../../types/source-memory";

function makeProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sm-svc-"));
  mkdirSync(join(root, "novel", "chapters"), { recursive: true });
  mkdirSync(join(root, "novel", "source-memory"), { recursive: true });
  writeFileSync(
    join(root, "novel", "source-memory", "MEMORY.md"),
    "# 原著圣经\n\n## 一句话主线\n晏燎创建万劫圣宗。\n\n## 主要人物\n- 晏燎：剑主\n",
  );
  writeFileSync(
    join(root, "novel", "chapters", "chapter-001.md"),
    "## 第1章 剑主夜访\n\n晏燎夜访道口镇，遇见绯樱。\n",
  );
  writeFileSync(
    join(root, "novel", "chapters", "chapter-002.md"),
    "## 第2章 血祭\n\n道口镇血祭之夜，晏燎雨中出逃。\n",
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function chunkOf(root: string, file: string, anchor: string): SourceMemoryStagedRecord {
  const sourcePath = `novel/chapters/${file}`;
  return {
    kind: "character",
    title: "晏燎",
    body: "剑主，夜访道口镇",
    entities: ["晏燎"],
    confidence: 0.9,
    sourcePath,
    sourceSha256: sha256Of(readFileSync(join(root, "novel", "chapters", file), "utf8")),
    chapterId: file.replace(/\.md$/, ""),
    anchor,
  };
}

function activeGeneration(root: string): { buildId: string; generationPath: string } {
  return JSON.parse(readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8")) as {
    buildId: string;
    generationPath: string;
  };
}

describe("source-memory-service L2 增量抽取", () => {
  it("发布 V3 immutable generation 并以 active.json 作为唯一读取指针", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const reply = await service.build("p1");
      expect(reply.success).toBe(true);

      const memoryDir = join(root, "novel", "source-memory");
      const active = JSON.parse(readFileSync(join(memoryDir, "active.json"), "utf8")) as {
        buildId: string;
        generationPath: string;
        manifestSha256: string;
      };
      expect(active.buildId).toBe(reply.buildId);
      expect(active.generationPath.startsWith("generations/")).toBe(true);
      expect(active.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(memoryDir, active.generationPath, "manifest.json"))).toBe(true);
      expect(existsSync(join(memoryDir, active.generationPath, "records.jsonl"))).toBe(true);
      expect(existsSync(join(memoryDir, active.generationPath, "index.sqlite"))).toBe(true);
      expect(existsSync(join(memoryDir, active.generationPath, "build-state.json"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("忽略并保留 legacy source-bible，不进入记录或检索", async () => {
    const { root, cleanup } = makeProject();
    try {
      const legacyPath = join(root, "novel", "source-bible.md");
      const legacy = "## 退役圣经\n只有旧文件存在的紫电孤城。\n";
      writeFileSync(legacyPath, legacy);
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      await service.build("p1");

      expect(service.search("p1", "紫电孤城").hits).toEqual([]);
      expect(readFileSync(legacyPath, "utf8")).toBe(legacy);
    } finally {
      cleanup();
    }
  });

  it("权威源变化后 status/search 显式 stale 且不返回旧命中", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      await service.build("p1");
      expect(service.search("p1", "晏燎").hits?.length).toBeGreaterThan(0);

      writeFileSync(join(root, "novel", "chapters", "chapter-001.md"), "## 第1章 已外改\n\n事实已变化。\n");
      const search = service.search("p1", "晏燎");
      expect(search.success).toBe(false);
      expect(search.hits).toEqual([]);
      expect(search.degradedReason).toBe("sources-stale");
      expect(service.status("p1").status).toBe("stale");
    } finally {
      cleanup();
    }
  });

  it("同项目并发 writer 确定性返回 busy，不共享 staging", async () => {
    const { root, cleanup } = makeProject();
    let releaseGate: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    try {
      const service = createSourceMemoryService({
        getProjectRoot: () => root,
        failpoint: async (point) => {
          if (point === "after-index-build") {
            markStarted?.();
            await gate;
          }
        },
      });
      const first = service.build("p1");
      await started;
      const second = await service.build("p1");
      expect(second).toMatchObject({ success: false, code: "writer-busy" });
      releaseGate?.();
      expect((await first).success).toBe(true);
    } finally {
      releaseGate?.();
      cleanup();
    }
  });

  it("generation 已完成但 pointer 发布失败时仍保留旧 active", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      const activeBefore = readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8");
      const failing = createSourceMemoryService({
        getProjectRoot: () => root,
        failpoint: (point) => {
          if (point === "before-pointer-rename") throw new Error("injected-pointer-failure");
        },
      });
      const commit = await failing.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: plan.chunks.map((chunk) => ({ sourcePath: chunk.sourcePath, anchor: chunk.anchor, ok: true })),
      });
      expect(commit.success).toBe(false);
      expect(commit.error).toContain("injected-pointer-failure");
      expect(readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8")).toBe(activeBefore);
      expect(service.search("p1", "晏燎").hits?.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("重复标题和续块使用稳定且不冲突的 recordId/anchor", async () => {
    const { root, cleanup } = makeProject();
    try {
      writeFileSync(
        join(root, "novel", "chapters", "chapter-001.md"),
        `## 重复标题\n${"甲".repeat(1300)}\n\n## 重复标题\n${"乙".repeat(1300)}\n`,
      );
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      await service.build("p1");
      const active = activeGeneration(root);
      const rows = readFileSync(
        join(root, "novel", "source-memory", active.generationPath, "records.jsonl"),
        "utf8",
      ).trim().split("\n").map((line) => JSON.parse(line) as { recordId: string; anchor: string });
      expect(new Set(rows.map((row) => row.recordId)).size).toBe(rows.length);
      expect(new Set(rows.map((row) => row.anchor)).size).toBe(rows.length);
    } finally {
      cleanup();
    }
  });

  it("坏 staged JSONL 阻断 commit 且不移动 active", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      const activeBefore = readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8");
      appendFileSync(join(root, "novel", "source-memory", "staging", plan.buildId, "staged-records.jsonl"), "{broken\n");
      const commit = await service.commitBuild("p1", { buildId: plan.buildId, coverage: [] });
      expect(commit.success).toBe(false);
      expect(readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8")).toBe(activeBefore);
    } finally {
      cleanup();
    }
  });

  it("损坏 SQLite 后保留恢复证据并发布可检索的新 generation", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      await service.build("p1");
      const active = activeGeneration(root);
      writeFileSync(join(root, "novel", "source-memory", active.generationPath, "index.sqlite"), "broken sqlite");
      expect(service.search("p1", "晏燎")).toMatchObject({ success: false, hits: [], indexHealth: "corrupt" });
      const recovered = await service.rebuildIndex("p1");
      expect(recovered).toMatchObject({ success: true, indexHealth: "healthy" });
      expect(recovered.backupPath && existsSync(join(root, "novel", "source-memory", recovered.backupPath))).toBe(true);
      expect(service.search("p1", "晏燎").hits?.length).toBeGreaterThan(0);
      expect(activeGeneration(root).generationPath).not.toBe(active.generationPath);
    } finally {
      cleanup();
    }
  });

  it("V2 flat 仅作为一次迁移输入，发布 V3 后旧文件字节不变", async () => {
    const { root, cleanup } = makeProject();
    try {
      const memoryDir = join(root, "novel", "source-memory");
      const chapterPath = join(root, "novel", "chapters", "chapter-001.md");
      const memoryPath = join(memoryDir, "MEMORY.md");
      const legacyManifest = JSON.stringify({
        schemaVersion: 2,
        buildId: "legacy",
        sources: [
          { path: "novel/source-memory/MEMORY.md", sha256: sha256Of(readFileSync(memoryPath, "utf8")) },
          { path: "novel/chapters/chapter-001.md", sha256: sha256Of(readFileSync(chapterPath, "utf8")) },
          {
            path: "novel/chapters/chapter-002.md",
            sha256: sha256Of(readFileSync(join(root, "novel", "chapters", "chapter-002.md"), "utf8")),
          },
        ],
      });
      const legacyRecords = `${JSON.stringify({
        recordId: "structured:character:legacy",
        kind: "character",
        title: "旧档人物",
        body: "来自可验证 V2 事实层",
        sourcePath: "novel/chapters/chapter-001.md",
        sourceSha256: sha256Of(readFileSync(chapterPath, "utf8")),
        anchor: "旧锚点",
        chapterId: "chapter-001",
        createdAt: "2026-08-17T00:00:00Z",
      })}\n`;
      writeFileSync(join(memoryDir, "manifest.json"), legacyManifest);
      writeFileSync(join(memoryDir, "records.jsonl"), legacyRecords);

      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const built = await service.build("p1");
      expect(built.success).toBe(true);
      expect(service.search("p1", "旧档人物").hits?.some((hit) => hit.kind === "character")).toBe(true);
      expect(readFileSync(join(memoryDir, "manifest.json"), "utf8")).toBe(legacyManifest);
      expect(readFileSync(join(memoryDir, "records.jsonl"), "utf8")).toBe(legacyRecords);
    } finally {
      cleanup();
    }
  });

  it("项目根隔离，查询不会跨项目泄漏", async () => {
    const first = makeProject();
    const second = makeProject();
    try {
      writeFileSync(join(second.root, "novel", "source-memory", "MEMORY.md"), "## 独有事实\n玄霜孤城只属于项目二。\n");
      const roots = new Map([["p1", first.root], ["p2", second.root]]);
      const service = createSourceMemoryService({ getProjectRoot: (projectId) => roots.get(projectId)! });
      await service.build("p1");
      await service.build("p2");
      expect(service.search("p2", "玄霜孤城").hits?.length).toBeGreaterThan(0);
      expect(service.search("p1", "玄霜孤城").hits).toEqual([]);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it("发布前 source-race 阻断 pointer，旧 active 保持原字节", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      const activeBefore = readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8");
      const racing = createSourceMemoryService({
        getProjectRoot: () => root,
        failpoint: (point) => {
          if (point === "after-index-build") {
            writeFileSync(join(root, "novel", "source-memory", "MEMORY.md"), "## 外部变化\n发布期间改变。\n");
          }
        },
      });
      const commit = await racing.commitBuild("p1", { buildId: plan.buildId, coverage: [] });
      expect(commit.success).toBe(false);
      expect(commit.error).toContain("sources-changed");
      expect(readFileSync(join(root, "novel", "source-memory", "active.json"), "utf8")).toBe(activeBefore);
      expect(service.status("p1").status).toBe("stale");
    } finally {
      cleanup();
    }
  });

  it("build 返回 changed 章节计划，状态 partial 带 extraction-pending", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const reply = await service.build("p1");
      expect(reply.success).toBe(true);
      expect(reply.plan?.chunks.length).toBeGreaterThan(0);
      expect(reply.plan?.chunks.every((c) => c.sourcePath.startsWith("novel/chapters/"))).toBe(true);
      expect(reply.plan?.chunks.some((c) => c.chapterId === "chapter-001")).toBe(true);
      expect(reply.plan?.chunks.some((c) => c.chapterId === "chapter-002")).toBe(true);
      const status = service.status("p1");
      expect(status.status).toBe("partial");
      expect(status.degradedReason).toBe("extraction-pending:2");
    } finally {
      cleanup();
    }
  });

  it("仅 partial extraction-pending 恢复旧 plan，ready 重建不重复抽取", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const first = await service.build("p1");
      expect(first.plan?.chunks.length).toBeGreaterThan(0);

      const resumed = await service.build("p1");
      expect(resumed.plan).toEqual(first.plan);

      const committed = await service.commitBuild("p1", {
        buildId: first.buildId!,
        coverage: first.plan!.chunks.map((chunk) => ({
          sourcePath: chunk.sourcePath,
          anchor: chunk.anchor,
          ok: true,
        })),
      });
      expect(committed.status).toBe("ready");

      const noOp = await service.build("p1");
      expect(noOp).toMatchObject({
        success: true,
        buildId: first.buildId,
      });
      expect(noOp.plan).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("stage 校验 provenance/kind/锚点，commit 全覆盖后 ready 且检索带出处", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;

      // 非法 kind / 越界 hash / 非计划锚点 → 拒收
      const bad = await service.stageRecords("p1", plan.buildId, [
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), kind: "villain" as never },
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), sourceSha256: "0".repeat(64) },
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), anchor: "不存在的锚点" },
      ]);
      expect(bad.success).toBe(true);
      expect(bad.accepted).toBe(0);
      expect(bad.rejected).toBe(3);

      const good = await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      expect(good.accepted).toBe(1);

      // 旧 buildId → plan-stale
      expect((await service.stageRecords("p1", "stale-build", [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)])).success).toBe(false);

      const commit = await service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: plan.chunks.map((c) => ({ sourcePath: c.sourcePath, anchor: c.anchor, ok: true })),
      });
      expect(commit.success).toBe(true);
      expect(commit.status).toBe("ready");
      expect((commit.structuredCount ?? 0) >= 1).toBe(true);

      const hits = service.search("p1", "晏燎").hits ?? [];
      expect(hits.some((h) => h.kind === "character" && h.title === "晏燎")).toBe(true);
      const structured = hits.find((h) => h.kind === "character");
      expect(structured?.sourcePath).toBe("novel/chapters/chapter-001.md");
      expect(service.search("p1", "不存在的人名").hits).toEqual([]);

      const status = service.status("p1");
      expect(status.status).toBe("ready");
      expect((status.structuredCount ?? 0) >= 1).toBe(true);
      expect((status.rawCount ?? 0) >= 1).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("部分块失败 → partial 且 raw 检索仍可用（不伪报 ready）", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      const chunk1 = plan.chunks.find((c) => c.chapterId === "chapter-001")!;
      await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      const commit = await service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: plan.chunks.map((c) => ({
          sourcePath: c.sourcePath,
          anchor: c.anchor,
          ok: c.chapterId === "chapter-001",
        })),
      });
      expect(commit.status).toBe("partial");
      expect(commit.failedChunks).toBe(plan.chunks.length - 1);
      const status = service.status("p1");
      expect(status.status).toBe("partial");
      expect(status.degradedReason).toBe(`extraction-failed:${plan.chunks.length - 1}`);
      // AI 失败的章节 raw 块仍在检索层
      expect((service.search("p1", "血祭").hits ?? []).some((h) => h.kind === "chapter-chunk")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("增量：改一章后 plan 只含该章切块，未变章的结构化记录被复用", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan1 = (await service.build("p1")).plan!;
      const chunk1 = plan1.chunks.find((c) => c.chapterId === "chapter-001")!;
      await service.stageRecords("p1", plan1.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      await service.commitBuild("p1", {
        buildId: plan1.buildId,
        coverage: plan1.chunks.map((c) => ({ sourcePath: c.sourcePath, anchor: c.anchor, ok: true })),
      });

      // 修改 chapter-002
      writeFileSync(
        join(root, "novel", "chapters", "chapter-002.md"),
        "## 第2章 血祭（改）\n\n道口镇血祭之夜，万劫圣宗初现。\n",
      );
      const plan2 = (await service.build("p1")).plan!;
      expect(plan2.changedSources).toBe(1);
      expect(plan2.chunks.every((c) => c.chapterId === "chapter-002")).toBe(true);
      expect(plan2.carriedStructuredCount).toBe(1); // chapter-001 的记录复用

      // 重抽后 commit：旧章记录仍在、可检索
      const chunk2 = plan2.chunks[0]!;
      await service.stageRecords("p1", plan2.buildId, [
        {
          kind: "term",
          title: "万劫圣宗",
          body: "晏燎创建的宗门",
          entities: ["万劫圣宗", "晏燎"],
          sourcePath: chunk2.sourcePath,
          sourceSha256: chunk2.sourceSha256,
          chapterId: chunk2.chapterId,
          anchor: chunk2.anchor,
        },
      ]);
      const commit2 = await service.commitBuild("p1", {
        buildId: plan2.buildId,
        coverage: [{ sourcePath: chunk2.sourcePath, anchor: chunk2.anchor, ok: true }],
      });
      expect(commit2.status).toBe("ready");
      const hits = service.search("p1", "晏燎").hits ?? [];
      expect(hits.some((h) => h.kind === "character" && h.sourcePath.includes("chapter-001"))).toBe(true);
      expect(service.search("p1", "万劫圣宗").hits?.some((h) => h.kind === "term")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("build 期间正文再变 → stage/commit 拒绝并要求重新构建", async () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      const chunk1 = plan.chunks[0]!;
      const staged = await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      expect(staged.accepted).toBe(1);

      writeFileSync(join(root, "novel", "chapters", "chapter-001.md"), "## 第1章 剑主夜访（改）\n\n正文变了。\n");
      // manifest 尚未重建 → stage 整体成功，但新内容 hash 与旧计划不符 → 逐条拒收
      const stagedAfter = await service.stageRecords("p1", plan.buildId, [
        chunkOf(root, "chapter-001.md", chunk1.anchor),
      ]);
      expect(stagedAfter.success).toBe(true);
      expect(stagedAfter.accepted).toBe(0);
      expect(stagedAfter.rejected).toBe(1);
      const commit = await service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: [{ sourcePath: chunk1.sourcePath, anchor: chunk1.anchor, ok: true }],
      });
      expect(commit.success).toBe(false);
      expect(commit.error).toContain("sources-changed");
    } finally {
      cleanup();
    }
  });

  it("MEMORY.md 全程只读（build/stage/commit 均不改写用户圣经）", async () => {
    const { root, cleanup } = makeProject();
    try {
      const memoryPath = join(root, "novel", "source-memory", "MEMORY.md");
      const before = readFileSync(memoryPath, "utf8");
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = (await service.build("p1")).plan!;
      await service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      await service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: plan.chunks.map((c) => ({ sourcePath: c.sourcePath, anchor: c.anchor, ok: true })),
      });
      expect(readFileSync(memoryPath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });
});
