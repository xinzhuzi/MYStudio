/**
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

  /** 生成草稿池 GC:<runtime>/audio 下 mtime 超过 30 天的产物在启动时清理。
   *  配音室「本地制作列表」仅引用新近条目(localStorage 截留 100 条),超龄失链可接受。 */
  const cleanupAudioGenerationPool = () => {
    const audioDir = path.join(runtimeDataDir(), "audio");
    try {
      if (!fs.existsSync(audioDir)) return;
      const cutoff = Date.now() - TTS_AUDIO_POOL_MAX_AGE_MS;
      for (const entry of fs.readdirSync(audioDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(audioDir, entry.name);
        try {
          if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
        } catch { /* 单文件清理失败忽略 */ }
      }
    } catch { /* 池清理失败不阻断启动 */ }
  };

  /** TTS 后端 catalog 中登记的模型 repo_id 及别名/对齐 tokenizer。
   *  迁移扫描时只匹配这些 repo，避免把全局 HF hub 里其他程序的模型误判为待迁移。 */
  const KNOWN_TTS_REPO_IDS: ReadonlySet<string> = new Set([
    // voiceClone
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "YatharthS/LuxTTS",
    "ResembleAI/chatterbox",
    "ResembleAI/chatterbox-turbo",
    "HumeAI/tada-1b",
    // presetVoice
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "hexgrad/Kokoro-82M",
    // longAudio
    "HumeAI/tada-3b-ml",
    // stt
    "mlx-community/SenseVoiceSmall",
    "mlx-community/whisper-large-v3-turbo",
    "mlx-community/whisper-small",
    // aliases (model_cache.py MODEL_REPO_ALIASES)
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    // alignment tokenizer (model_inventory.py)
    "openai/whisper-large-v3-turbo",
  ]);

  /** 将磁盘上的 `models--org--name` 目录名还原为 `org/name` 形式的 repo_id。 */
  const repoDirNameToId = (dirName: string): string => (
    dirName.replace(/^models--/, "").replace(/--/g, "/")
  );

  const listModelRepositories = (rootDir: string, filterKnownTts = false) => {
    if (!fileExists(rootDir)) return [];
    try {
      return fs.readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => (
          entry.isDirectory()
          && entry.name.startsWith("models--")
          && (!filterKnownTts || KNOWN_TTS_REPO_IDS.has(repoDirNameToId(entry.name)))
        ))
        .map((entry) => path.join(rootDir, entry.name))
        .sort();
    } catch {
      return [];
    }
  };

  const getModelRepositorySources = () => [
    ...listModelRepositories(huggingFaceHubDir(), true),
    ...listModelRepositories(legacyDefaultModelsDir()),
    ...listModelRepositories(legacyModelsDir()),
    ...listModelRepositories(legacyCacheModelsDir()),
  ];

  const getStorageLayout = (): TtsStorageLayout => {
    const runtimeDir = runtimeDataDir();
    const modelsDir = defaultModelCacheDir();
    const legacyRuntimeExists = fileExists(legacyRuntimeDir);
    const legacyModelsExists = fileExists(legacyModelsDir());
    const legacyDefaultModelsExists = fileExists(legacyDefaultModelsDir());
    const legacyCacheModelsExists = fileExists(legacyCacheModelsDir());
    const legacyHuggingFaceHubExists = fileExists(huggingFaceHubDir());
    const hasRuntimeConflict = legacyRuntimeExists && fileExists(runtimeDir);
    const hasModelRepositories = getModelRepositorySources().length > 0;
    const migrationState = hasRuntimeConflict
      ? "conflict"
      : legacyRuntimeExists || hasModelRepositories
        ? "ready"
        : "up-to-date";
    return {
      rootDir: ttsRootDir(),
      runtimeDir,
      modelsDir,
      legacyRuntimeDir,
      legacyModelsDir: legacyModelsDir(),
      legacyDefaultModelsDir: legacyDefaultModelsDir(),
      legacyCacheModelsDir: legacyCacheModelsDir(),
      legacyHuggingFaceHubDir: huggingFaceHubDir(),
      legacyRuntimeExists,
      legacyModelsExists,
      legacyDefaultModelsExists,
      legacyCacheModelsExists,
      legacyHuggingFaceHubExists,
      migrationState,
      migrationMessage: hasRuntimeConflict
        ? "旧版运行数据目录与新的 TTS/runtime 同时存在，已阻止自动迁移。"
        : legacyRuntimeExists || hasModelRepositories
          ? "检测到旧版或 Hugging Face 模型，迁移时会逐项校验后移动。"
          : undefined,
    };
  };

  const buildModelMigrationPlan = async (modelsDir: string): Promise<{
    actions: ModelMigrationAction[];
    conflicts: string[];
  }> => {
    const byName = new Map<string, string[]>();
    for (const sourceDir of getModelRepositorySources()) {
      const modelName = path.basename(sourceDir);
      const sources = byName.get(modelName) ?? [];
      sources.push(sourceDir);
      byName.set(modelName, sources);
    }

    const actions: ModelMigrationAction[] = [];
    const conflicts: string[] = [];
    for (const [modelName, sources] of byName) {
      const targetDir = path.join(modelsDir, modelName);
      if (fileExists(targetDir)) {
        for (const sourceDir of sources) {
          if (!await directoryIsCoveredBy(sourceDir, targetDir)) {
            conflicts.push(modelName);
            break;
          }
          actions.push({ kind: "remove", sourceDir });
        }
        continue;
      }

      const [primarySource, ...duplicateSources] = sources;
      if (!primarySource) continue;
      for (const sourceDir of duplicateSources) {
        if (!await directoryIsCoveredBy(sourceDir, primarySource)) {
          conflicts.push(modelName);
          break;
        }
      }
      if (conflicts.includes(modelName)) continue;
      actions.push({ kind: "move", sourceDir: primarySource, targetDir });
      actions.push(...duplicateSources.map((sourceDir) => ({ kind: "remove" as const, sourceDir })));
    }
    return { actions, conflicts };
  };

  return {
    cleanupAudioGenerationPool, KNOWN_TTS_REPO_IDS, repoDirNameToId, listModelRepositories,
    getModelRepositorySources, getStorageLayout, buildModelMigrationPlan,
  };
}

export type { TtsRuntimePaths };
