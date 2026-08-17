// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("source-memory-service L2 增量抽取", () => {
  it("build 返回 changed 章节计划，状态 partial 带 extraction-pending", () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const reply = service.build("p1");
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

  it("stage 校验 provenance/kind/锚点，commit 全覆盖后 ready 且检索带出处", () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = service.build("p1").plan!;

      // 非法 kind / 越界 hash / 非计划锚点 → 拒收
      const bad = service.stageRecords("p1", plan.buildId, [
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), kind: "villain" as never },
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), sourceSha256: "0".repeat(64) },
        { ...chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor), anchor: "不存在的锚点" },
      ]);
      expect(bad.success).toBe(true);
      expect(bad.accepted).toBe(0);
      expect(bad.rejected).toBe(3);

      const good = service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      expect(good.accepted).toBe(1);

      // 旧 buildId → plan-stale
      expect(service.stageRecords("p1", "stale-build", [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]).success).toBe(false);

      const commit = service.commitBuild("p1", {
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

  it("部分块失败 → partial 且 raw 检索仍可用（不伪报 ready）", () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = service.build("p1").plan!;
      const chunk1 = plan.chunks.find((c) => c.chapterId === "chapter-001")!;
      service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      const commit = service.commitBuild("p1", {
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

  it("增量：改一章后 plan 只含该章切块，未变章的结构化记录被复用", () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan1 = service.build("p1").plan!;
      const chunk1 = plan1.chunks.find((c) => c.chapterId === "chapter-001")!;
      service.stageRecords("p1", plan1.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      service.commitBuild("p1", {
        buildId: plan1.buildId,
        coverage: plan1.chunks.map((c) => ({ sourcePath: c.sourcePath, anchor: c.anchor, ok: true })),
      });

      // 修改 chapter-002
      writeFileSync(
        join(root, "novel", "chapters", "chapter-002.md"),
        "## 第2章 血祭（改）\n\n道口镇血祭之夜，万劫圣宗初现。\n",
      );
      const plan2 = service.build("p1").plan!;
      expect(plan2.changedSources).toBe(1);
      expect(plan2.chunks.every((c) => c.chapterId === "chapter-002")).toBe(true);
      expect(plan2.carriedStructuredCount).toBe(1); // chapter-001 的记录复用

      // 重抽后 commit：旧章记录仍在、可检索
      const chunk2 = plan2.chunks[0]!;
      service.stageRecords("p1", plan2.buildId, [
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
      const commit2 = service.commitBuild("p1", {
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

  it("build 期间正文再变 → stage/commit 拒绝并要求重新构建", () => {
    const { root, cleanup } = makeProject();
    try {
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = service.build("p1").plan!;
      const chunk1 = plan.chunks[0]!;
      const staged = service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", chunk1.anchor)]);
      expect(staged.accepted).toBe(1);

      writeFileSync(join(root, "novel", "chapters", "chapter-001.md"), "## 第1章 剑主夜访（改）\n\n正文变了。\n");
      // manifest 尚未重建 → stage 整体成功，但新内容 hash 与旧计划不符 → 逐条拒收
      const stagedAfter = service.stageRecords("p1", plan.buildId, [
        chunkOf(root, "chapter-001.md", chunk1.anchor),
      ]);
      expect(stagedAfter.success).toBe(true);
      expect(stagedAfter.accepted).toBe(0);
      expect(stagedAfter.rejected).toBe(1);
      const commit = service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: [{ sourcePath: chunk1.sourcePath, anchor: chunk1.anchor, ok: true }],
      });
      expect(commit.success).toBe(false);
      expect(commit.error).toContain("sources-changed");
    } finally {
      cleanup();
    }
  });

  it("MEMORY.md 全程只读（build/stage/commit 均不改写用户圣经）", () => {
    const { root, cleanup } = makeProject();
    try {
      const memoryPath = join(root, "novel", "source-memory", "MEMORY.md");
      const before = readFileSync(memoryPath, "utf8");
      const service = createSourceMemoryService({ getProjectRoot: () => root });
      const plan = service.build("p1").plan!;
      service.stageRecords("p1", plan.buildId, [chunkOf(root, "chapter-001.md", plan.chunks[0]!.anchor)]);
      service.commitBuild("p1", {
        buildId: plan.buildId,
        coverage: plan.chunks.map((c) => ({ sourcePath: c.sourcePath, anchor: c.anchor, ok: true })),
      });
      expect(readFileSync(memoryPath, "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });
});
