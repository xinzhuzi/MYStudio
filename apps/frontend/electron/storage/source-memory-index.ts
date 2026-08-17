/** source-memory FTS5 检索索引：CJK bigram + BM25，SQLite 仅是可重建投影。 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// vite 不解析 node:sqlite 静态导入,运行时经 createRequire 取(Electron/Node ≥23.4 均内置)
interface SqliteStatement {
  run(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
// vite 不解析 node:sqlite 静态导入且 @types/node 未声明,运行时经 createRequire 取并按本地接口使用
const { DatabaseSync: DatabaseSyncCtor } = createRequire(import.meta.url)("node:sqlite");
import type { SourceMemoryRecord, SourceMemorySearchHit } from "../../types/source-memory";

export function cjkBigramTokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const tokens: string[] = [];
  // Latin/数字词整体成 token；连续 CJK 切 bigram（单字段单独保留，保证单字查询可命中）
  const chunks = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
  let prev = "";
  for (const chunk of chunks) {
    if (chunk.length === 1 && /[\u4e00-\u9fff]/.test(chunk)) {
      if (prev) tokens.push(prev + chunk);
      tokens.push(chunk);
      prev = chunk;
    } else {
      tokens.push(chunk);
      prev = "";
    }
  }
  return tokens;
}

export function sha256Of(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function chunkMarkdown(markdown: string, maxChars = 1200): { title: string; body: string }[] {
  const sections = markdown.split(/\n(?=##\s)/g).filter((s) => s.trim());
  const out: { title: string; body: string }[] = [];
  for (const section of sections) {
    const first = section.split("\n", 1)[0] ?? "";
    const title = first.replace(/^#+\s*/, "").trim().slice(0, 60) || "未命名段";
    for (let i = 0; i < section.length; i += maxChars) {
      out.push({ title: i === 0 ? title : `${title}·续${Math.floor(i / maxChars) + 1}`, body: section.slice(i, i + maxChars) });
    }
  }
  return out.length ? out : markdown.trim() ? [{ title: "全文", body: markdown }] : [];
}

export interface IndexRecord extends SourceMemoryRecord {
  body: string;
}

export function buildIndexSqlite(records: IndexRecord[], dbPath: string): void {
  const db = new DatabaseSyncCtor(dbPath);
  try {
    db.exec("DROP TABLE IF EXISTS records");
    db.exec("DROP TABLE IF EXISTS records_fts");
    db.exec("CREATE TABLE records (recordId TEXT PRIMARY KEY, kind TEXT, title TEXT, sourcePath TEXT, anchor TEXT, sourceSha256 TEXT, createdAt TEXT, chapterId TEXT, entities TEXT, body TEXT)");
    db.exec("CREATE VIRTUAL TABLE records_fts USING fts5(recordId UNINDEXED, search_tokens, tokenize = 'unicode61')");
    const insert = db.prepare("INSERT INTO records (recordId, kind, title, sourcePath, anchor, sourceSha256, createdAt, chapterId, entities, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO records_fts (recordId, search_tokens) VALUES (?, ?)");
    for (const r of records) {
      insert.run(
        r.recordId,
        r.kind,
        r.title,
        r.sourcePath,
        r.anchor,
        r.sourceSha256,
        r.createdAt,
        r.chapterId ?? "",
        (r.entities ?? []).join("\n"),
        r.body,
      );
      insertFts.run(r.recordId, cjkBigramTokens(`${r.title}\n${r.body}\n${(r.entities ?? []).join("\n")}`).join(" "));
    }
  } finally {
    db.close();
  }
}

function fts5Quote(query: string): string {
  let uniq = [...new Set(cjkBigramTokens(query).map((t) => t.replace(/"/g, "")))];
  // 查询侧优先用 ≥2 字 token,避免单字(的/在/人)过度匹配;整查询为单字时才用单字
  const multi = uniq.filter((t) => t.length >= 2);
  if (multi.length) uniq = multi;
  return uniq.slice(0, 12).map((t) => `"${t}"`).join(" OR ");
}

export function searchIndexSqlite(dbPath: string, query: string, limit = 6): SourceMemorySearchHit[] {
  let db: DatabaseSync;
  try {
    db = new DatabaseSyncCtor(dbPath, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const tokens = cjkBigramTokens(query);
    if (!tokens.length) return [];
    // 实体加权：查询 token 与记录 entities 精确命中者在 BM25（负值，越小越优）上再减
    // 固定权重；同分按 recordId 排序保持确定性（血统偏离三：硬过滤×BM25×实体命中）。
    const entityBoost = new Map(tokens.map((t) => [t, true]));
    const stmt = db.prepare(
      `SELECT r.recordId, r.kind, r.title, r.sourcePath, r.anchor, r.chapterId, r.entities, r.body,
              bm25(records_fts) AS score
       FROM records_fts f JOIN records r ON r.recordId = f.recordId
       WHERE records_fts MATCH ?
       ORDER BY score LIMIT ?`,
    );
    const rows = stmt.all(fts5Quote(query), limit * 3) as Array<Record<string, unknown>>;
    return rows
      .map((row) => {
        const entities = String(row.entities ?? "")
          .split("\n")
          .map((e) => e.trim())
          .filter(Boolean);
        const entityHits = entities.filter((e) => entityBoost.has(e.toLowerCase())).length;
        return {
          recordId: String(row.recordId),
          kind: String(row.kind),
          title: String(row.title),
          sourcePath: String(row.sourcePath),
          anchor: String(row.anchor),
          score: (Number(row.score) || 0) - entityHits * 2,
          snippet: String(row.body ?? "").slice(0, 120),
          chapterId: String(row.chapterId ?? "") || undefined,
        };
      })
      .sort((a, b) => a.score - b.score || (a.recordId < b.recordId ? -1 : 1))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    db.close();
  }
}
