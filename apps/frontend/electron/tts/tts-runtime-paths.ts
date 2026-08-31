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
}

export type TtsRuntimePaths = ReturnType<typeof createTtsRuntimePaths>;

export function createTtsRuntimePaths(deps: TtsRuntimePathsDeps, io: TtsRuntimePathsIo) {
  const { readTextFile, writeTextFile, ensureDir } = io;

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
    return config.modelCacheDir ? normalizeUserPath(config.modelCacheDir) : defaultModelCacheDir();
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
