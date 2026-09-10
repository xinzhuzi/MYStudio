/**
 * tts-runtime 路径与配置族——存储根/TTS 目录族/legacy 目录族/config 读写/
 * 模型缓存目录/控制令牌。08-31 file-size-reduction 专批拆出,体逐字保留。
 */
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { TtsRuntimeControllerDeps, RuntimeConfig } from "./tts-runtime-shared";
import { normalizeUserPath } from "./tts-runtime-shared";
import { ttsModelCacheDir } from "@/electron/storage/model-dirs";

export type TtsRuntimePathsDeps = Pick<TtsRuntimeControllerDeps, "storageBasePath" | "huggingFaceHubDir" | "userDataPath">;
export interface TtsRuntimePathsIo {
  readTextFile: (filePath: string) => string | null;
  writeTextFile: (filePath: string, text: string) => void;
  ensureDir: (dirPath: string) => void;
  fileExists: (filePath: string) => boolean;
}

export type TtsRuntimePaths = ReturnType<typeof createTtsRuntimePaths>;

export function createTtsRuntimePaths(deps: TtsRuntimePathsDeps, io: TtsRuntimePathsIo) {
  const { readTextFile, writeTextFile, ensureDir, fileExists } = io;

  const storageBasePath = () => {
    if (typeof deps.storageBasePath === "function") return deps.storageBasePath();
    return deps.storageBasePath || deps.userDataPath;
  };
  const huggingFaceHubDir = () => {
    if (typeof deps.huggingFaceHubDir === "function") return deps.huggingFaceHubDir();
    return deps.huggingFaceHubDir || path.join(os.homedir(), ".cache", "huggingface", "hub");
  };
  const ttsRootDir = () => path.join(storageBasePath(), "TTS");
  const runtimeDataDir = () => path.join(ttsRootDir(), "runtime");
  const legacyRuntimeDir = path.join(deps.userDataPath, "tts-runtime");
  const legacyModelsDir = () => path.join(storageBasePath(), "tts-models");
  const legacyDefaultModelsDir = () => path.join(ttsRootDir(), "models");
  // 2026-08 前的默认模型缓存目录（<base>/TTS/model）；新布局统一收口到 <base>/model/<family>/
  const legacyCacheModelsDir = () => path.join(ttsRootDir(), "model");
  const runtimePythonDir = () => path.join(storageBasePath(), "python");
  const runtimeArchiveDir = () => storageBasePath();
  const configPath = () => path.join(runtimeDataDir(), "config.json");
  const defaultModelCacheDir = () => ttsModelCacheDir(storageBasePath());

  // 历代已退役的默认模型缓存目录(含 08-19 规范家 <base>/model/TTS,09-10 统一家迁
  // comfyui/models 后退役)。统一脚本只搬文件不碰 config,当年保存时固化进 config 的
  // 旧默认会压住新家变成死指针(09-10 实弹:设置页仍指旧家、探测落空)。
  const retiredModelCacheDirs = () => [
    path.join(storageBasePath(), "model", "TTS"),
    legacyModelsDir(),
    legacyDefaultModelsDir(),
    legacyCacheModelsDir(),
  ].map(normalizeUserPath);

  const readConfig = (): RuntimeConfig => {
    const raw = readTextFile(configPath());
    if (!raw) return {};
    try {
      return JSON.parse(raw) as RuntimeConfig;
    } catch {
      return {};
    }
  };

  const writeConfig = (config: RuntimeConfig) => {
    ensureDir(runtimeDataDir());
    writeTextFile(configPath(), JSON.stringify(config, null, 2));
  };

  const getModelCacheDir = () => {
    const config = readConfig();
    if (!config.modelCacheDir) return defaultModelCacheDir();
    const configured = normalizeUserPath(config.modelCacheDir);
    // 覆盖值恰为退役默认家且该目录已不存在 = 固化的旧默认而非用户自定义,作废回落新家;
    // 目录仍在(尚未跑统一脚本的机器)或真自定义路径一律原样保留(用户覆盖语义不变)。
    if (retiredModelCacheDirs().includes(configured) && !fileExists(configured)) {
      const next: RuntimeConfig = { ...config };
      delete next.modelCacheDir;
      writeConfig(next);
      return defaultModelCacheDir();
    }
    return configured;
  };

  const getControlToken = () => {
    const config = readConfig();
    if (config.controlToken) return config.controlToken;
    const controlToken = crypto.randomUUID();
    writeConfig({ ...config, controlToken });
    return controlToken;
  };

  const saveModelCacheDir = (dirPath: string) => {
    const modelCacheDir = dirPath.trim() ? normalizeUserPath(dirPath) : defaultModelCacheDir();
    ensureDir(runtimeDataDir());
    ensureDir(modelCacheDir);
    const config = readConfig();
    writeConfig({ ...config, modelCacheDir });
    return modelCacheDir;
  };

  return {
    storageBasePath, huggingFaceHubDir, ttsRootDir, runtimeDataDir, legacyRuntimeDir,
    legacyModelsDir, legacyDefaultModelsDir, legacyCacheModelsDir, runtimePythonDir,
    runtimeArchiveDir, configPath, defaultModelCacheDir, readConfig, writeConfig,
    getModelCacheDir, saveModelCacheDir, getControlToken,
  };
}
