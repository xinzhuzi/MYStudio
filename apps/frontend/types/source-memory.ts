/** 原著记忆库（source-memory）共享契约——L1 MVP：raw chunk + 圣经入 FTS5 档案。 */

export interface SourceMemoryRecord {
  recordId: string;
  kind: "bible" | "chapter-chunk";
  title: string;
  sourcePath: string;
  sourceSha256: string;
  anchor: string;
  createdAt: string;
}

export interface SourceMemoryBuildReply {
  success: boolean;
  buildId?: string;
  recordCount?: number;
  error?: string;
}

export interface SourceMemorySearchHit {
  recordId: string;
  kind: string;
  title: string;
  sourcePath: string;
  anchor: string;
  score: number;
  snippet: string;
}

export interface SourceMemorySearchReply {
  success: boolean;
  hits?: SourceMemorySearchHit[];
  buildId?: string;
  degradedReason?: string;
  error?: string;
}

export interface SourceMemoryStatusReply {
  success: boolean;
  status?: "idle" | "ready" | "failed";
  buildId?: string;
  recordCount?: number;
  builtAt?: string;
  error?: string;
}
