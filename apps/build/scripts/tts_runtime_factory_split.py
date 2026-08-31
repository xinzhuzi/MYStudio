#!/usr/bin/env python3
"""tts-runtime 工厂专批:抽出 路径/迁移/Python 三簇 ctx 工厂模块。

体逐字保留;模块内解构同名注入依赖;门面解构同名→工厂其余体零改动。
幂等:从 git HEAD 重建。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps" / "frontend" / "electron" / "tts" / "tts-runtime.ts"
DIR = SRC.parent

original = subprocess.run(["git", "show", "HEAD:apps/frontend/electron/tts/tts-runtime.ts"],
                          capture_output=True, text=True, cwd=REPO).stdout
lines = original.splitlines(keepends=True)
def seg(a, b): return "".join(lines[a - 1: b])

paths_mod = '''/**
 * tts-runtime 路径与配置族——存储根/TTS 目录族/legacy 目录族/config 读写/
 * 模型缓存目录/控制令牌。08-31 file-size-reduction 专批拆出,体逐字保留。
 */
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { TtsRuntimeControllerDeps, RuntimeConfig } from "./tts-runtime-shared";
import { expandHome, normalizeUserPath } from "./tts-runtime-shared";
import { ttsModelCacheDir } from "@/electron/storage/model-dirs";

export type TtsRuntimePathsDeps = Pick<TtsRuntimeControllerDeps, "storageBasePath" | "huggingFaceHubDir" | "userDataPath">;
export interface TtsRuntimePathsIo {
  readTextFile: (filePath: string) => string | null;
  writeTextFile: (filePath: string, text: string) => void;
  ensureDir: (dirPath: string) => void;
}

export function createTtsRuntimePaths(deps: TtsRuntimePathsDeps, io: TtsRuntimePathsIo) {
  const { readTextFile, writeTextFile, ensureDir } = io;

''' + seg(58, 76) + "\n" + seg(84, 102) + "\n" + seg(256, 262) + "\n" + seg(264, 271) + '''
  return {
    storageBasePath, huggingFaceHubDir, ttsRootDir, runtimeDataDir, legacyRuntimeDir,
    legacyModelsDir, legacyDefaultModelsDir, legacyCacheModelsDir, runtimePythonDir,
    runtimeArchiveDir, configPath, defaultModelCacheDir, readConfig, writeConfig,
    getModelCacheDir, saveModelCacheDir, getControlToken,
  };
}
'''
(DIR / "tts-runtime-paths.ts").write_text(paths_mod, encoding="utf-8")

migration_mod = '''/**
 * tts-runtime 模型迁移族——生成音频池 GC/已知 repo 清单/仓库枚举/存储布局/
 * 迁移计划(逐项校验+重复去留)。08-31 file-size-reduction 专批拆出,体逐字保留。
 */
import fs from "node:fs";
import path from "node:path";
import type { TtsStorageLayout } from "@/types/tts";
import { TTS_AUDIO_POOL_MAX_AGE_MS, directoryIsCoveredBy, type ModelMigrationAction } from "./tts-runtime-shared";
import type { TtsRuntimePaths } from "./tts-runtime-paths";

export interface TtsRuntimeMigrationIo {
  fileExists: (filePath: string) => boolean;
}

export function createTtsRuntimeMigration(paths: TtsRuntimePaths, io: TtsRuntimeMigrationIo) {
  const { fileExists } = io;
  const { runtimeDataDir, ttsRootDir, defaultModelCacheDir, legacyRuntimeDir, legacyModelsDir, legacyDefaultModelsDir, legacyCacheModelsDir, huggingFaceHubDir } = paths;

''' + seg(104, 254) + '''
  return {
    cleanupAudioGenerationPool, KNOWN_TTS_REPO_IDS, repoDirNameToId, listModelRepositories,
    getModelRepositorySources, getStorageLayout, buildModelMigrationPlan,
  };
}

export type { TtsRuntimePaths };
'''
(DIR / "tts-runtime-migration.ts").write_text(migration_mod, encoding="utf-8")

python_body = seg(339, 559).replace("setupState.setupProgress", "currentSetupProgress()")
python_mod = '''/**
 * tts-runtime Python 运行时族——托管 Python 发现/校验/下载解压(HTTPS 源+
 * sha256 校验+tar 穿越防护)与依赖离线证明/安装(marker 哈希)。08-31
 * file-size-reduction 专批拆出,体逐字保留。
 */
import path from "node:path";
import crypto from "node:crypto";
import type { TtsRuntimeInstalledItem, TtsRuntimeStatus } from "@/types/tts";
import {
  type ModelMigrationAction,
  type RuntimeConfig,
  defaultPythonDownloadUrl,
  getErrorMessage,
  isRecord,
  isValidPythonRuntimeUrl,
  parseJsonString,
  sha256File,
} from "./tts-runtime-shared";
import type { TtsRuntimePaths } from "./tts-runtime-paths";

export interface TtsPythonIo {
  fileExists: (filePath: string) => boolean;
  ensureDir: (dirPath: string) => void;
  removeFile: (filePath: string) => void;
  writeBinaryFile: (filePath: string, data: Uint8Array) => void;
  renameFile: (from: string, to: string) => void;
  readTextFile: (filePath: string) => string | null;
  writeTextFile: (filePath: string, text: string) => void;
}
export interface TtsPythonExec {
  runPython: (command: string, args: string[], options?: unknown) => Promise<unknown>;
  fetchRuntimeArchive: (url: string, partialPath: string, onProgress: (progress: { progress: number }) => void) => Promise<{ ok: boolean; status: number; data?: ArrayBuffer | Uint8Array }>;
  extractArchive: (archivePath: string, destinationDir: string) => Promise<void>;
}
export interface TtsPythonHooks {
  updateSetupState: (next: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress">) => void;
  setInstalledItem: (item: TtsRuntimeInstalledItem) => void;
  currentSetupProgress: () => number | undefined;
}

export function createTtsRuntimePython(paths: TtsRuntimePaths, io: TtsPythonIo, exec: TtsPythonExec, hooks: TtsPythonHooks) {
  const { fileExists, ensureDir, removeFile, writeBinaryFile, renameFile, readTextFile, writeTextFile } = io;
  const { runPython, fetchRuntimeArchive, extractArchive } = exec;
  const { updateSetupState, setInstalledItem, currentSetupProgress } = hooks;
  const { runtimePythonDir, runtimeArchiveDir, runtimeDataDir, readConfig } = paths;

''' + python_body + '''
  return {
    managedPythonExecutablePath, getBundledPython, pythonDownloadUrl, findManagedPython,
    validateManagedPython, findReadyPython, ensurePython, getDepsPlan, depsAreReady,
    decodePipInstallReport, verifyDepsWithoutInstall, ensureDeps,
  };
}
'''
(DIR / "tts-runtime-python.ts").write_text(python_mod, encoding="utf-8")

# paths 模块的 TtsRuntimePaths 类型补丁(paths_mod 未定义,补进文件尾由 migration/python 引用)
paths_mod_fixed = paths_mod.replace(
    "export function createTtsRuntimePaths",
    "export type TtsRuntimePaths = ReturnType<typeof createTtsRuntimePaths>;\n\nexport function createTtsRuntimePaths",
)
(DIR / "tts-runtime-paths.ts").write_text(paths_mod_fixed, encoding="utf-8")

WIRING_A = '''
  const pathsApi = createTtsRuntimePaths(deps, { readTextFile, writeTextFile, ensureDir });
  const {
    storageBasePath, huggingFaceHubDir, ttsRootDir, runtimeDataDir, legacyRuntimeDir,
    legacyModelsDir, legacyDefaultModelsDir, legacyCacheModelsDir, runtimePythonDir,
    runtimeArchiveDir, configPath, defaultModelCacheDir, readConfig, writeConfig,
    getModelCacheDir, saveModelCacheDir, getControlToken,
  } = pathsApi;
  const {
    cleanupAudioGenerationPool, KNOWN_TTS_REPO_IDS, listModelRepositories,
    getModelRepositorySources, getStorageLayout, buildModelMigrationPlan,
  } = createTtsRuntimeMigration(pathsApi, { fileExists });
'''
WIRING_B = '''
  const {
    managedPythonExecutablePath, getBundledPython, findManagedPython, validateManagedPython,
    findReadyPython, ensurePython, getDepsPlan, depsAreReady, ensureDeps,
  } = createTtsRuntimePython(
    pathsApi,
    { fileExists, ensureDir, removeFile, writeBinaryFile, renameFile, readTextFile, writeTextFile },
    { runPython, fetchRuntimeArchive, extractArchive },
    { updateSetupState, setInstalledItem, currentSetupProgress: () => setupState.setupProgress },
  );
'''
facade = (
    seg(1, 57)
    + WIRING_A
    + seg(77, 83)
    + seg(272, 338)
    + WIRING_B
    + seg(560, len(lines))
)
facade = facade.replace(
    'import { captureSidecarOutput } from "../diagnostics/sidecar-log-capture";',
    'import { captureSidecarOutput } from "../diagnostics/sidecar-log-capture";\nimport { createTtsRuntimePaths } from "./tts-runtime-paths";\nimport { createTtsRuntimeMigration } from "./tts-runtime-migration";\nimport { createTtsRuntimePython } from "./tts-runtime-python";',
)
SRC.write_text(facade, encoding="utf-8")
print(f"paths/migration/python 三模块+门面装配完成: 门面 {len(facade.splitlines())} 行")
