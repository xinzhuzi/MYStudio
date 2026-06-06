import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { promisify } from "node:util";
import { LOCAL_TTS_HOST, LOCAL_TTS_PORT } from "../lib/tts/constants";
import type { TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeInstalledItem, TtsRuntimeStatus } from "@/types/tts";

const DEFAULT_TTS_PORT = LOCAL_TTS_PORT;
const DEFAULT_TTS_HOST = LOCAL_TTS_HOST;

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
}

interface FetchBytesResult {
  data: ArrayBuffer;
  mimeType?: string;
}

interface RuntimeConfig {
  modelCacheDir?: string;
  controlToken?: string;
  pythonRuntimeUrl?: string;
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

export interface TtsRuntimeControllerDeps {
  appRoot: string;
  userDataPath: string;
  storageBasePath?: string | (() => string);
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
  stop: () => Promise<TtsRuntimeCommandResult>;
  getConfig: () => Promise<TtsRuntimeConfig>;
  setConfig: (config: Partial<TtsRuntimeConfig>) => Promise<TtsRuntimeCommandResult>;
  setModelCacheDir: (dirPath: string) => Promise<TtsRuntimeCommandResult>;
  request: (method: string, routePath: string, body?: unknown) => Promise<unknown>;
  requestBytes: (method: string, routePath: string, body?: unknown) => Promise<FetchBytesResult>;
  requestFormData: (routePath: string, audioFilePath: string, referenceText?: string) => Promise<unknown>;
}

function defaultFetchJson(url: string, options: FetchJsonOptions) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `TTS backend request failed (${response.status})`);
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
      throw new Error(text || `TTS backend request failed (${response.status})`);
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRoutePath(routePath: string) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function sidecarMainPath(sidecarRoot: string) {
  return path.join(sidecarRoot, "manying_voicebox_tts", "main.py");
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

function makeStatus(params: {
  installed: boolean;
  running: boolean;
  port: number;
  baseUrl: string;
  setupStage: TtsRuntimeStatus["setupStage"];
  setupMessage?: string;
  setupProgress?: number;
  cacheDir: string;
  modelCacheDir: string;
  defaultModelCacheDir: string;
  systemModelCacheDir: string;
  pythonRuntimeDir: string;
  managed: boolean;
  pid?: number;
  error?: string;
}): TtsRuntimeStatus {
  return {
    installed: params.installed,
    running: params.running,
    port: params.port,
    baseUrl: params.baseUrl,
    setupStage: params.setupStage,
    setupMessage: params.setupMessage,
    setupProgress: params.setupProgress,
    cacheDir: params.cacheDir,
    modelCacheDir: params.modelCacheDir,
    defaultModelCacheDir: params.defaultModelCacheDir,
    systemModelCacheDir: params.systemModelCacheDir,
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
  const sidecarRoots = uniquePaths([
    ...(deps.sidecarRoots ?? []),
    path.join(deps.appRoot, "..", "backend"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "backend") : "",
  ]);
  const storageBasePath = () => {
    if (typeof deps.storageBasePath === "function") return deps.storageBasePath();
    return deps.storageBasePath || deps.userDataPath;
  };
  const cacheDir = path.join(deps.userDataPath, "tts-runtime");
  const runtimePythonDir = () => path.join(storageBasePath(), "python");
  const runtimeArchiveDir = () => storageBasePath();
  const configPath = path.join(cacheDir, "config.json");
  const defaultModelCacheDir = () => path.join(storageBasePath(), "tts-models");
  const systemModelCacheDir = path.join(os.homedir(), ".cache", "huggingface");
  let child: SpawnedProcess | null = null;
  let setupState: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress"> = {
    setupStage: "idle",
    setupMessage: undefined,
    setupProgress: undefined,
  };

  const readConfig = (): RuntimeConfig => {
    const raw = readTextFile(configPath);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as RuntimeConfig;
    } catch {
      return {};
    }
  };

  const writeConfig = (config: RuntimeConfig) => {
    ensureDir(cacheDir);
    writeTextFile(configPath, JSON.stringify(config, null, 2));
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
    ensureDir(cacheDir);
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

  const isInstalled = () => resolveSidecarRoot() !== undefined;

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
    return { error: "请先到设置里的 Python 配置页完成配置" };
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
    const markerPath = path.join(cacheDir, ".deps-hash");
    const reqContent = readTextFile(reqPath) ?? "";
    const reqHash = crypto.createHash("md5").update(`${python}\n${reqContent}`).digest("hex");
    return { reqPath, markerPath, reqHash };
  }

  function depsAreReady(sidecarRoot: string, python: string) {
    const depsPlan = getDepsPlan(sidecarRoot, python);
    if (!depsPlan.markerPath || !depsPlan.reqHash) return true;
    return readTextFile(depsPlan.markerPath)?.trim() === depsPlan.reqHash;
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
      ensureDir(cacheDir);
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
    const installed = isInstalled();
    const health = await getBackendHealth();
    const running = health.healthy;
    return makeStatus({
      installed,
      running,
      port,
      baseUrl,
      setupStage: setupState.setupStage ?? "idle",
      setupMessage: setupState.setupMessage,
      setupProgress: setupState.setupProgress,
      cacheDir,
      modelCacheDir: getModelCacheDir(),
      defaultModelCacheDir: defaultModelCacheDir(),
      systemModelCacheDir,
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

    ensureDir(cacheDir);
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    ensureDir(modelCacheDir);
    ensureDir(hfHubCacheDir);

    const pyResult = await findReadyPython();
    if (!pyResult.python) {
      return { success: false, status: await status(), error: pyResult.error };
    }
    if (!depsAreReady(sidecarRoot, pyResult.python)) {
      updateSetupState({ setupStage: "failed", setupMessage: "TTS Python 依赖未配置", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: "请先到设置里的 Python 配置页点击开始配置，完成 TTS 依赖安装",
      };
    }
    const controlToken = getControlToken();
    const backendPython = pyResult.python;

    updateSetupState({ setupStage: "starting-backend", setupMessage: "本地 TTS 后端启动中", setupProgress: undefined });
    const systemHfCache = path.join(os.homedir(), ".cache", "huggingface", "hub");
    child = spawnProcess(
      backendPython,
      [
        "-m",
        "manying_voicebox_tts.main",
        "--host",
        host,
        "--port",
        String(port),
        "--data-dir",
        cacheDir,
      ],
      {
        cwd: sidecarRoot,
        env: {
          ...process.env,
          PYTHONPATH: sidecarRoot,
          MANYING_TTS_DATA_DIR: cacheDir,
          MANYING_TTS_MODELS_DIR: modelCacheDir,
          VOICEBOX_MODELS_DIR: modelCacheDir,
          HF_HUB_CACHE: systemHfCache,
          MANYING_TTS_CONTROL_TOKEN: controlToken,
        },
      },
    );

    const healthy = await waitUntilHealthy();
    if (!healthy) {
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
      return await fetchJson(requestUrl, buildRequestOptions(method, body));
    } catch (error) {
      throw new Error(`本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage(error)}`);
    }
  }

  async function requestBytes(method: string, routePath: string, body?: unknown) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchBytes(requestUrl, buildRequestOptions(method, body));
    } catch (error) {
      throw new Error(`本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage(error)}`);
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

      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Manying-TTS-Token": getControlToken(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.concat(parts),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `TTS backend request failed (${response.status})`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return response.json();
      }
      return response.text();
    } catch (error) {
      throw new Error(`本地 TTS 后端请求失败: POST ${requestUrl}: ${getErrorMessage(error)}`);
    }
  }

  return {
    status,
    start,
    setup,
    stop,
    getConfig,
    setConfig,
    setModelCacheDir,
    request,
    requestBytes,
    requestFormData,

  };
}
