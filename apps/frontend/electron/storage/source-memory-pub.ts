/**
 * 源记忆代际发布层。深网专批矩阵驱动。体逐字保留;io+build+共享态注入。
 */
import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { buildIndexSqlite, inspectIndexSqlite, sha256Of, type IndexRecord } from "./source-memory-index";
import type { SourceMemoryRecord } from "@/types/source-memory";
import type { ScannedFile, ManifestFile, ActiveGeneration, BuildStateFile } from "./source-memory-service";
import { prettyJson } from "./pretty-json";
import { withProjectDeletionLock } from "./project-mutex";
import { SCHEMA_VERSION, EXTRACTOR_VERSION, INDEX_VERSION } from "./source-memory-paths";
import type { SourceMemoryIo } from "./source-memory-paths";
import type { SourceMemoryBuild } from "./source-memory-build";

export function createSourceMemoryPub(io: SourceMemoryIo, build: SourceMemoryBuild, hooks: { failpoint?: (point: string) => void | Promise<void>; writers: Set<string>; getProjectRoot: (projectId: string) => string }) {
  const { getProjectRoot } = hooks;
  const { memoryDir, activePath, generationsDir, stagingDir, readRecordsStrict } = io;
  const { computeBuildId, sameSourceSnapshot, scanSources } = build;
  const { failpoint, writers } = hooks;

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

  return { listRecoverableArtifacts, publishGeneration, withWriter, activeSourcesFresh, indexHealthOf };
}
export type SourceMemoryPub = ReturnType<typeof createSourceMemoryPub>;
