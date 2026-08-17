/** source-memory 服务：目录契约 + 构建（章节/圣经 → FTS5 档案）+ 检索 + 状态。L1 MVP：
 *  主进程直跑 node:sqlite（章节量小不阻塞；utilityProcess 推迟到 L1 后续切片），
 *  每次 build 全量重建投影（原子替换），records.jsonl 为人可读事实层。 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildIndexSqlite,
  chunkMarkdown,
  sha256Of,
  searchIndexSqlite,
  type IndexRecord,
} from "./source-memory-index";
import type {
  SourceMemoryBuildReply,
  SourceMemorySearchReply,
  SourceMemoryStatusReply,
} from "../../types/source-memory";

const SOURCES = ["novel/source-memory/MEMORY.md", "novel/source-bible.md", "novel/chapters"] as const;

export interface SourceMemoryServiceContext {
  getProjectRoot: (projectId: string) => string;
}

export function createSourceMemoryService({ getProjectRoot }: SourceMemoryServiceContext) {
  const memoryDir = (projectId: string) => path.join(getProjectRoot(projectId), "novel", "source-memory");
  const dbPath = (projectId: string) => path.join(memoryDir(projectId), "index.sqlite");
  const statePath = (projectId: string) => path.join(memoryDir(projectId), "build-state.json");

  function readIfExists(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  function collectRecords(projectRoot: string): { records: IndexRecord[]; sources: Array<{ path: string; sha256: string }> } {
    const createdAt = new Date().toISOString();
    const records: IndexRecord[] = [];
    const sources: Array<{ path: string; sha256: string }> = [];
    for (const rel of SOURCES) {
      const abs = path.join(projectRoot, rel);
      if (rel.endsWith(".md")) {
        const content = readIfExists(abs);
        if (content === null || !content.trim()) continue;
        const sha = sha256Of(content);
        sources.push({ path: rel, sha256: sha });
        const kind = rel.includes("MEMORY") || rel.includes("source-bible") ? "bible" : "chapter-chunk";
        for (const chunk of chunkMarkdown(content)) {
          records.push({
            recordId: `${kind}:${rel}:${chunk.title}`.slice(0, 120),
            kind,
            title: chunk.title,
            sourcePath: rel,
            sourceSha256: sha,
            anchor: chunk.title,
            createdAt,
            body: chunk.body,
          });
        }
      } else {
        let files: string[] = [];
        try {
          files = fs.readdirSync(abs).filter((f) => f.endsWith(".md")).sort();
        } catch {
          continue;
        }
        for (const file of files) {
          const content = readIfExists(path.join(abs, file));
          if (content === null || !content.trim()) continue;
          const relFile = `${rel}/${file}`;
          const sha = sha256Of(content);
          sources.push({ path: relFile, sha256: sha });
          for (const chunk of chunkMarkdown(content)) {
            records.push({
              recordId: `chapter-chunk:${relFile}:${chunk.title}`.slice(0, 120),
              kind: "chapter-chunk",
              title: chunk.title,
              sourcePath: relFile,
              sourceSha256: sha,
              anchor: chunk.title,
              createdAt,
              body: chunk.body,
            });
          }
        }
      }
    }
    return { records, sources };
  }

  return {
    build(projectId: string): SourceMemoryBuildReply {
      try {
        const projectRoot = getProjectRoot(projectId);
        const dir = memoryDir(projectId);
        fs.mkdirSync(path.join(dir, "staging"), { recursive: true });
        const { records, sources } = collectRecords(projectRoot);
        const buildId = createHash("sha256")
          .update(sources.map((s) => `${s.path}:${s.sha256}`).join("\n"))
          .digest("hex")
          .slice(0, 12);
        const stagingDb = path.join(dir, "staging", "index.sqlite");
        buildIndexSqlite(records, stagingDb);
        fs.writeFileSync(
          path.join(dir, "records.jsonl"),
          records.map((r) => JSON.stringify({ ...r, body: r.body.slice(0, 200) })).join("\n") + "\n",
          "utf8",
        );
        fs.writeFileSync(
          path.join(dir, "manifest.json"),
          JSON.stringify({ schemaVersion: 1, buildId, sources, recordCount: records.length, builtAt: new Date().toISOString() }, null, 2),
          "utf8",
        );
        // 原子提升：staging 库就位后 rename 替换 canonical
        fs.renameSync(stagingDb, dbPath(projectId));
        fs.writeFileSync(
          statePath(projectId),
          JSON.stringify({ status: "ready", buildId, recordCount: records.length, builtAt: new Date().toISOString() }),
          "utf8",
        );
        if (!readIfExists(path.join(dir, "README.md"))) {
          fs.writeFileSync(
            path.join(dir, "README.md"),
            "# 原著记忆库\n\nindex.sqlite 是可删除重建的检索投影；records.jsonl 是人可读事实层；MEMORY.md 是单一常驻层（用户维护）。重建=再次构建。\n",
            "utf8",
          );
        }
        return { success: true, buildId, recordCount: records.length };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    search(projectId: string, query: string, limit = 6): SourceMemorySearchReply {
      const hits = searchIndexSqlite(dbPath(projectId), query, limit);
      const manifest = readIfExists(path.join(memoryDir(projectId), "manifest.json"));
      const buildId = manifest ? (JSON.parse(manifest).buildId as string | undefined) : undefined;
      if (!hits.length) {
        return { success: true, hits: [], buildId, degradedReason: "empty" };
      }
      return { success: true, hits, buildId };
    },

    status(projectId: string): SourceMemoryStatusReply {
      const state = readIfExists(statePath(projectId));
      if (!state) return { success: true, status: "idle" };
      try {
        const parsed = JSON.parse(state) as { status?: string; buildId?: string; recordCount?: number; builtAt?: string };
        return {
          success: true,
          status: parsed.status === "ready" ? "ready" : "failed",
          buildId: parsed.buildId,
          recordCount: parsed.recordCount,
          builtAt: parsed.builtAt,
        };
      } catch {
        return { success: true, status: "failed" };
      }
    },
  };
}
