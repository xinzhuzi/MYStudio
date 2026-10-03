#!/usr/bin/env python3
"""source-memory-service 专批:巨工厂三簇 ctx 化拆分(tts 范式)。

io 族[106,210] / 索引构建族[33,51]+[211,372] / 代际发布族[373,492];
门面留工厂签名+return-object+接线。体逐字保留,模块内解构同名注入。
幂等:从 git HEAD 重建。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps" / "frontend" / "electron" / "storage" / "source-memory-service.ts"

original = subprocess.run(["git", "show", "HEAD:apps/frontend/electron/storage/source-memory-service.ts"],
                          capture_output=True, text=True, cwd=REPO).stdout
lines = original.splitlines(keepends=True)
def seg(a, b): return "".join(lines[a - 1: b])

IO_CTX = ["getProjectRoot"]
INDEX_CTX = ["readJsonIfExists", "readIfExists", "activePath", "legacyManifestPath", "legacyRecordsPath", "readActiveSnapshot", "readRecordsStrict"]
GEN_CTX = ["memoryDir", "activePath", "generationsDir", "stagingDir", "backupsDir", "readJsonIfExists", "readIfExists", "generationDirectory", "readActiveSnapshot"]

def destructure(names, indent="  "):
    return indent + "const {\n" + "".join(f"{indent}  {n},\n" for n in names) + indent + "} = ctx;"

HEAD_IMPORTS = '''import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
'''

io_mod = '''/**
 * 源记忆服务 io 族——记忆目录路径族与读侧工具(存在性读/JSON 读/代际目录解析/
 * 活动快照/严格记录读取)。file-size-reduction 专批拆出,体逐字保留。
 */
''' + HEAD_IMPORTS + '''
export interface SourceMemoryIoCtx {
  getProjectRoot: (projectId: string) => string;
}

export function createSourceMemoryIo(ctx: SourceMemoryIoCtx) {
''' + destructure(IO_CTX) + '''

''' + seg(106, 210) + '''
  return {
    memoryDir, activePath, generationsDir, stagingDir, backupsDir,
    legacyManifestPath, legacyRecordsPath, readIfExists, readJsonIfExists,
    generationDirectory, readActiveSnapshot, readRecordsStrict,
  };
}
'''

index_mod = '''/**
 * 源记忆索引构建族——源扫描/buildId/结构化携带/raw 记录/抽取分块/快照等价判定。
 * file-size-reduction 专批拆出,体逐字保留;io 依赖经 ctx 注入。
 */
''' + HEAD_IMPORTS + '''
export interface SourceMemoryIndexCtx {
  readJsonIfExists: <T>(filePath: string) => T | null;
  readIfExists: (filePath: string) => string | null;
  activePath: (projectId: string) => string;
  legacyManifestPath: (projectId: string) => string;
  legacyRecordsPath: (projectId: string) => string;
  readActiveSnapshot: (projectId: string) => { success: boolean; directory?: string; manifest?: { sources?: unknown[] } } & Record<string, unknown>;
  readRecordsStrict: (filePath: string, manifest: unknown) => Array<Record<string, unknown>>;
}

export function createSourceMemoryBuild(ctx: SourceMemoryIndexCtx) {
''' + destructure(INDEX_CTX) + '''

''' + seg(33, 51) + "\n" + seg(211, 372) + '''
  return {
    STRUCTURED_KINDS, EXTRACTOR_VERSION, SOURCES, SCHEMA_VERSION, INDEX_VERSION,
    scanSources, computeBuildId, loadCarriedStructured, buildRawRecords,
    buildPlanChunks, sameSourceSnapshot,
  };
}
'''

gen_mod = '''/**
 * 源记忆代际发布族——可恢复产物清单/代际发布(暂存→原子切换→备份)/写者互斥/
 * 活动源新鲜度/索引健康判定。file-size-reduction 专批拆出,体逐字保留。
 */
''' + HEAD_IMPORTS + '''
export interface SourceMemoryGenCtx {
  memoryDir: (projectId: string) => string;
  activePath: (projectId: string) => string;
  generationsDir: (projectId: string) => string;
  stagingDir: (projectId: string) => string;
  backupsDir: (projectId: string) => string;
  readJsonIfExists: <T>(filePath: string) => T | null;
  readIfExists: (filePath: string) => string | null;
  generationDirectory: (projectId: string, generationPath: string) => string | null;
  readActiveSnapshot: (projectId: string) => Record<string, unknown>;
}

export function createSourceMemoryGenerations(ctx: SourceMemoryGenCtx) {
''' + destructure(GEN_CTX) + '''

''' + seg(373, 492) + '''
  return { listRecoverableArtifacts, publishGeneration, withWriter, activeSourcesFresh, indexHealthOf };
}
'''

for name, content in [("source-memory-io.ts", io_mod),
                      ("source-memory-build.ts", index_mod),
                      ("source-memory-generations.ts", gen_mod)]:
    (SRC.parent / name).write_text(content, encoding="utf-8")
    print(f"{name}: {len(content.splitlines())} 行")

WIRING = '''
  const ioApi = createSourceMemoryIo({ getProjectRoot });
  const {
    memoryDir, activePath, generationsDir, stagingDir, backupsDir,
    legacyManifestPath, legacyRecordsPath, readIfExists, readJsonIfExists,
    generationDirectory, readActiveSnapshot, readRecordsStrict,
  } = ioApi;
  const {
    STRUCTURED_KINDS, EXTRACTOR_VERSION, SOURCES, SCHEMA_VERSION, INDEX_VERSION,
    scanSources, computeBuildId, loadCarriedStructured, buildRawRecords,
    buildPlanChunks, sameSourceSnapshot,
  } = createSourceMemoryBuild(ioApi);
  const { listRecoverableArtifacts, publishGeneration, withWriter, activeSourcesFresh, indexHealthOf } =
    createSourceMemoryGenerations(ioApi);
'''

facade = seg(1, 105) + WIRING + seg(493, len(lines))
facade = facade.replace(
    'import path from "node:path";',
    'import path from "node:path";\nimport { createSourceMemoryIo } from "./source-memory-io";\nimport { createSourceMemoryBuild } from "./source-memory-build";\nimport { createSourceMemoryGenerations } from "./source-memory-generations";',
    1,
)
SRC.write_text(facade, encoding="utf-8")
print(f"门面 {len(facade.splitlines())} 行")
