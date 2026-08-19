/** 原著记忆库（source-memory）共享契约。
 *  L1：raw chunk（圣经/章节切块）入 FTS5 档案。
 *  L2：AI 结构化抽取——11 类带 provenance 的事实记录，经 stage→commit 增量入档。 */

/** L2 结构化抽取的 11 类记录（血统偏离一：类型化语料，非会话原文）。 */
export type SourceMemoryStructuredKind =
  | "character"
  | "alias"
  | "relation"
  | "event"
  | "timeline"
  | "world-rule"
  | "term"
  | "location"
  | "object"
  | "foreshadowing"
  | "adaptation-redline";

/** raw 层两类 + 结构化 11 类。 */
export type SourceMemoryRecordKind = "bible" | "chapter-chunk" | SourceMemoryStructuredKind;
export type SourceMemoryFreshness = "fresh";
export type SourceMemoryIndexHealth = "healthy" | "missing" | "corrupt" | "incompatible";

export interface SourceMemoryRecord {
  recordId: string;
  kind: SourceMemoryRecordKind;
  title: string;
  sourcePath: string;
  sourceSha256: string;
  anchor: string;
  createdAt: string;
  updatedAt: string;
  freshness: SourceMemoryFreshness;
  /** 章节文件名主干（chapter-001），raw 圣经块无此字段。 */
  chapterId?: string;
  /** 结构化记录涉及的实体名（人物/宗门/术语），供实体精确命中加权。 */
  entities?: string[];
  confidence?: number;
  extractorVersion?: string;
}

/** build 计划里的待抽取块：changed 来源切块后的完整描述。 */
export interface SourceMemoryExtractionChunk {
  sourcePath: string;
  sourceSha256: string;
  chapterId: string;
  anchor: string;
  title: string;
  text: string;
}

export interface SourceMemoryBuildPlan {
  buildId: string;
  /** changed/新增来源的切块（重抽对象）；unchanged 来源不在此列。 */
  chunks: SourceMemoryExtractionChunk[];
  changedSources: number;
  /** 从上一 build 复用的 unchanged 来源结构化记录数。 */
  carriedStructuredCount: number;
}

export interface SourceMemoryBuildReply {
  success: boolean;
  buildId?: string;
  recordCount?: number;
  /** changed 来源非空时返回——渲染进程据此发起 AI 抽取（stage→commit）。 */
  plan?: SourceMemoryBuildPlan;
  code?: "invalid-input" | "writer-busy" | "publication-failed";
  error?: string;
}

/** 渲染进程提交的待入档记录：内容字段来自 AI，provenance 来自 plan（主进程强校验）。 */
export interface SourceMemoryStagedRecord {
  kind: SourceMemoryStructuredKind;
  title: string;
  body: string;
  entities?: string[];
  confidence?: number;
  sourcePath: string;
  sourceSha256: string;
  chapterId: string;
  anchor: string;
}

export interface SourceMemoryStageRecordsReply {
  success: boolean;
  accepted?: number;
  rejected?: number;
  /** 逐条拒绝原因（截断到前 5 条），整批 schema 失败时 error 一条说明。 */
  errors?: string[];
  code?: "invalid-input" | "writer-busy" | "plan-stale";
  error?: string;
}

/** 每个计划块的抽取结果：ok=false 的块在 commit 后计入 partial。 */
export interface SourceMemoryChunkCoverage {
  sourcePath: string;
  anchor: string;
  ok: boolean;
}

export interface SourceMemoryCommitBuildReply {
  success: boolean;
  buildId?: string;
  status?: "ready" | "partial";
  structuredCount?: number;
  rawCount?: number;
  failedChunks?: number;
  code?: "invalid-input" | "writer-busy" | "plan-stale" | "sources-changed" | "publication-failed";
  error?: string;
}

export interface SourceMemorySearchHit {
  recordId: string;
  kind: string;
  title: string;
  sourcePath: string;
  sourceSha256: string;
  anchor: string;
  freshness: SourceMemoryFreshness;
  score: number;
  snippet: string;
  chapterId?: string;
}

export interface SourceMemorySearchReply {
  success: boolean;
  hits?: SourceMemorySearchHit[];
  buildId?: string;
  degradedReason?: string;
  indexHealth?: SourceMemoryIndexHealth;
  error?: string;
}

export interface SourceMemoryStatusReply {
  success: boolean;
  status?: "idle" | "ready" | "partial" | "stale" | "failed";
  buildId?: string;
  recordCount?: number;
  structuredCount?: number;
  rawCount?: number;
  builtAt?: string;
  sources?: Array<{ path: string; sha256: string; size: number; mtimeMs: number }>;
  indexHealth?: SourceMemoryIndexHealth;
  recoverableArtifacts?: string[];
  /** partial/failed 的可读原因（如 extraction-pending:2 / extraction-failed:1）。 */
  degradedReason?: string;
  error?: string;
}

export interface SourceMemoryRebuildIndexReply {
  success: boolean;
  buildId?: string;
  indexHealth?: SourceMemoryIndexHealth;
  backupPath?: string;
  code?: "invalid-input" | "writer-busy" | "active-missing" | "records-invalid" | "recovery-failed";
  error?: string;
}
