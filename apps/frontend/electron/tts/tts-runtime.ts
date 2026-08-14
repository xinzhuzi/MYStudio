import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { promisify } from "node:util";
import { LOCAL_TTS_HOST, LOCAL_TTS_PORT } from "../../lib/tts/constants";
import {
  getErrorMessage, isRecord, parseJsonString, readStringField,
  readBooleanField, readStatusField, isRetryableTtsStatus, isAbortError, formatTtsTimeout,
} from "./tts-runtime-utils";
import type {
  BackendModelStatus,
  TtsRuntimeCommandResult,
  TtsRuntimeConfig,
  TtsRuntimeInstalledItem,
  TtsRuntimeStatus,
  TtsStorageLayout,
} from "@/types/tts";

const DEFAULT_TTS_PORT = LOCAL_TTS_PORT;
const DEFAULT_TTS_HOST = LOCAL_TTS_HOST;
const DEFAULT_TTS_REQUEST_TIMEOUT_MS = 180_000;
const ALIGNMENT_MODEL_NAME = "whisper-large-v3-turbo";
const DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS = 1_000;
const DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS = 1_800;

type SpawnedProcess = Pick<ChildProcessWithoutNullStreams, "pid" | "kill">;
type BackendHealth = {
  healthy: boolean;
  service?: string;
  error?: string;
};

interface FetchJsonOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface FetchBytesResult {
  data: ArrayBuffer;
  mimeType?: string;
}

interface RuntimeConfig {
  modelCacheDir?: string;
  controlToken?: string;
  pythonRuntimeUrl?: string;
  pythonRuntimeDir?: string;
  installedItems?: TtsRuntimeInstalledItem[];
}

interface RuntimeArchiveProgress {
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}

interface RuntimeArchiveResult {
  ok: boolean;
  status: number;
  data?: ArrayBuffer | Uint8Array;
  totalBytes?: number;
}

export interface TtsRuntimeErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
}

export class TtsRuntimeError extends Error {
  readonly envelope: TtsRuntimeErrorEnvelope;
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(envelope: TtsRuntimeErrorEnvelope, legacyMessage = envelope.message) {
    super(legacyMessage);
    this.name = "TtsRuntimeError";
    this.envelope = envelope;
    this.code = envelope.code;
    this.retryable = envelope.retryable;
    this.status = envelope.status;
  }
}

export interface TtsRuntimeControllerDeps {
  appRoot: string;
  userDataPath: string;
  storageBasePath?: string | (() => string);
  huggingFaceHubDir?: string | (() => string);
  port?: number;
  host?: string;
  sidecarRoots?: string[];
  fileExists?: (filePath: string) => boolean;
  ensureDir?: (dirPath: string) => void;
  readTextFile?: (filePath: string) => string | null;
  writeTextFile?: (filePath: string, value: string) => void;
  writeBinaryFile?: (filePath: string, value: Uint8Array) => void;
  renameFile?: (from: string, to: string) => void;
  removeFile?: (filePath: string) => void;
  extractArchive?: (archivePath: string, destinationDir: string) => Promise<void>;
  runPython?: (command: string, args: string[], options?: Parameters<typeof execFileAsync>[2]) => Promise<unknown>;
  spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => SpawnedProcess;
  fetchJson?: (url: string, options: FetchJsonOptions) => Promise<unknown>;
  fetchBytes?: (url: string, options: FetchJsonOptions) => Promise<FetchBytesResult>;
  requestTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  alignmentModelPollIntervalMs?: number;
  alignmentModelPollAttempts?: number;
  fetchRuntimeArchive?: (
    url: string,
    destinationPath: string,
    onProgress?: (progress: RuntimeArchiveProgress) => void,
  ) => Promise<RuntimeArchiveResult>;
  findListeningPids?: (port: number, host: string) => Promise<number[]>;
  killProcess?: (pid: number) => boolean;
}

export interface TtsRuntimeController {
  status: () => Promise<TtsRuntimeStatus>;
  start: () => Promise<TtsRuntimeCommandResult>;
  setup: () => Promise<TtsRuntimeCommandResult>;
  prepareAlignmentModel: () => Promise<TtsRuntimeCommandResult>;
  stop: () => Promise<TtsRuntimeCommandResult>;
  getConfig: () => Promise<TtsRuntimeConfig>;
  getModelCacheDir: () => string;
  getStorageLayout: () => TtsStorageLayout;
  migrateStorage: () => Promise<TtsRuntimeCommandResult>;
  setConfig: (config: Partial<TtsRuntimeConfig>) => Promise<TtsRuntimeCommandResult>;
  setModelCacheDir: (dirPath: string) => Promise<TtsRuntimeCommandResult>;
  request: (method: string, routePath: string, body?: unknown) => Promise<unknown>;
  requestBytes: (method: string, routePath: string, body?: unknown) => Promise<FetchBytesResult>;
  requestFormData: (routePath: string, audioFilePath: string, referenceText?: string) => Promise<unknown>;
  readRequirements: () => Promise<{ content: string; path: string } | null>;
  deleteRuntime: () => Promise<TtsRuntimeCommandResult>;
  scanModelInventory: () => Promise<BackendModelStatus[]>;
}

function defaultFetchJson(url: string, options: FetchJsonOptions) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw createTtsBackendHttpError(text, response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return response.text();
    }
    return response.json();
  });
}

function defaultFetchBytes(url: string, options: FetchJsonOptions) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw createTtsBackendHttpError(text, response.status);
    }
    return {
      data: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type") ?? undefined,
    };
  });
}

const execFileAsync = promisify(execFile);

async function defaultFetchRuntimeArchive(
  url: string,
  _destinationPath: string,
  onProgress?: (progress: RuntimeArchiveProgress) => void,
): Promise<RuntimeArchiveResult> {
  const response = await fetch(url);
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;
  if (!response.ok) {
    return { ok: false, status: response.status, totalBytes };
  }
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      downloadedBytes: data.byteLength,
      totalBytes: totalBytes || data.byteLength,
      progress: totalBytes ? Math.round((data.byteLength / totalBytes) * 100) : undefined,
    });
    return { ok: true, status: response.status, data, totalBytes };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    downloadedBytes += value.byteLength;
    onProgress?.({
      downloadedBytes,
      totalBytes,
      progress: totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : undefined,
    });
  }
  const data = new Uint8Array(downloadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.({
    downloadedBytes,
    totalBytes: totalBytes || downloadedBytes,
    progress: 100,
  });
  return { ok: true, status: response.status, data, totalBytes: totalBytes || downloadedBytes };
}

async function defaultFindListeningPids(port: number) {
  try {
    const { stdout } = await execFileAsync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN", "-nP"]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function defaultKillProcess(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function findTtsErrorRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonString(value);
  if (!isRecord(parsed)) return undefined;

  for (const key of ["error", "detail", "result", "data"] as const) {
    const nested = parsed[key];
    if (isRecord(nested)) {
      const found = findTtsErrorRecord(nested);
      if (found) return found;
    }
  }

  const hasErrorField = [
    "code",
    "errorCode",
    "error_code",
    "message",
    "detail",
    "error",
    "retryable",
    "status",
    "statusCode",
    "status_code",
  ].some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  return hasErrorField ? parsed : undefined;
}

export function decodeTtsErrorEnvelope(value: unknown, fallbackStatus?: number): TtsRuntimeErrorEnvelope | undefined {
  const record = findTtsErrorRecord(value);
  if (!record) return undefined;

  const message = readStringField(record, ["message", "detail", "error"]);
  if (!message) return undefined;
  const status = readStatusField(record) ?? fallbackStatus;
  const explicitRetryable = readBooleanField(record, ["retryable"]);
  return {
    code: readStringField(record, ["code", "errorCode", "error_code"]) ?? "http-error",
    message,
    retryable: explicitRetryable ?? (status !== undefined && isRetryableTtsStatus(status)),
    status,
  };
}

function createTtsBackendHttpError(bodyText: string, status: number): TtsRuntimeError {
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = undefined;
  }
  const envelope = decodeTtsErrorEnvelope(body, status) ?? {
    code: "http-error",
    message: bodyText || `TTS backend request failed (${status})`,
    retryable: isRetryableTtsStatus(status),
    status,
  };
  return new TtsRuntimeError(envelope, bodyText || `TTS backend request failed (${status})`);
}

function normalizeTtsTransportError(error: unknown): TtsRuntimeError {
  if (error instanceof TtsRuntimeError) return error;
  if (isAbortError(error)) {
    return new TtsRuntimeError({
      code: "aborted",
      message: "TTS backend request was aborted",
      retryable: false,
    }, getErrorMessage(error));
  }
  const message = getErrorMessage(error) || "TTS backend request failed";
  const decoded = decodeTtsErrorEnvelope(error) ?? decodeTtsErrorEnvelope(message);
  return decoded
    ? new TtsRuntimeError(decoded, message)
    : new TtsRuntimeError({ code: "network-error", message, retryable: true }, message);
}

async function fetchWithTtsDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new TtsRuntimeError({
        code: "timeout",
        message: `TTS backend request timed out after ${formatTtsTimeout(timeoutMs)}`,
        retryable: true,
      });
    }
    throw normalizeTtsTransportError(error);
  } finally {
    clearTimeout(timer);
  }
}

function withTtsRequestContext(error: unknown, method: string, requestUrl: string): TtsRuntimeError {
  const message = `本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage(error)}`;
  const normalized = normalizeTtsTransportError(error);
  return new TtsRuntimeError(normalized.envelope, message);
}

function normalizeRoutePath(routePath: string) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function sidecarMainPath(sidecarRoot: string) {
  return path.join(sidecarRoot, "tts", "main.py");
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

function expandHome(inputPath: string) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function normalizeUserPath(inputPath: string) {
  return path.resolve(expandHome(inputPath.trim()));
}

function resolveHfHubCacheDir(modelCacheDir: string, fileExists: (filePath: string) => boolean) {
  if (path.basename(modelCacheDir) === "huggingface") {
    return path.join(modelCacheDir, "hub");
  }
  if (path.basename(modelCacheDir) !== "hub" && fileExists(path.join(modelCacheDir, "hub"))) {
    return path.join(modelCacheDir, "hub");
  }
  return modelCacheDir;
}

type ModelMigrationAction =
  | { kind: "move"; sourceDir: string; targetDir: string }
  | { kind: "remove"; sourceDir: string };

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function directoryIsCoveredBy(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const source = fs.lstatSync(sourcePath);
    const target = fs.lstatSync(targetPath);
    if (source.isSymbolicLink() || target.isSymbolicLink()) {
      return source.isSymbolicLink()
        && target.isSymbolicLink()
        && fs.readlinkSync(sourcePath) === fs.readlinkSync(targetPath);
    }
    if (source.isDirectory() || target.isDirectory()) {
      if (!source.isDirectory() || !target.isDirectory()) return false;
      const targetEntries = new Set(fs.readdirSync(targetPath));
      for (const entry of fs.readdirSync(sourcePath)) {
        if (!targetEntries.has(entry)) return false;
        if (!await directoryIsCoveredBy(path.join(sourcePath, entry), path.join(targetPath, entry))) return false;
      }
      return true;
    }
    if (!source.isFile() || !target.isFile() || source.size !== target.size) return false;
    return (await sha256File(sourcePath)) === (await sha256File(targetPath));
  } catch {
    return false;
  }
}

function makeStatus(params: {
  installed: boolean;
  sidecarAvailable: boolean;
  pythonInstalled: boolean;
  pythonExecutablePath?: string;
  dependenciesReady: boolean;
  running: boolean;
  port: number;
  baseUrl: string;
  setupStage: TtsRuntimeStatus["setupStage"];
  setupMessage?: string;
  setupProgress?: number;
  cacheDir: string;
  modelCacheDir: string;
  defaultModelCacheDir: string;
  hfHubCacheDir: string;
  storageLayout: TtsStorageLayout;
  pythonRuntimeDir: string;
  managed: boolean;
  pid?: number;
  error?: string;
}): TtsRuntimeStatus {
  return {
    installed: params.installed,
    sidecarAvailable: params.sidecarAvailable,
    pythonInstalled: params.pythonInstalled,
    pythonExecutablePath: params.pythonExecutablePath,
    dependenciesReady: params.dependenciesReady,
    running: params.running,
    port: params.port,
    baseUrl: params.baseUrl,
    setupStage: params.setupStage,
    setupMessage: params.setupMessage,
    setupProgress: params.setupProgress,
    cacheDir: params.cacheDir,
    modelCacheDir: params.modelCacheDir,
    defaultModelCacheDir: params.defaultModelCacheDir,
    hfHubCacheDir: params.hfHubCacheDir,
    storageLayout: params.storageLayout,
    pythonRuntimeDir: params.pythonRuntimeDir,
    managed: params.managed,
    pid: params.pid,
    error: params.error,
  };
}

function defaultPythonDownloadUrl(): string | null {
  const base = "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-";
  const suffix = "-install_only.tar.gz";
  if (process.platform === "darwin") return `${base}${process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"}${suffix}`;
  if (process.platform === "win32") return `${base}x86_64-pc-windows-msvc${suffix}`;
  if (process.platform === "linux") return `${base}${process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"}${suffix}`;
  return null;
}

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
  const extractArchive = deps.extractArchive ?? ((archivePath: string, destinationDir: string) => (
    execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }).then(() => undefined)
  ));
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
  const runtimePythonDir = () => path.join(storageBasePath(), "python");
  const runtimeArchiveDir = () => storageBasePath();
  const configPath = () => path.join(runtimeDataDir(), "config.json");
  const defaultModelCacheDir = () => path.join(ttsRootDir(), "model");
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
  ];

  const getStorageLayout = (): TtsStorageLayout => {
    const runtimeDir = runtimeDataDir();
    const modelsDir = defaultModelCacheDir();
    const legacyRuntimeExists = fileExists(legacyRuntimeDir);
    const legacyModelsExists = fileExists(legacyModelsDir());
    const legacyDefaultModelsExists = fileExists(legacyDefaultModelsDir());
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
      legacyHuggingFaceHubDir: huggingFaceHubDir(),
      legacyRuntimeExists,
      legacyModelsExists,
      legacyDefaultModelsExists,
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
      defaultPythonRuntimeUrl: defaultPythonDownloadUrl() ?? undefined,
      pythonRuntimeDir: runtimePythonDir(),
      installedItems: (config.installedItems ?? []).filter(isManagedPythonInstallItem),
    };
  };

  const saveRuntimeConfig = (nextConfig: Partial<TtsRuntimeConfig>) => {
    const config = readConfig();
    const pythonRuntimeUrl = nextConfig.pythonRuntimeUrl?.trim();
    writeConfig({
      ...config,
      pythonRuntimeUrl: pythonRuntimeUrl || undefined,
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
    const configuredUrl = config.pythonRuntimeUrl?.trim();
    if (configuredUrl) return configuredUrl;
    const override = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    if (override) return override;
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
    saveRuntimeConfig(config);
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
      const legacyModelPaths = [layout.legacyModelsDir, layout.legacyDefaultModelsDir];
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
