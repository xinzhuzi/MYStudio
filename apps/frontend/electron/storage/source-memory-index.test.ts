import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexSqlite,
  chunkMarkdown,
  cjkBigramTokens,
  searchIndexSqlite,
} from "./source-memory-index";

describe("cjkBigramTokens", () => {
  it("把连续中文切成 bigram 并保留单字，Latin 整词", () => {
    const tokens = cjkBigramTokens("晏燎创建万劫圣宗");
    expect(tokens).toEqual(expect.arrayContaining(["晏燎", "万劫", "圣宗", "晏"]));
    expect(tokens.filter((t) => t === "晏燎")).toHaveLength(1);
    expect(cjkBigramTokens("chapter-001 晏燎")).toContain("chapter");
  });
});

describe("chunkMarkdown", () => {
  it("按二级标题切块并保留标题", () => {
    const chunks = chunkMarkdown("# 书\n\n## 第一章 起源\n正文A\n\n## 第二章 发展\n正文B");
    expect(chunks.map((c) => c.title)).toEqual(["书", "第一章 起源", "第二章 发展"]);
  });
});

describe("index + search（真实 node:sqlite）", () => {
  it("中文短词经 bigram 命中，返回来源与 BM25 分数", () => {
    const dir = mkdtempSync(join(tmpdir(), "sm-idx-"));
    const db = join(dir, "index.sqlite");
    try {
      buildIndexSqlite(
        [
          {
            recordId: "bible:MEMORY.md:主角",
            kind: "bible",
            title: "主角",
            sourcePath: "novel/source-memory/MEMORY.md",
            sourceSha256: "a".repeat(64),
            anchor: "主角",
            createdAt: "2026-08-17T00:00:00Z",
            body: "灭族孤儿晏燎创万劫圣宗，推翻天庭灵石霸权",
          },
          {
            recordId: "chapter-chunk:chapters/chapter-001.md:第一章",
            kind: "chapter-chunk",
            title: "第一章",
            sourcePath: "novel/chapters/chapter-001.md",
            sourceSha256: "b".repeat(64),
            anchor: "第一章",
            createdAt: "2026-08-17T00:00:00Z",
            body: "道口镇血祭之夜，晏燎在雨中出逃",
          },
        ],
        db,
      );
      const hits = searchIndexSqlite(db, "晏燎 万劫圣宗", 4);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.sourcePath.includes("MEMORY.md"))).toBe(true);
      expect(hits[0]?.snippet.length).toBeGreaterThan(0);
      expect(searchIndexSqlite(db, "不存在的人名", 4)).toEqual([]);
      expect(searchIndexSqlite(join(dir, "missing.sqlite"), "晏燎")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

void writeFileSync;
void mkdirSync;
