/** source-memory 服务：目录契约 + 构建（章节/圣经 → FTS5 档案）+ 增量抽取计划 + 检索 + 状态。
 *  L1 MVP：主进程直跑 node:sqlite（章节量小不阻塞），投影整体重建（原子替换）。
 *  L2 增量：build 对比 manifest SHA → changed 章节切块成 plan 随 reply 返回；
 *  渲染进程 AI 抽取后经 stage-records（staging 暂存，强校验 provenance）→
 *  commit-build（源未变才提升；部分失败=partial 不伪报）。MEMORY.md 永远只读。
 *  records.jsonl 是人可读事实层：raw 块存预览（可从源重导），结构化记录存全文（增量复用靠它）。 */
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
  SourceMemoryBuildPlan,
  SourceMemoryBuildReply,
  SourceMemoryCommitBuildReply,
  SourceMemoryExtractionChunk,
  SourceMemoryRecord,
  SourceMemorySearchReply,
  SourceMemoryStagedRecord,
  SourceMemoryStageRecordsReply,
  SourceMemoryStatusReply,
} from "../../types/source-memory";

const SOURCES = ["novel/source-memory/MEMORY.md", "novel/source-bible.md", "novel/chapters"] as const;

const STRUCTURED_KINDS = new Set([
  "character",
  "alias",
  "relation",
  "event",
  "timeline",
  "world-rule",
  "term",
  "location",
  "object",
  "foreshadowing",
  "adaptation-redline",
]);

interface ManifestFile {
  schemaVersion: number;
  buildId: string;
  sources: Array<{ path: string; sha256: string }>;
  recordCount: number;
  builtAt: string;
}

interface ScannedFile {
  rel: string;
  sha256: string;
  content: string;
}

function chapterIdOfChapterFile(relFile: string): string {
  return path.basename(relFile).replace(/\.md$/, "");
}

export function createSourceMemoryService({ getProjectRoot }: { getProjectRoot: (projectId: string) => string }) {
  const memoryDir = (projectId: string) => path.join(getProjectRoot(projectId), "novel", "source-memory");
  const dbPath = (projectId: string) => path.join(memoryDir(projectId), "index.sqlite");
  const statePath = (projectId: string) => path.join(memoryDir(projectId), "build-state.json");
  const manifestPath = (projectId: string) => path.join(memoryDir(projectId), "manifest.json");
  const recordsPath = (projectId: string) => path.join(memoryDir(projectId), "records.jsonl");
  const stagingDir = (projectId: string) => path.join(memoryDir(projectId), "staging");

  function readIfExists(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  function readJsonIfExists<T>(filePath: string): T | null {
    const raw = readIfExists(filePath);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** 扫描全部注册源：圣经两文件 + 章节目录。 */
  function scanSources(projectRoot: string): ScannedFile[] {
    const files: ScannedFile[] = [];
    for (const rel of SOURCES) {
      const abs = path.join(projectRoot, rel);
      if (rel.endsWith(".md")) {
        const content = readIfExists(abs);
        if (content === null || !content.trim()) continue;
        files.push({ rel, sha256: sha256Of(content), content });
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
          files.push({ rel: relFile, sha256: sha256Of(content), content });
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
    const rows = readIfExists(recordsPath(projectId));
    if (!rows) return [];
    const shaByPath = new Map(currentFiles.map((f) => [f.rel, f.sha256]));
    const carried: Array<SourceMemoryRecord & { body: string }> = [];
    for (const line of rows.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as SourceMemoryRecord & { body?: unknown };
        if (!STRUCTURED_KINDS.has(parsed.kind)) continue;
        // 源已变化/删除的旧结构化记录直接排除（stale 不入默认检索）
        if (shaByPath.get(parsed.sourcePath) !== parsed.sourceSha256) continue;
        if (typeof parsed.body !== "string" || !parsed.body.trim()) continue;
        carried.push({
          recordId: parsed.recordId,
          kind: parsed.kind,
          title: parsed.title,
          sourcePath: parsed.sourcePath,
          sourceSha256: parsed.sourceSha256,
          anchor: parsed.anchor,
          createdAt: parsed.createdAt,
          chapterId: parsed.chapterId,
          entities: parsed.entities,
          confidence: parsed.confidence,
          extractorVersion: parsed.extractorVersion,
          body: parsed.body.trim(),
        });
      } catch {
        // 坏行跳过，事实层坏行不阻断重建
      }
    }
    return carried;
  }

  /** raw 层记录：圣经/章节切块全文（投影可从源确定性重导）。 */
  function buildRawRecords(files: ScannedFile[], createdAt: string): IndexRecord[] {
    const records: IndexRecord[] = [];
    for (const file of files) {
      const isBible = !file.rel.startsWith("novel/chapters/");
      const kind = isBible ? "bible" : "chapter-chunk";
      const chapterId = isBible ? undefined : chapterIdOfChapterFile(file.rel);
      for (const chunk of chunkMarkdown(file.content)) {
        records.push({
          recordId: `${kind}:${file.rel}:${chunk.title}`.slice(0, 120),
          kind,
          title: chunk.title,
          sourcePath: file.rel,
          sourceSha256: file.sha256,
          anchor: chunk.title,
          createdAt,
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
      for (const chunk of chunkMarkdown(file.content)) {
        chunks.push({
          sourcePath: file.rel,
          sourceSha256: file.sha256,
          chapterId: chapterIdOfChapterFile(file.rel),
          anchor: chunk.title,
          title: chunk.title,
          text: chunk.body,
        });
      }
    }
    return chunks;
  }

  function writeProjection(
    projectId: string,
    files: ScannedFile[],
    raw: IndexRecord[],
    structured: SourceMemoryRecord[],
    structuredBodies: Map<string, string>,
  ): void {
    const dir = memoryDir(projectId);
    fs.mkdirSync(stagingDir(projectId), { recursive: true });
    const merged: IndexRecord[] = [
      ...raw,
      ...structured.map((r) => ({ ...r, body: structuredBodies.get(r.recordId) ?? r.title })),
    ];
    buildIndexSqlite(merged, path.join(dir, "staging", "index.sqlite"));
    fs.writeFileSync(
      recordsPath(projectId),
      merged
        .map((r) =>
          JSON.stringify(
            STRUCTURED_KINDS.has(r.kind)
              ? r // 结构化记录全文入事实层（增量复用依赖完整 body）
              : { ...r, body: r.body.slice(0, 200) }, // raw 块存预览，可从源重导
          ),
        )
        .join("\n") + "\n",
      "utf8",
    );
    fs.writeFileSync(
      manifestPath(projectId),
      JSON.stringify(
        {
          schemaVersion: 2,
          buildId: computeBuildId(files),
          sources: files.map((f) => ({ path: f.rel, sha256: f.sha256 })),
          recordCount: merged.length,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.renameSync(path.join(dir, "staging", "index.sqlite"), dbPath(projectId));
  }

  function writeState(
    projectId: string,
    state: {
      status: "ready" | "partial";
      buildId: string;
      recordCount: number;
      structuredCount: number;
      rawCount: number;
      degradedReason?: string;
    },
  ): void {
    fs.writeFileSync(statePath(projectId), JSON.stringify({ ...state, builtAt: new Date().toISOString() }), "utf8");
  }

  return {
    /** 全量扫源重建投影（raw + 复用的结构化记录），changed 章节以 plan 随 reply 返回。 */
    build(projectId: string): SourceMemoryBuildReply {
      try {
        const projectRoot = getProjectRoot(projectId);
        const files = scanSources(projectRoot);
        const manifest = readJsonIfExists<ManifestFile>(manifestPath(projectId));
        const prevShaByPath = new Map((manifest?.sources ?? []).map((s) => [s.path, s.sha256]));
        const createdAt = new Date().toISOString();
        const raw = buildRawRecords(files, createdAt);
        const carried = loadCarriedStructured(projectId, files);
        const structuredBodies = new Map<string, string>();
        const buildId = computeBuildId(files);
        writeProjection(projectId, files, raw, carried, structuredBodies);
        if (!readIfExists(path.join(memoryDir(projectId), "README.md"))) {
          fs.writeFileSync(
            path.join(memoryDir(projectId), "README.md"),
            "# 原著记忆库\n\nindex.sqlite 是可删除重建的检索投影；records.jsonl 是人可读事实层（结构化记录全文、raw 块预览）；MEMORY.md 是单一常驻层（用户维护，本系统只读）。重建=再次构建。\n",
            "utf8",
          );
        }
        const chunks = buildPlanChunks(files, prevShaByPath);
        const changedChapterFiles = new Set(chunks.map((c) => c.sourcePath)).size;
        writeState(projectId, {
          status: changedChapterFiles ? "partial" : "ready",
          buildId,
          recordCount: raw.length + carried.length,
          structuredCount: carried.length,
          rawCount: raw.length,
          ...(changedChapterFiles ? { degradedReason: `extraction-pending:${changedChapterFiles}` } : {}),
        });
        // plan 持久化到 staging，供 stage-records 校验 provenance、commit 核对覆盖
        fs.writeFileSync(
          path.join(stagingDir(projectId), `plan-${buildId}.json`),
          JSON.stringify({ buildId, chunks }),
          "utf8",
        );
        const plan: SourceMemoryBuildPlan = {
          buildId,
          chunks,
          changedSources: changedChapterFiles,
          carriedStructuredCount: carried.length,
        };
        return {
          success: true,
          buildId,
          recordCount: raw.length + carried.length,
          ...(chunks.length ? { plan } : {}),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    /** 渲染进程回传的 AI 抽取记录暂存：强校验 kind/来源/锚点后 append 进 staging。 */
    stageRecords(projectId: string, buildId: string, records: SourceMemoryStagedRecord[]): SourceMemoryStageRecordsReply {
      try {
        const manifest = readJsonIfExists<ManifestFile>(manifestPath(projectId));
        if (!manifest || manifest.buildId !== buildId) {
          return { success: false, error: "plan-stale：源已变化，请重新构建" };
        }
        const plan = readJsonIfExists<{ buildId: string; chunks: SourceMemoryExtractionChunk[] }>(
          path.join(stagingDir(projectId), `plan-${buildId}.json`),
        );
        if (!plan || plan.buildId !== buildId) {
          return { success: false, error: "plan-stale：构建计划缺失，请重新构建" };
        }
        const anchorsByPath = new Map<string, Set<string>>();
        const shaByPath = new Map<string, string>();
        for (const chunk of plan.chunks) {
          if (!anchorsByPath.has(chunk.sourcePath)) anchorsByPath.set(chunk.sourcePath, new Set());
          anchorsByPath.get(chunk.sourcePath)!.add(chunk.anchor);
          shaByPath.set(chunk.sourcePath, chunk.sourceSha256);
        }
        const accepted: string[] = [];
        const errors: string[] = [];
        let rejected = 0;
        for (const [index, record] of records.entries()) {
          const fail = (reason: string) => {
            rejected += 1;
            if (errors.length < 5) errors.push(`#${index} ${reason}`);
          };
          if (!record || typeof record !== "object") {
            fail("记录不是对象");
            continue;
          }
          if (!STRUCTURED_KINDS.has(record.kind)) {
            fail(`非法 kind：${String(record.kind)}`);
            continue;
          }
          const title = typeof record.title === "string" ? record.title.trim() : "";
          const body = typeof record.body === "string" ? record.body.trim() : "";
          if (!title || title.length > 60) {
            fail("title 缺失或超过 60 字符");
            continue;
          }
          if (!body || body.length > 300) {
            fail("body 缺失或超过 300 字符");
            continue;
          }
          if (shaByPath.get(record.sourcePath) !== record.sourceSha256) {
            fail(`来源 hash 与构建计划不符：${record.sourcePath}`);
            continue;
          }
          if (!anchorsByPath.get(record.sourcePath)?.has(record.anchor)) {
            fail(`锚点不在构建计划内：${record.anchor}`);
            continue;
          }
          if (!record.chapterId?.trim() || record.chapterId.length > 60) {
            fail("chapterId 缺失或超长");
            continue;
          }
          const entities = (Array.isArray(record.entities) ? record.entities : [])
            .map((e) => (typeof e === "string" ? e.trim() : ""))
            .filter(Boolean)
            .slice(0, 8);
          if (entities.some((e) => e.length > 40)) {
            fail("entities 存在超过 40 字符的项");
            continue;
          }
          const confidence =
            typeof record.confidence === "number" && record.confidence >= 0 && record.confidence <= 1
              ? record.confidence
              : undefined;
          // 稳定 id：projectId+源hash+锚点+kind+规范名 → 去重与确定性排序的依据
          const normalizedKey = title.toLowerCase().replace(/\s+/g, " ");
          const recordId = `structured:${record.kind}:${createHash("sha256")
            .update([projectId, record.sourceSha256, record.anchor, record.kind, normalizedKey].join("|"))
            .digest("hex")
            .slice(0, 16)}`;
          accepted.push(
            JSON.stringify({
              recordId,
              kind: record.kind,
              title,
              body,
              sourcePath: record.sourcePath,
              sourceSha256: record.sourceSha256,
              chapterId: record.chapterId,
              anchor: record.anchor,
              entities,
              ...(confidence !== undefined ? { confidence } : {}),
              createdAt: new Date().toISOString(),
            }),
          );
        }
        if (accepted.length) {
          fs.appendFileSync(
            path.join(stagingDir(projectId), `records-${buildId}.jsonl`),
            accepted.join("\n") + "\n",
            "utf8",
          );
        }
        return { success: true, accepted: accepted.length, rejected, ...(errors.length ? { errors } : {}) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    /** 提交：源未再变才合并 staged+carried+raw 原子提升；按 coverage 判 ready/partial。 */
    commitBuild(
      projectId: string,
      payload: { buildId: string; coverage?: Array<{ sourcePath: string; anchor: string; ok: boolean }> },
    ): SourceMemoryCommitBuildReply {
      try {
        const files = scanSources(getProjectRoot(projectId));
        const buildId = computeBuildId(files);
        if (buildId !== payload.buildId) {
          return { success: false, error: "sources-changed：构建期间正文已修改，请重新构建" };
        }
        const plan = readJsonIfExists<{ buildId: string; chunks: SourceMemoryExtractionChunk[] }>(
          path.join(stagingDir(projectId), `plan-${buildId}.json`),
        );
        const stagedRows = readIfExists(path.join(stagingDir(projectId), `records-${buildId}.jsonl`));
        const staged: Array<SourceMemoryRecord & { body: string }> = [];
        if (stagedRows) {
          for (const line of stagedRows.split("\n")) {
            if (!line.trim()) continue;
            try {
              staged.push(JSON.parse(line) as SourceMemoryRecord & { body: string });
            } catch {
              // 坏行丢弃
            }
          }
        }
        const createdAt = new Date().toISOString();
        const raw = buildRawRecords(files, createdAt);
        // 去重合并：recordId 相同（重复提交/重试）取后者
        const mergedById = new Map<string, SourceMemoryRecord & { body?: string }>();
        for (const record of loadCarriedStructured(projectId, files)) mergedById.set(record.recordId, record);        for (const record of staged) mergedById.set(record.recordId, record);
        const structured = [...mergedById.values()];
        const structuredBodies = new Map(
          structured.filter((r) => r.body).map((r) => [r.recordId, r.body as string]),
        );
        writeProjection(projectId, files, raw, structured, structuredBodies);
        // 覆盖核对：计划块中未被标记 ok 的都算失败（含完全没出现在 coverage 的）
        const okSet = new Set(
          (payload.coverage ?? []).filter((c) => c.ok).map((c) => `${c.sourcePath}#${c.anchor}`),
        );
        const failedChunks = (plan?.chunks ?? []).filter((c) => !okSet.has(`${c.sourcePath}#${c.anchor}`)).length;
        const status = failedChunks ? "partial" : "ready";
        writeState(projectId, {
          status,
          buildId,
          recordCount: raw.length + structured.length,
          structuredCount: structured.length,
          rawCount: raw.length,
          ...(failedChunks ? { degradedReason: `extraction-failed:${failedChunks}` } : {}),
        });
        for (const stale of [`plan-${buildId}.json`, `records-${buildId}.jsonl`]) {
          try {
            fs.rmSync(path.join(stagingDir(projectId), stale));
          } catch {
            // 缺失即跳过
          }
        }
        return {
          success: true,
          buildId,
          status,
          structuredCount: structured.length,
          rawCount: raw.length,
          ...(failedChunks ? { failedChunks } : {}),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    search(projectId: string, query: string, limit = 6): SourceMemorySearchReply {
      const hits = searchIndexSqlite(dbPath(projectId), query, limit);
      const manifest = readJsonIfExists<ManifestFile>(manifestPath(projectId));
      const buildId = manifest?.buildId;
      if (!hits.length) {
        return { success: true, hits: [], buildId, degradedReason: "empty" };
      }
      return { success: true, hits, buildId };
    },

    status(projectId: string): SourceMemoryStatusReply {
      const state = readJsonIfExists<{
        status?: string;
        buildId?: string;
        recordCount?: number;
        structuredCount?: number;
        rawCount?: number;
        builtAt?: string;
        degradedReason?: string;
      }>(statePath(projectId));
      if (!state) return { success: true, status: "idle" };
      const status =
        state.status === "ready" || state.status === "partial" ? state.status : "failed";
      return {
        success: true,
        status,
        buildId: state.buildId,
        recordCount: state.recordCount,
        structuredCount: state.structuredCount,
        rawCount: state.rawCount,
        builtAt: state.builtAt,
        ...(state.degradedReason ? { degradedReason: state.degradedReason } : {}),
      };
    },
  };
}
