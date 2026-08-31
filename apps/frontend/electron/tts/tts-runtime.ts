import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { captureSidecarOutput } from "../diagnostics/sidecar-log-capture";
import { assertSafeTarMembers } from "./archive-safety";
import { getErrorMessage, isRecord, parseJsonString } from "./tts-runtime-utils";
import type { BackendModelStatus, TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeInstalledItem, TtsRuntimeStatus, TtsStorageLayout } from "@/types/tts";
import { ttsModelCacheDir } from "@/electron/storage/model-dirs";
import { ALIGNMENT_MODEL_NAME, BackendHealth, DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS, DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS, DEFAULT_TTS_HOST, DEFAULT_TTS_PORT, DEFAULT_TTS_REQUEST_TIMEOUT_MS, FetchJsonOptions, ModelMigrationAction, RuntimeConfig, SpawnedProcess, TTS_AUDIO_POOL_MAX_AGE_MS, TtsRuntimeController, TtsRuntimeControllerDeps, TtsRuntimeError, createTtsBackendHttpError, defaultFetchBytes, defaultFetchJson, defaultFetchRuntimeArchive, defaultFindListeningPids, defaultKillProcess, defaultPythonDownloadUrl, directoryIsCoveredBy, execFileAsync, expandHome, fetchWithTtsDeadline, isValidPythonRuntimeSha256, isValidPythonRuntimeUrl, makeStatus, normalizeRoutePath, normalizeUserPath, resolveHfHubCacheDir, sha256File, sidecarMainPath, uniquePaths, withTtsRequestContext } from "./tts-runtime-shared";

export function createTtsRuntimeController(deps: TtsRuntimeControllerDeps): TtsRuntimeController {
  const port = deps.port ?? DEFAULT_TTS_PORT;
  const host = deps.host ?? DEFAULT_TTS_HOST;
  const baseUrl = `http://${host}:${port}`;
  const fileExists = deps.fileExists ?? fs.existsSync;
  const ensureDir = deps.ensureDir ?? ((dirPath: string) => fs.mkdirSync(dirPath, { recursive: true }));
  const readTextFile = deps.readTextFile ?? ((filePath: string) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  });
  const writeTextFile = deps.writeTextFile ?? ((filePath: string, value: string) => fs.writeFileSync(filePath, value));
  const writeBinaryFile = deps.writeBinaryFile ?? ((filePath: string, value: Uint8Array) => fs.writeFileSync(filePath, value));
  const renameFile = deps.renameFile ?? ((from: string, to: string) => fs.renameSync(from, to));
  const removeFile = deps.removeFile ?? ((filePath: string) => fs.rmSync(filePath, { force: true }));
  const extractArchive = deps.extractArchive ?? (async (archivePath: string, destinationDir: string) => {
    // 解压网络归档前先校验成员,拒绝 ../、绝对路径等穿越写法(见 archive-safety.ts)。
    const listing = await execFileAsync("tar", ["-tzf", archivePath], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }) as { stdout?: string };
    assertSafeTarMembers((listing.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean));
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  });
  const runPython = deps.runPython ?? ((command: string, args: string[], options?: Parameters<typeof execFileAsync>[2]) => execFileAsync(command, args, options));
  const spawnProcess = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const fetchRuntimeArchive = deps.fetchRuntimeArchive ?? defaultFetchRuntimeArchive;
  const findListeningPids = deps.findListeningPids ?? defaultFindListeningPids;
  const killProcess = deps.killProcess ?? defaultKillProcess;
  const requestTimeoutMs = Number.isFinite(deps.requestTimeoutMs) && (deps.requestTimeoutMs ?? 0) > 0
    ? Math.max(1, Math.floor(deps.requestTimeoutMs ?? DEFAULT_TTS_REQUEST_TIMEOUT_MS))
    : DEFAULT_TTS_REQUEST_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const alignmentModelPollIntervalMs = Number.isFinite(deps.alignmentModelPollIntervalMs)
    ? Math.max(0, Math.floor(deps.alignmentModelPollIntervalMs ?? DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS))
    : DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS;
  const alignmentModelPollAttempts = Number.isFinite(deps.alignmentModelPollAttempts)
    ? Math.max(1, Math.floor(deps.alignmentModelPollAttempts ?? DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS))
    : DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS;
  const sidecarRoots = uniquePaths([
    ...(deps.sidecarRoots ?? []),
    path.join(deps.appRoot, "..", "backend"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "backend") : "",
  ]);
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
  let child: SpawnedProcess | null = null;
  let setupState: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress"> = {
    setupStage: "idle",
    setupMessage: undefined,
    setupProgress: undefined,
  };

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

  const isManagedPythonInstallItem = (item: TtsRuntimeInstalledItem) => {
    if (item.label !== "Python 运行环境") return true;
    if (!item.detail || !path.isAbsolute(item.detail)) return false;
    const normalizedDetail = path.resolve(expandHome(item.detail));
    const runtimeDir = path.resolve(expandHome(runtimePythonDir()));
    const pythonPath = path.resolve(managedPythonExecutablePath(runtimeDir));
    return normalizedDetail === runtimeDir || normalizedDetail === pythonPath;
  };

  const getRuntimeConfig = (): TtsRuntimeConfig => {
    const config = readConfig();
    const envUrl = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    return {
      pythonRuntimeUrl: config.pythonRuntimeUrl || envUrl || "",
      pythonRuntimeSha256: config.pythonRuntimeSha256 || undefined,
      defaultPythonRuntimeUrl: defaultPythonDownloadUrl() ?? undefined,
      pythonRuntimeDir: runtimePythonDir(),
      installedItems: (config.installedItems ?? []).filter(isManagedPythonInstallItem),
    };
  };

  const saveRuntimeConfig = (nextConfig: Partial<TtsRuntimeConfig>) => {
    const config = readConfig();
    const pythonRuntimeUrl = nextConfig.pythonRuntimeUrl?.trim();
    if (pythonRuntimeUrl && !isValidPythonRuntimeUrl(pythonRuntimeUrl)) {
      throw new TtsRuntimeError({
        code: "invalid-request",
        message: "Python 运行环境下载地址必须使用 HTTPS",
        retryable: false,
      });
    }
    const pythonRuntimeSha256 = nextConfig.pythonRuntimeSha256?.trim();
    if (pythonRuntimeSha256 && !isValidPythonRuntimeSha256(pythonRuntimeSha256)) {
      throw new TtsRuntimeError({
        code: "invalid-request",
        message: "Python 运行环境 sha256 必须是 64 位十六进制字符串",
        retryable: false,
      });
    }
    writeConfig({
      ...config,
      pythonRuntimeUrl: pythonRuntimeUrl || undefined,
      pythonRuntimeSha256: pythonRuntimeSha256 || undefined,
    });
  };

  const setInstalledItem = (item: TtsRuntimeInstalledItem) => {
    const config = readConfig();
    const existing = config.installedItems ?? [];
    const nextItems = [
      ...existing.filter((existingItem) => existingItem.label !== item.label),
      item,
    ];
    writeConfig({ ...config, installedItems: nextItems });
  };

  const updateSetupState = (next: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress">) => {
    setupState = {
      setupStage: next.setupStage,
      setupMessage: next.setupMessage,
      setupProgress: next.setupProgress,
    };
  };

  const resolveSidecarRoot = () => sidecarRoots.find((sidecarRoot) => fileExists(sidecarMainPath(sidecarRoot)));

  function managedPythonExecutablePath(runtimeDir: string) {
    return process.platform === "win32"
      ? path.join(runtimeDir, "python.exe")
      : path.join(runtimeDir, "bin", "python3");
  }

  function getBundledPython(sidecarRoot: string): string | null {
    const pythonPath = managedPythonExecutablePath(sidecarRoot);
    return fileExists(pythonPath) ? pythonPath : null;
  }

  function pythonDownloadUrl(): string | null {
    const config = readConfig();
    // 配置/环境变量下载源必须 HTTPS;非法值不落地执行,回退官方默认源。
    const configuredUrl = config.pythonRuntimeUrl?.trim();
    if (configuredUrl) {
      if (!isValidPythonRuntimeUrl(configuredUrl)) {
        console.warn("[TTS] pythonRuntimeUrl 非 HTTPS，已忽略并回退默认下载源:", configuredUrl.slice(0, 24));
        return defaultPythonDownloadUrl();
      }
      return configuredUrl;
    }
    const override = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    if (override) {
      if (!isValidPythonRuntimeUrl(override)) {
        console.warn("[TTS] MANYING_TTS_PYTHON_RUNTIME_URL 非 HTTPS，已忽略并回退默认下载源");
        return defaultPythonDownloadUrl();
      }
      return override;
    }
    return defaultPythonDownloadUrl();
  }

  function findManagedPython(): string | null {
    return getBundledPython(runtimePythonDir());
  }

  async function validateManagedPython(python: string): Promise<{ success: boolean; error?: string }> {
    try {
      const versionResult = await runPython(python, ["--version"], { timeout: 30_000, maxBuffer: 1024 * 1024 }) as {
        stdout?: string;
        stderr?: string;
      };
      const versionText = `${versionResult.stdout ?? ""}${versionResult.stderr ?? ""}`.trim();
      if (/Python\s+3\.12\./.test(versionText)) return { success: true };
      return { success: false, error: `当前 Python 运行环境不是 Python 3.12: ${versionText || python}` };
    } catch (error) {
      return { success: false, error: `Python 3.12 运行环境校验失败: ${getErrorMessage(error)}` };
    }
  }

  async function findReadyPython(): Promise<{ python?: string; error?: string }> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查 Python 运行环境", setupProgress: 0 });
    const managedPython = findManagedPython();
    if (managedPython) {
      const validation = await validateManagedPython(managedPython);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 0 });
        return { error: validation.error };
      }
      updateSetupState({
        setupStage: "checking",
        setupMessage: "已找到项目存储中的 Python 运行环境",
        setupProgress: 100,
      });
      return { python: managedPython };
    }
    updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境未配置", setupProgress: 0 });
    return { error: "请先到设置里的本地配置页的 Python 运行环境区块完成配置" };
  }

  async function ensurePython(): Promise<{ python?: string; error?: string }> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查 Python 3.12 运行环境", setupProgress: 0 });
    const managedPython = findManagedPython();
    if (managedPython) {
      const validation = await validateManagedPython(managedPython);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 0 });
        setInstalledItem({ label: "Python 运行环境", detail: managedPython, status: "failed" });
        return { error: validation.error };
      }
      setInstalledItem({
        label: "Python 运行环境",
        detail: managedPython,
        status: "skipped",
      });
      return { python: managedPython };
    }
    const runtimeDir = runtimePythonDir();
    const url = pythonDownloadUrl();
    if (!url) {
      updateSetupState({ setupStage: "failed", setupMessage: "当前平台不支持自动下载 Python", setupProgress: 0 });
      return { error: `不支持的平台: ${process.platform} ${process.arch}` };
    }
    const archiveDir = runtimeArchiveDir();
    const partialArchive = path.join(archiveDir, "python-runtime.tar.gz.partial");
    const archivePath = path.join(archiveDir, "python-runtime.tar.gz");
    try {
      ensureDir(archiveDir);
      updateSetupState({ setupStage: "downloading-python", setupMessage: "正在下载 Python 运行环境", setupProgress: 0 });
      const res = await fetchRuntimeArchive(url, partialArchive, (progress) => {
        updateSetupState({
          setupStage: "downloading-python",
          setupMessage: "正在下载 Python 运行环境",
          setupProgress: progress.progress,
        });
      });
      if (!res.ok || !res.data) {
        removeFile(partialArchive);
        updateSetupState({ setupStage: "failed", setupMessage: "Python 下载失败", setupProgress: setupState.setupProgress });
        return { error: `下载 Python 失败 (${res.status})` };
      }
      writeBinaryFile(partialArchive, res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data));
      renameFile(partialArchive, archivePath);
      const expectedSha256 = readConfig().pythonRuntimeSha256?.trim().toLowerCase();
      if (expectedSha256) {
        const actualSha256 = await sha256File(archivePath);
        if (actualSha256 !== expectedSha256) {
          removeFile(archivePath);
          updateSetupState({ setupStage: "failed", setupMessage: "Python 运行环境包完整性校验失败", setupProgress: 100 });
          setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
          return { error: `Python 运行环境包 sha256 校验失败(期望 ${expectedSha256.slice(0, 12)}…，实际 ${actualSha256.slice(0, 12)}…)` };
        }
      }
      updateSetupState({ setupStage: "extracting-python", setupMessage: "正在配置 Python 仓库", setupProgress: 100 });
      await extractArchive(archivePath, archiveDir);
      removeFile(archivePath);
      const py = getBundledPython(runtimeDir);
      if (!py) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 解压后未找到可执行文件", setupProgress: 100 });
        setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
        return { error: "Python 解压后未找到可执行文件" };
      }
      const validation = await validateManagedPython(py);
      if (!validation.success) {
        updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境校验失败", setupProgress: 100 });
        setInstalledItem({ label: "Python 运行环境", detail: py, status: "failed" });
        return { error: validation.error };
      }
      setInstalledItem({ label: "Python 运行环境", detail: py, status: "installed" });
      return { python: py };
    } catch (error) {
      removeFile(partialArchive);
      updateSetupState({ setupStage: "failed", setupMessage: "Python 下载失败", setupProgress: setupState.setupProgress });
      setInstalledItem({ label: "Python 运行环境", detail: runtimeDir, status: "failed" });
      return { error: `Python 下载失败: ${getErrorMessage(error)}` };
    }
  }

  function getDepsPlan(sidecarRoot: string, python: string): {
    reqPath?: string;
    markerPath?: string;
    reqHash?: string;
  } {
    const reqPath = path.join(sidecarRoot, "requirements.txt");
    if (!fileExists(reqPath)) return {};
    const markerPath = path.join(runtimeDataDir(), ".deps-hash");
    const reqContent = readTextFile(reqPath) ?? "";
    const reqHash = crypto.createHash("md5").update(`${python}\n${reqContent}`).digest("hex");
    return { reqPath, markerPath, reqHash };
  }

  function depsAreReady(sidecarRoot: string, python: string) {
    const depsPlan = getDepsPlan(sidecarRoot, python);
    if (!depsPlan.markerPath || !depsPlan.reqHash) return true;
    return readTextFile(depsPlan.markerPath)?.trim() === depsPlan.reqHash;
  }

  function decodePipInstallReport(value: unknown): { install: unknown[] } | null {
    if (!isRecord(value)) return null;
    const install = value.install;
    if (!Array.isArray(install)) return null;
    return { install };
  }

  /**
   * Offline dependency proof for stale/missing markers: pip runs with
   * `--dry-run` (mutates nothing) and `--no-index` (cannot contact any
   * package index); only a structured report whose `install` list is empty
   * counts as satisfied. Malformed output, pending installs, or command
   * failure all fail closed and route to the explicit setup action.
   */
  async function verifyDepsWithoutInstall(reqPath: string, python: string): Promise<boolean> {
    try {
      const result = await runPython(
        python,
        ["-m", "pip", "install", "--dry-run", "--no-index", "--report", "-", "--quiet", "-r", reqPath],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      ) as { stdout?: string };
      const report = decodePipInstallReport(parseJsonString(result.stdout));
      return report !== null && report.install.length === 0;
    } catch {
      return false;
    }
  }

  async function ensureDeps(sidecarRoot: string, python: string): Promise<{ success: boolean; error?: string }> {
    const { reqPath, markerPath, reqHash } = getDepsPlan(sidecarRoot, python);
    if (!reqPath || !markerPath || !reqHash) return { success: true };
    const installedHash = readTextFile(markerPath);
    if (installedHash?.trim() === reqHash) {
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "skipped" });
      return { success: true };
    }
    try {
      updateSetupState({ setupStage: "installing-deps", setupMessage: "正在安装 TTS 依赖", setupProgress: undefined });
      if (process.platform === "win32") {
        // PyPI 默认是 CPU 版 torch，Windows 需从 CUDA 专用 index 安装
        await runPython(python, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cu121"], { timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
      }
      await runPython(python, ["-m", "pip", "install", "-r", reqPath], { timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
      ensureDir(runtimeDataDir());
      writeTextFile(markerPath, reqHash);
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "installed" });
    } catch (error) {
      updateSetupState({ setupStage: "failed", setupMessage: "安装 TTS 依赖失败", setupProgress: undefined });
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "failed" });
      return { success: false, error: `安装依赖失败: ${getErrorMessage(error)}` };
    }
    return { success: true };
  }

  async function getBackendHealth(): Promise<BackendHealth> {
    try {
      const payload = await fetchJson(`${baseUrl}/health`, { method: "GET" });
      const service = typeof payload === "object" && payload && "service" in payload
        ? String((payload as { service?: unknown }).service)
        : undefined;
      return { healthy: true, service, error: undefined };
    } catch (error) {
      return { healthy: false, error: getErrorMessage(error) };
    }
  }

  async function isBackendHealthy() {
    return (await getBackendHealth()).healthy;
  }

  async function waitUntilHealthy() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  async function waitUntilStopped() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  async function status(): Promise<TtsRuntimeStatus> {
    const sidecarRoot = resolveSidecarRoot();
    const installed = sidecarRoot !== undefined;
    const pythonExecutablePath = findManagedPython();
    const pythonInstalled = pythonExecutablePath !== null;
    const dependenciesReady = sidecarRoot !== undefined && pythonExecutablePath !== null
      ? depsAreReady(sidecarRoot, pythonExecutablePath)
      : false;
    const health = await getBackendHealth();
    const running = health.healthy;
    return makeStatus({
      installed,
      sidecarAvailable: installed,
      pythonInstalled,
      pythonExecutablePath: pythonExecutablePath ?? undefined,
      dependenciesReady,
      running,
      port,
      baseUrl,
      setupStage: setupState.setupStage ?? "idle",
      setupMessage: setupState.setupMessage,
      setupProgress: setupState.setupProgress,
      cacheDir: runtimeDataDir(),
      modelCacheDir: getModelCacheDir(),
      defaultModelCacheDir: defaultModelCacheDir(),
      hfHubCacheDir: resolveHfHubCacheDir(getModelCacheDir(), fileExists),
      storageLayout: getStorageLayout(),
      pythonRuntimeDir: runtimePythonDir(),
      managed: child !== null,
      pid: child?.pid,
      error: !running && child ? `TTS 后端进程存在但 HTTP 不可达: ${health.error ?? baseUrl}` : undefined,
    });
  }

  async function requestBackendShutdown() {
    const controlToken = getControlToken();
    return fetchJson(`${baseUrl}/shutdown`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manying-TTS-Token": controlToken,
      },
      body: JSON.stringify({ token: controlToken }),
    });
  }

  async function stopStaleBackendProcess(health: BackendHealth) {
    if (health.service !== "manying-voicebox-tts") return false;
    const pids = await findListeningPids(port, host);
    if (pids.length === 0) return false;
    const killed = pids.some((pid) => killProcess(pid));
    if (!killed) return false;
    return waitUntilStopped();
  }

  async function start(): Promise<TtsRuntimeCommandResult> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查本地 TTS 后端", setupProgress: 0 });
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`,
      };
    }

    if (child) {
      if (await isBackendHealthy()) {
        updateSetupState({ setupStage: "ready", setupMessage: "本地 TTS 后端已就绪", setupProgress: 100 });
        return { success: true, status: await status() };
      }
      child.kill();
      child = null;
    }

    const existingHealth = await getBackendHealth();
    if (existingHealth.healthy) {
      const stopped = await stopStaleBackendProcess(existingHealth);
      if (!stopped) {
        updateSetupState({ setupStage: "failed", setupMessage: "本地 TTS 端口清理失败", setupProgress: 0 });
        return {
          success: false,
          status: await status(),
          error: "本地 TTS 端口已被本地 TTS 残留进程占用，自动清理失败",
        };
      }
    }

    const runtimeDir = runtimeDataDir();
    ensureDir(runtimeDir);
    cleanupAudioGenerationPool();
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    ensureDir(modelCacheDir);
    ensureDir(hfHubCacheDir);

    const pyResult = await findReadyPython();
    if (!pyResult.python) {
      console.warn("[TTS] start aborted: Python runtime not found —", pyResult.error);
      return { success: false, status: await status(), error: pyResult.error };
    }
    if (!depsAreReady(sidecarRoot, pyResult.python)) {
      const depsPlan = getDepsPlan(sidecarRoot, pyResult.python);
      let depsVerified = false;
      if (depsPlan.reqPath && depsPlan.markerPath && depsPlan.reqHash) {
        updateSetupState({ setupStage: "checking", setupMessage: "正在离线校验 TTS Python 依赖", setupProgress: undefined });
        depsVerified = await verifyDepsWithoutInstall(depsPlan.reqPath, pyResult.python);
        if (depsVerified) {
          ensureDir(runtimeDataDir());
          writeTextFile(depsPlan.markerPath, depsPlan.reqHash);
          console.warn("[TTS] healed stale dependency marker after offline dry-run proof:", depsPlan.markerPath);
        }
      }
      if (!depsVerified) {
        console.warn("[TTS] deps not ready — marker:", depsPlan.markerPath, "expected hash:", depsPlan.reqHash, "actual:", readTextFile(depsPlan.markerPath ?? "")?.trim() ?? "(missing)");
        updateSetupState({ setupStage: "failed", setupMessage: "TTS Python 依赖未配置", setupProgress: 0 });
        return {
          success: false,
          status: await status(),
          error: "请先到设置里的本地配置页的 Python 运行环境区块点击开始配置，完成 TTS 依赖安装",
        };
      }
    }
    const controlToken = getControlToken();
    const backendPython = pyResult.python;

    updateSetupState({ setupStage: "starting-backend", setupMessage: "本地 TTS 后端启动中", setupProgress: undefined });
    console.warn("[TTS] starting backend:", backendPython, "cwd:", sidecarRoot, "port:", port);
    child = spawnProcess(
      backendPython,
      [
        "-m",
        "tts.main",
        "--host",
        host,
        "--port",
        String(port),
        "--data-dir",
        runtimeDir,
      ],
      {
        cwd: sidecarRoot,
        env: {
          ...process.env,
          PYTHONPATH: sidecarRoot,
          MANYING_TTS_DATA_DIR: runtimeDir,
          MANYING_TTS_MODELS_DIR: modelCacheDir,
          VOICEBOX_MODELS_DIR: modelCacheDir,
          HF_HUB_CACHE: hfHubCacheDir,
          MANYING_TTS_CONTROL_TOKEN: controlToken,
        },
      },
    );
    // 默认 stdio=pipe 却无人监听:输出被丢且管道塞满会卡死后端——统一捕获进 logs/sidecars/。
    captureSidecarOutput({
      module: "tts-backend",
      // 真实 spawn 产物是完整 ChildProcess;SpawnedProcess 的 Pick 窄类型
      // 仅为测试注入声明,此处还原全型交给捕获器。
      child: child as ChildProcess,
      label: `${backendPython} -m tts.main --port ${port}`,
    });

    const healthy = await waitUntilHealthy();
    if (!healthy) {
      console.warn("[TTS] backend did not become healthy on", baseUrl, "— killing spawned process");
      child?.kill();
      child = null;
      updateSetupState({ setupStage: "failed", setupMessage: "本地 TTS 后端启动失败", setupProgress: undefined });
      return {
        success: false,
        status: await status(),
        error: `TTS backend did not become healthy on ${baseUrl}`,
      };
    }
    updateSetupState({ setupStage: "ready", setupMessage: "本地 TTS 后端已就绪", setupProgress: 100 });
    console.warn("[TTS] backend ready on", baseUrl);
    return { success: true, status: await status() };
  }

  async function setup(): Promise<TtsRuntimeCommandResult> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`,
      };
    }
    const pyResult = await ensurePython();
    if (!pyResult.python) {
      return { success: false, status: await status(), error: pyResult.error };
    }
    const depsResult = await ensureDeps(sidecarRoot, pyResult.python);
    if (!depsResult.success) {
      return { success: false, status: await status(), error: depsResult.error };
    }
    updateSetupState({ setupStage: "ready", setupMessage: "Python 运行环境已配置", setupProgress: 100 });
    return { success: true, status: await status() };
  }

  async function prepareAlignmentModel(): Promise<TtsRuntimeCommandResult> {
    const setupResult = await setup();
    if (!setupResult.success) return setupResult;

    const startResult = await start();
    if (!startResult.success) return startResult;

    type ModelStatusPayload = {
      models?: Array<{ model_name?: unknown; downloaded?: unknown; downloading?: unknown }>;
    };
    type ProgressPayload = { status?: unknown; error?: unknown };

    const readModelStatus = async () => {
      const payload = await request("GET", "/models/status") as ModelStatusPayload;
      const model = Array.isArray(payload.models)
        ? payload.models.find((item) => item?.model_name === ALIGNMENT_MODEL_NAME)
        : undefined;
      if (!model) throw new Error(`TTS 后端未提供 ${ALIGNMENT_MODEL_NAME} 模型`);
      return model;
    };

    try {
      const current = await readModelStatus();
      if (current.downloaded === true) {
        updateSetupState({ setupStage: "ready", setupMessage: "Whisper 对齐模型已就绪", setupProgress: 100 });
        return { success: true, status: await status() };
      }
      if (current.downloading !== true) {
        await request("POST", "/models/download", { model_name: ALIGNMENT_MODEL_NAME });
      }

      for (let attempt = 0; attempt < alignmentModelPollAttempts; attempt += 1) {
        updateSetupState({
          setupStage: "downloading-model",
          setupMessage: "正在准备 Whisper 原文对齐模型",
          setupProgress: undefined,
        });
        const progress = await request("GET", `/models/progress-json/${encodeURIComponent(ALIGNMENT_MODEL_NAME)}`) as ProgressPayload;
        if (progress.status === "error") {
          const detail = typeof progress.error === "string" && progress.error.trim() ? `: ${progress.error}` : "";
          updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型下载失败", setupProgress: undefined });
          return { success: false, status: await status(), error: `Whisper 对齐模型下载失败${detail}` };
        }
        const next = await readModelStatus();
        if (next.downloaded === true) {
          updateSetupState({ setupStage: "ready", setupMessage: "Whisper 对齐模型已就绪", setupProgress: 100 });
          return { success: true, status: await status() };
        }
        await sleep(alignmentModelPollIntervalMs);
      }
      updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型下载超时", setupProgress: undefined });
      return { success: false, status: await status(), error: "Whisper 对齐模型下载超时，请检查网络后重试" };
    } catch (error) {
      updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型准备失败", setupProgress: undefined });
      return { success: false, status: await status(), error: `Whisper 对齐模型准备失败: ${getErrorMessage(error)}` };
    }
  }

  async function setModelCacheDir(dirPath: string): Promise<TtsRuntimeCommandResult> {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再切换模型缓存路径",
      };
    }
    saveModelCacheDir(dirPath);
    return { success: true, status: await status() };
  }

  async function getConfig(): Promise<TtsRuntimeConfig> {
    return getRuntimeConfig();
  }

  async function setConfig(config: Partial<TtsRuntimeConfig>): Promise<TtsRuntimeCommandResult> {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再修改 Python 运行环境配置",
      };
    }
    try {
      saveRuntimeConfig(config);
    } catch (error) {
      return { success: false, status: await status(), error: getErrorMessage(error) };
    }
    return { success: true, status: await status() };
  }

  async function stop(): Promise<TtsRuntimeCommandResult> {
    if (child) {
      child.kill();
      child = null;
      const stopped = await waitUntilStopped();
      if (!stopped) {
        return {
          success: false,
          status: await status(),
          error: "TTS 后端未能在预期时间内停止",
        };
      }
      return { success: true, status: await status() };
    }
    const health = await getBackendHealth();
    if (health.healthy) {
      try {
        await requestBackendShutdown();
        const stopped = await waitUntilStopped();
        if (stopped) return { success: true, status: await status() };
        const staleStopped = await stopStaleBackendProcess(health);
        if (staleStopped) return { success: true, status: await status() };
        return {
          success: false,
          status: await status(),
          error: "已发送停止请求，但本地 TTS 后端仍在运行",
        };
      } catch (error) {
        const staleStopped = await stopStaleBackendProcess(health);
        if (staleStopped) return { success: true, status: await status() };
        return {
          success: false,
          status: await status(),
          error: `检测到本地 TTS 残留进程，但自动清理失败；请关闭对应 Python 进程后再刷新。原始错误：${getErrorMessage(error)}`,
        };
      }
    }
    return { success: true, status: await status() };
  }

  function buildRequestOptions(method: string, body?: unknown): FetchJsonOptions {
    const hasBody = body !== undefined && method.toUpperCase() !== "GET";
    const headers: Record<string, string> = {
      "X-Manying-TTS-Token": getControlToken(),
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    };
  }

  async function request(method: string, routePath: string, body?: unknown) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchWithTtsDeadline(requestTimeoutMs, (signal) => (
        fetchJson(requestUrl, { ...buildRequestOptions(method, body), signal })
      ));
    } catch (error) {
      throw withTtsRequestContext(error, method, requestUrl);
    }
  }

  async function requestBytes(method: string, routePath: string, body?: unknown) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchWithTtsDeadline(requestTimeoutMs, (signal) => (
        fetchBytes(requestUrl, { ...buildRequestOptions(method, body), signal })
      ));
    } catch (error) {
      throw withTtsRequestContext(error, method, requestUrl);
    }
  }

  /** Upload audio file as FormData (for voice sample upload). */
  async function requestFormData(routePath: string, audioFilePath: string, referenceText?: string) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      // Read file from disk
      const fileBuffer = fs.readFileSync(audioFilePath);
      const fileName = routePath.split("/").pop() ?? "audio.wav";
      // Build multipart form-data manually
      const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
      const parts: Buffer[] = [];

      // file part
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ));
      parts.push(fileBuffer);
      parts.push(Buffer.from("\r\n"));

      // reference_text part
      if (referenceText) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="reference_text"\r\n\r\n${referenceText}\r\n`,
        ));
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const response = await fetchWithTtsDeadline(requestTimeoutMs, (signal) => fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Manying-TTS-Token": getControlToken(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.concat(parts),
        signal,
      }));

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw createTtsBackendHttpError(text, response.status);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return response.json();
      }
      return response.text();
    } catch (error) {
      throw withTtsRequestContext(error, "POST", requestUrl);
    }
  }

  async function readRequirements(): Promise<{ content: string; path: string } | null> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) return null;
    // Always read the currently active sidecar copy; persisted installed-item
    // paths are display history and may point at a previous installation.
    const reqPath = path.join(sidecarRoot, "requirements.txt");
    const content = readTextFile(reqPath);
    if (content === null) return null;
    return { content, path: reqPath };
  }

  async function migrateStorage(): Promise<TtsRuntimeCommandResult> {
    const layout = getStorageLayout();
    if (layout.migrationState === "conflict") {
      return {
        success: false,
        status: await status(),
        error: layout.migrationMessage ?? "新的 TTS 文件夹已存在，无法安全迁移旧数据",
      };
    }
    if (layout.migrationState === "up-to-date") {
      return { success: true, status: await status() };
    }

    const stopResult = await stop();
    if (!stopResult.success) {
      return { success: false, status: await status(), error: stopResult.error ?? "停止 TTS 后端失败" };
    }

    try {
      const modelPlan = await buildModelMigrationPlan(layout.modelsDir);
      if (modelPlan.conflicts.length > 0) {
        return {
          success: false,
          status: await status(),
          error: `以下模型目录内容不一致，未迁移：${modelPlan.conflicts.join("、")}`,
        };
      }

      ensureDir(layout.rootDir);
      if (layout.legacyRuntimeExists) renameFile(layout.legacyRuntimeDir, layout.runtimeDir);
      ensureDir(layout.modelsDir);
      for (const action of modelPlan.actions) {
        if (action.kind === "move") {
          renameFile(action.sourceDir, action.targetDir);
        } else {
          fs.rmSync(action.sourceDir, { recursive: true, force: true });
        }
      }

      const config = readConfig();
      const legacyModelPaths = [layout.legacyModelsDir, layout.legacyDefaultModelsDir, layout.legacyCacheModelsDir];
      const configuredModelCacheDir = config.modelCacheDir;
      const usesLegacyOrUnsetModelDir = !configuredModelCacheDir || legacyModelPaths.some((legacyPath) => (
        normalizeUserPath(configuredModelCacheDir) === normalizeUserPath(legacyPath)
      ));
      if (usesLegacyOrUnsetModelDir) {
        writeConfig({ ...config, modelCacheDir: layout.modelsDir });
      }
      return { success: true, status: await status() };
    } catch (error) {
      return { success: false, status: await status(), error: `迁移 TTS 文件夹失败: ${getErrorMessage(error)}` };
    }
  }

  async function deleteRuntime(): Promise<TtsRuntimeCommandResult> {
    const targetDir = runtimePythonDir();
    try {
      const stopResult = await stop();
      if (!stopResult.success) {
        return { success: false, status: await status(), error: stopResult.error ?? "停止 TTS 后端失败" };
      }
      if (fileExists(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      writeConfig({ ...readConfig(), installedItems: undefined });
      updateSetupState({ setupStage: "idle", setupMessage: undefined, setupProgress: undefined });
      return { success: true, status: await status() };
    } catch (error) {
      return { success: false, status: await status(), error: `删除 Python 运行环境失败: ${getErrorMessage(error)}` };
    }
  }

  /**
   * Read-only model inventory that runs the backend's `tts.model_inventory`
   * scanner through the managed Python without starting the HTTP server.
   * Used by `LocalTtsPanel.refresh()` when the backend is stopped, so users
   * can still see which models are already downloaded. The probe accepts no
   * renderer path payload, performs no download, and contacts no network.
   * Fail-closed: invalid output or command failure yields an empty list.
   */
  async function scanModelInventory(): Promise<BackendModelStatus[]> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) return [];
    const python = findManagedPython();
    if (!python) return [];
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    try {
      const result = await runPython(
        python,
        ["-m", "tts.model_inventory"],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, MANYING_TTS_MODELS_DIR: modelCacheDir, HF_HUB_CACHE: hfHubCacheDir } },
      ) as { stdout?: string };
      const parsed = parseJsonString(result.stdout);
      if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];
      return parsed.models as BackendModelStatus[];
    } catch {
      return [];
    }
  }

  return {
    status,
    start,
    setup,
    prepareAlignmentModel,
    stop,
    getConfig,
    getModelCacheDir,
    getStorageLayout,
    migrateStorage,
    setConfig,
    setModelCacheDir,
    request,
    requestBytes,
    requestFormData,
    readRequirements,
    deleteRuntime,
    scanModelInventory,
  };
}


export { ALIGNMENT_MODEL_NAME, DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS, DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS, DEFAULT_TTS_HOST, DEFAULT_TTS_PORT, DEFAULT_TTS_REQUEST_TIMEOUT_MS, TTS_AUDIO_POOL_MAX_AGE_MS, TtsRuntimeError, createTtsBackendHttpError, decodeTtsErrorEnvelope, defaultFetchBytes, defaultFetchJson, defaultFetchRuntimeArchive, defaultFindListeningPids, defaultKillProcess, defaultPythonDownloadUrl, directoryIsCoveredBy, execFileAsync, expandHome, fetchWithTtsDeadline, findTtsErrorRecord, isValidPythonRuntimeSha256, isValidPythonRuntimeUrl, makeStatus, normalizeRoutePath, normalizeTtsTransportError, normalizeUserPath, resolveHfHubCacheDir, sha256File, sidecarMainPath, uniquePaths, withTtsRequestContext } from "./tts-runtime-shared";
export type { BackendHealth, FetchBytesResult, FetchJsonOptions, ModelMigrationAction, RuntimeArchiveProgress, RuntimeArchiveResult, RuntimeConfig, SpawnedProcess, TtsRuntimeController, TtsRuntimeControllerDeps, TtsRuntimeErrorEnvelope } from "./tts-runtime-shared";
