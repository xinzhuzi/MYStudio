/**
 * 源记忆 io 层——记忆目录路径族与读侧工具。深网专批矩阵驱动。体逐字保留。
 */
import path from "node:path";
import fs from "node:fs";
import { sha256Of, type IndexRecord } from "./source-memory-index";
export const SOURCES = ["novel/source-memory/MEMORY.md", "novel/chapters"] as const;
export const SCHEMA_VERSION = 3;
export const EXTRACTOR_VERSION = "source-memory-v3";
export const INDEX_VERSION = 1;

export const STRUCTURED_KINDS = new Set([
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

import type { ManifestFile, ActiveGeneration, BuildStateFile } from "./source-memory-service";

export function createSourceMemoryPaths(deps: { getProjectRoot: (projectId: string) => string }) {
  const { getProjectRoot } = deps;




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

  return {
    memoryDir, activePath, generationsDir, stagingDir, backupsDir,
    legacyManifestPath, legacyRecordsPath, readIfExists, readJsonIfExists,
    generationDirectory, readActiveSnapshot, readRecordsStrict,
  };
}

export type SourceMemoryIo = ReturnType<typeof createSourceMemoryPaths>;
