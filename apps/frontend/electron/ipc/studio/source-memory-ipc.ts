import { ipcMain } from "electron";
import { createSourceMemoryService } from "../../storage/source-memory-service";
import { resolveProjectRootPath } from "../../storage/storage-paths";
import type { SourceMemoryChunkCoverage, SourceMemoryStagedRecord } from "../../../types/source-memory";

type RegisterSourceMemoryIpcContext = { getDataDir: () => string };
type InvalidInputReply = { success: false; code: "invalid-input"; error: string };

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const BUILD_ID_PATTERN = /^[a-f0-9]{12}$/;
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

function invalidInput(message: string): InvalidInputReply {
  return { success: false, code: "invalid-input", error: message };
}

function decodeProjectId(value: unknown): string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) throw new Error("projectId 无效");
  return value;
}

function decodeBuildId(value: unknown): string {
  if (typeof value !== "string" || !BUILD_ID_PATTERN.test(value)) throw new Error("buildId 无效");
  return value;
}

function decodeBoundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field} 缺失或超长`);
  return normalized;
}

function decodeSourcePath(value: unknown): string {
  const sourcePath = decodeBoundedString(value, "sourcePath", 300);
  if (!/^novel\/chapters\/[a-zA-Z0-9._-]+\.md$/.test(sourcePath)) throw new Error("sourcePath 无效");
  return sourcePath;
}

function decodeStagedRecord(value: unknown): SourceMemoryStagedRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("record 必须是对象");
  const raw = value as Record<string, unknown>;
  const kind = decodeBoundedString(raw.kind, "kind", 40);
  if (!STRUCTURED_KINDS.has(kind)) throw new Error("kind 无效");
  const sourceSha256 = decodeBoundedString(raw.sourceSha256, "sourceSha256", 64);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("sourceSha256 无效");
  const chapterId = decodeBoundedString(raw.chapterId, "chapterId", 60);
  if (chapterId.includes("/") || chapterId.includes("\\")) throw new Error("chapterId 无效");
  let entities: string[] | undefined;
  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities) || raw.entities.length > 8) throw new Error("entities 无效");
    entities = raw.entities.map((entity) => decodeBoundedString(entity, "entity", 40));
  }
  let confidence: number | undefined;
  if (raw.confidence !== undefined) {
    if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
      throw new Error("confidence 无效");
    }
    confidence = raw.confidence;
  }
  return {
    kind: kind as SourceMemoryStagedRecord["kind"],
    title: decodeBoundedString(raw.title, "title", 60),
    body: decodeBoundedString(raw.body, "body", 300),
    sourcePath: decodeSourcePath(raw.sourcePath),
    sourceSha256,
    chapterId,
    anchor: decodeBoundedString(raw.anchor, "anchor", 160),
    ...(entities ? { entities } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function decodeCoverage(value: unknown): SourceMemoryChunkCoverage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("coverage 必须是对象");
  const raw = value as Record<string, unknown>;
  if (typeof raw.ok !== "boolean") throw new Error("coverage.ok 无效");
  return {
    sourcePath: decodeSourcePath(raw.sourcePath),
    anchor: decodeBoundedString(raw.anchor, "anchor", 160),
    ok: raw.ok,
  };
}

async function safeReply<T>(action: () => T | Promise<T>): Promise<T | InvalidInputReply> {
  try {
    return await action();
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : String(error));
  }
}

export function registerSourceMemoryIpcHandlers({ getDataDir }: RegisterSourceMemoryIpcContext) {
  const service = createSourceMemoryService({
    getProjectRoot: (projectId) => resolveProjectRootPath(getDataDir(), projectId),
  });

  ipcMain.handle("source-memory-build", (_event, projectId: unknown) =>
    safeReply(() => service.build(decodeProjectId(projectId))),
  );
  ipcMain.handle("source-memory-search", (_event, projectId: unknown, query: unknown, limit?: unknown) =>
    safeReply(() => {
      const decodedLimit = limit === undefined ? 6 : limit;
      if (typeof decodedLimit !== "number" || !Number.isInteger(decodedLimit) || decodedLimit < 1 || decodedLimit > 50) {
        throw new Error("limit 无效");
      }
      return service.search(decodeProjectId(projectId), decodeBoundedString(query, "query", 200), decodedLimit);
    }),
  );
  ipcMain.handle("source-memory-status", (_event, projectId: unknown) =>
    safeReply(() => service.status(decodeProjectId(projectId))),
  );
  ipcMain.handle("source-memory-stage-records", (_event, projectId: unknown, buildId: unknown, records: unknown) =>
    safeReply(() => {
      if (!Array.isArray(records) || records.length > 200) throw new Error("records 无效或超量");
      return service.stageRecords(decodeProjectId(projectId), decodeBuildId(buildId), records.map(decodeStagedRecord));
    }),
  );
  ipcMain.handle("source-memory-commit-build", (_event, projectId: unknown, payload: unknown) =>
    safeReply(() => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload 无效");
      const raw = payload as Record<string, unknown>;
      const coverageRaw = raw.coverage ?? [];
      if (!Array.isArray(coverageRaw) || coverageRaw.length > 1000) throw new Error("coverage 无效或超量");
      return service.commitBuild(decodeProjectId(projectId), {
        buildId: decodeBuildId(raw.buildId),
        coverage: coverageRaw.map(decodeCoverage),
      });
    }),
  );
  ipcMain.handle("source-memory-rebuild-index", (_event, projectId: unknown) =>
    safeReply(() => service.rebuildIndex(decodeProjectId(projectId))),
  );
}
