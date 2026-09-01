/**
 * 源记忆索引构建层——源扫描/buildId/结构化携带/raw 记录/分块/快照等价。深网专批矩阵驱动。体逐字保留。
 */
import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { type IndexRecord, sha256Of, chunkMarkdown } from "./source-memory-index";
import type { SourceMemoryRecord, SourceMemoryExtractionChunk } from "@/types/source-memory";
import type { ScannedFile } from "./source-memory-service";
import { EXTRACTOR_VERSION, type SourceMemoryIo } from "./source-memory-paths";

function chapterIdOfChapterFile(relFile: string): string {
  return path.basename(relFile).replace(/\.md$/, "");
}

export function createSourceMemoryBuild(io: SourceMemoryIo) {
  const { readJsonIfExists, readIfExists, activePath, legacyManifestPath, legacyRecordsPath, readActiveSnapshot, readRecordsStrict } = io;
  const SOURCES = ["novel/source-memory/MEMORY.md", "novel/chapters"] as const;
  const STRUCTURED_KINDS = new Set(["character","alias","relation","event","timeline","world-rule","term","location","object","foreshadowing","adaptation-redline"]);

  function scanSources(projectRoot: string): ScannedFile[] {
    const files: ScannedFile[] = [];
    for (const rel of SOURCES) {
      const abs = path.join(projectRoot, rel);
      if (rel.endsWith(".md")) {
        const content = readIfExists(abs);
        if (content === null || !content.trim()) continue;
        const stat = fs.statSync(abs);
        files.push({ rel, sha256: sha256Of(content), size: stat.size, mtimeMs: stat.mtimeMs, content });
      } else {
        let names: string[] = [];
        try {
          names = fs.readdirSync(abs).filter((f) => f.endsWith(".md")).sort();
        } catch {
          continue;
        }
        for (const name of names) {
          const content = readIfExists(path.join(abs, name));
          if (content === null || !content.trim()) continue;
          const relFile = `${rel}/${name}`;
          const stat = fs.statSync(path.join(abs, name));
          files.push({ rel: relFile, sha256: sha256Of(content), size: stat.size, mtimeMs: stat.mtimeMs, content });
        }
      }
    }
    return files;
  }

  function computeBuildId(files: ScannedFile[]): string {
    return createHash("sha256")
      .update(files.map((f) => `${f.rel}:${f.sha256}`).join("\n"))
      .digest("hex")
      .slice(0, 12);
  }

  /** 读取上一 build 的结构化记录（事实层全文），供 unchanged 来源增量复用。 */
  function loadCarriedStructured(
    projectId: string,
    currentFiles: ScannedFile[],
  ): Array<SourceMemoryRecord & { body: string }> {
    const shaByPath = new Map(currentFiles.map((f) => [f.rel, f.sha256]));
    const active = readActiveSnapshot(projectId);
    let sourceRecords: Array<Partial<IndexRecord>> = [];
    if (active.success) {
      sourceRecords = readRecordsStrict(path.join(active.directory, "records.jsonl"), active.manifest);
    } else {
      if (fs.existsSync(activePath(projectId))) return [];
      const legacyManifest = readJsonIfExists<{
        sources?: Array<{ path?: unknown; sha256?: unknown }>;
      }>(legacyManifestPath(projectId));
      const legacyRows = readIfExists(legacyRecordsPath(projectId));
      const legacySources = new Map(
        (legacyManifest?.sources ?? [])
          .filter((source): source is { path: string; sha256: string } =>
            typeof source.path === "string" && typeof source.sha256 === "string")
          .map((source) => [source.path, source.sha256]),
      );
      const legacyMatches = [...shaByPath].every(([sourcePath, sha256]) => legacySources.get(sourcePath) === sha256);
      if (legacyRows && legacyMatches) {
        for (const line of legacyRows.split("\n")) {
          if (!line.trim()) continue;
          try {
            sourceRecords.push(JSON.parse(line) as Partial<IndexRecord>);
          } catch {
            return [];
          }
        }
      }
    }
    const now = new Date().toISOString();
    return sourceRecords.flatMap((parsed) => {
      if (
        !parsed.kind ||
        !STRUCTURED_KINDS.has(parsed.kind) ||
        typeof parsed.recordId !== "string" ||
        typeof parsed.title !== "string" ||
        typeof parsed.sourcePath !== "string" ||
        typeof parsed.sourceSha256 !== "string" ||
        shaByPath.get(parsed.sourcePath) !== parsed.sourceSha256 ||
        typeof parsed.anchor !== "string" ||
        typeof parsed.body !== "string" ||
        !parsed.body.trim()
      ) {
        return [];
      }
      return [{
        recordId: parsed.recordId,
        kind: parsed.kind,
        title: parsed.title,
        sourcePath: parsed.sourcePath,
        sourceSha256: parsed.sourceSha256,
        anchor: parsed.anchor,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : now,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
        freshness: "fresh" as const,
        chapterId: parsed.chapterId,
        entities: parsed.entities,
        confidence: parsed.confidence,
        extractorVersion: parsed.extractorVersion ?? EXTRACTOR_VERSION,
        body: parsed.body.trim(),
      }];
    });
  }

  /** raw 层记录：圣经/章节切块全文（投影可从源确定性重导）。 */
  function buildRawRecords(files: ScannedFile[], createdAt: string): IndexRecord[] {
    const records: IndexRecord[] = [];
    for (const file of files) {
      const isBible = !file.rel.startsWith("novel/chapters/");
      const kind = isBible ? "bible" : "chapter-chunk";
      const chapterId = isBible ? undefined : chapterIdOfChapterFile(file.rel);
      for (const [chunkOrdinal, chunk] of chunkMarkdown(file.content).entries()) {
        const anchor = `chunk-${chunkOrdinal + 1}:${chunk.title}`;
        records.push({
          recordId: `${kind}:${createHash("sha256")
            .update([file.rel, file.sha256, chunkOrdinal, anchor].join("|"))
            .digest("hex")
            .slice(0, 24)}`,
          kind,
          title: chunk.title,
          sourcePath: file.rel,
          sourceSha256: file.sha256,
          anchor,
          createdAt,
          updatedAt: createdAt,
          freshness: "fresh",
          extractorVersion: "raw-v1",
          chapterId,
          body: chunk.body,
        });
      }
    }
    return records;
  }

  /** changed 章节切块成抽取计划；圣经文件变化只影响 raw 层，不触发 AI 重抽。 */
  function buildPlanChunks(files: ScannedFile[], prevShaByPath: Map<string, string>): SourceMemoryExtractionChunk[] {
    const chunks: SourceMemoryExtractionChunk[] = [];
    for (const file of files) {
      if (!file.rel.startsWith("novel/chapters/")) continue;
      if (prevShaByPath.get(file.rel) === file.sha256) continue;
      for (const [chunkOrdinal, chunk] of chunkMarkdown(file.content).entries()) {
        chunks.push({
          sourcePath: file.rel,
          sourceSha256: file.sha256,
          chapterId: chapterIdOfChapterFile(file.rel),
          anchor: `chunk-${chunkOrdinal + 1}:${chunk.title}`,
          title: chunk.title,
          text: chunk.body,
        });
      }
    }
    return chunks;
  }

  function sameSourceSnapshot(left: ScannedFile[], right: ScannedFile[]): boolean {
    return left.length === right.length && left.every((source, index) => {
      const other = right[index];
      return other?.rel === source.rel && other.sha256 === source.sha256;
    });
  }

  return {
    STRUCTURED_KINDS, SOURCES,
    scanSources, computeBuildId, loadCarriedStructured, buildRawRecords,
    buildPlanChunks, sameSourceSnapshot,
  };
}
export type SourceMemoryBuild = ReturnType<typeof createSourceMemoryBuild>;
