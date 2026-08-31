import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LOCAL_TTS_HOST, LOCAL_TTS_PORT } from "../../lib/tts/constants";
import { formatTtsTimeout, getErrorMessage, isAbortError, isRecord, isRetryableTtsStatus, parseJsonString, readBooleanField, readStatusField, readStringField } from "./tts-runtime-utils";
import type { BackendModelStatus, TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeInstalledItem, TtsRuntimeStatus, TtsStorageLayout } from "@/types/tts";
import { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio, execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * TTS runtime 共享底座——端口/超时常量、传输错误翻译、路径与 sha 工具、HF 缓存迁移、Python 包校验。file-size-reduction P1 拆出,体逐字保留。
 */
export const DEFAULT_TTS_PORT = LOCAL_TTS_PORT;
export const DEFAULT_TTS_HOST = LOCAL_TTS_HOST;
export const DEFAULT_TTS_REQUEST_TIMEOUT_MS = 180_000;
export const TTS_AUDIO_POOL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const ALIGNMENT_MODEL_NAME = "whisper-large-v3-turbo";
export const DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS = 1_800;

export type SpawnedProcess = Pick<ChildProcessWithoutNullStreams, "pid" | "kill">;
export type BackendHealth = {
  healthy: boolean;
  service?: string;
  error?: string;
};

export interface FetchJsonOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchBytesResult {
  data: ArrayBuffer;
  mimeType?: string;
}

export interface RuntimeConfig {
  modelCacheDir?: string;
  controlToken?: string;
  pythonRuntimeUrl?: string;
  pythonRuntimeSha256?: string;
  pythonRuntimeDir?: string;
  installedItems?: TtsRuntimeInstalledItem[];
}

export interface RuntimeArchiveProgress {
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}

export interface RuntimeArchiveResult {
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

export function defaultFetchJson(url: string, options: FetchJsonOptions) {
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

export function defaultFetchBytes(url: string, options: FetchJsonOptions) {
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

export const execFileAsync = promisify(execFile);

export async function defaultFetchRuntimeArchive(
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

export async function defaultFindListeningPids(port: number) {
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

export function defaultKillProcess(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function findTtsErrorRecord(value: unknown): Record<string, unknown> | undefined {
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

export function createTtsBackendHttpError(bodyText: string, status: number): TtsRuntimeError {
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

export function normalizeTtsTransportError(error: unknown): TtsRuntimeError {
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

export async function fetchWithTtsDeadline<T>(
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

export function withTtsRequestContext(error: unknown, method: string, requestUrl: string): TtsRuntimeError {
  const message = `本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage(error)}`;
  const normalized = normalizeTtsTransportError(error);
  return new TtsRuntimeError(normalized.envelope, message);
}

export function normalizeRoutePath(routePath: string) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

export function sidecarMainPath(sidecarRoot: string) {
  return path.join(sidecarRoot, "tts", "main.py");
}

export function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

export function expandHome(inputPath: string) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export function normalizeUserPath(inputPath: string) {
  return path.resolve(expandHome(inputPath.trim()));
}

export function resolveHfHubCacheDir(modelCacheDir: string, fileExists: (filePath: string) => boolean) {
  if (path.basename(modelCacheDir) === "huggingface") {
    return path.join(modelCacheDir, "hub");
  }
  if (path.basename(modelCacheDir) !== "hub" && fileExists(path.join(modelCacheDir, "hub"))) {
    return path.join(modelCacheDir, "hub");
  }
  return modelCacheDir;
}

export type ModelMigrationAction =
  | { kind: "move"; sourceDir: string; targetDir: string }
  | { kind: "remove"; sourceDir: string };

export function sha256File(filePath: string): Promise<string> {
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

export async function directoryIsCoveredBy(sourcePath: string, targetPath: string): Promise<boolean> {
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

export function makeStatus(params: {
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

export function defaultPythonDownloadUrl(): string | null {
  const base = "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-";
  const suffix = "-install_only.tar.gz";
  if (process.platform === "darwin") return `${base}${process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"}${suffix}`;
  if (process.platform === "win32") return `${base}x86_64-pc-windows-msvc${suffix}`;
  if (process.platform === "linux") return `${base}${process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"}${suffix}`;
  return null;
}

/**
 * Python 运行环境下载源只允许 HTTPS:该归档解压后会直接执行二进制,
 * 明文 HTTP 下载源等于把主机代码执行权交给网络中间人。
 */
export function isValidPythonRuntimeUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** 归档完整性指纹格式:64 位小写/大写 hex(sha256)。 */
export function isValidPythonRuntimeSha256(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

