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
  inspectIndexSqlite,
  sha256Of,
  searchIndexSqlite,
  type IndexRecord,
} from "./source-memory-index";
import { prettyJson } from "./pretty-json";
import { withProjectDeletionLock } from "./project-mutex";
import type {
  SourceMemoryBuildPlan,
  SourceMemoryBuildReply,
  SourceMemoryCommitBuildReply,
  SourceMemoryExtractionChunk,
  SourceMemoryRecord,
  SourceMemoryRebuildIndexReply,
  SourceMemorySearchReply,
  SourceMemoryStagedRecord,
  SourceMemoryStageRecordsReply,
  SourceMemoryStatusReply,
} from "../../types/source-memory";

const SOURCES = ["novel/source-memory/MEMORY.md", "novel/chapters"] as const;
const SCHEMA_VERSION = 3;
const EXTRACTOR_VERSION = "source-memory-v3";
const INDEX_VERSION = 1;

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
  extractorVersion: string;
  indexVersion: number;
  buildId: string;
  sources: Array<{ path: string; sha256: string; size: number; mtimeMs: number }>;
  recordCount: number;
  recordsSha256: string;
  builtAt: string;
}

interface ScannedFile {
  rel: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  content: string;
}

interface ActiveGeneration {
  buildId: string;
  generationPath: string;
  manifestSha256: string;
  publishedAt: string;
}

interface BuildStateFile {
  status: "ready" | "partial";
  buildId: string;
  recordCount: number;
  structuredCount: number;
  rawCount: number;
  builtAt: string;
  degradedReason?: string;
}

type SourceMemoryFailpoint =
  | "after-index-build"
  | "before-generation-rename"
  | "after-generation-rename"
  | "before-pointer-rename";

function chapterIdOfChapterFile(relFile: string): string {
  return path.basename(relFile).replace(/\.md$/, "");
}

export function createSourceMemoryService({
  getProjectRoot,
  failpoint,
}: {
  getProjectRoot: (projectId: string) => string;
  failpoint?: (point: SourceMemoryFailpoint) => void | Promise<void>;
}) {
  const writers = new Set<string>();
  const memoryDir = (projectId: string) => path.join(getProjectRoot(projectId), "novel", "source-memory");
  const activePath = (projectId: string) => path.join(memoryDir(projectId), "active.json");
  const generationsDir = (projectId: string) => path.join(memoryDir(projectId), "generations");
  const stagingDir = (projectId: string) => path.join(memoryDir(projectId), "staging");
  const backupsDir = (projectId: string) => path.join(memoryDir(projectId), "backups", "recovery");
  const legacyManifestPath = (projectId: string) => path.join(memoryDir(projectId), "manifest.json");
  const legacyRecordsPath = (projectId: string) => path.join(memoryDir(projectId), "records.jsonl");

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

  function generationDirectory(projectId: string, generationPath: string): string | null {
    if (!/^generations\/[a-zA-Z0-9._-]+$/.test(generationPath)) return null;
    const root = path.resolve(generationsDir(projectId));
    const resolved = path.resolve(memoryDir(projectId), generationPath);
    return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
  }

  function readActiveSnapshot(projectId: string):
    | { success: true; active: ActiveGeneration; directory: string; manifest: ManifestFile; state: BuildStateFile }
    | { success: false; code: "active-missing" | "active-invalid" | "manifest-invalid"; error: string } {
    const active = readJsonIfExists<ActiveGeneration>(activePath(projectId));
    if (!active) return { success: false, code: "active-missing", error: "active generation missing" };
    const directory = generationDirectory(projectId, active.generationPath);
    if (!directory || !active.buildId || !/^[a-f0-9]{64}$/.test(active.manifestSha256 ?? "")) {
      return { success: false, code: "active-invalid", error: "active pointer invalid" };
    }
    const manifestRaw = readIfExists(path.join(directory, "manifest.json"));
    if (!manifestRaw || sha256Of(manifestRaw) !== active.manifestSha256) {
      return { success: false, code: "manifest-invalid", error: "active manifest checksum mismatch" };
    }
    let manifest: ManifestFile;
    try {
      manifest = JSON.parse(manifestRaw) as ManifestFile;
    } catch {
      return { success: false, code: "manifest-invalid", error: "active manifest JSON invalid" };
    }
    const state = readJsonIfExists<BuildStateFile>(path.join(directory, "build-state.json"));
    if (
      manifest.schemaVersion !== SCHEMA_VERSION ||
      manifest.extractorVersion !== EXTRACTOR_VERSION ||
      manifest.indexVersion !== INDEX_VERSION ||
      manifest.buildId !== active.buildId ||
      !Array.isArray(manifest.sources) ||
      !Number.isInteger(manifest.recordCount) ||
      !/^[a-f0-9]{64}$/.test(manifest.recordsSha256 ?? "") ||
      !state ||
      state.buildId !== active.buildId
    ) {
      return { success: false, code: "manifest-invalid", error: "active manifest contract invalid" };
    }
    return { success: true, active, directory, manifest, state };
  }

  function readRecordsStrict(filePath: string, manifest: ManifestFile): IndexRecord[] {
    const raw = readIfExists(filePath);
    if (raw === null || sha256Of(raw) !== manifest.recordsSha256) {
      throw new Error("records checksum mismatch");
    }
    const records: IndexRecord[] = [];
    const sourceShaByPath = new Map(manifest.sources.map((source) => [source.path, source.sha256]));
    const ids = new Set<string>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Partial<IndexRecord>;
      if (
        typeof parsed.recordId !== "string" ||
        ids.has(parsed.recordId) ||
        typeof parsed.kind !== "string" ||
        typeof parsed.title !== "string" ||
        typeof parsed.sourcePath !== "string" ||
        typeof parsed.sourceSha256 !== "string" ||
        sourceShaByPath.get(parsed.sourcePath) !== parsed.sourceSha256 ||
        typeof parsed.anchor !== "string" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.updatedAt !== "string" ||
        parsed.freshness !== "fresh" ||
        typeof parsed.extractorVersion !== "string" ||
        typeof parsed.body !== "string"
      ) {
        throw new Error("records JSONL contract invalid");
      }
      ids.add(parsed.recordId);
      records.push(parsed as IndexRecord);
    }
    if (records.length !== manifest.recordCount) throw new Error("records count mismatch");
    return records;
  }

  /** 扫描全部权威源：唯一常驻 MEMORY.md + 章节目录。 */
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

  function listRecoverableArtifacts(projectId: string): string[] {
    const dir = memoryDir(projectId);
    const artifacts: string[] = [];
    for (const relative of ["staging", "backups/recovery"]) {
      const absolute = path.join(dir, relative);
      try {
        for (const name of fs.readdirSync(absolute).sort()) artifacts.push(`${relative}/${name}`);
      } catch {
        // 目录尚不存在。
      }
    }
    return artifacts;
  }

  async function publishGeneration(
    projectId: string,
    files: ScannedFile[],
    raw: IndexRecord[],
    structured: SourceMemoryRecord[],
    structuredBodies: Map<string, string>,
    stateInput: Omit<BuildStateFile, "builtAt">,
  ): Promise<ActiveGeneration> {
    const dir = memoryDir(projectId);
    const buildId = computeBuildId(files);
    const builtAt = new Date().toISOString();
    const merged: IndexRecord[] = [
      ...raw,
      ...structured.map((r) => ({ ...r, body: structuredBodies.get(r.recordId) ?? r.title })),
    ];
    const recordsContent = merged.map((record) => JSON.stringify(record)).join("\n") + "\n";
    const recordsSha256 = sha256Of(recordsContent);
    const generationId = `${buildId}-${createHash("sha256")
      .update(`${recordsSha256}|${stateInput.status}|${builtAt}`)
      .digest("hex")
      .slice(0, 12)}`;
    const buildStagingDir = path.join(stagingDir(projectId), buildId);
    const tempGeneration = path.join(buildStagingDir, `generation.tmp-${generationId}`);
    const finalGeneration = path.join(generationsDir(projectId), generationId);
    fs.mkdirSync(tempGeneration, { recursive: true });
    fs.mkdirSync(generationsDir(projectId), { recursive: true });
    fs.writeFileSync(path.join(tempGeneration, "records.jsonl"), recordsContent, "utf8");
    const manifest: ManifestFile = {
      schemaVersion: SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      indexVersion: INDEX_VERSION,
      buildId,
      sources: files.map((source) => ({
        path: source.rel,
        sha256: source.sha256,
        size: source.size,
        mtimeMs: source.mtimeMs,
      })),
      recordCount: merged.length,
      recordsSha256,
      builtAt,
    };
    const manifestContent = prettyJson(manifest);
    fs.writeFileSync(path.join(tempGeneration, "manifest.json"), manifestContent, "utf8");
    fs.writeFileSync(path.join(tempGeneration, "build-state.json"), prettyJson({ ...stateInput, builtAt }), "utf8");
    buildIndexSqlite(merged, path.join(tempGeneration, "index.sqlite"), { buildId, indexVersion: INDEX_VERSION });
    await failpoint?.("after-index-build");

    readRecordsStrict(path.join(tempGeneration, "records.jsonl"), manifest);
    const inspected = inspectIndexSqlite(path.join(tempGeneration, "index.sqlite"), {
      buildId,
      indexVersion: INDEX_VERSION,
      recordCount: merged.length,
    });
    if (!inspected.success) throw new Error(`${inspected.code}: ${inspected.error}`);
    if (!sameSourceSnapshot(files, scanSources(getProjectRoot(projectId)))) {
      throw new Error("sources-changed：构建期间正文已修改，请重新构建");
    }

    await failpoint?.("before-generation-rename");
    fs.renameSync(tempGeneration, finalGeneration);
    await failpoint?.("after-generation-rename");
    const active: ActiveGeneration = {
      buildId,
      generationPath: `generations/${generationId}`,
      manifestSha256: sha256Of(manifestContent),
      publishedAt: new Date().toISOString(),
    };
    const activeTemp = path.join(dir, `active.json.tmp-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(activeTemp, prettyJson(active), "utf8");
    await failpoint?.("before-pointer-rename");
    fs.renameSync(activeTemp, activePath(projectId));
    return active;
  }

  async function withWriter<T extends { success: boolean; error?: string; code?: string }>(
    projectId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (writers.has(projectId)) {
      return { success: false, code: "writer-busy", error: "writer-busy：该项目正在构建记忆库" } as T;
    }
    writers.add(projectId);
    try {
      return await withProjectDeletionLock(projectId, action);
    } finally {
      writers.delete(projectId);
    }
  }

  function activeSourcesFresh(projectId: string, manifest: ManifestFile): boolean {
    const current = scanSources(getProjectRoot(projectId));
    if (current.length !== manifest.sources.length) return false;
    return current.every((source, index) => {
      const registered = manifest.sources[index];
      return registered?.path === source.rel && registered.sha256 === source.sha256;
    });
  }

  function indexHealthOf(code: string): "missing" | "corrupt" | "incompatible" {
    if (code === "index-open-failed") return "missing";
    if (code === "index-incompatible") return "incompatible";
    return "corrupt";
  }

  return {
    /** 全量扫源重建投影（raw + 复用的结构化记录），changed 章节以 plan 随 reply 返回。 */
    async build(projectId: string): Promise<SourceMemoryBuildReply> {
      return withWriter(projectId, async () => {
        try {
          const projectRoot = getProjectRoot(projectId);
          const files = scanSources(projectRoot);
          const buildId = computeBuildId(files);
          const active = readActiveSnapshot(projectId);
          if (active.success && active.manifest.buildId === buildId) {
            const canResumeExtraction =
              active.state.status === "partial" && active.state.degradedReason?.startsWith("extraction-pending:");
            const savedPlan = canResumeExtraction
              ? readJsonIfExists<SourceMemoryBuildPlan>(path.join(stagingDir(projectId), buildId, "plan.json"))
              : null;
            return {
              success: true,
              buildId,
              recordCount: active.manifest.recordCount,
              ...(savedPlan?.chunks.length ? { plan: savedPlan } : {}),
            };
          }
          const previousSources = active.success
            ? active.manifest.sources
            : readJsonIfExists<{ sources?: Array<{ path: string; sha256: string }> }>(legacyManifestPath(projectId))?.sources ?? [];
          const prevShaByPath = new Map(previousSources.map((source) => [source.path, source.sha256]));
          const createdAt = new Date().toISOString();
          const raw = buildRawRecords(files, createdAt);
          const carried = loadCarriedStructured(projectId, files);
          const structuredBodies = new Map(carried.map((record) => [record.recordId, record.body]));
          const chunks = buildPlanChunks(files, prevShaByPath);
          const changedChapterFiles = new Set(chunks.map((chunk) => chunk.sourcePath)).size;
          const plan: SourceMemoryBuildPlan = {
            buildId,
            chunks,
            changedSources: changedChapterFiles,
            carriedStructuredCount: carried.length,
          };
          const buildStagingDir = path.join(stagingDir(projectId), buildId);
          if (fs.existsSync(path.join(buildStagingDir, "plan.json"))) {
            return { success: false, code: "publication-failed", error: "staging-exists：构建计划已存在" };
          }
          fs.mkdirSync(buildStagingDir, { recursive: true });
          fs.writeFileSync(path.join(buildStagingDir, "plan.json"), prettyJson(plan), "utf8");
          await publishGeneration(projectId, files, raw, carried, structuredBodies, {
            status: changedChapterFiles ? "partial" : "ready",
            buildId,
            recordCount: raw.length + carried.length,
            structuredCount: carried.length,
            rawCount: raw.length,
            ...(changedChapterFiles ? { degradedReason: `extraction-pending:${changedChapterFiles}` } : {}),
          });
          if (!readIfExists(path.join(memoryDir(projectId), "README.md"))) {
            fs.writeFileSync(
              path.join(memoryDir(projectId), "README.md"),
              "# 原著记忆库\n\nMEMORY.md 是用户维护的唯一常驻事实源。active.json 原子指向 generations/ 下的不可变检索快照；staging、backups 和 legacy flat 文件均不会被自动删除。\n",
              "utf8",
            );
          }
          return {
            success: true,
            buildId,
            recordCount: raw.length + carried.length,
            ...(chunks.length ? { plan } : {}),
          };
        } catch (error) {
          return {
            success: false,
            code: "publication-failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },

    /** 渲染进程回传的 AI 抽取记录暂存：强校验 kind/来源/锚点后 append 进 staging。 */
    async stageRecords(
      projectId: string,
      buildId: string,
      records: SourceMemoryStagedRecord[],
    ): Promise<SourceMemoryStageRecordsReply> {
      return withWriter(projectId, async () => {
        try {
          const active = readActiveSnapshot(projectId);
          if (!active.success || active.manifest.buildId !== buildId) {
            return { success: false, code: "plan-stale", error: "plan-stale：源已变化，请重新构建" };
          }
          const plan = readJsonIfExists<SourceMemoryBuildPlan>(path.join(stagingDir(projectId), buildId, "plan.json"));
          if (!plan || plan.buildId !== buildId) {
            return { success: false, code: "plan-stale", error: "plan-stale：构建计划缺失，请重新构建" };
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
          const now = new Date().toISOString();
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
              createdAt: now,
              updatedAt: now,
              freshness: "fresh",
              extractorVersion: EXTRACTOR_VERSION,
            }),
          );
        }
        if (accepted.length) {
          fs.appendFileSync(
            path.join(stagingDir(projectId), buildId, "staged-records.jsonl"),
            accepted.join("\n") + "\n",
            "utf8",
          );
        }
          return { success: true, accepted: accepted.length, rejected, ...(errors.length ? { errors } : {}) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },

    /** 提交：源未再变才合并 staged+carried+raw 原子提升；按 coverage 判 ready/partial。 */
    async commitBuild(
      projectId: string,
      payload: { buildId: string; coverage?: Array<{ sourcePath: string; anchor: string; ok: boolean }> },
    ): Promise<SourceMemoryCommitBuildReply> {
      return withWriter(projectId, async () => {
        try {
          const files = scanSources(getProjectRoot(projectId));
          const buildId = computeBuildId(files);
          if (buildId !== payload.buildId) {
            return { success: false, code: "sources-changed", error: "sources-changed：构建期间正文已修改，请重新构建" };
          }
          const plan = readJsonIfExists<SourceMemoryBuildPlan>(path.join(stagingDir(projectId), buildId, "plan.json"));
          if (!plan || plan.buildId !== buildId) {
            return { success: false, code: "plan-stale", error: "plan-stale：构建计划缺失，请重新构建" };
          }
          const stagedRows = readIfExists(path.join(stagingDir(projectId), buildId, "staged-records.jsonl"));
          const staged: Array<SourceMemoryRecord & { body: string }> = [];
          if (stagedRows) {
            for (const line of stagedRows.split("\n")) {
              if (!line.trim()) continue;
              const record = JSON.parse(line) as SourceMemoryRecord & { body: string };
              if (
                !STRUCTURED_KINDS.has(record.kind) ||
                record.freshness !== "fresh" ||
                typeof record.updatedAt !== "string" ||
                typeof record.extractorVersion !== "string" ||
                typeof record.body !== "string"
              ) {
                throw new Error("staged records contract invalid");
              }
              staged.push(record);
            }
          }
          const createdAt = new Date().toISOString();
          const raw = buildRawRecords(files, createdAt);
          const mergedById = new Map<string, SourceMemoryRecord & { body?: string }>();
          for (const record of loadCarriedStructured(projectId, files)) mergedById.set(record.recordId, record);
          for (const record of staged) mergedById.set(record.recordId, record);
          const structured = [...mergedById.values()];
          const structuredBodies = new Map(
            structured.filter((record) => record.body).map((record) => [record.recordId, record.body as string]),
          );
          const okSet = new Set(
            (payload.coverage ?? []).filter((coverage) => coverage.ok).map((coverage) => `${coverage.sourcePath}#${coverage.anchor}`),
          );
          const failedChunks = plan.chunks.filter((chunk) => !okSet.has(`${chunk.sourcePath}#${chunk.anchor}`)).length;
          const status = failedChunks ? "partial" : "ready";
          await publishGeneration(projectId, files, raw, structured, structuredBodies, {
            status,
            buildId,
            recordCount: raw.length + structured.length,
            structuredCount: structured.length,
            rawCount: raw.length,
            ...(failedChunks ? { degradedReason: `extraction-failed:${failedChunks}` } : {}),
          });
          return {
            success: true,
            buildId,
            status,
            structuredCount: structured.length,
            rawCount: raw.length,
            ...(failedChunks ? { failedChunks } : {}),
          };
        } catch (error) {
          return {
            success: false,
            code: "publication-failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },

    search(projectId: string, query: string, limit = 6): SourceMemorySearchReply {
      const active = readActiveSnapshot(projectId);
      if (!active.success) {
        return {
          success: false,
          hits: [],
          degradedReason: active.code === "active-missing" ? "legacy-flat" : active.code,
          error: active.error,
        };
      }
      if (!activeSourcesFresh(projectId, active.manifest)) {
        return {
          success: false,
          hits: [],
          buildId: active.active.buildId,
          degradedReason: "sources-stale",
          error: "权威源已变化，请重新构建",
        };
      }
      try {
        readRecordsStrict(path.join(active.directory, "records.jsonl"), active.manifest);
      } catch (error) {
        return {
          success: false,
          hits: [],
          buildId: active.active.buildId,
          degradedReason: "records-invalid",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const result = searchIndexSqlite(path.join(active.directory, "index.sqlite"), query, limit, {
        buildId: active.active.buildId,
        indexVersion: active.manifest.indexVersion,
        recordCount: active.manifest.recordCount,
      });
      if (!result.success) {
        return {
          success: false,
          hits: [],
          buildId: active.active.buildId,
          degradedReason: result.code,
          indexHealth: indexHealthOf(result.code),
          error: result.error,
        };
      }
      if (!result.hits.length) {
        return { success: true, hits: [], buildId: active.active.buildId, degradedReason: "empty", indexHealth: "healthy" };
      }
      return { success: true, hits: result.hits, buildId: active.active.buildId, indexHealth: "healthy" };
    },

    status(projectId: string): SourceMemoryStatusReply {
      const active = readActiveSnapshot(projectId);
      const recoverableArtifacts = listRecoverableArtifacts(projectId);
      if (!active.success) {
        const hasLegacy = fs.existsSync(legacyManifestPath(projectId)) || fs.existsSync(legacyRecordsPath(projectId));
        if (active.code === "active-missing") {
          return {
            success: true,
            status: hasLegacy ? "partial" : "idle",
            ...(hasLegacy ? { degradedReason: "legacy-flat" } : {}),
            ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
          };
        }
        return {
          success: false,
          status: "failed",
          degradedReason: active.code,
          error: active.error,
          ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
        };
      }
      if (!activeSourcesFresh(projectId, active.manifest)) {
        return {
          success: true,
          status: "stale",
          buildId: active.active.buildId,
          recordCount: active.state.recordCount,
          structuredCount: active.state.structuredCount,
          rawCount: active.state.rawCount,
          builtAt: active.state.builtAt,
          sources: active.manifest.sources,
          degradedReason: "sources-stale",
          ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
        };
      }
      try {
        readRecordsStrict(path.join(active.directory, "records.jsonl"), active.manifest);
      } catch (error) {
        return {
          success: false,
          status: "failed",
          buildId: active.active.buildId,
          degradedReason: "records-invalid",
          error: error instanceof Error ? error.message : String(error),
          ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
        };
      }
      const inspected = inspectIndexSqlite(path.join(active.directory, "index.sqlite"), {
        buildId: active.active.buildId,
        indexVersion: active.manifest.indexVersion,
        recordCount: active.manifest.recordCount,
      });
      if (!inspected.success) {
        return {
          success: false,
          status: "failed",
          buildId: active.active.buildId,
          indexHealth: indexHealthOf(inspected.code),
          degradedReason: inspected.code,
          error: inspected.error,
          ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
        };
      }
      return {
        success: true,
        status: active.state.status,
        buildId: active.state.buildId,
        recordCount: active.state.recordCount,
        structuredCount: active.state.structuredCount,
        rawCount: active.state.rawCount,
        builtAt: active.state.builtAt,
        sources: active.manifest.sources,
        indexHealth: "healthy",
        ...(active.state.degradedReason ? { degradedReason: active.state.degradedReason } : {}),
        ...(recoverableArtifacts.length ? { recoverableArtifacts } : {}),
      };
    },

    async rebuildIndex(projectId: string): Promise<SourceMemoryRebuildIndexReply> {
      return withWriter(projectId, async () => {
        try {
          const active = readActiveSnapshot(projectId);
          if (!active.success) {
            return { success: false, code: "active-missing", error: active.error };
          }
          const records = readRecordsStrict(path.join(active.directory, "records.jsonl"), active.manifest);
          if (!activeSourcesFresh(projectId, active.manifest)) {
            return { success: false, code: "records-invalid", error: "sources-stale：权威源已变化" };
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const backupDirectory = path.join(backupsDir(projectId), `${timestamp}-${active.active.buildId}`);
          fs.mkdirSync(backupDirectory, { recursive: true });
          const damagedIndex = path.join(active.directory, "index.sqlite");
          if (fs.existsSync(damagedIndex)) fs.copyFileSync(damagedIndex, path.join(backupDirectory, "index.sqlite"));
          fs.writeFileSync(
            path.join(backupDirectory, "recovery.json"),
            prettyJson({ buildId: active.active.buildId, reason: "index-rebuild", recordedAt: new Date().toISOString() }),
            "utf8",
          );
          const raw = records.filter((record) => record.kind === "bible" || record.kind === "chapter-chunk");
          const structured = records.filter((record) => STRUCTURED_KINDS.has(record.kind));
          const structuredBodies = new Map(structured.map((record) => [record.recordId, record.body]));
          const currentFiles = scanSources(getProjectRoot(projectId));
          await publishGeneration(projectId, currentFiles, raw, structured, structuredBodies, {
            status: active.state.status,
            buildId: active.active.buildId,
            recordCount: records.length,
            structuredCount: active.state.structuredCount,
            rawCount: active.state.rawCount,
            ...(active.state.degradedReason ? { degradedReason: active.state.degradedReason } : {}),
          });
          return {
            success: true,
            buildId: active.active.buildId,
            indexHealth: "healthy",
            backupPath: path.relative(memoryDir(projectId), backupDirectory),
          };
        } catch (error) {
          return {
            success: false,
            code: "recovery-failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },
  };
}
