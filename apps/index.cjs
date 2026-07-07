"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const crypto$1 = require("node:crypto");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const openai = require("@ai-sdk/openai");
const openaiCompatible = require("@ai-sdk/openai-compatible");
const anthropic = require("@ai-sdk/anthropic");
const google = require("@ai-sdk/google");
const deepseek = require("@ai-sdk/deepseek");
const vercelMinimaxAiProvider = require("vercel-minimax-ai-provider");
const ai = require("ai");
const updateConfig = {
  manifestUrl: "http://68.64.176.186/manying-studio/version.json",
  defaultGithubUrl: "https://github.com/zhengbingjin/MYStudio",
  defaultBaiduUrl: "https://pan.baidu.com/s/1ImH6tOIiuFxIDXC0fC-6Lg",
  defaultBaiduCode: "8888"
};
const packageMetadata = {
  updateConfig
};
const MAX_STRING_LENGTH = 1024;
const MAX_PROMPT_PREVIEW = 120;
const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|x-api-key|token|secret|password|access[-_]?key|bearer)/i;
const PROMPT_KEY_PATTERN = /(prompt|messages?|content|referenceText)/i;
function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function sanitizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return value;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
}
function summarizePrompt(value) {
  return {
    promptLength: value.length,
    promptHash: hashText(value),
    promptPreview: value.slice(0, MAX_PROMPT_PREVIEW),
    truncated: value.length > MAX_PROMPT_PREVIEW
  };
}
function looksLikeBase64Payload(value) {
  if (value.startsWith("data:") && value.includes(";base64,")) return true;
  if (value.length < 512) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}
function sanitizeString(key, value) {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (looksLikeBase64Payload(value)) {
    return {
      binaryPayload: true,
      length: value.length,
      hash: hashText(value)
    };
  }
  if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
  if (key && PROMPT_KEY_PATTERN.test(key) && value.length > MAX_PROMPT_PREVIEW) {
    return summarizePrompt(value);
  }
  if (value.length > MAX_STRING_LENGTH) {
    return {
      textLength: value.length,
      textHash: hashText(value),
      textPreview: value.slice(0, MAX_STRING_LENGTH),
      truncated: true
    };
  }
  return value;
}
function sanitizeDiagnosticsData(value, key, depth = 0) {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(key, value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return sanitizeDiagnosticsError(value);
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDiagnosticsData(item, key, depth + 1));
  }
  if (isPlainRecord(value)) {
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = sanitizeDiagnosticsData(entryValue, entryKey, depth + 1);
    }
    return output;
  }
  return String(value);
}
function sanitizeDiagnosticsError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: String(sanitizeDiagnosticsData(error.message)),
      stack: error.stack ? String(sanitizeDiagnosticsData(error.stack)).slice(0, 2e3) : void 0
    };
  }
  return { message: String(sanitizeDiagnosticsData(String(error))) };
}
function summarizeResponseBody(value, limit = MAX_STRING_LENGTH) {
  const sanitized = sanitizeDiagnosticsData(value);
  if (typeof sanitized === "string") return sanitized.slice(0, limit);
  return JSON.stringify(sanitized).slice(0, limit);
}
const LEVEL_SCORE = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
function ensureDir$1(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}
function formatDay(date) {
  return date.toISOString().slice(0, 10);
}
function getErrorMessage$2(error) {
  return error instanceof Error ? error.message : String(error);
}
function isDiagnosticsFile(name) {
  return /^diagnostics-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(name);
}
async function listDiagnosticsFiles(rootDir) {
  ensureDir$1(rootDir);
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isDiagnosticsFile(entry.name)) continue;
    const filePath = path.join(rootDir, entry.name);
    const stat = await fs.promises.stat(filePath);
    files.push({
      name: entry.name,
      path: filePath,
      size: stat.size,
      updatedAt: new Date(stat.mtimeMs).toISOString()
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}
function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed.timestamp || !parsed.level || !parsed.category || !parsed.message) return null;
    return parsed;
  } catch {
    return null;
  }
}
function buildEntry(input, now) {
  return {
    timestamp: now.toISOString(),
    level: input.level ?? "info",
    category: input.category,
    operationId: input.operationId,
    requestId: input.requestId,
    message: input.message,
    context: input.context ? sanitizeDiagnosticsData(input.context) : void 0,
    durationMs: input.durationMs,
    error: input.error ? sanitizeDiagnosticsError(input.error) : void 0
  };
}
function matchesQuery(entry, query) {
  if (query.since && entry.timestamp < query.since) return false;
  if (query.until && entry.timestamp > query.until) return false;
  if (query.level && entry.level !== query.level) return false;
  if (query.minLevel && LEVEL_SCORE[entry.level] < LEVEL_SCORE[query.minLevel]) return false;
  if (query.categories?.length && !query.categories.includes(entry.category)) return false;
  if (query.operationId && entry.operationId !== query.operationId) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  return true;
}
function createDiagnosticsLogService(options) {
  const rootDir = options.rootDir;
  const retentionDays = options.retentionDays ?? 30;
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  async function cleanupOldFiles(referenceDate) {
    const cutoff = referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1e3;
    const files = await listDiagnosticsFiles(rootDir);
    await Promise.all(files.map(async (file) => {
      const match = file.name.match(/^diagnostics-(\d{4}-\d{2}-\d{2})/);
      const fileTime = match ? (/* @__PURE__ */ new Date(`${match[1]}T00:00:00.000Z`)).getTime() : 0;
      if (fileTime && fileTime < cutoff) {
        await fs.promises.unlink(file.path).catch(() => void 0);
      }
    }));
  }
  async function resolveWritePath(date) {
    ensureDir$1(rootDir);
    const day = formatDay(date);
    let filePath = path.join(rootDir, `diagnostics-${day}.jsonl`);
    if (!fs.existsSync(filePath)) return filePath;
    const stat = await fs.promises.stat(filePath);
    if (stat.size < maxFileBytes) return filePath;
    for (let index = 1; index < 1e3; index += 1) {
      filePath = path.join(rootDir, `diagnostics-${day}-${index}.jsonl`);
      if (!fs.existsSync(filePath)) return filePath;
      const rotatedStat = await fs.promises.stat(filePath);
      if (rotatedStat.size < maxFileBytes) return filePath;
    }
    return filePath;
  }
  return {
    async write(input) {
      const current = now();
      await cleanupOldFiles(current);
      const entry = buildEntry(input, current);
      const filePath = await resolveWritePath(current);
      await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}
`, "utf8");
      return entry;
    },
    async query(query = {}) {
      const files = await listDiagnosticsFiles(rootDir);
      const entries = [];
      for (const file of files) {
        const raw = await fs.promises.readFile(file.path, "utf8").catch(() => "");
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const entry = parseLine(line);
          if (entry && matchesQuery(entry, query)) entries.push(entry);
        }
      }
      entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const limit = query.limit ?? 500;
      return {
        entries: entries.slice(Math.max(0, entries.length - limit)),
        total: entries.length
      };
    },
    async getInfo() {
      const files = await listDiagnosticsFiles(rootDir);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const since = new Date(now().getTime() - 24 * 60 * 60 * 1e3).toISOString();
      const recent = await this.query({ since, minLevel: "warn", limit: 1e4 });
      return {
        directory: rootDir,
        totalBytes,
        fileCount: files.length,
        recentWarnCount: recent.entries.filter((entry) => entry.level === "warn").length,
        recentErrorCount: recent.entries.filter((entry) => entry.level === "error").length,
        retentionDays,
        files
      };
    },
    async exportBundle() {
      try {
        ensureDir$1(rootDir);
        const current = now();
        const filePath = path.join(rootDir, `diagnostics-bundle-${formatDay(current)}-${current.getTime()}.json`);
        const info = await this.getInfo();
        const entries = await this.query({ limit: 5e4 });
        await fs.promises.writeFile(filePath, JSON.stringify({ exportedAt: current.toISOString(), info, entries: entries.entries }, null, 2), "utf8");
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: getErrorMessage$2(error) };
      }
    },
    async clear() {
      try {
        const files = await listDiagnosticsFiles(rootDir);
        let removedFiles = 0;
        for (const file of files) {
          await fs.promises.unlink(file.path).catch(() => void 0);
          removedFiles += 1;
        }
        return { success: true, removedFiles };
      } catch (error) {
        return { success: false, removedFiles: 0, error: getErrorMessage$2(error) };
      }
    },
    getDirectory() {
      ensureDir$1(rootDir);
      return rootDir;
    }
  };
}
const LOCAL_TTS_HOST = "127.0.0.1";
const LOCAL_TTS_PORT = 17593;
const DEFAULT_TTS_PORT = LOCAL_TTS_PORT;
const DEFAULT_TTS_HOST = LOCAL_TTS_HOST;
function defaultFetchJson(url, options) {
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
function defaultFetchBytes(url, options) {
  return fetch(url, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `TTS backend request failed (${response.status})`);
    }
    return {
      data: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type") ?? void 0
    };
  });
}
const execFileAsync$3 = node_util.promisify(node_child_process.execFile);
async function defaultFetchRuntimeArchive(url, _destinationPath, onProgress) {
  const response = await fetch(url);
  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number(totalHeader) : void 0;
  if (!response.ok) {
    return { ok: false, status: response.status, totalBytes };
  }
  if (!response.body) {
    const data2 = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      downloadedBytes: data2.byteLength,
      totalBytes: totalBytes || data2.byteLength,
      progress: totalBytes ? Math.round(data2.byteLength / totalBytes * 100) : void 0
    });
    return { ok: true, status: response.status, data: data2, totalBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
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
      progress: totalBytes ? Math.min(99, Math.round(downloadedBytes / totalBytes * 100)) : void 0
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
    progress: 100
  });
  return { ok: true, status: response.status, data, totalBytes: totalBytes || downloadedBytes };
}
async function defaultFindListeningPids(port) {
  try {
    const { stdout } = await execFileAsync$3("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN", "-nP"]);
    return stdout.split(/\s+/).map((value) => Number(value)).filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}
function defaultKillProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
function getErrorMessage$1(error) {
  return error instanceof Error ? error.message : String(error);
}
function normalizeRoutePath(routePath) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}
function sidecarMainPath(sidecarRoot) {
  return path.join(sidecarRoot, "manying_voicebox_tts", "main.py");
}
function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}
function expandHome(inputPath) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}
function normalizeUserPath(inputPath) {
  return path.resolve(expandHome(inputPath.trim()));
}
function resolveHfHubCacheDir(modelCacheDir, fileExists) {
  if (path.basename(modelCacheDir) === "huggingface") {
    return path.join(modelCacheDir, "hub");
  }
  if (path.basename(modelCacheDir) !== "hub" && fileExists(path.join(modelCacheDir, "hub"))) {
    return path.join(modelCacheDir, "hub");
  }
  return modelCacheDir;
}
function makeStatus(params) {
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
    error: params.error
  };
}
function defaultPythonDownloadUrl() {
  const base = "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-";
  const suffix = "-install_only.tar.gz";
  if (process.platform === "darwin") return `${base}${process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"}${suffix}`;
  if (process.platform === "win32") return `${base}x86_64-pc-windows-msvc${suffix}`;
  if (process.platform === "linux") return `${base}${process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"}${suffix}`;
  return null;
}
function createTtsRuntimeController(deps) {
  const port = deps.port ?? DEFAULT_TTS_PORT;
  const host = deps.host ?? DEFAULT_TTS_HOST;
  const baseUrl = `http://${host}:${port}`;
  const fileExists = deps.fileExists ?? fs.existsSync;
  const ensureDir2 = deps.ensureDir ?? ((dirPath) => fs.mkdirSync(dirPath, { recursive: true }));
  const readTextFile = deps.readTextFile ?? ((filePath) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  });
  const writeTextFile = deps.writeTextFile ?? ((filePath, value) => fs.writeFileSync(filePath, value));
  const writeBinaryFile = deps.writeBinaryFile ?? ((filePath, value) => fs.writeFileSync(filePath, value));
  const renameFile = deps.renameFile ?? ((from, to) => fs.renameSync(from, to));
  const removeFile = deps.removeFile ?? ((filePath) => fs.rmSync(filePath, { force: true }));
  const extractArchive = deps.extractArchive ?? ((archivePath, destinationDir) => execFileAsync$3("tar", ["-xzf", archivePath, "-C", destinationDir], { timeout: 6e5, maxBuffer: 64 * 1024 * 1024 }).then(() => void 0));
  const runPython = deps.runPython ?? ((command, args, options) => execFileAsync$3(command, args, options));
  const spawnProcess = deps.spawnProcess ?? ((command, args, options) => node_child_process.spawn(command, args, options));
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const fetchRuntimeArchive = deps.fetchRuntimeArchive ?? defaultFetchRuntimeArchive;
  const findListeningPids = deps.findListeningPids ?? defaultFindListeningPids;
  const killProcess = deps.killProcess ?? defaultKillProcess;
  const sidecarRoots = uniquePaths([
    ...deps.sidecarRoots ?? [],
    path.join(deps.appRoot, "..", "backend"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "backend") : ""
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
  let child = null;
  let setupState = {
    setupStage: "idle",
    setupMessage: void 0,
    setupProgress: void 0
  };
  const readConfig = () => {
    const raw = readTextFile(configPath);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };
  const writeConfig = (config) => {
    ensureDir2(cacheDir);
    writeTextFile(configPath, JSON.stringify(config, null, 2));
  };
  const getModelCacheDir = () => {
    const config = readConfig();
    return config.modelCacheDir ? normalizeUserPath(config.modelCacheDir) : defaultModelCacheDir();
  };
  const getControlToken = () => {
    const config = readConfig();
    if (config.controlToken) return config.controlToken;
    const controlToken = crypto$1.randomUUID();
    writeConfig({ ...config, controlToken });
    return controlToken;
  };
  const saveModelCacheDir = (dirPath) => {
    const modelCacheDir = dirPath.trim() ? normalizeUserPath(dirPath) : defaultModelCacheDir();
    ensureDir2(cacheDir);
    ensureDir2(modelCacheDir);
    const config = readConfig();
    writeConfig({ ...config, modelCacheDir });
    return modelCacheDir;
  };
  const isManagedPythonInstallItem = (item) => {
    if (item.label !== "Python 运行环境") return true;
    if (!item.detail || !path.isAbsolute(item.detail)) return false;
    const normalizedDetail = path.resolve(expandHome(item.detail));
    const runtimeDir = path.resolve(expandHome(runtimePythonDir()));
    const pythonPath = path.resolve(managedPythonExecutablePath(runtimeDir));
    return normalizedDetail === runtimeDir || normalizedDetail === pythonPath;
  };
  const getRuntimeConfig = () => {
    const config = readConfig();
    const envUrl = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    return {
      pythonRuntimeUrl: config.pythonRuntimeUrl || envUrl || "",
      defaultPythonRuntimeUrl: defaultPythonDownloadUrl() ?? void 0,
      pythonRuntimeDir: runtimePythonDir(),
      installedItems: (config.installedItems ?? []).filter(isManagedPythonInstallItem)
    };
  };
  const saveRuntimeConfig = (nextConfig) => {
    const config = readConfig();
    const pythonRuntimeUrl = nextConfig.pythonRuntimeUrl?.trim();
    writeConfig({
      ...config,
      pythonRuntimeUrl: pythonRuntimeUrl || void 0
    });
  };
  const setInstalledItem = (item) => {
    const config = readConfig();
    const existing = config.installedItems ?? [];
    const nextItems = [
      ...existing.filter((existingItem) => existingItem.label !== item.label),
      item
    ];
    writeConfig({ ...config, installedItems: nextItems });
  };
  const updateSetupState = (next) => {
    setupState = {
      setupStage: next.setupStage,
      setupMessage: next.setupMessage,
      setupProgress: next.setupProgress
    };
  };
  const resolveSidecarRoot = () => sidecarRoots.find((sidecarRoot) => fileExists(sidecarMainPath(sidecarRoot)));
  const isInstalled = () => resolveSidecarRoot() !== void 0;
  function managedPythonExecutablePath(runtimeDir) {
    return process.platform === "win32" ? path.join(runtimeDir, "python.exe") : path.join(runtimeDir, "bin", "python3");
  }
  function getBundledPython(sidecarRoot) {
    const pythonPath = managedPythonExecutablePath(sidecarRoot);
    return fileExists(pythonPath) ? pythonPath : null;
  }
  function pythonDownloadUrl() {
    const config = readConfig();
    const configuredUrl = config.pythonRuntimeUrl?.trim();
    if (configuredUrl) return configuredUrl;
    const override = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    if (override) return override;
    return defaultPythonDownloadUrl();
  }
  function findManagedPython() {
    return getBundledPython(runtimePythonDir());
  }
  async function validateManagedPython(python) {
    try {
      const versionResult = await runPython(python, ["--version"], { timeout: 3e4, maxBuffer: 1024 * 1024 });
      const versionText = `${versionResult.stdout ?? ""}${versionResult.stderr ?? ""}`.trim();
      if (/Python\s+3\.12\./.test(versionText)) return { success: true };
      return { success: false, error: `当前 Python 运行环境不是 Python 3.12: ${versionText || python}` };
    } catch (error) {
      return { success: false, error: `Python 3.12 运行环境校验失败: ${getErrorMessage$1(error)}` };
    }
  }
  async function findReadyPython() {
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
        setupProgress: 100
      });
      return { python: managedPython };
    }
    updateSetupState({ setupStage: "failed", setupMessage: "Python 3.12 运行环境未配置", setupProgress: 0 });
    return { error: "请先到设置里的 Python 配置页完成配置" };
  }
  async function ensurePython() {
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
        status: "skipped"
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
      ensureDir2(archiveDir);
      updateSetupState({ setupStage: "downloading-python", setupMessage: "正在下载 Python 运行环境", setupProgress: 0 });
      const res = await fetchRuntimeArchive(url, partialArchive, (progress) => {
        updateSetupState({
          setupStage: "downloading-python",
          setupMessage: "正在下载 Python 运行环境",
          setupProgress: progress.progress
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
      return { error: `Python 下载失败: ${getErrorMessage$1(error)}` };
    }
  }
  function getDepsPlan(sidecarRoot, python) {
    const reqPath = path.join(sidecarRoot, "requirements.txt");
    if (!fileExists(reqPath)) return {};
    const markerPath = path.join(cacheDir, ".deps-hash");
    const reqContent = readTextFile(reqPath) ?? "";
    const reqHash = crypto$1.createHash("md5").update(`${python}
${reqContent}`).digest("hex");
    return { reqPath, markerPath, reqHash };
  }
  function depsAreReady(sidecarRoot, python) {
    const depsPlan = getDepsPlan(sidecarRoot, python);
    if (!depsPlan.markerPath || !depsPlan.reqHash) return true;
    return readTextFile(depsPlan.markerPath)?.trim() === depsPlan.reqHash;
  }
  async function ensureDeps(sidecarRoot, python) {
    const { reqPath, markerPath, reqHash } = getDepsPlan(sidecarRoot, python);
    if (!reqPath || !markerPath || !reqHash) return { success: true };
    const installedHash = readTextFile(markerPath);
    if (installedHash?.trim() === reqHash) {
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "skipped" });
      return { success: true };
    }
    try {
      updateSetupState({ setupStage: "installing-deps", setupMessage: "正在安装 TTS 依赖", setupProgress: void 0 });
      if (process.platform === "win32") {
        await runPython(python, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cu121"], { timeout: 18e5, maxBuffer: 32 * 1024 * 1024 });
      }
      await runPython(python, ["-m", "pip", "install", "-r", reqPath], { timeout: 18e5, maxBuffer: 32 * 1024 * 1024 });
      ensureDir2(cacheDir);
      writeTextFile(markerPath, reqHash);
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "installed" });
    } catch (error) {
      updateSetupState({ setupStage: "failed", setupMessage: "安装 TTS 依赖失败", setupProgress: void 0 });
      setInstalledItem({ label: "TTS Python 依赖", detail: reqPath, status: "failed" });
      return { success: false, error: `安装依赖失败: ${getErrorMessage$1(error)}` };
    }
    return { success: true };
  }
  async function getBackendHealth() {
    try {
      const payload = await fetchJson(`${baseUrl}/health`, { method: "GET" });
      const service = typeof payload === "object" && payload && "service" in payload ? String(payload.service) : void 0;
      return { healthy: true, service, error: void 0 };
    } catch (error) {
      return { healthy: false, error: getErrorMessage$1(error) };
    }
  }
  async function isBackendHealthy() {
    return (await getBackendHealth()).healthy;
  }
  async function waitUntilHealthy() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 1e3));
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
  async function status() {
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
      error: !running && child ? `TTS 后端进程存在但 HTTP 不可达: ${health.error ?? baseUrl}` : void 0
    });
  }
  async function requestBackendShutdown() {
    const controlToken = getControlToken();
    return fetchJson(`${baseUrl}/shutdown`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manying-TTS-Token": controlToken
      },
      body: JSON.stringify({ token: controlToken })
    });
  }
  async function stopStaleBackendProcess(health) {
    if (health.service !== "manying-voicebox-tts") return false;
    const pids = await findListeningPids(port, host);
    if (pids.length === 0) return false;
    const killed = pids.some((pid) => killProcess(pid));
    if (!killed) return false;
    return waitUntilStopped();
  }
  async function start() {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查本地 TTS 后端", setupProgress: 0 });
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`
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
          error: "本地 TTS 端口已被本地 TTS 残留进程占用，自动清理失败"
        };
      }
    }
    ensureDir2(cacheDir);
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    ensureDir2(modelCacheDir);
    ensureDir2(hfHubCacheDir);
    const pyResult = await findReadyPython();
    if (!pyResult.python) {
      return { success: false, status: await status(), error: pyResult.error };
    }
    if (!depsAreReady(sidecarRoot, pyResult.python)) {
      updateSetupState({ setupStage: "failed", setupMessage: "TTS Python 依赖未配置", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: "请先到设置里的 Python 配置页点击开始配置，完成 TTS 依赖安装"
      };
    }
    const controlToken = getControlToken();
    const backendPython = pyResult.python;
    updateSetupState({ setupStage: "starting-backend", setupMessage: "本地 TTS 后端启动中", setupProgress: void 0 });
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
        cacheDir
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
          MANYING_TTS_CONTROL_TOKEN: controlToken
        }
      }
    );
    const healthy = await waitUntilHealthy();
    if (!healthy) {
      child?.kill();
      child = null;
      updateSetupState({ setupStage: "failed", setupMessage: "本地 TTS 后端启动失败", setupProgress: void 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS backend did not become healthy on ${baseUrl}`
      };
    }
    updateSetupState({ setupStage: "ready", setupMessage: "本地 TTS 后端已就绪", setupProgress: 100 });
    return { success: true, status: await status() };
  }
  async function setup() {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`
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
  async function setModelCacheDir(dirPath) {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再切换模型缓存路径"
      };
    }
    saveModelCacheDir(dirPath);
    return { success: true, status: await status() };
  }
  async function getConfig() {
    return getRuntimeConfig();
  }
  async function setConfig(config) {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再修改 Python 运行环境配置"
      };
    }
    saveRuntimeConfig(config);
    return { success: true, status: await status() };
  }
  async function stop() {
    if (child) {
      child.kill();
      child = null;
      const stopped = await waitUntilStopped();
      if (!stopped) {
        return {
          success: false,
          status: await status(),
          error: "TTS 后端未能在预期时间内停止"
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
          error: "已发送停止请求，但本地 TTS 后端仍在运行"
        };
      } catch (error) {
        const staleStopped = await stopStaleBackendProcess(health);
        if (staleStopped) return { success: true, status: await status() };
        return {
          success: false,
          status: await status(),
          error: `检测到本地 TTS 残留进程，但自动清理失败；请关闭对应 Python 进程后再刷新。原始错误：${getErrorMessage$1(error)}`
        };
      }
    }
    return { success: true, status: await status() };
  }
  function buildRequestOptions(method, body) {
    const hasBody = body !== void 0 && method.toUpperCase() !== "GET";
    const headers = {
      "X-Manying-TTS-Token": getControlToken()
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : void 0
    };
  }
  async function request(method, routePath, body) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchJson(requestUrl, buildRequestOptions(method, body));
    } catch (error) {
      throw new Error(`本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage$1(error)}`);
    }
  }
  async function requestBytes(method, routePath, body) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchBytes(requestUrl, buildRequestOptions(method, body));
    } catch (error) {
      throw new Error(`本地 TTS 后端请求失败: ${method.toUpperCase()} ${requestUrl}: ${getErrorMessage$1(error)}`);
    }
  }
  async function requestFormData(routePath, audioFilePath, referenceText) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      const fileBuffer = fs.readFileSync(audioFilePath);
      const fileName = routePath.split("/").pop() ?? "audio.wav";
      const boundary = `----FormBoundary${crypto$1.randomUUID().replace(/-/g, "")}`;
      const parts = [];
      parts.push(Buffer.from(
        `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${fileName}"\r
Content-Type: application/octet-stream\r
\r
`
      ));
      parts.push(fileBuffer);
      parts.push(Buffer.from("\r\n"));
      if (referenceText) {
        parts.push(Buffer.from(
          `--${boundary}\r
Content-Disposition: form-data; name="reference_text"\r
\r
${referenceText}\r
`
        ));
      }
      parts.push(Buffer.from(`--${boundary}--\r
`));
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Manying-TTS-Token": getControlToken(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`
        },
        body: Buffer.concat(parts)
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
      throw new Error(`本地 TTS 后端请求失败: POST ${requestUrl}: ${getErrorMessage$1(error)}`);
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
    requestFormData
  };
}
const manifestFilename = ".studio-skills-manifest.json";
const agentSkillsDirectory = "agent_skills";
const seedImageFilePattern = /\.(png|jpe?g|gif|webp|svg)$/i;
const blockedSeedDirectoryNames = /* @__PURE__ */ new Set([
  ".cache",
  "__MACOSX",
  "__pycache__",
  "coverage",
  "node_modules"
]);
const blockedSeedFileNames = /* @__PURE__ */ new Set([
  ".DS_Store"
]);
function getStudioSkillStorageRoot(storageBasePath) {
  return path.join(storageBasePath, "skills");
}
function resolveStoredStudioSkillPath(storageRoot, relativePath) {
  const normalizedPath = getStoredStudioSkillRelativePath(normalizeEditableSkillPath(relativePath));
  const targetPath = path.resolve(storageRoot, normalizedPath);
  assertInsideRoot$2(storageRoot, targetPath);
  return { storageRoot, targetPath, normalizedPath };
}
let _skillsSyncDone = false;
let _skillsSyncPromise = null;
function resetStudioSkillsSyncState() {
  _skillsSyncDone = false;
  _skillsSyncPromise = null;
}
async function ensureStudioSkillsSynced(options) {
  if (_skillsSyncDone) return;
  if (_skillsSyncPromise) return _skillsSyncPromise;
  _skillsSyncPromise = (async () => {
    const { storageRoot } = options;
    await fs.promises.mkdir(storageRoot, { recursive: true });
    const manifest = await readManifest(storageRoot);
    await migrateLegacyRootAgentSkills(storageRoot, manifest);
    for (const root of getSourceRoots$1(options)) {
      await syncSeedDirectory(root, root, storageRoot, manifest);
    }
    await writeManifest(storageRoot, manifest);
    _skillsSyncDone = true;
  })();
  _skillsSyncPromise.finally(() => {
    _skillsSyncPromise = null;
  });
  return _skillsSyncPromise;
}
async function listStoredStudioSkillFiles(options) {
  const { storageRoot } = options;
  await ensureStudioSkillsSynced(options);
  if (!fs.existsSync(storageRoot)) return [];
  const manifest = await readManifest(storageRoot);
  const files = await collectMarkdownFiles(storageRoot);
  const records = await Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(storageRoot, filePath).replace(/\\/g, "/");
    const stat = await fs.promises.stat(filePath);
    const sourceRelativePath = getSourceStudioSkillRelativePath(relativePath);
    const sourcePath = findSourcePath(options, sourceRelativePath);
    const isCustomized = sourcePath ? await hashFile$1(filePath) !== await hashFile$1(sourcePath) : true;
    return {
      relativePath,
      filePath,
      storagePath: filePath,
      sourcePath,
      size: stat.size,
      updatedAt: stat.mtimeMs,
      isCustomized,
      isDeleted: false,
      sourceExists: Boolean(sourcePath)
    };
  }));
  const existingPaths = new Set(records.map((record) => record.relativePath));
  for (const root of getSourceRoots$1(options)) {
    const sourceFiles = await collectMarkdownFiles(root);
    for (const sourcePath of sourceFiles) {
      const sourceRelativePath = path.relative(root, sourcePath).replace(/\\/g, "/");
      const storageRelativePath = getStoredStudioSkillRelativePath(sourceRelativePath);
      const deleted = manifest.deleted[storageRelativePath];
      if (!deleted || existingPaths.has(storageRelativePath)) continue;
      const targetPath = path.join(storageRoot, storageRelativePath);
      records.push({
        relativePath: storageRelativePath,
        filePath: targetPath,
        storagePath: targetPath,
        sourcePath,
        size: 0,
        updatedAt: deleted.deletedAt,
        isCustomized: false,
        isDeleted: true,
        deletedAt: deleted.deletedAt,
        sourceExists: true
      });
      existingPaths.add(storageRelativePath);
    }
  }
  return records.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
async function readStoredStudioSkillText(storageRoot, relativePath) {
  const { targetPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  return fs.promises.readFile(targetPath, "utf-8");
}
async function writeStoredStudioSkillText(storageRoot, relativePath, value) {
  const { targetPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, value, "utf-8");
  await clearDeletedManifestEntry(storageRoot, path.relative(storageRoot, targetPath).replace(/\\/g, "/"));
  return fs.promises.stat(targetPath);
}
async function createStoredStudioSkillFile(storageRoot, relativePath, value) {
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  if (fs.existsSync(targetPath)) {
    throw new Error("Studio skill file already exists");
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, value, "utf-8");
  await clearDeletedManifestEntry(storageRoot, normalizedPath);
  const stat = await fs.promises.stat(targetPath);
  return {
    relativePath: normalizedPath,
    filePath: targetPath,
    storagePath: targetPath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    isCustomized: true,
    sourceExists: false
  };
}
async function deleteStoredStudioSkillFile(storageRoot, relativePath) {
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  const manifest = await readManifest(storageRoot);
  manifest.deleted[normalizedPath] = { deletedAt: Date.now() };
  delete manifest.files[normalizedPath];
  await writeManifest(storageRoot, manifest);
  if (!fs.existsSync(targetPath)) return false;
  await fs.promises.unlink(targetPath);
  await pruneEmptyDirectories(path.dirname(targetPath), storageRoot);
  return true;
}
async function restoreStoredStudioSkillFile(options, relativePath) {
  const { storageRoot } = options;
  await fs.promises.mkdir(storageRoot, { recursive: true });
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  const sourceRelativePath = getSourceStudioSkillRelativePath(normalizedPath);
  const sourcePath = findSourcePath(options, sourceRelativePath);
  if (!sourcePath) {
    throw new Error("Bundled studio skill does not exist");
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, targetPath);
  const manifest = await readManifest(storageRoot);
  delete manifest.deleted[normalizedPath];
  manifest.files[normalizedPath] = {
    seedHash: await hashFile$1(sourcePath),
    syncedAt: Date.now()
  };
  await writeManifest(storageRoot, manifest);
  const stat = await fs.promises.stat(targetPath);
  return {
    relativePath: normalizedPath,
    filePath: targetPath,
    storagePath: targetPath,
    sourcePath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    isCustomized: false,
    isDeleted: false,
    sourceExists: true
  };
}
async function markStoredStudioSkillPathDeleted(storageRoot, relativePath) {
  const normalizedPath = normalizeStoredSkillAssetPath(relativePath);
  const targetPath = path.resolve(storageRoot, normalizedPath);
  assertInsideRoot$2(storageRoot, targetPath);
  const manifest = await readManifest(storageRoot);
  manifest.deleted[normalizedPath] = { deletedAt: Date.now() };
  delete manifest.files[normalizedPath];
  await writeManifest(storageRoot, manifest);
}
async function syncSeedDirectory(root, current, storageRoot, manifest) {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(current, entry.name);
    const sourceRelativePath = path.relative(root, sourcePath).replace(/\\/g, "/");
    const storageRelativePath = getStoredStudioSkillRelativePath(sourceRelativePath);
    const targetPath = path.join(storageRoot, storageRelativePath);
    if (entry.isDirectory()) {
      if (!shouldWalkStudioSkillSeedDirectory(sourceRelativePath)) return;
      await fs.promises.mkdir(targetPath, { recursive: true });
      await syncSeedDirectory(root, sourcePath, storageRoot, manifest);
      return;
    }
    if (!entry.isFile()) return;
    if (!shouldSyncStudioSkillSeedFile(sourceRelativePath)) return;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const sourceHash = await hashFile$1(sourcePath);
    if (manifest.deleted[storageRelativePath]) return;
    if (!fs.existsSync(targetPath)) {
      await fs.promises.copyFile(sourcePath, targetPath);
      manifest.files[storageRelativePath] = { seedHash: sourceHash, syncedAt: Date.now() };
      return;
    }
    manifest.files[storageRelativePath] = { seedHash: sourceHash, syncedAt: Date.now() };
  }));
}
async function collectMarkdownFiles(current) {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [entryPath];
  }));
  return files.flat();
}
function shouldWalkStudioSkillSeedDirectory(relativePath) {
  return !relativePath.split("/").some((part) => blockedSeedDirectoryNames.has(part));
}
function shouldSyncStudioSkillSeedFile(relativePath) {
  const filename = path.posix.basename(relativePath);
  if (blockedSeedFileNames.has(filename)) return false;
  if (filename.endsWith(".tmp") || filename.endsWith(".bak")) return false;
  if (filename.endsWith(".map") || filename.endsWith(".tsbuildinfo")) return false;
  return filename.endsWith(".md") || seedImageFilePattern.test(filename);
}
async function readManifest(storageRoot) {
  const manifestPath = path.join(storageRoot, manifestFilename);
  try {
    const raw = await fs.promises.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version === 1 && parsed.files && typeof parsed.files === "object") {
      return {
        version: 1,
        files: parsed.files,
        deleted: parsed.deleted && typeof parsed.deleted === "object" ? parsed.deleted : {}
      };
    }
  } catch {
  }
  return { version: 1, files: {}, deleted: {} };
}
function getSourceRoots$1(options) {
  const roots = [options.sourceRoot, ...options.fallbackSourceRoots ?? []].map((root) => path.resolve(root)).filter((root) => fs.existsSync(root));
  return [...new Set(roots)];
}
function findSourcePath(options, relativePath) {
  for (const root of getSourceRoots$1(options)) {
    const sourcePath = path.resolve(root, relativePath);
    assertInsideRoot$2(root, sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return void 0;
}
async function writeManifest(storageRoot, manifest) {
  await fs.promises.writeFile(
    path.join(storageRoot, manifestFilename),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
}
async function hashFile$1(filePath) {
  const hash = crypto$1.createHash("sha256");
  hash.update(await fs.promises.readFile(filePath));
  return hash.digest("hex");
}
async function pruneEmptyDirectories(current, stopAt) {
  const normalizedStop = path.resolve(stopAt);
  let next = path.resolve(current);
  while (next !== normalizedStop && next.startsWith(normalizedStop + path.sep)) {
    const entries = await fs.promises.readdir(next).catch(() => []);
    if (entries.length > 0) return;
    await fs.promises.rmdir(next).catch(() => {
    });
    next = path.dirname(next);
  }
}
async function clearDeletedManifestEntry(storageRoot, relativePath) {
  const manifest = await readManifest(storageRoot);
  if (!manifest.deleted[relativePath]) return;
  delete manifest.deleted[relativePath];
  await writeManifest(storageRoot, manifest);
}
function normalizeEditableSkillPath(relativePath) {
  const rawPath = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(rawPath)) {
    throw new Error("Invalid studio skill path");
  }
  const normalizedPath = path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath === "." || normalizedPath.startsWith("../") || normalizedPath.includes("/../") || !normalizedPath.endsWith(".md")) {
    throw new Error("Invalid studio skill path");
  }
  return normalizedPath;
}
function normalizeStoredSkillAssetPath(relativePath) {
  const rawPath = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(rawPath)) {
    throw new Error("Invalid studio skill path");
  }
  const normalizedPath = path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath === "." || normalizedPath.startsWith("../") || normalizedPath.includes("/../") || normalizedPath === manifestFilename || normalizedPath.endsWith(`/${manifestFilename}`)) {
    throw new Error("Invalid studio skill path");
  }
  return normalizedPath;
}
function getStoredStudioSkillRelativePath(relativePath) {
  if (!relativePath.includes("/") && relativePath.endsWith(".md")) {
    return `${agentSkillsDirectory}/${relativePath}`;
  }
  return relativePath;
}
function getSourceStudioSkillRelativePath(relativePath) {
  if (relativePath.startsWith(`${agentSkillsDirectory}/`)) {
    return relativePath.slice(agentSkillsDirectory.length + 1);
  }
  return relativePath;
}
async function migrateLegacyRootAgentSkills(storageRoot, manifest) {
  const entries = await fs.promises.readdir(storageRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".md")) return;
    const legacyPath = path.join(storageRoot, entry.name);
    const targetPath = path.join(storageRoot, agentSkillsDirectory, entry.name);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    if (!fs.existsSync(targetPath)) {
      await fs.promises.rename(legacyPath, targetPath);
      migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${entry.name}`);
      return;
    }
    const legacyHash = await hashFile$1(legacyPath);
    const targetHash = await hashFile$1(targetPath);
    if (legacyHash === targetHash) {
      await fs.promises.unlink(legacyPath);
      migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${entry.name}`);
      return;
    }
    const parsed = path.parse(entry.name);
    const conflictName = `${parsed.name}.legacy-${Date.now()}${parsed.ext}`;
    await fs.promises.rename(legacyPath, path.join(storageRoot, agentSkillsDirectory, conflictName));
    migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${conflictName}`);
  }));
}
function migrateManifestEntry(manifest, from, to) {
  if (manifest.files[from]) {
    manifest.files[to] = manifest.files[from];
    delete manifest.files[from];
  }
  if (manifest.deleted[from]) {
    manifest.deleted[to] = manifest.deleted[from];
    delete manifest.deleted[from];
  }
}
function assertInsideRoot$2(root, targetPath) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Studio skill path escapes storage root");
  }
}
const STUDIO_VISUAL_MANUAL_MODULES = [
  { label: "README", value: "README", relativePath: "README.md" },
  { label: "前缀", value: "prefix", relativePath: "prefix.md" },
  { label: "角色", value: "art_character", relativePath: "art_prompt/art_character.md" },
  { label: "角色衍生", value: "art_character_derivative", relativePath: "art_prompt/art_character_derivative.md" },
  { label: "道具", value: "art_prop", relativePath: "art_prompt/art_prop.md" },
  { label: "道具衍生", value: "art_prop_derivative", relativePath: "art_prompt/art_prop_derivative.md" },
  { label: "场景", value: "art_scene", relativePath: "art_prompt/art_scene.md" },
  { label: "场景衍生", value: "art_scene_derivative", relativePath: "art_prompt/art_scene_derivative.md" },
  { label: "分镜", value: "director_storyboard", relativePath: "driector_skills/director_storyboard.md" },
  { label: "分镜视频", value: "art_storyboard_video", relativePath: "art_prompt/art_storyboard_video.md" },
  { label: "技法-导演规划", value: "director_planning_style", relativePath: "driector_skills/director_planning_style.md" },
  { label: "技法-分镜表设计", value: "director_storyboard_table_style", relativePath: "driector_skills/director_storyboard_table_style.md" }
];
const imageFilePattern = /\.(png|jpe?g|gif|webp|svg)$/i;
async function listStoredVisualManuals(options) {
  await ensureStudioSkillsSynced(options);
  const artRoot = path.join(options.storageRoot, "art_skills");
  if (!fs.existsSync(artRoot)) return [];
  const entries = await fs.promises.readdir(artRoot, { withFileTypes: true });
  const manuals = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readStoredVisualManualSummary(options, entry.name)));
  return manuals.sort((left, right) => {
    const categoryDelta = getCategorySortIndex(left.category) - getCategorySortIndex(right.category);
    if (categoryDelta !== 0) return categoryDelta;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}
async function readStoredVisualManual(options, stylePath) {
  await ensureStudioSkillsSynced(options);
  const normalizedStylePath = normalizeStylePath(stylePath);
  const summary = await readStoredVisualManualSummary(options, normalizedStylePath);
  return {
    ...summary,
    modules: await readVisualManualModules(options.storageRoot, normalizedStylePath)
  };
}
async function writeStoredVisualManual(storageRoot, stylePath, payload) {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (!fs.existsSync(manualRoot)) {
    throw new Error("视觉风格不存在");
  }
  const moduleByValue = new Map(payload.modules.map((module2) => [module2.value, module2.content]));
  if (payload.name.trim()) {
    const existingReadme = moduleByValue.get("README") ?? await readOptionalText(path.join(manualRoot, "README.md"));
    moduleByValue.set("README", applyManualName(payload.name.trim(), existingReadme));
  }
  await Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => {
    if (!moduleByValue.has(definition.value)) return;
    const filePath = resolveVisualManualFile(storageRoot, normalizedStylePath, definition.relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, moduleByValue.get(definition.value) ?? "", "utf-8");
  }));
  if (payload.images) {
    await writeVisualManualImages(storageRoot, normalizedStylePath, payload.images);
  }
}
async function writeStoredVisualManualImages(storageRoot, stylePath, payload) {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (!fs.existsSync(manualRoot)) {
    throw new Error("视觉风格不存在");
  }
  await writeVisualManualImages(storageRoot, normalizedStylePath, payload.images);
}
async function createStoredVisualManual(storageRoot, payload) {
  const normalizedStylePath = normalizeStylePath(payload.stylePath);
  const manualRoot = resolveVisualManualDirectory(storageRoot, normalizedStylePath);
  if (fs.existsSync(manualRoot)) {
    throw new Error("视觉风格目录已存在");
  }
  await Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => {
    const filePath = resolveVisualManualFile(storageRoot, normalizedStylePath, definition.relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const content = definition.value === "README" ? [`# ${payload.name.trim() || normalizedStylePath}`, payload.description?.trim() ?? ""].filter(Boolean).join("\n\n") + "\n" : "";
    await fs.promises.writeFile(filePath, content, "utf-8");
  }));
  await fs.promises.mkdir(path.join(manualRoot, "images"), { recursive: true });
  return normalizedStylePath;
}
async function duplicateStoredVisualManual(sourceStorageRoot, sourceStylePath, payload, targetStorageRoot) {
  const normalizedSource = normalizeStylePath(sourceStylePath);
  const normalizedTarget = normalizeStylePath(payload.stylePath);
  const sourceRoot = resolveVisualManualDirectory(sourceStorageRoot, normalizedSource);
  const destRoot = sourceStorageRoot;
  const targetRoot = path.resolve(destRoot, "art_skills", normalizedTarget);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`源风格目录不存在: ${normalizedSource}`);
  }
  if (fs.existsSync(targetRoot)) {
    throw new Error("目标风格目录已存在");
  }
  await copyDirRecursive(sourceRoot, targetRoot);
  const readmePath = path.join(targetRoot, "README.md");
  if (fs.existsSync(readmePath)) {
    const content = await fs.promises.readFile(readmePath, "utf-8");
    const newContent = content.replace(/^#\s+.*/m, `# ${payload.name.trim() || normalizedTarget}`);
    await fs.promises.writeFile(readmePath, newContent, "utf-8");
  }
  return normalizedTarget;
}
async function copyDirRecursive(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
async function readStoredVisualManualSummary(options, stylePath) {
  const normalizedStylePath = normalizeStylePath(stylePath);
  const manualRoot = resolveVisualManualDirectory(options.storageRoot, normalizedStylePath);
  const readme = await readOptionalText(path.join(manualRoot, "README.md"));
  const modules = await readVisualManualModules(options.storageRoot, normalizedStylePath);
  const sourcePath = findVisualManualSourcePath(options, normalizedStylePath);
  const sourceExists = Boolean(sourcePath);
  const moduleCount = modules.filter((module2) => module2.content.trim()).length;
  const images = await collectVisualManualImages(options.storageRoot, normalizedStylePath, options.makeFileUrl);
  return {
    id: normalizedStylePath,
    stylePath: normalizedStylePath,
    name: getManualName(readme, normalizedStylePath),
    description: getManualDescription(readme),
    category: getManualCategory(normalizedStylePath),
    storagePath: manualRoot,
    sourcePath,
    sourceExists,
    isCustomized: sourceExists ? await hasCustomizedManualFiles(options, normalizedStylePath) : true,
    moduleCount,
    imageCount: images.length,
    images
  };
}
async function readVisualManualModules(storageRoot, stylePath) {
  return Promise.all(STUDIO_VISUAL_MANUAL_MODULES.map(async (definition) => ({
    ...definition,
    content: await readOptionalText(resolveVisualManualFile(storageRoot, stylePath, definition.relativePath))
  })));
}
async function collectVisualManualImages(storageRoot, stylePath, makeFileUrl) {
  const imagesRoot = resolveVisualManualDirectory(storageRoot, path.posix.join(stylePath, "images"));
  if (!fs.existsSync(imagesRoot)) return [];
  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && imageFilePattern.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")).map((entry) => {
    const relativePath = path.posix.join("art_skills", stylePath, "images", entry.name);
    const filePath = path.join(imagesRoot, entry.name);
    return {
      name: entry.name,
      relativePath,
      filePath,
      url: makeFileUrl(relativePath)
    };
  });
}
async function writeVisualManualImages(storageRoot, stylePath, images) {
  const manualRoot = resolveVisualManualDirectory(storageRoot, stylePath);
  const imagesRoot = path.join(manualRoot, "images");
  await fs.promises.mkdir(imagesRoot, { recursive: true });
  const retainedNames = /* @__PURE__ */ new Set();
  for (const image of images) {
    if (image.relativePath) {
      const existingName = getRetainedImageName(stylePath, image.relativePath);
      if (existingName) retainedNames.add(existingName);
      continue;
    }
    if (!image.dataUrl) continue;
    const imageBuffer = parseDataUrlImage(image.dataUrl);
    const targetName = makeUniqueImageFilename(imagesRoot, image.name, imageBuffer.extension);
    await fs.promises.writeFile(path.join(imagesRoot, targetName), imageBuffer.buffer);
    retainedNames.add(targetName);
  }
  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !imageFilePattern.test(entry.name)) return;
    if (retainedNames.has(entry.name)) return;
    const relativePath = path.posix.join("art_skills", stylePath, "images", entry.name);
    await markStoredStudioSkillPathDeleted(storageRoot, relativePath);
    await fs.promises.unlink(path.join(imagesRoot, entry.name));
  }));
}
function getRetainedImageName(stylePath, relativePath) {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/").replace(/^\/+/, ""));
  const expectedPrefix = path.posix.join("art_skills", stylePath, "images") + "/";
  if (!normalized.startsWith(expectedPrefix)) return null;
  const filename = path.posix.basename(normalized);
  if (!filename || filename.includes("/") || !imageFilePattern.test(filename)) return null;
  return filename;
}
function parseDataUrlImage(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml));base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("无效的参考图数据");
  }
  const mimeType = match[1].toLowerCase();
  const extension = mimeType.includes("png") ? ".png" : mimeType.includes("webp") ? ".webp" : mimeType.includes("gif") ? ".gif" : mimeType.includes("svg") ? ".svg" : ".jpg";
  return {
    buffer: Buffer.from(match[2], "base64"),
    extension
  };
}
function makeUniqueImageFilename(imagesRoot, originalName, extension) {
  const parsed = path.parse(originalName ?? "");
  const safeName = parsed.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const baseName = safeName || "style-ref";
  let filename = `${baseName}-${crypto$1.randomUUID()}${extension}`;
  while (fs.existsSync(path.join(imagesRoot, filename))) {
    filename = `${baseName}-${crypto$1.randomUUID()}${extension}`;
  }
  return filename;
}
async function hasCustomizedManualFiles(options, stylePath) {
  for (const definition of STUDIO_VISUAL_MANUAL_MODULES) {
    const storedPath = resolveVisualManualFile(options.storageRoot, stylePath, definition.relativePath);
    const sourcePath = findVisualManualSourceFilePath(options, stylePath, definition.relativePath);
    const storedExists = fs.existsSync(storedPath);
    if (!storedExists && !sourcePath) continue;
    if (!storedExists || !sourcePath) return true;
    if (await hashFile(storedPath) !== await hashFile(sourcePath)) return true;
  }
  if (await hasCustomizedManualImages(options, stylePath)) return true;
  return false;
}
async function hasCustomizedManualImages(options, stylePath) {
  const sourceImagesRoot = findVisualManualSourceDirectory(options, path.posix.join(stylePath, "images"));
  const storedImagesRoot = resolveVisualManualDirectory(options.storageRoot, path.posix.join(stylePath, "images"));
  const sourceImages = sourceImagesRoot ? await collectImageHashes(sourceImagesRoot) : /* @__PURE__ */ new Map();
  const storedImages = await collectImageHashes(storedImagesRoot);
  if (sourceImages.size !== storedImages.size) return true;
  for (const [filename, hash] of sourceImages) {
    if (storedImages.get(filename) !== hash) return true;
  }
  return false;
}
async function collectImageHashes(imagesRoot) {
  const result = /* @__PURE__ */ new Map();
  if (!fs.existsSync(imagesRoot)) return result;
  const entries = await fs.promises.readdir(imagesRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !imageFilePattern.test(entry.name)) return;
    result.set(entry.name, await hashFile(path.join(imagesRoot, entry.name)));
  }));
  return result;
}
async function readOptionalText(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
function applyManualName(name, readme) {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex < 0) return `${name}
`;
  const prefix = lines[firstLineIndex].match(/^(\s*#+\s*)/)?.[1] ?? "";
  lines[firstLineIndex] = `${prefix}${name}`;
  return lines.join("\n");
}
function getManualName(readme, fallback) {
  const firstLine = readme.split(/\r?\n/).find((line) => line.trim());
  return cleanManualText(firstLine ?? fallback) || fallback;
}
function getManualDescription(readme) {
  const lines = readme.split(/\r?\n/).map((line) => cleanManualText(line)).filter(Boolean);
  return lines.find((line, index) => index > 0 && !line.startsWith("#"))?.slice(0, 180);
}
function cleanManualText(value) {
  return value.replace(/^#+\s*/, "").replace(/--/g, "").trim();
}
function getManualCategory(stylePath) {
  const lower = stylePath.toLowerCase();
  if (lower.includes("daojie")) return "daojie";
  if (lower.startsWith("2d") || lower.includes("_2d")) return "2d";
  if (lower.startsWith("3d") || lower.includes("_3d")) return "3d";
  if (lower.includes("realpeople") || lower.includes("real")) return "real";
  if (lower.includes("stop_motion") || lower.includes("stopmotion")) return "stop_motion";
  return "other";
}
function getCategorySortIndex(category) {
  return {
    daojie: 0,
    "2d": 1,
    "3d": 2,
    real: 3,
    stop_motion: 4,
    other: 5
  }[category];
}
function getSourceRoots(options) {
  return [options.sourceRoot, ...options.fallbackSourceRoots ?? []].map((root) => path.resolve(root)).filter((root) => fs.existsSync(root));
}
function findVisualManualSourcePath(options, stylePath) {
  return findVisualManualSourceDirectory(options, stylePath);
}
function findVisualManualSourceDirectory(options, relativePath) {
  for (const root of getSourceRoots(options)) {
    const sourcePath = path.resolve(root, "art_skills", relativePath);
    assertInsideRoot$1(path.join(root, "art_skills"), sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return void 0;
}
function findVisualManualSourceFilePath(options, stylePath, relativePath) {
  for (const root of getSourceRoots(options)) {
    const sourcePath = path.resolve(root, "art_skills", stylePath, relativePath);
    assertInsideRoot$1(path.join(root, "art_skills", stylePath), sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return void 0;
}
function normalizeStylePath(stylePath) {
  const normalized = path.posix.normalize(stylePath.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("/")) {
    throw new Error("无效的视觉风格路径");
  }
  return normalized;
}
function resolveVisualManualDirectory(storageRoot, relativePath) {
  const targetPath = path.resolve(storageRoot, "art_skills", relativePath);
  assertInsideRoot$1(path.join(storageRoot, "art_skills"), targetPath);
  return targetPath;
}
function resolveVisualManualFile(storageRoot, stylePath, relativePath) {
  const targetPath = path.resolve(storageRoot, "art_skills", stylePath, relativePath);
  assertInsideRoot$1(path.join(storageRoot, "art_skills", stylePath), targetPath);
  return targetPath;
}
function assertInsideRoot$1(root, targetPath) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error("视觉风格路径越界");
  }
}
async function hashFile(filePath) {
  const hash = crypto$1.createHash("sha256");
  hash.update(await fs.promises.readFile(filePath));
  return hash.digest("hex");
}
const execFileAsync$2 = node_util.promisify(node_child_process.execFile);
const IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const DB_ASSET_TYPES = /* @__PURE__ */ new Set(["role", "scene", "tool", "audio"]);
const FILE_ASSET_CACHE_TTL_MS = 3e4;
const fileAssetCache = /* @__PURE__ */ new Map();
function getToonflowDataRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "toonflow", "data");
}
function getToonflowOssRoot() {
  return path.join(getToonflowDataRoot(), "oss");
}
function resolveToonflowAssetPath(requestUrl) {
  const url = new URL(requestUrl);
  const relativePath = [
    url.hostname,
    ...url.pathname.split("/").filter(Boolean)
  ].map((part) => decodeURIComponent(part)).join("/");
  const ossRoot = path.resolve(getToonflowOssRoot());
  const filePath = path.resolve(ossRoot, relativePath.replace(/^oss[\\/]/, ""));
  if (filePath !== ossRoot && !filePath.startsWith(ossRoot + path.sep)) {
    throw new Error("Toonflow asset path escapes storage root");
  }
  return filePath;
}
async function listStudioRuntimeAssets(request) {
  const type = normalizeAssetKind(request.type);
  const search = (request.search ?? "").trim();
  const offset = clampInteger(request.offset, 0, 2e5, 0);
  const limit = clampInteger(request.limit, 1, 500, 120);
  try {
    const response = DB_ASSET_TYPES.has(type) ? await listAssetsFromSqlite({ type, search, offset, limit }) : await listAssetsFromFiles({ type, search, offset, limit, refresh: Boolean(request.refresh) });
    return {
      ...response,
      roots: {
        toonflowDataRoot: getToonflowDataRoot(),
        toonflowOssRoot: getToonflowOssRoot()
      }
    };
  } catch (error) {
    const fallback = await listAssetsFromFiles({ type, search, offset, limit, refresh: Boolean(request.refresh) }).catch((fallbackError) => ({
      success: false,
      items: [],
      total: 0,
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    }));
    return {
      ...fallback,
      error: fallback.success ? void 0 : error instanceof Error ? error.message : String(error),
      roots: {
        toonflowDataRoot: getToonflowDataRoot(),
        toonflowOssRoot: getToonflowOssRoot()
      }
    };
  }
}
async function listAssetsFromSqlite(input) {
  const dbPath = path.join(getToonflowDataRoot(), "db2.sqlite");
  if (!fs.existsSync(dbPath)) {
    return listAssetsFromFiles(input);
  }
  const typeCondition = `a.type = ${sqlString(input.type)}`;
  const searchCondition = input.search ? ` and (a.name like ${sqlString(`%${input.search}%`)} or a.describe like ${sqlString(`%${input.search}%`)})` : "";
  const where = `a.assetsId is null and ${typeCondition}${searchCondition}`;
  const query = `
    select
      a.id,
      a.name,
      a.type,
      a.prompt,
      a.describe,
      a.remark,
      a.projectId,
      i.filePath,
      i.state,
      (
        select count(*)
        from o_assets child
        where child.assetsId = a.id
      ) as childrenCount
    from o_assets a
    left join o_image i on a.imageId = i.id
    where ${where}
    order by a.id asc
    limit ${input.limit}
    offset ${input.offset};
  `;
  const countQuery = `select count(*) as total from o_assets a where ${where};`;
  const [itemsOutput, countOutput] = await Promise.all([
    runSqliteJson$1(dbPath, query),
    runSqliteJson$1(dbPath, countQuery)
  ]);
  return {
    success: true,
    items: itemsOutput.map((row) => mapRuntimeAssetRow(row, input.type)).filter((item) => Boolean(item)),
    total: Number(countOutput[0]?.total ?? 0)
  };
}
async function listAssetsFromFiles(input) {
  const entries = collectCachedFileAssets(input.type, Boolean(input.refresh));
  const keyword = input.search.toLocaleLowerCase("zh-Hans-CN");
  const filtered = keyword ? entries.filter((item) => {
    const haystack = `${item.name} ${item.description ?? ""} ${item.sourcePath ?? ""}`.toLocaleLowerCase("zh-Hans-CN");
    return haystack.includes(keyword);
  }) : entries;
  return {
    success: true,
    items: filtered.slice(input.offset, input.offset + input.limit),
    total: filtered.length
  };
}
function collectCachedFileAssets(type, refresh) {
  const cached = fileAssetCache.get(type);
  if (!refresh && cached && Date.now() - cached.createdAt < FILE_ASSET_CACHE_TTL_MS) {
    return cached.items;
  }
  const items = collectFileAssets(type);
  fileAssetCache.set(type, { createdAt: Date.now(), items });
  return items;
}
function collectFileAssets(type) {
  const ossRoot = getToonflowOssRoot();
  if (!fs.existsSync(ossRoot)) return [];
  const projectDirs = fs.readdirSync(ossRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => entry.name).sort();
  const entries = [];
  for (const projectId of projectDirs) {
    for (const relDir of getFileAssetDirs(type)) {
      const absoluteDir = path.join(ossRoot, projectId, relDir);
      if (!fs.existsSync(absoluteDir)) continue;
      const files = fs.readdirSync(absoluteDir, { withFileTypes: true }).filter((entry) => entry.isFile() && isSupportedAssetExtension(type, entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
      for (const filename of files) {
        const relPath = joinOssRelative(projectId, relDir, filename);
        const sourcePath = path.join(ossRoot, relPath);
        const name = path.basename(filename, path.extname(filename));
        const thumbnailRelPath = resolveThumbnailRelPath(relPath, type);
        entries.push({
          id: `toonflow-file:${type}:${relPath}`,
          source: "toonflow-runtime",
          type,
          name,
          description: `本地 ${type === "clip" ? "视频" : "素材"}文件`,
          setting: sourcePath,
          thumbnailUrl: thumbnailRelPath ? toToonflowAssetUrl(thumbnailRelPath) : void 0,
          previewUrl: toToonflowAssetUrl(relPath),
          filePath: `/${relPath}`,
          sourcePath,
          state: "success"
        });
      }
    }
  }
  if (type === "clip") {
    entries.push(...collectStaticClipAssets());
  }
  return entries;
}
function collectStaticClipAssets() {
  const assetsRoot = path.join(getToonflowDataRoot(), "assets");
  if (!fs.existsSync(assetsRoot)) return [];
  return fs.readdirSync(assetsRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && isSupportedAssetExtension("clip", entry.name)).map((entry) => {
    const sourcePath = path.join(assetsRoot, entry.name);
    const name = path.basename(entry.name, path.extname(entry.name));
    return {
      id: `toonflow-static-clip:${entry.name}`,
      source: "toonflow-runtime",
      type: "clip",
      name,
      description: "本地视频素材",
      setting: sourcePath,
      previewUrl: `file://${sourcePath}`,
      filePath: sourcePath,
      sourcePath,
      state: "success"
    };
  });
}
function mapRuntimeAssetRow(row, fallbackType) {
  const type = normalizeAssetKind(row.type ?? fallbackType);
  const filePath = normalizeOssRelativePath(row.filePath);
  const thumbnailPath = filePath ? resolveThumbnailRelPath(filePath, type) : void 0;
  const previewPath = filePath;
  const name = String(row.name ?? "").trim() || (filePath ? path.basename(filePath, path.extname(filePath)) : "未命名素材");
  return {
    id: `toonflow-db:${row.id ?? `${type}:${filePath || name}`}`,
    source: "toonflow-runtime",
    type,
    name,
    description: normalizeDescription(row.describe),
    setting: normalizeDescription(row.remark || row.describe),
    remark: normalizeDescription(row.remark),
    prompt: row.prompt || void 0,
    thumbnailUrl: thumbnailPath ? toToonflowAssetUrl(thumbnailPath) : void 0,
    previewUrl: previewPath ? toToonflowAssetUrl(previewPath) : void 0,
    filePath: filePath ? `/${filePath}` : void 0,
    sourcePath: filePath ? path.join(getToonflowOssRoot(), filePath) : void 0,
    state: row.state,
    childrenCount: Number(row.childrenCount ?? 0)
  };
}
async function runSqliteJson$1(dbPath, query) {
  const { stdout } = await execFileAsync$2("sqlite3", ["-json", dbPath, query], {
    maxBuffer: 20 * 1024 * 1024
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}
function getFileAssetDirs(type) {
  switch (type) {
    case "role":
      return ["assets/role", "role"];
    case "scene":
      return ["assets/scene", "scene"];
    case "tool":
      return ["assets/tool", "props"];
    case "audio":
      return ["audio"];
    case "clip":
      return ["video", "assets"];
  }
}
function resolveThumbnailRelPath(relPath, type) {
  if (type !== "role" && type !== "scene" && type !== "tool") return void 0;
  const smallImagePath = joinOssRelative("smallImage", relPath);
  return fs.existsSync(path.join(getToonflowOssRoot(), smallImagePath)) ? smallImagePath : relPath;
}
function isSupportedAssetExtension(type, filename) {
  const extension = path.extname(filename).toLowerCase();
  if (type === "audio") return AUDIO_EXTENSIONS.has(extension);
  if (type === "clip") return VIDEO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
  return IMAGE_EXTENSIONS.has(extension);
}
function toToonflowAssetUrl(relPath) {
  return `toonflow-asset://oss/${relPath.split(/[\\/]+/).map((part) => encodeURIComponent(part)).join("/")}`;
}
function joinOssRelative(...parts) {
  return parts.flatMap((part) => part.split(/[\\/]+/)).filter(Boolean).join("/");
}
function normalizeOssRelativePath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^[\\/]+/, "").replace(/\\/g, "/");
}
function normalizeDescription(value) {
  if (typeof value !== "string") return void 0;
  const cleaned = value.trim();
  if (!cleaned) return void 0;
  const parts = cleaned.split("|").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" / ") : cleaned;
}
function normalizeAssetKind(value) {
  if (value === "role" || value === "scene" || value === "tool" || value === "clip" || value === "audio") {
    return value;
  }
  return "tool";
}
function clampInteger(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}
function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;
function parseAssetNames(value, fallback = "未命名素材") {
  const rawName = value?.trim() ?? "";
  const names = uniqueNames(
    rawName.split(/[;；]/).map(cleanAssetNameSegment).filter(Boolean)
  );
  const allNames = names.length > 0 ? names : [fallback];
  return {
    rawName,
    primaryName: allNames[0] ?? fallback,
    secondaryNames: allNames.slice(1),
    allNames
  };
}
function assetNameMatchesQuery(assetName, query) {
  const normalizedQuery = normalizeComparableName(query);
  if (!normalizedQuery) return false;
  return parseAssetNames(assetName).allNames.some((name) => normalizeComparableName(name) === normalizedQuery);
}
function cleanAssetNameSegment(value) {
  const text = value.trim();
  if (!text) return "";
  const fileName = text.split(/[\\/]/).filter(Boolean).pop() || text;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}
function normalizeComparableName(value) {
  return cleanAssetNameSegment(value).replace(/\s+/g, "").toLocaleLowerCase("zh-Hans-CN");
}
function uniqueNames(names) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const name of names) {
    const key = normalizeComparableName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
const execFileAsync$1 = node_util.promisify(node_child_process.execFile);
let basePath = "";
function initAssetsStorage(storageBasePath) {
  basePath = storageBasePath;
  const assetsDir = getAssetsDir();
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "role"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "scene"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "tool"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "clip"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "files", "audio"), { recursive: true });
  ensureDb();
}
function getAssetsDir() {
  return path.join(basePath, "assets");
}
function getDbPath() {
  return path.join(getAssetsDir(), "assets.db");
}
function getFilesDir() {
  return path.join(getAssetsDir(), "files");
}
function getThumbsDir() {
  return path.join(getAssetsDir(), "thumbs");
}
function resolveAssetManagedPath(root, relativePath) {
  const normalizedRoot = path.resolve(root);
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelativePath || normalizedRelativePath.includes("\0") || normalizedRelativePath.split("/").includes("..")) {
    throw new Error("Asset path escapes managed root");
  }
  const targetPath = path.resolve(normalizedRoot, normalizedRelativePath);
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Asset path escapes managed root");
  }
  return targetPath;
}
function shouldCreateAssetThumbnail(type) {
  return type !== "audio" && type !== "clip";
}
let thumbActive = 0;
const thumbQueue = [];
const thumbQueued = /* @__PURE__ */ new Set();
function pumpThumbQueue() {
  while (thumbActive < 4 && thumbQueue.length > 0) {
    const job = thumbQueue.shift();
    thumbActive++;
    job();
  }
}
function enqueueThumb(srcPath, thumbPath) {
  if (thumbQueued.has(thumbPath)) return;
  thumbQueued.add(thumbPath);
  thumbQueue.push(() => {
    node_child_process.execFile("sips", ["-z", "200", "200", srcPath, "--out", thumbPath], () => {
      thumbActive--;
      thumbQueued.delete(thumbPath);
      pumpThumbQueue();
    });
  });
  pumpThumbQueue();
}
function getThumbUrl(filePath, type) {
  if (!filePath) return void 0;
  if (!shouldCreateAssetThumbnail(type)) {
    const srcPath2 = resolveAssetManagedPath(getFilesDir(), filePath);
    return fs.existsSync(srcPath2) ? `file://${srcPath2}` : void 0;
  }
  const thumbPath = resolveAssetManagedPath(getThumbsDir(), filePath);
  if (fs.existsSync(thumbPath)) return `file://${thumbPath}`;
  const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
  if (!fs.existsSync(srcPath)) return void 0;
  const thumbDir = path.dirname(thumbPath);
  fs.mkdirSync(thumbDir, { recursive: true });
  enqueueThumb(srcPath, thumbPath);
  return `file://${srcPath}`;
}
function ensureDb() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) return;
  const schema = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  setting TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  filePath TEXT,
  images TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manying-local',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
`;
  runSqliteSync(dbPath, schema);
  const jsonPath = path.join(getAssetsDir(), "db.json");
  if (fs.existsSync(jsonPath)) {
    migrateFromJson(jsonPath, dbPath);
  }
}
function runSqliteSync(dbPath, sql) {
  node_child_process.execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024 });
}
async function runSqliteJson(dbPath, query) {
  const { stdout } = await execFileAsync$1("sqlite3", ["-json", dbPath, query], {
    maxBuffer: 20 * 1024 * 1024
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}
function runSqliteExec(dbPath, sql) {
  node_child_process.execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024 });
}
function escapeSql(value) {
  return value.replace(/'/g, "''");
}
function escapeSqlLike(value) {
  return escapeSql(value).replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function buildAssetWhere(type, search, category) {
  const conds = [`type='${escapeSql(type)}'`];
  if (search) conds.push(`(name LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\' OR prompt LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\')`);
  if (category) conds.push(`tags LIKE '%"${escapeSql(category)}"%'`);
  return `WHERE ${conds.join(" AND ")}`;
}
function buildAssetNameCandidateCondition(name) {
  const exact = escapeSql(name);
  const like = escapeSqlLike(name);
  return `(name='${exact}' OR name LIKE '%${like}%' ESCAPE '\\' OR remark LIKE '%${like}%' ESCAPE '\\')`;
}
function runSqliteExecSafe(dbPath, sql) {
  node_child_process.execFileSync("sqlite3", [dbPath], { input: sql, maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
function runSqliteJsonSync(dbPath, query) {
  const stdout = node_child_process.execFileSync("sqlite3", ["-json", dbPath, query], { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
  if (!stdout) return [];
  return JSON.parse(stdout);
}
function migrateFromJson(jsonPath, dbPath) {
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    const assets = data.assets || [];
    if (!assets.length) return;
    const batchSize = 200;
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
      const values = batch.map((a) => {
        const id = a.id || crypto$1.randomUUID();
        const tags = JSON.stringify(a.tags || []);
        const images = JSON.stringify(a.images || []);
        const now = a.createdAt || (/* @__PURE__ */ new Date()).toISOString();
        return `('${escapeSql(id)}','${escapeSql(a.type || "")}','${escapeSql(a.name || "")}','${escapeSql(a.description || "")}','${escapeSql(a.prompt || "")}','${escapeSql(a.setting || "")}','${escapeSql(a.remark || "")}','${escapeSql(tags)}','${escapeSql(a.filePath || "")}','${escapeSql(images)}','${escapeSql(a.source || "manying-local")}','${escapeSql(now)}','${escapeSql(now)}')`;
      }).join(",\n");
      const sql = `INSERT OR IGNORE INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES
${values};`;
      runSqliteExec(dbPath, sql);
    }
    fs.renameSync(jsonPath, jsonPath + ".migrated");
  } catch (e) {
    console.error("migrateFromJson failed:", e);
  }
}
async function listAssets(type, search, offset = 0, limit = 60, category) {
  const dbPath = getDbPath();
  const where = buildAssetWhere(type, search, category);
  const countResult = await runSqliteJson(dbPath, `SELECT count(*) as cnt FROM assets ${where};`);
  const total = countResult[0]?.cnt ?? 0;
  const rows = await runSqliteJson(
    dbPath,
    `SELECT id, type, name, description, filePath, tags FROM assets ${where} ORDER BY rowid ASC LIMIT ${limit} OFFSET ${offset};`
  );
  const items = rows.map((row) => {
    const absPath = row.filePath ? path.join(getFilesDir(), row.filePath) : void 0;
    const previewUrl = absPath ? `file://${absPath}` : void 0;
    let tags = [];
    try {
      tags = row.tags ? JSON.parse(row.tags) : [];
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      source: "manying-local",
      type: row.type,
      name: row.name,
      description: row.description,
      tags,
      thumbnailUrl: getThumbUrl(row.filePath, row.type),
      previewUrl,
      filePath: row.filePath,
      sourcePath: absPath,
      state: "success"
    };
  });
  return { items, total };
}
async function getAsset(id) {
  const dbPath = getDbPath();
  const rows = await runSqliteJson(
    dbPath,
    `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`
  );
  if (!rows.length) return null;
  return rowToSummary(rows[0]);
}
async function getAssetByName(type, name) {
  const dbPath = getDbPath();
  const rows = await runSqliteJson(
    dbPath,
    `SELECT * FROM assets WHERE type='${escapeSql(type)}' AND ${buildAssetNameCandidateCondition(name)} LIMIT 50;`
  );
  const match = pickBestAssetNameMatch(rows, name) || pickBestAssetRow(rows.filter((row) => row.remark?.includes(name)));
  return match ? rowToSummary(match) : null;
}
async function batchMatchAssets(type, names) {
  const dbPath = getDbPath();
  const result = /* @__PURE__ */ new Map();
  if (!names.length) return result;
  const conditions = names.map(buildAssetNameCandidateCondition).join(" OR ");
  const query = `SELECT * FROM assets WHERE type='${escapeSql(type)}' AND (${conditions});`;
  const rows = await runSqliteJson(dbPath, query);
  for (const name of names) {
    const match = pickBestAssetNameMatch(rows, name) || pickBestAssetRow(rows.filter((row) => row.remark?.includes(name)));
    if (match) {
      result.set(name, rowToSummary(match));
    }
  }
  return result;
}
function pickBestAssetNameMatch(rows, name) {
  const matches = rows.filter((row) => assetNameMatchesQuery(row.name, name));
  if (!matches.length) return null;
  return pickBestAssetRow(matches);
}
function pickBestAssetRow(rows) {
  const usableRows = rows.filter(isUsableAssetRow);
  if (!usableRows.length) return null;
  return [...usableRows].sort((a, b) => assetCompletenessScore(b) - assetCompletenessScore(a))[0];
}
function assetCompletenessScore(row) {
  return (hasStoredText(row.filePath) ? 100 : 0) + (assetImagesCount(row.images) > 0 ? 80 : 0) + (hasStoredText(row.prompt) ? 20 : 0) + (hasStoredText(row.description) ? 10 : 0) + (hasStoredText(row.setting) ? 5 : 0) + (hasStoredText(row.remark) ? 1 : 0);
}
function isUsableAssetRow(row) {
  return assetCompletenessScore(row) > 0;
}
function hasStoredText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function assetImagesCount(value) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
function updateAsset(id, updates) {
  const dbPath = getDbPath();
  const sets = [];
  if (updates.name !== void 0) sets.push(`name='${escapeSql(updates.name)}'`);
  if (updates.description !== void 0) sets.push(`description='${escapeSql(updates.description)}'`);
  if (updates.prompt !== void 0) sets.push(`prompt='${escapeSql(updates.prompt)}'`);
  if (updates.setting !== void 0) sets.push(`setting='${escapeSql(updates.setting)}'`);
  if (updates.remark !== void 0) sets.push(`remark='${escapeSql(updates.remark)}'`);
  if (updates.tags !== void 0) sets.push(`tags='${escapeSql(JSON.stringify(updates.tags))}'`);
  if (!sets.length) return null;
  sets.push(`updatedAt='${(/* @__PURE__ */ new Date()).toISOString()}'`);
  runSqliteExecSafe(dbPath, `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(id)}';`);
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}
function addAsset(input) {
  const dbPath = getDbPath();
  const id = crypto$1.randomUUID();
  let filePath = "";
  if (input.sourceFilePath && fs.existsSync(input.sourceFilePath)) {
    const ext = path.extname(input.sourceFilePath);
    const destName = `${id}${ext}`;
    const destPath = path.join(getFilesDir(), input.type, destName);
    fs.copyFileSync(input.sourceFilePath, destPath);
    filePath = `${input.type}/${destName}`;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const tags = JSON.stringify(input.tags || []);
  runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(input.type)}','${escapeSql(input.name || "")}','${escapeSql(input.description || "")}','${escapeSql(input.prompt || "")}','${escapeSql(input.setting || "")}','${escapeSql(input.remark || "")}','${escapeSql(tags)}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);
  const absPath = filePath ? path.join(getFilesDir(), filePath) : void 0;
  return {
    id,
    source: "manying-local",
    type: input.type,
    name: input.name,
    thumbnailUrl: absPath ? `file://${absPath}` : void 0,
    previewUrl: absPath ? `file://${absPath}` : void 0,
    filePath,
    sourcePath: absPath,
    state: "success"
  };
}
function deleteAsset(id) {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT filePath, images FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  if (!rows.length) return false;
  const row = rows[0];
  if (row.filePath) {
    const fullPath = resolveAssetManagedPath(getFilesDir(), row.filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = resolveAssetManagedPath(getThumbsDir(), row.filePath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  try {
    const images = JSON.parse(row.images || "[]");
    for (const img of images) {
      const imgPath = resolveAssetManagedPath(getFilesDir(), img.filePath);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  } catch {
  }
  node_child_process.execFileSync("sqlite3", [dbPath, `DELETE FROM assets WHERE id='${escapeSql(id)}';`], { maxBuffer: 1024 * 1024 });
  return true;
}
function replaceAssetMainImage(assetId, sourceFilePath) {
  if (!fs.existsSync(sourceFilePath)) return null;
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;
  const asset = rows[0];
  if (asset.filePath) {
    const oldPath = path.join(getFilesDir(), asset.filePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    const oldThumb = path.join(getThumbsDir(), asset.filePath);
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb);
  }
  const ext = path.extname(sourceFilePath);
  const safeName = `${asset.name}`.replace(/[/\\:*?"<>|]/g, "_");
  const destName = `${safeName}_${Date.now()}${ext}`;
  const destPath = path.join(getFilesDir(), asset.type, destName);
  fs.copyFileSync(sourceFilePath, destPath);
  const newFilePath = `${asset.type}/${destName}`;
  const thumbDir = path.join(getThumbsDir(), asset.type);
  fs.mkdirSync(thumbDir, { recursive: true });
  node_child_process.execFile("sips", ["-z", "200", "200", destPath, "--out", path.join(thumbDir, destName)], () => {
  });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  runSqliteExecSafe(dbPath, `UPDATE assets SET filePath='${escapeSql(newFilePath)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`);
  return getAssetSync(assetId);
}
function addAssetImage(assetId, imageName, sourceFilePath) {
  if (!fs.existsSync(sourceFilePath)) return null;
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;
  const asset = rows[0];
  const ext = path.extname(sourceFilePath);
  const safeName = `${asset.name}_${imageName}`.replace(/[/\\:*?"<>|]/g, "_");
  let destName = `${safeName}${ext}`;
  let destPath = path.join(getFilesDir(), asset.type, destName);
  if (fs.existsSync(destPath)) {
    destName = `${safeName}_${Date.now()}${ext}`;
    destPath = path.join(getFilesDir(), asset.type, destName);
  }
  fs.copyFileSync(sourceFilePath, destPath);
  const relPath = `${asset.type}/${destName}`;
  const images = JSON.parse(asset.images || "[]");
  images.push({ name: imageName, filePath: relPath });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const imagesJson = JSON.stringify(images);
  node_child_process.execFileSync("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(imagesJson)}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });
  return getAssetSync(assetId);
}
function removeAssetImage(assetId, imageFilePath) {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;
  const asset = rows[0];
  const images = JSON.parse(asset.images || "[]");
  const idx = images.findIndex((img) => img.filePath === imageFilePath);
  if (idx === -1) return null;
  const fullPath = resolveAssetManagedPath(getFilesDir(), imageFilePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  images.splice(idx, 1);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  node_child_process.execFileSync("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });
  return getAssetSync(assetId);
}
function renameAssetImage(assetId, imageFilePath, newName) {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(assetId)}' LIMIT 1;`);
  if (!rows.length) return null;
  const asset = rows[0];
  const images = JSON.parse(asset.images || "[]");
  const img = images.find((i) => i.filePath === imageFilePath);
  if (!img) return null;
  img.name = newName;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  node_child_process.execFileSync("sqlite3", [dbPath, `UPDATE assets SET images='${escapeSql(JSON.stringify(images))}', updatedAt='${now}' WHERE id='${escapeSql(assetId)}';`], { maxBuffer: 5 * 1024 * 1024 });
  return getAssetSync(assetId);
}
function importFromToonflow(toonflowItems) {
  const dbPath = getDbPath();
  let changed = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const item of toonflowItems) {
    const existing = runSqliteJsonSync(
      dbPath,
      `SELECT * FROM assets WHERE type='${escapeSql(item.type)}' AND name='${escapeSql(item.name)}' LIMIT 1;`
    );
    if (existing.length) {
      if (backfillAssetFromToonflow(existing[0], item, now)) changed++;
      continue;
    }
    const id = crypto$1.randomUUID();
    let filePath = "";
    const sourceFile = item.sourcePath;
    if (sourceFile && fs.existsSync(sourceFile)) {
      filePath = copyAssetSourceFile(item.type, id, sourceFile);
    }
    runSqliteExecSafe(dbPath, `INSERT INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES ('${escapeSql(id)}','${escapeSql(item.type)}','${escapeSql(item.name || "")}','${escapeSql(item.description || "")}','${escapeSql(item.prompt || "")}','${escapeSql(item.setting || "")}','${escapeSql(item.remark || "")}','${escapeSql(JSON.stringify(item.tags || []))}','${escapeSql(filePath)}','[]','manying-local','${now}','${now}');`);
    changed++;
  }
  return changed;
}
function backfillAssetFromToonflow(row, item, now) {
  const sets = [];
  if (!hasStoredText(row.description) && hasStoredText(item.description)) {
    sets.push(`description='${escapeSql(item.description)}'`);
  }
  if (!hasStoredText(row.prompt) && hasStoredText(item.prompt)) {
    sets.push(`prompt='${escapeSql(item.prompt)}'`);
  }
  if (!hasStoredText(row.setting) && hasStoredText(item.setting)) {
    sets.push(`setting='${escapeSql(item.setting)}'`);
  }
  if (!hasStoredText(row.remark) && hasStoredText(item.remark)) {
    sets.push(`remark='${escapeSql(item.remark)}'`);
  }
  if (assetTagsCount(row.tags) === 0 && item.tags?.length) {
    sets.push(`tags='${escapeSql(JSON.stringify(item.tags))}'`);
  }
  if (!hasStoredText(row.filePath) && item.sourcePath && fs.existsSync(item.sourcePath)) {
    const filePath = copyAssetSourceFile(row.type, row.id, item.sourcePath);
    sets.push(`filePath='${escapeSql(filePath)}'`);
  }
  if (!sets.length) return false;
  sets.push(`updatedAt='${now}'`);
  runSqliteExecSafe(getDbPath(), `UPDATE assets SET ${sets.join(",")} WHERE id='${escapeSql(row.id)}';`);
  return true;
}
function copyAssetSourceFile(type, id, sourceFile) {
  const ext = path.extname(sourceFile);
  const destDir = path.join(getFilesDir(), type);
  fs.mkdirSync(destDir, { recursive: true });
  let destName = `${id}${ext}`;
  let destPath = path.join(destDir, destName);
  if (fs.existsSync(destPath)) {
    destName = `${id}_${Date.now()}${ext}`;
    destPath = path.join(destDir, destName);
  }
  fs.copyFileSync(sourceFile, destPath);
  return `${type}/${destName}`;
}
function assetTagsCount(value) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
function getAssetSync(id) {
  const dbPath = getDbPath();
  const rows = runSqliteJsonSync(dbPath, `SELECT * FROM assets WHERE id='${escapeSql(id)}' LIMIT 1;`);
  return rows.length ? rowToSummary(rows[0]) : null;
}
function rowToSummary(row) {
  const absPath = row.filePath ? path.join(getFilesDir(), row.filePath) : void 0;
  const previewUrl = absPath ? `file://${absPath}` : void 0;
  let images;
  try {
    const parsed = JSON.parse(row.images || "[]");
    if (parsed.length) {
      images = parsed.map((img) => ({
        name: img.name,
        filePath: img.filePath,
        url: `file://${path.join(getFilesDir(), img.filePath)}`
      }));
    }
  } catch {
  }
  return {
    id: row.id,
    source: "manying-local",
    type: row.type,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    setting: row.setting,
    remark: row.remark,
    tags: (() => {
      try {
        return JSON.parse(row.tags || "[]");
      } catch {
        return [];
      }
    })(),
    thumbnailUrl: previewUrl,
    previewUrl,
    filePath: row.filePath,
    sourcePath: absPath,
    state: "success",
    images
  };
}
function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function createOperationId(prefix = "op") {
  return `${prefix}-${randomId()}`;
}
async function logEvent(entry) {
  try {
    await window.diagnosticsLog?.write(entry);
  } catch {
  }
}
function getInputUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
function getNetworkContext(input, init, meta) {
  const rawUrl = getInputUrl(input);
  let baseUrlHost = "unknown";
  let pathTemplate = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    baseUrlHost = parsed.host;
    pathTemplate = parsed.pathname;
  } catch {
  }
  return {
    endpointFamily: meta.endpointFamily,
    providerId: meta.providerId,
    providerName: meta.providerName,
    model: meta.model,
    method: init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET"),
    baseUrlHost,
    pathTemplate,
    timeoutMs: meta.timeoutMs,
    attempt: meta.attempt,
    maxRetries: meta.maxRetries,
    retryBackoffMs: meta.retryBackoffMs,
    keyRotated: meta.keyRotated,
    taskId: meta.taskId,
    pollAttempt: meta.pollAttempt,
    pollStatus: meta.pollStatus
  };
}
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function observedFetch(input, init, meta) {
  const startedAt = performance.now();
  const requestId = meta.requestId ?? createOperationId("req");
  const operationId = meta.operationId ?? createOperationId("op");
  const fetcher = meta.fetcher ?? fetch;
  const emit = meta.logEvent ?? logEvent;
  const baseContext = getNetworkContext(input, init, meta);
  await emit({
    level: "debug",
    category: "network",
    operationId,
    requestId,
    message: "HTTP request started",
    context: baseContext
  });
  try {
    const response = await fetcher(input, init);
    const durationMs = Math.round(performance.now() - startedAt);
    const context = {
      ...baseContext,
      status: response.status,
      statusText: response.statusText,
      durationMs
    };
    if (!response.ok) {
      const responseSummary = await response.clone().text().then((text) => summarizeResponseBody(text, 1024)).catch(() => "");
      await emit({
        level: "error",
        category: "network",
        operationId,
        requestId,
        message: "HTTP request failed",
        durationMs,
        context: {
          ...context,
          responseSummary
        }
      });
      return response;
    }
    await emit({
      level: "info",
      category: "network",
      operationId,
      requestId,
      message: "HTTP request completed",
      durationMs,
      context
    });
    return response;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    await emit({
      level: "error",
      category: "network",
      operationId,
      requestId,
      message: "HTTP request errored",
      durationMs,
      context: {
        ...baseContext,
        durationMs,
        errorName: error instanceof Error ? error.name : void 0,
        errorMessage: getErrorMessage(error)
      },
      error
    });
    throw error;
  }
}
function parseApiKeys(apiKey) {
  if (!apiKey) return [];
  return apiKey.split(/[,\n]/).map((k) => k.trim()).filter((k) => k.length > 0);
}
const THINKING_TEST_MAX_TOKENS = 2048;
function normalize(model) {
  return model.trim().toLowerCase();
}
const OPENAI_REASONING = /(^|[^a-z])o[1-9](-|$)|gpt-5/;
const ANTHROPIC_REASONING = /claude.*(3[._-]7|sonnet-4|opus-4|-4-)/;
const GEMINI_REASONING = /gemini-2\.5/;
const ZHIPU_REASONING = /glm-(4\.[5-9]|[5-9])|glm-z1/;
const QWEN_REASONING = /qwen3|qwq/;
const DEEPSEEK_REASONING = /deepseek-(r1|reasoner)/;
const GENERIC_REASONING = /(^|[^a-z])(r1|reasoner|reasoning|reason|thinking|think)([^a-z]|$)/;
function supportsThinking(model) {
  if (!model) return false;
  const name = normalize(model);
  return OPENAI_REASONING.test(name) || ANTHROPIC_REASONING.test(name) || GEMINI_REASONING.test(name) || ZHIPU_REASONING.test(name) || QWEN_REASONING.test(name) || DEEPSEEK_REASONING.test(name) || GENERIC_REASONING.test(name);
}
function resolveThinkingEnabled(model, override) {
  if (typeof override === "boolean") return override;
  return supportsThinking(model);
}
function buildThinkingParams(input) {
  const { model, protocol, maxTokens, enabled } = input;
  const effectiveEnabled = resolveThinkingEnabled(model, enabled);
  if (!effectiveEnabled) return {};
  const name = normalize(model);
  const forced = enabled === true;
  if (protocol === "gemini-compatible") {
    return { generationConfig: { thinkingConfig: { thinkingBudget: -1 } } };
  }
  if (protocol === "anthropic-compatible" || ANTHROPIC_REASONING.test(name)) {
    const budget = Math.max(1024, Math.floor((maxTokens || THINKING_TEST_MAX_TOKENS) / 2));
    const safeBudget = Math.min(budget, Math.max(1024, (maxTokens || THINKING_TEST_MAX_TOKENS) - 512));
    return { thinking: { type: "enabled", budget_tokens: safeBudget } };
  }
  if (OPENAI_REASONING.test(name)) {
    return { reasoning_effort: "high" };
  }
  if (ZHIPU_REASONING.test(name)) {
    return { thinking: { type: "enabled" } };
  }
  if (QWEN_REASONING.test(name)) {
    return { enable_thinking: true };
  }
  if (forced) {
    return { thinking: { type: "enabled" } };
  }
  return {};
}
const DEFAULT_MODEL_TEST_TIMEOUT_MS = 15e3;
const IMAGE_MODEL_TEST_TIMEOUT_MS = 12e4;
function getModelTestTimeoutMs(type) {
  return type === "image" ? IMAGE_MODEL_TEST_TIMEOUT_MS : DEFAULT_MODEL_TEST_TIMEOUT_MS;
}
function buildOpenAICompatibleEndpoint(baseUrl, path2) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path2}` : `${normalized}/v1/${path2}`;
}
function buildGeminiCompatibleEndpoint(baseUrl, model) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const versioned = /\/v\d+(beta)?$/.test(normalized) ? normalized : `${normalized}/v1beta`;
  return `${versioned}/models/${encodeURIComponent(model)}:generateContent`;
}
function buildTextModelTestAttempts(baseUrl, apiKey, model, thinkingOverride) {
  const prompt = "回复 OK 和模型名称";
  const thinking = resolveThinkingEnabled(model, thinkingOverride);
  const tokenBudget = thinking ? THINKING_TEST_MAX_TOKENS : 32;
  const openaiThinking = buildThinkingParams({ model, protocol: "openai-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const anthropicThinking = buildThinkingParams({ model, protocol: "anthropic-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const geminiThinking = buildThinkingParams({ model, protocol: "gemini-compatible", maxTokens: tokenBudget, enabled: thinkingOverride });
  const geminiThinkingConfig = geminiThinking.generationConfig?.thinkingConfig;
  return [
    {
      protocol: "openai-compatible",
      label: "OpenAI 兼容",
      endpoint: buildOpenAICompatibleEndpoint(baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: tokenBudget,
        temperature: 0,
        ...openaiThinking
      }
    },
    {
      protocol: "anthropic-compatible",
      label: "Anthropic 兼容",
      endpoint: buildOpenAICompatibleEndpoint(baseUrl, "messages"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model,
        max_tokens: tokenBudget,
        messages: [{ role: "user", content: prompt }],
        ...anthropicThinking
      }
    },
    {
      protocol: "gemini-compatible",
      label: "Gemini 兼容",
      endpoint: buildGeminiCompatibleEndpoint(baseUrl, model),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: tokenBudget,
          temperature: 0,
          ...geminiThinkingConfig ? { thinkingConfig: geminiThinkingConfig } : {}
        }
      }
    }
  ];
}
function buildImageModelTestAttempt(baseUrl, apiKey, model) {
  return {
    protocol: "openai-compatible",
    label: "OpenAI 图片",
    endpoint: buildOpenAICompatibleEndpoint(baseUrl, "images/generations"),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: {
      model,
      prompt: "API 连通性测试图",
      n: 1,
      stream: false,
      aspect_ratio: "1:1",
      resolution: "1K"
    }
  };
}
function prepareModelTestRequest(payload) {
  const keys = parseApiKeys(payload.provider.apiKey);
  const isLocalTtsProvider = payload.provider.platform === "manying-local-tts" || payload.provider.platform === "tts-compatible";
  if (keys.length === 0 && (!isLocalTtsProvider || payload.type === "text")) {
    return { success: false, error: "缺少 API Key" };
  }
  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) {
    return { success: false, error: "缺少 Base URL" };
  }
  const model = payload.model?.trim();
  if (!model) {
    return { success: false, error: "缺少模型" };
  }
  if (payload.type === "image") {
    const attempt = buildImageModelTestAttempt(baseUrl, keys[0], model);
    return {
      success: true,
      dryRun: false,
      type: "image",
      attempts: [attempt],
      protocol: attempt.protocol,
      label: attempt.label,
      endpoint: attempt.endpoint,
      headers: attempt.headers,
      body: attempt.body
    };
  }
  if (payload.type !== "text") {
    return {
      success: true,
      dryRun: true,
      message: `配置 dry-run 通过，V1 暂不调用 ${payload.type} 模型`
    };
  }
  const attempts = buildTextModelTestAttempts(baseUrl, keys[0], model, payload.thinkingEnabled);
  const firstAttempt = attempts[0];
  return {
    success: true,
    dryRun: false,
    type: "text",
    attempts,
    protocol: firstAttempt.protocol,
    label: firstAttempt.label,
    endpoint: firstAttempt.endpoint,
    headers: firstAttempt.headers,
    body: firstAttempt.body
  };
}
function parseOpenAICompatibleResponse(text) {
  const data = JSON.parse(text);
  return data.choices?.[0]?.message?.content?.trim();
}
function parseAnthropicCompatibleResponse(text) {
  const data = JSON.parse(text);
  return data.content?.map((item) => item.text?.trim()).filter(Boolean).join(" ");
}
function parseGeminiCompatibleResponse(text) {
  const data = JSON.parse(text);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim()).filter(Boolean).join(" ");
}
function parseModelTestSuccessText(protocol, text) {
  try {
    if (protocol === "anthropic-compatible") return parseAnthropicCompatibleResponse(text);
    if (protocol === "gemini-compatible") return parseGeminiCompatibleResponse(text);
    return parseOpenAICompatibleResponse(text);
  } catch {
    return void 0;
  }
}
function hasImageTestResult(text) {
  try {
    const data = JSON.parse(text);
    const first = Array.isArray(data.data) ? data.data[0] : void 0;
    return Boolean(
      first?.url || first?.image_url || first?.b64_json || first?.task_id || data.url || data.image_url || data.b64_json || data.task_id || data.id
    );
  } catch {
    return false;
  }
}
async function runModelTestRequest(payload, fetcher = fetch, timeoutMs = getModelTestTimeoutMs(payload.type)) {
  const prepared = prepareModelTestRequest(payload);
  if (!prepared.success) {
    return { success: false, error: prepared.error };
  }
  if (prepared.dryRun) {
    return { success: true, message: prepared.message };
  }
  const attempts = [];
  for (const attempt of prepared.attempts) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(attempt.endpoint, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      if (!response.ok) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `模型测试失败 (${response.status}) ${text.slice(0, 240)}`
        });
        continue;
      }
      const imageAccepted = prepared.type === "image" ? hasImageTestResult(text) : false;
      if (prepared.type === "image" && !imageAccepted) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `图片模型测试未返回图片 URL、base64 或任务 ID: ${text.slice(0, 240)}`
        });
        continue;
      }
      const content = prepared.type === "text" ? parseModelTestSuccessText(attempt.protocol, text) : void 0;
      return {
        success: true,
        protocol: attempt.protocol,
        status: response.status,
        elapsedMs,
        attempts: [
          ...attempts,
          {
            protocol: attempt.protocol,
            label: attempt.label,
            endpoint: attempt.endpoint,
            success: true,
            status: response.status,
            elapsedMs
          }
        ],
        message: prepared.type === "image" ? `图片测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms` : content ? `测试通过 · ${attempt.label} · ${content.slice(0, 120)} · ${elapsedMs}ms` : `测试通过 · ${attempt.label} · ${payload.model} · ${elapsedMs}ms`
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = error instanceof Error && error.name === "AbortError";
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs,
        error: isTimeout ? `${payload.type === "image" ? "图片模型测试" : "模型测试"}超时 (${Math.round(timeoutMs / 1e3)}s)` : error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const lastAttempt = attempts[attempts.length - 1];
  return {
    success: false,
    attempts,
    protocol: lastAttempt?.protocol,
    status: lastAttempt?.status,
    elapsedMs: attempts.reduce((sum, attempt) => sum + attempt.elapsedMs, 0),
    error: attempts.map((attempt) => `${attempt.label}: ${attempt.error || attempt.status || "失败"}`).join("；") || "模型测试失败"
  };
}
function prepareTextCompletionRequest(payload) {
  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) return { success: false, error: "缺少 API Key" };
  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) return { success: false, error: "缺少 Base URL" };
  const model = payload.model?.trim();
  if (!model) return { success: false, error: "缺少模型" };
  const messages = payload.messages.filter((message) => message.content.trim());
  if (!messages.length) return { success: false, error: "缺少消息内容" };
  const attempts = buildTextCompletionAttempts({
    baseUrl,
    apiKey: keys[0],
    model,
    messages,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens ?? 2048
  });
  const protocol = resolveRuntimeTextProtocol(payload.provider);
  return {
    success: true,
    attempts: protocol ? attempts.filter((attempt) => attempt.protocol === protocol) : attempts
  };
}
function resolveRuntimeTextProtocol(provider) {
  if (provider.apiProtocol) return provider.apiProtocol;
  if (provider.platform === "anthropic-compatible") return "anthropic-compatible";
  if (provider.platform === "gemini-compatible") return "gemini-compatible";
  if (provider.platform === "openai" || provider.platform === "openai-compatible" || provider.platform === "custom" || provider.platform === "memefast" || provider.platform === "deepseek" || provider.platform === "volcengine" || provider.platform === "klingai" || provider.platform === "vidu" || provider.platform === "runninghub" || provider.platform === "minimax" || provider.platform === "tts-compatible") {
    return "openai-compatible";
  }
  return void 0;
}
async function runTextCompletionRequest(payload, fetcher = fetch, timeoutMs = 3e5) {
  const prepared = prepareTextCompletionRequest(payload);
  if (!prepared.success) return { success: false, error: prepared.error };
  if (!prepared.attempts.length) return { success: false, error: "没有可用的接口协议" };
  const attempts = [];
  for (const attempt of prepared.attempts) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(attempt.endpoint, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
        signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      if (!response.ok) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: `文本模型调用失败 (${response.status}) ${text.slice(0, 240)}`
        });
        continue;
      }
      const content = parseTextCompletionSuccess(attempt.protocol, text);
      if (!content) {
        attempts.push({
          protocol: attempt.protocol,
          label: attempt.label,
          endpoint: attempt.endpoint,
          success: false,
          status: response.status,
          elapsedMs,
          error: "模型响应中缺少文本内容"
        });
        continue;
      }
      return {
        success: true,
        text: content,
        protocol: attempt.protocol,
        status: response.status,
        elapsedMs,
        attempts: [
          ...attempts,
          {
            protocol: attempt.protocol,
            label: attempt.label,
            endpoint: attempt.endpoint,
            success: true,
            status: response.status,
            elapsedMs
          }
        ]
      };
    } catch (error) {
      attempts.push({
        protocol: attempt.protocol,
        label: attempt.label,
        endpoint: attempt.endpoint,
        success: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const lastAttempt = attempts[attempts.length - 1];
  return {
    success: false,
    attempts,
    protocol: lastAttempt?.protocol,
    status: lastAttempt?.status,
    elapsedMs: attempts.reduce((sum, attempt) => sum + attempt.elapsedMs, 0),
    error: attempts.map((attempt) => `${attempt.label}: ${attempt.error || attempt.status || "失败"}`).join("；")
  };
}
function buildTextCompletionAttempts(input) {
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const nonSystemMessages = input.messages.filter((message) => message.role !== "system");
  return [
    {
      protocol: "openai-compatible",
      label: "OpenAI 兼容",
      endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      body: {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.2
      }
    },
    {
      protocol: "anthropic-compatible",
      label: "Anthropic 兼容",
      endpoint: buildOpenAICompatibleEndpoint(input.baseUrl, "messages"),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model: input.model,
        system: system || void 0,
        max_tokens: input.maxTokens,
        temperature: input.temperature ?? 0.2,
        messages: normalizeAnthropicMessages(nonSystemMessages)
      }
    },
    {
      protocol: "gemini-compatible",
      label: "Gemini 兼容",
      endpoint: buildGeminiCompatibleEndpoint(input.baseUrl, input.model),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: {
        systemInstruction: system ? { parts: [{ text: system }] } : void 0,
        contents: nonSystemMessages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }]
        })),
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: input.temperature ?? 0.2
        }
      }
    }
  ];
}
function normalizeAnthropicMessages(messages) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  }));
}
function parseTextCompletionSuccess(protocol, text) {
  const data = JSON.parse(text);
  if (protocol === "anthropic-compatible") {
    return data.content?.map((item) => item.text?.trim()).filter(Boolean).join("\n").trim();
  }
  if (protocol === "gemini-compatible") {
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim()).filter(Boolean).join("\n").trim();
  }
  return data.choices?.[0]?.message?.content?.trim();
}
async function runTextCompletionStreamRequest(payload, onDelta, fetcher = fetch, timeoutMs = 3e5) {
  if (payload.provider.apiProtocol && payload.provider.apiProtocol !== "openai-compatible") {
    const result = await runTextCompletionRequest(payload, fetcher, timeoutMs);
    if (result.success && result.text) onDelta(result.text);
    return result;
  }
  const keys = parseApiKeys(payload.provider.apiKey);
  if (keys.length === 0) return { success: false, error: "缺少 API Key" };
  const baseUrl = payload.provider.baseUrl?.trim();
  if (!baseUrl) return { success: false, error: "缺少 Base URL" };
  const model = payload.model?.trim();
  if (!model) return { success: false, error: "缺少模型" };
  const messages = payload.messages.filter((message) => message.content.trim());
  if (!messages.length) return { success: false, error: "缺少消息内容" };
  const endpoint = buildOpenAICompatibleEndpoint(baseUrl, "chat/completions");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let full = "";
  const fallbackOneShot = async (reason) => {
    console.warn(`[text-stream] 流式失败(${reason}) → 回退一次性`);
    const r = await runTextCompletionRequest(payload, fetcher, timeoutMs);
    if (r.success && r.text && !full) onDelta(r.text);
    return r;
  };
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys[0]}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: payload.maxTokens ?? 2048,
        temperature: payload.temperature ?? 0.2,
        stream: true
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return await fallbackOneShot(`status ${response.status}: ${errText.slice(0, 120)}`);
    }
    const body = response.body;
    if (!body) return await fallbackOneShot("无数据流");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstByteAt = 0;
    const fbTimer = setTimeout(() => {
      if (!firstByteAt) controller.abort();
    }, 3e4);
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstByteAt && (value?.length ?? 0) > 0) {
          firstByteAt = Date.now();
          clearTimeout(fbTimer);
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
          }
        }
      }
    } finally {
      clearTimeout(fbTimer);
    }
    if (!full.trim()) return await fallbackOneShot("流式空响应");
    return { success: true, text: full, status: response.status, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return await fallbackOneShot(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}
function createProviderInstance(params) {
  const { baseUrl, apiKey, platform, name } = params;
  const safeName = name || platform || "default";
  const safeBaseURL = baseUrl || "";
  switch (platform) {
    case "openai":
      return openai.createOpenAI({ baseURL: safeBaseURL || void 0, apiKey });
    case "openai-compatible":
      return openaiCompatible.createOpenAICompatible({
        name: safeName,
        baseURL: safeBaseURL,
        apiKey
      });
    case "anthropic-compatible":
      return anthropic.createAnthropic({ baseURL: safeBaseURL || void 0, apiKey });
    case "gemini-compatible":
      return google.createGoogleGenerativeAI({
        baseURL: safeBaseURL,
        apiKey
      });
    case "deepseek":
      return deepseek.createDeepSeek({ baseURL: safeBaseURL || void 0, apiKey });
    case "minimax":
      return vercelMinimaxAiProvider.createMinimax({ apiKey });
    case "klingai":
    case "volcengine":
    case "vidu":
    case "runninghub":
    case "tts-compatible":
    case "custom":
      return openaiCompatible.createOpenAICompatible({
        name: platform,
        baseURL: safeBaseURL,
        apiKey
      });
    default:
      return openaiCompatible.createOpenAICompatible({
        name: platform,
        baseURL: safeBaseURL,
        apiKey
      });
  }
}
function getLanguageModel(provider, modelName) {
  const instance = createProviderInstance(provider);
  if ("chat" in instance) return instance.chat(modelName);
  if ("chatModel" in instance) return instance.chatModel(modelName);
  return instance(modelName);
}
async function sdkGenerateText(options) {
  try {
    const model = getLanguageModel(options.provider, options.model);
    const result = await ai.generateText({
      model,
      messages: options.messages,
      ...options.temperature != null && { temperature: options.temperature },
      ...options.maxTokens != null && { maxOutputTokens: options.maxTokens },
      ...options.providerOptions && { providerOptions: options.providerOptions }
    });
    return { success: true, text: result.text };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
async function sdkStreamText(options) {
  const model = getLanguageModel(options.provider, options.model);
  const result = ai.streamText({
    model,
    messages: options.messages,
    ...options.temperature != null && { temperature: options.temperature },
    ...options.maxTokens != null && { maxOutputTokens: options.maxTokens },
    ...options.abortSignal && { abortSignal: options.abortSignal }
  });
  return result;
}
function shouldCreateWindowOnActivate({
  isAppReady,
  openWindowCount
}) {
  return isAppReady && openWindowCount === 0;
}
function shouldCreateWindowOnSecondInstance({
  isAppReady,
  hasUsableWindow
}) {
  return isAppReady && !hasUsableWindow;
}
function createBeforeQuitCleanup({
  stopLocalServices,
  quit,
  onError
}) {
  let cleanupStarted = false;
  let cleanupFinished = false;
  return (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    void stopLocalServices().catch((error) => {
      onError?.(error);
    }).finally(() => {
      cleanupFinished = true;
      quit();
    });
  };
}
function createWindowAllClosedHandler({
  platform,
  stopLocalServices,
  quit,
  onError
}) {
  return () => {
    void stopLocalServices().catch((error) => {
      onError?.(error);
    });
    if (platform !== "darwin") {
      quit();
    }
  };
}
function assertInsideRoot(root, target, label) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalizedTarget;
}
function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error(`Invalid ${label}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalized;
}
function normalizePathSegment(value, label) {
  const normalized = normalizeRelativePath(value, label);
  if (normalized.includes("/")) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalized;
}
function encodeRelativePath(value) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}
function resolveDataFilePath(dataRoot, key) {
  const normalizedKey = normalizeRelativePath(key, "storage key");
  return assertInsideRoot(dataRoot, path.resolve(dataRoot, `${normalizedKey}.json`), "Storage key");
}
function resolveDataDirPath(dataRoot, prefix) {
  const normalizedPrefix = normalizeRelativePath(prefix, "storage prefix");
  return assertInsideRoot(dataRoot, path.resolve(dataRoot, normalizedPrefix), "Storage prefix");
}
function parseLocalMediaPath(localPath) {
  const match = localPath.match(/^local-(?:image|video):\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const category = decodeURIComponent(match[1]);
  const filename = decodeURIComponent(match[2]);
  return {
    category: normalizeRelativePath(category, "local media category"),
    filename: normalizeRelativePath(filename, "local media filename")
  };
}
function resolveLocalMediaPath(mediaRoot, localPath) {
  const parsed = parseLocalMediaPath(localPath);
  if (!parsed) throw new Error("Invalid local media path");
  return assertInsideRoot(mediaRoot, path.resolve(mediaRoot, parsed.category, parsed.filename), "Local media path");
}
function createProjectFileUrl(projectId, relativePath) {
  const normalizedProjectId = normalizePathSegment(projectId, "project id");
  const normalizedRelativePath = normalizeRelativePath(relativePath, "project file path");
  return `project-file://${encodeURIComponent(normalizedProjectId)}/${encodeRelativePath(normalizedRelativePath)}`;
}
function parseProjectFileUrl(projectFileUrl) {
  const match = projectFileUrl.match(/^project-file:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const projectId = normalizePathSegment(decodeURIComponent(match[1]), "project id");
  const relativePath = normalizeRelativePath(
    match[2].split("/").map((part) => decodeURIComponent(part)).join("/"),
    "project file path"
  );
  return { projectId, relativePath };
}
function resolveProjectScopedFilePath(dataRoot, projectId, relativePath) {
  const normalizedProjectId = normalizePathSegment(projectId, "project id");
  const normalizedRelativePath = normalizeRelativePath(relativePath, "project file path");
  return assertInsideRoot(
    dataRoot,
    path.resolve(dataRoot, "_p", normalizedProjectId, normalizedRelativePath),
    "Project file path"
  );
}
function resolveProjectFileUrl(dataRoot, projectFileUrl) {
  const parsed = parseProjectFileUrl(projectFileUrl);
  if (!parsed) throw new Error("Invalid project file URL");
  return resolveProjectScopedFilePath(dataRoot, parsed.projectId, parsed.relativePath);
}
process.env.APP_ROOT = path.join(__dirname, "../..");
const VITE_DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"] || process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(__dirname);
const RENDERER_DIST = path.join(__dirname, "../renderer");
const RENDERER_INDEX_HTML = path.join("renderer", "index.html");
process.env.VITE_PUBLIC = RENDERER_DIST;
let win;
const execFileAsync = node_util.promisify(node_child_process.execFile);
const hasSingleInstanceLock = electron.app.requestSingleInstanceLock();
const diagnosticsLogService = createDiagnosticsLogService({
  rootDir: path.join(electron.app.getPath("userData"), "logs", "diagnostics"),
  retentionDays: 30
});
if (!hasSingleInstanceLock) {
  electron.app.exit(0);
}
const packageUpdateConfig = packageMetadata.updateConfig ?? {};
function writeDiagnosticsLog(entry) {
  diagnosticsLogService.write(entry).catch((error) => {
    console.warn("Failed to write diagnostics log:", error);
  });
}
function createDiagnosticsOperationId(prefix) {
  return `${prefix}-${crypto$1.randomUUID()}`;
}
function createDiagnosticsFetch(params) {
  return (input, init) => observedFetch(input, init, {
    ...params,
    requestId: createDiagnosticsOperationId("req"),
    fetcher: fetch,
    logEvent: writeDiagnosticsLog
  });
}
async function diagnosticsFetchJson(url, options) {
  const operationId = createDiagnosticsOperationId("tts-http");
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId("req"),
    endpointFamily: "tts-runtime",
    providerName: "Manying Local TTS",
    fetcher: fetch,
    logEvent: writeDiagnosticsLog
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `TTS backend request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return response.text();
  }
  return response.json();
}
async function diagnosticsFetchBytes(url, options) {
  const operationId = createDiagnosticsOperationId("tts-http");
  const response = await observedFetch(url, options, {
    operationId,
    requestId: createDiagnosticsOperationId("req"),
    endpointFamily: "tts-runtime-bytes",
    providerName: "Manying Local TTS",
    fetcher: fetch,
    logEvent: writeDiagnosticsLog
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `TTS backend request failed (${response.status})`);
  }
  return {
    data: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? void 0
  };
}
const ttsRuntimeController = createTtsRuntimeController({
  appRoot: process.env.APP_ROOT ?? path.join(__dirname, "../.."),
  userDataPath: electron.app.getPath("userData"),
  storageBasePath: () => getStorageBasePath(),
  fetchJson: diagnosticsFetchJson,
  fetchBytes: diagnosticsFetchBytes
});
let stopLocalSidecarsPromise = null;
function stopLocalSidecars() {
  if (!stopLocalSidecarsPromise) {
    stopLocalSidecarsPromise = (async () => {
      const result = await ttsRuntimeController.stop();
      if (!result.success) {
        console.warn("Failed to stop local TTS backend:", result.error);
      }
    })().finally(() => {
      stopLocalSidecarsPromise = null;
    });
  }
  return stopLocalSidecarsPromise;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function sanitizeExternalUrl(value) {
  if (!isNonEmptyString(value)) return void 0;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return void 0;
    }
    return parsed.toString();
  } catch {
    return void 0;
  }
}
function normalizeVersionParts(version) {
  return version.replace(/^v/i, "").split(".").map((part) => {
    const match = part.match(/\d+/);
    return match ? Number(match[0]) : 0;
  });
}
function compareVersions(left, right) {
  const leftParts = normalizeVersionParts(left);
  const rightParts = normalizeVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}
function getUpdateManifestUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.manifestUrl);
}
function getDefaultGithubUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.defaultGithubUrl);
}
function getDefaultBaiduUrl() {
  return sanitizeExternalUrl(packageUpdateConfig.defaultBaiduUrl);
}
function getDefaultBaiduCode() {
  return isNonEmptyString(packageUpdateConfig.defaultBaiduCode) ? packageUpdateConfig.defaultBaiduCode.trim() : void 0;
}
async function fetchUpdateManifest() {
  const manifestUrl = getUpdateManifestUrl();
  if (!manifestUrl) {
    throw new Error("未配置版本清单地址");
  }
  const requestUrl = new URL(manifestUrl);
  requestUrl.searchParams.set("_ts", Date.now().toString());
  const response = await electron.net.fetch(requestUrl.toString());
  if (!response.ok) {
    throw new Error(`版本清单请求失败 (${response.status})`);
  }
  const rawManifest = await response.json();
  if (!isNonEmptyString(rawManifest.version)) {
    throw new Error("版本清单缺少有效的 version 字段");
  }
  return {
    version: rawManifest.version.trim(),
    releaseNotes: isNonEmptyString(rawManifest.releaseNotes) ? rawManifest.releaseNotes.trim() : isNonEmptyString(rawManifest.notes) ? rawManifest.notes.trim() : void 0,
    publishedAt: isNonEmptyString(rawManifest.publishedAt) ? rawManifest.publishedAt.trim() : void 0,
    githubUrl: sanitizeExternalUrl(rawManifest.githubUrl) ?? getDefaultGithubUrl(),
    baiduUrl: sanitizeExternalUrl(rawManifest.baiduUrl) ?? getDefaultBaiduUrl(),
    baiduCode: isNonEmptyString(rawManifest.baiduCode) ? rawManifest.baiduCode.trim() : getDefaultBaiduCode()
  };
}
async function resolveAvailableUpdate(currentVersion) {
  const manifest = await fetchUpdateManifest();
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return null;
  }
  return {
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    publishedAt: manifest.publishedAt,
    githubUrl: manifest.githubUrl,
    baiduUrl: manifest.baiduUrl,
    baiduCode: manifest.baiduCode
  };
}
function createWindow() {
  win = new electron.BrowserWindow({
    title: "漫影工作室",
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: "#17191c",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs")
    }
  });
  let hasShownWindow = false;
  const showWindow = () => {
    if (!win || win.isDestroyed() || hasShownWindow) return;
    hasShownWindow = true;
    win.show();
  };
  win.once("ready-to-show", showWindow);
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    writeDiagnosticsLog({
      level: "info",
      category: "runtime",
      message: "Renderer finished loading",
      context: { url: win?.webContents.getURL() }
    });
    showWindow();
  });
  win.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`);
    writeDiagnosticsLog({
      level: "error",
      category: "runtime",
      message: "Renderer failed to load",
      context: { errorCode, errorDescription, url: win?.webContents.getURL() }
    });
    showWindow();
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const logLevel = level >= 3 ? "error" : level >= 2 ? "warn" : level >= 1 ? "info" : "debug";
    writeDiagnosticsLog({
      level: logLevel,
      category: "runtime",
      message: "Renderer console message",
      context: { consoleLevel: level, message, line, sourceId }
    });
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    writeDiagnosticsLog({
      level: "error",
      category: "runtime",
      message: "Renderer process gone",
      context: { reason: details.reason, exitCode: details.exitCode }
    });
  });
  win.on("unresponsive", () => {
    writeDiagnosticsLog({
      level: "warn",
      category: "runtime",
      message: "Main window became unresponsive"
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      electron.shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
    electron.shell.openExternal(url);
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(new URL(RENDERER_INDEX_HTML, VITE_DEV_SERVER_URL).toString());
  } else {
    win.loadFile(path.join(RENDERER_DIST, RENDERER_INDEX_HTML));
  }
}
electron.app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
    return;
  }
  if (shouldCreateWindowOnSecondInstance({
    isAppReady: electron.app.isReady(),
    hasUsableWindow: false
  })) {
    createWindow();
  }
});
electron.app.on("window-all-closed", createWindowAllClosedHandler({
  platform: process.platform,
  stopLocalServices: stopLocalSidecars,
  quit: () => {
    electron.app.quit();
    win = null;
  },
  onError: (error) => {
    console.warn("Failed to stop local services after all windows closed:", error);
  }
}));
electron.app.on("before-quit", createBeforeQuitCleanup({
  stopLocalServices: stopLocalSidecars,
  quit: () => electron.app.quit(),
  onError: (error) => {
    console.warn("Failed to stop local services before quit:", error);
  }
}));
electron.app.on("activate", () => {
  if (shouldCreateWindowOnActivate({
    isAppReady: electron.app.isReady(),
    openWindowCount: electron.BrowserWindow.getAllWindows().length
  })) {
    createWindow();
  }
});
const DEFAULT_STORAGE_CONFIG = {
  basePath: "",
  projectPath: "",
  mediaPath: "",
  autoCleanEnabled: false,
  autoCleanDays: 30
};
const storageConfigPath = path.join(electron.app.getPath("userData"), "storage-config.json");
let storageConfig = loadStorageConfig();
let autoCleanInterval = null;
function loadStorageConfig() {
  try {
    if (fs.existsSync(storageConfigPath)) {
      const raw = fs.readFileSync(storageConfigPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STORAGE_CONFIG, ...parsed };
    }
  } catch (error) {
    console.warn("Failed to load storage config:", error);
  }
  return { ...DEFAULT_STORAGE_CONFIG };
}
function saveStorageConfig() {
  try {
    fs.writeFileSync(storageConfigPath, JSON.stringify(storageConfig, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to save storage config:", error);
  }
}
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
function normalizePath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
}
function isSubdirectory(parentPath, childPath) {
  const normalizedParent = path.resolve(parentPath).toLowerCase() + path.sep;
  const normalizedChild = path.resolve(childPath).toLowerCase() + path.sep;
  return normalizedChild.startsWith(normalizedParent);
}
function pathsConflict(source, dest) {
  const normalizedSource = path.resolve(source).toLowerCase();
  const normalizedDest = path.resolve(dest).toLowerCase();
  if (normalizedSource === normalizedDest) {
    return null;
  }
  if (isSubdirectory(source, dest)) {
    return "目标路径不能是当前路径的子目录";
  }
  if (isSubdirectory(dest, source)) {
    return "当前路径不能是目标路径的子目录";
  }
  return null;
}
function getStorageBasePath() {
  const configured = storageConfig.basePath?.trim();
  if (configured) {
    return normalizePath(configured);
  }
  const legacyProject = storageConfig.projectPath?.trim();
  if (legacyProject) {
    return path.dirname(normalizePath(legacyProject));
  }
  return electron.app.getPath("userData");
}
function getProjectDataRoot() {
  const base = path.join(getStorageBasePath(), "projects");
  ensureDir(base);
  return base;
}
function getMediaRoot() {
  const base = path.join(getStorageBasePath(), "media");
  ensureDir(base);
  return base;
}
function getSkillsRoot() {
  const base = getStudioSkillStorageRoot(getStorageBasePath());
  ensureDir(base);
  return base;
}
function getCacheDirs() {
  const userData = electron.app.getPath("userData");
  return [
    path.join(userData, "Cache"),
    path.join(userData, "Code Cache"),
    path.join(userData, "GPUCache")
  ];
}
async function getDirectorySize(dirPath) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath);
      } else {
        const stat = await fs.promises.stat(fullPath);
        total += stat.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}
async function copyDir(source, destination) {
  ensureDir(destination);
  await fs.promises.cp(source, destination, { recursive: true, force: true });
}
async function removeDir(dirPath) {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
}
async function deleteOldFiles(dirPath, cutoffTime) {
  let cleared = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleared += await deleteOldFiles(fullPath, cutoffTime);
        const remaining = await fs.promises.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.promises.rmdir(fullPath).catch(() => {
          });
        }
      } else {
        const stat = await fs.promises.stat(fullPath);
        if (stat.mtimeMs < cutoffTime) {
          await fs.promises.unlink(fullPath).catch(() => {
          });
          cleared += stat.size;
        }
      }
    }
  } catch {
  }
  return cleared;
}
function scheduleAutoClean() {
  if (autoCleanInterval) {
    clearInterval(autoCleanInterval);
    autoCleanInterval = null;
  }
  if (storageConfig.autoCleanEnabled) {
    const days = storageConfig.autoCleanDays || DEFAULT_STORAGE_CONFIG.autoCleanDays;
    clearCache(days).catch(() => {
    });
    autoCleanInterval = setInterval(() => {
      clearCache(days).catch(() => {
      });
    }, 24 * 60 * 60 * 1e3);
  }
}
async function clearCache(olderThanDays) {
  const dirs = getCacheDirs();
  let cleared = 0;
  if (olderThanDays && olderThanDays > 0) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1e3;
    for (const dir of dirs) {
      cleared += await deleteOldFiles(dir, cutoff);
    }
    return cleared;
  }
  for (const dir of dirs) {
    cleared += await getDirectorySize(dir);
    await removeDir(dir).catch(() => {
    });
    ensureDir(dir);
  }
  return cleared;
}
const getImagesDir = (subDir) => {
  const imagesDir = path.join(getMediaRoot(), subDir);
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
  return imagesDir;
};
const downloadImage = (url, filePath, maxRedirects = 5) => {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const protocol2 = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filePath);
    protocol2.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        file.close();
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }
      }
      if (status !== 200) {
        file.close();
        fs.unlink(filePath, () => {
        });
        reject(new Error(`Failed to download: ${status}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      fs.unlink(filePath, () => {
      });
      reject(err);
    });
  });
};
function isHttpUrl(value) {
  return value.startsWith("http://") || value.startsWith("https://");
}
function resolveImageHostUploadUrl(provider) {
  const uploadPath = (provider.uploadPath || "").trim();
  if (uploadPath && isHttpUrl(uploadPath)) {
    return uploadPath;
  }
  const baseUrl = (provider.baseUrl || "").trim().replace(/\/*$/, "");
  if (!baseUrl && !uploadPath) return "";
  if (!baseUrl && uploadPath) return "";
  if (!uploadPath) return baseUrl;
  const normalizedPath = uploadPath.startsWith("/") ? uploadPath : `/${uploadPath}`;
  return `${baseUrl}${normalizedPath}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function getByPath(obj, objectPath) {
  if (!isRecord(obj) || !objectPath) return void 0;
  return objectPath.split(".").reduce((acc, key) => {
    if (!isRecord(acc)) return void 0;
    return acc[key];
  }, obj);
}
function extractFirstHttpUrl(value) {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0];
}
function getExtensionFromMimeType(mimeType) {
  switch ((mimeType || "").toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    case "image/png":
    default:
      return "png";
  }
}
function getMimeTypeFromExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif"
  };
  return mimeTypes[extension] || "image/png";
}
function parseDataUrl(dataUrl) {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
  if (!matches) return null;
  const mimeType = matches[1] || "image/png";
  const buffer = Buffer.from(matches[2], "base64");
  if (buffer.length === 0) return null;
  return { buffer, mimeType };
}
function resolveImageSourcePath(imagePath) {
  if (imagePath.startsWith("project-file://")) {
    return resolveProjectFileUrl(getDataDir(), imagePath);
  }
  if (imagePath.startsWith("local-image://")) {
    return resolveLocalMediaPath(getMediaRoot(), imagePath);
  }
  if (imagePath.startsWith("file://")) {
    return imagePath.replace(/^file:\/\/\/?/, "");
  }
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  return null;
}
async function fetchBuffer(url, timeoutMs = 45e3) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/*, */*;q=0.8"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error("获取到的图片为空");
    }
    return {
      buffer,
      mimeType: response.headers.get("content-type") || "image/png"
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1e3)}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function readImageSource(imageData) {
  if (isHttpUrl(imageData)) {
    return fetchBuffer(imageData);
  }
  const parsedDataUrl = parseDataUrl(imageData);
  if (parsedDataUrl) {
    return parsedDataUrl;
  }
  const resolvedPath = resolveImageSourcePath(imageData);
  if (resolvedPath) {
    if (!fs.existsSync(resolvedPath)) {
      throw new Error("本地图片不存在");
    }
    const buffer = fs.readFileSync(resolvedPath);
    if (buffer.length === 0) {
      throw new Error("本地图片为空文件");
    }
    return {
      buffer,
      mimeType: getMimeTypeFromExtension(resolvedPath)
    };
  }
  const rawBuffer = Buffer.from(imageData, "base64");
  if (rawBuffer.length === 0) {
    throw new Error("图片数据无效");
  }
  return {
    buffer: rawBuffer,
    mimeType: "image/png"
  };
}
async function toUploadFilePayload(imageData, name) {
  const { buffer, mimeType } = await readImageSource(imageData);
  const baseName = (name || "upload").trim() || "upload";
  const hasExtension = /\.[a-z0-9]{2,8}$/i.test(baseName);
  const filename = hasExtension ? baseName : `${baseName}.${getExtensionFromMimeType(mimeType)}`;
  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
    mimeType
  };
}
async function toBase64Payload(imageData) {
  if (imageData.startsWith("data:")) {
    const parsed = parseDataUrl(imageData);
    if (!parsed) {
      throw new Error("图片数据无效");
    }
    return parsed.buffer.toString("base64");
  }
  if (isHttpUrl(imageData) || imageData.startsWith("project-file://") || imageData.startsWith("local-image://") || imageData.startsWith("file://") || path.isAbsolute(imageData)) {
    const { buffer } = await readImageSource(imageData);
    return buffer.toString("base64");
  }
  return imageData;
}
async function uploadImageHostFromMain({
  provider,
  apiKey,
  imageData,
  options
}) {
  try {
    const uploadUrl = resolveImageHostUploadUrl(provider);
    if (!uploadUrl) {
      return { success: false, error: "图床上传地址未配置" };
    }
    const fieldName = provider.imageField || "image";
    const nameField = provider.nameField || "name";
    const payloadType = provider.imagePayloadType || "base64";
    const staticFormFields = provider.staticFormFields || {};
    const formData = new FormData();
    Object.entries(staticFormFields).forEach(([key, value]) => {
      formData.append(key, value);
    });
    if (provider.apiKeyFormField && apiKey) {
      formData.append(provider.apiKeyFormField, apiKey);
    }
    if (payloadType === "file") {
      const { blob, filename } = await toUploadFilePayload(imageData, options?.name);
      formData.append(fieldName, blob, filename);
    } else {
      const base64Data = await toBase64Payload(imageData);
      formData.append(fieldName, base64Data);
    }
    if (options?.name) {
      formData.append(nameField, options.name);
    }
    const url = new URL(uploadUrl);
    if (provider.apiKeyParam && apiKey) {
      url.searchParams.set(provider.apiKeyParam, apiKey);
    }
    if (provider.expirationParam && options?.expiration) {
      url.searchParams.set(provider.expirationParam, String(options.expiration));
    }
    const headers = {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8"
    };
    if (provider.apiKeyHeader && apiKey) {
      headers[provider.apiKeyHeader] = apiKey;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45e3);
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const errorMessage = getByPath(data, "error.message");
        const messageField = getByPath(data, "message");
        const message = typeof errorMessage === "string" ? errorMessage : typeof messageField === "string" ? messageField : text || `上传失败: ${response.status}`;
        return { success: false, error: message };
      }
      const urlField = getByPath(data, provider.responseUrlField || "url");
      const deleteField = getByPath(data, provider.responseDeleteUrlField || "delete_url");
      const trimmedText = text.trim();
      const extractedTextUrl = extractFirstHttpUrl(trimmedText);
      if (urlField) {
        return {
          success: true,
          url: typeof urlField === "string" ? urlField : String(urlField),
          deleteUrl: deleteField ? typeof deleteField === "string" ? deleteField : String(deleteField) : void 0
        };
      }
      if (extractedTextUrl) {
        return { success: true, url: extractedTextUrl };
      }
      console.warn("[ImageHost/Main] Upload succeeded but no URL was detected in the response", {
        provider: provider.name,
        platform: provider.platform,
        responsePreview: trimmedText.substring(0, 200)
      });
      return { success: false, error: `图床 ${provider.name} 上传成功但未返回 URL` };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { success: false, error: "上传超时，请稍后重试" };
      }
      return { success: false, error: error instanceof Error ? error.message : "上传失败" };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "上传失败" };
  }
}
electron.ipcMain.handle("save-image", async (_event, { url, category, filename }) => {
  try {
    const imagesDir = getImagesDir(category);
    const ext = path.extname(filename) || ".png";
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const filePath = path.join(imagesDir, safeName);
    if (url.startsWith("data:")) {
      const matches = url.match(/^data:[^;]+;base64,(.+)$/s);
      if (!matches) {
        return { success: false, error: "Invalid data URL format" };
      }
      const buffer = Buffer.from(matches[1], "base64");
      if (buffer.length === 0) {
        return { success: false, error: "Decoded base64 data is empty (0 bytes)" };
      }
      fs.writeFileSync(filePath, buffer);
    } else {
      await downloadImage(url, filePath);
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      fs.unlinkSync(filePath);
      return { success: false, error: "Saved file is 0 bytes" };
    }
    return { success: true, localPath: `local-image://${category}/${safeName}` };
  } catch (error) {
    console.error("Failed to save image:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("get-image-path", async (_event, localPath) => {
  try {
    const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    if (fs.existsSync(filePath)) {
      return `file:///${filePath.replace(/\\/g, "/")}`;
    }
  } catch {
    return null;
  }
  return null;
});
electron.ipcMain.handle("delete-image", async (_event, localPath) => {
  try {
    const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
});
electron.ipcMain.handle("read-image-base64", async (_event, localPath) => {
  try {
    const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp"
    };
    const mimeType = mimeTypes[ext] || "image/png";
    const base64 = `data:${mimeType};base64,${data.toString("base64")}`;
    return { success: true, base64, mimeType, size: data.length };
  } catch (error) {
    console.error("Failed to read image:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("get-absolute-path", async (_event, localPath) => {
  try {
    const filePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  } catch {
    return null;
  }
  return null;
});
electron.ipcMain.handle("image-host-upload", async (_event, payload) => {
  const operationId = createDiagnosticsOperationId("image-host");
  writeDiagnosticsLog({
    level: "info",
    category: "ipc",
    operationId,
    message: "Image host upload IPC started",
    context: {
      providerName: payload.provider.name,
      platform: payload.provider.platform,
      baseUrl: payload.provider.baseUrl,
      imageDataLength: payload.imageData.length
    }
  });
  try {
    const result = await uploadImageHostFromMain(payload);
    writeDiagnosticsLog({
      level: result.success ? "info" : "error",
      category: "network",
      operationId,
      message: result.success ? "Image host upload completed" : "Image host upload failed",
      context: {
        providerName: payload.provider.name,
        platform: payload.provider.platform,
        hasUrl: Boolean(result.url),
        error: result.error
      }
    });
    return result;
  } catch (error) {
    writeDiagnosticsLog({
      level: "error",
      category: "network",
      operationId,
      message: "Image host upload errored",
      context: {
        providerName: payload.provider.name,
        platform: payload.provider.platform
      },
      error
    });
    throw error;
  }
});
const getDataDir = () => {
  const dataDir = getProjectDataRoot();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};
electron.ipcMain.handle("file-storage-get", async (_event, key) => {
  try {
    const filePath = resolveDataFilePath(getDataDir(), key);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return data;
    }
    return null;
  } catch (error) {
    console.error("Failed to read file storage:", error);
    return null;
  }
});
electron.ipcMain.handle("file-storage-set", async (_event, key, value) => {
  try {
    const filePath = resolveDataFilePath(getDataDir(), key);
    const parentDir = path.dirname(filePath);
    ensureDir(parentDir);
    fs.writeFileSync(filePath, value, "utf-8");
    console.log(`Saved to file: ${filePath} (${Math.round(value.length / 1024)}KB)`);
    return true;
  } catch (error) {
    console.error("Failed to write file storage:", error);
    return false;
  }
});
electron.ipcMain.handle("file-storage-remove", async (_event, key) => {
  try {
    const filePath = resolveDataFilePath(getDataDir(), key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    console.error("Failed to remove file storage:", error);
    return false;
  }
});
electron.ipcMain.handle("file-storage-rename", async (_event, fromKey, toKey) => {
  try {
    const fromPath = resolveDataFilePath(getDataDir(), fromKey);
    const toPath = resolveDataFilePath(getDataDir(), toKey);
    if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return false;
    ensureDir(path.dirname(toPath));
    fs.renameSync(fromPath, toPath);
    return true;
  } catch (error) {
    console.error("Failed to rename file storage:", error);
    return false;
  }
});
electron.ipcMain.handle("file-storage-exists", async (_event, key) => {
  try {
    const filePath = resolveDataFilePath(getDataDir(), key);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});
electron.ipcMain.handle("file-storage-list-dirs", async (_event, prefix) => {
  try {
    const dirPath = resolveDataDirPath(getDataDir(), prefix);
    if (!fs.existsSync(dirPath)) return [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "_migrated").map((e) => e.name);
  } catch {
    return [];
  }
});
electron.ipcMain.handle("file-storage-list", async (_event, prefix) => {
  try {
    const dirPath = resolveDataDirPath(getDataDir(), prefix);
    if (!fs.existsSync(dirPath)) return [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => `${prefix}/${e.name.replace(".json", "")}`);
  } catch {
    return [];
  }
});
electron.ipcMain.handle("file-storage-remove-dir", async (_event, prefix) => {
  try {
    const dirPath = resolveDataDirPath(getDataDir(), prefix);
    if (fs.existsSync(dirPath)) {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    }
    return true;
  } catch (error) {
    console.error("Failed to remove directory:", error);
    return false;
  }
});
function resolveProjectFilePath(key) {
  const dataRoot = getDataDir();
  const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedKey || normalizedKey.includes("../") || normalizedKey.includes("..\\")) {
    throw new Error("Invalid project file key");
  }
  const targetPath = path.resolve(dataRoot, normalizedKey);
  const normalizedRoot = path.resolve(dataRoot);
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Project file key escapes storage root");
  }
  return targetPath;
}
function getStudioManualsSourceRoot() {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, "../..");
  const candidates = [
    path.join(appRoot, "src", "assets", "studio-manuals"),
    path.join(electron.app.getAppPath(), "src", "assets", "studio-manuals"),
    path.join(process.resourcesPath, "studio-manuals")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
function getToonflowRuntimeStudioManualsSourceRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "toonflow", "data", "skills");
}
function getStudioManualsFallbackSourceRoots() {
  const primaryRoot = path.resolve(getStudioManualsSourceRoot());
  return [getToonflowRuntimeStudioManualsSourceRoot()].map((candidate) => path.resolve(candidate)).filter((candidate) => candidate !== primaryRoot && fs.existsSync(candidate));
}
function getStudioSkillSyncOptions() {
  return {
    sourceRoot: getStudioManualsSourceRoot(),
    fallbackSourceRoots: getStudioManualsFallbackSourceRoots(),
    storageRoot: getSkillsRoot()
  };
}
function encodePathForProtocol(relativePath) {
  return relativePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}
function makeStudioSkillFileUrl(relativePath) {
  return `studio-skill://${encodePathForProtocol(relativePath)}`;
}
async function ensureStudioSkillsAvailableAtStartup() {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
  } catch (error) {
    console.warn("Failed to sync studio skills at startup:", error);
  }
}
electron.ipcMain.handle("project-file-write-text", async (_event, key, value) => {
  try {
    const filePath = resolveProjectFilePath(key);
    ensureDir(path.dirname(filePath));
    await fs.promises.writeFile(filePath, value, "utf-8");
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
function toProjectFileBuffer(bytes) {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}
async function writeProjectBinaryFile(payload, buffer) {
  if (buffer.length === 0) {
    return { success: false, error: "项目文件为空" };
  }
  const filePath = resolveProjectScopedFilePath(getDataDir(), payload.projectId, payload.relativePath);
  ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, buffer);
  return {
    success: true,
    url: createProjectFileUrl(payload.projectId, payload.relativePath),
    filePath,
    size: buffer.length
  };
}
electron.ipcMain.handle("project-file-write-binary", async (_event, payload) => {
  try {
    return await writeProjectBinaryFile(payload, toProjectFileBuffer(payload.bytes));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("project-file-save-image", async (_event, payload) => {
  try {
    const { buffer } = await readImageSource(payload.source);
    return await writeProjectBinaryFile(payload, buffer);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("project-file-read-base64", async (_event, projectFileUrl) => {
  try {
    const filePath = resolveProjectFileUrl(getDataDir(), projectFileUrl);
    const data = await fs.promises.readFile(filePath);
    return {
      success: true,
      base64: `data:${getMimeType(filePath)};base64,${data.toString("base64")}`,
      mimeType: getMimeType(filePath),
      size: data.length
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("project-file-get-absolute-path", async (_event, projectFileUrl) => {
  try {
    const filePath = resolveProjectFileUrl(getDataDir(), projectFileUrl);
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
});
electron.ipcMain.handle("project-file-remove-text", async (_event, key) => {
  try {
    const filePath = resolveProjectFilePath(key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-skill-list", async () => {
  try {
    return await listStoredStudioSkillFiles(getStudioSkillSyncOptions());
  } catch (error) {
    console.warn("Failed to list studio skills:", error);
    return [];
  }
});
electron.ipcMain.handle("studio-skill-read-text", async (_event, relativePath) => {
  try {
    const skillsRoot = getSkillsRoot();
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath);
    const content = await readStoredStudioSkillText(skillsRoot, relativePath);
    const filePath = targetPath;
    return { success: true, content, filePath, storagePath: filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-skill-write-text", async (_event, relativePath, value) => {
  try {
    const skillsRoot = getSkillsRoot();
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath);
    const stat = await writeStoredStudioSkillText(skillsRoot, relativePath, value);
    const filePath = targetPath;
    return { success: true, filePath, storagePath: filePath, updatedAt: stat.mtimeMs };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-skill-create-text", async (_event, relativePath, value) => {
  try {
    const skillsRoot = getSkillsRoot();
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    const created = await createStoredStudioSkillFile(skillsRoot, relativePath, value);
    return { success: true, ...created };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-skill-delete-text", async (_event, relativePath) => {
  try {
    const deleted = await deleteStoredStudioSkillFile(getSkillsRoot(), relativePath);
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-skill-restore-text", async (_event, relativePath) => {
  try {
    const restored = await restoreStoredStudioSkillFile(getStudioSkillSyncOptions(), relativePath);
    return { success: true, ...restored };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
let _visualManualListCache = null;
let _visualManualListLoading = null;
electron.ipcMain.handle("studio-visual-manual-list", async (_event, options) => {
  if (options?.refresh) {
    _visualManualListCache = null;
    resetStudioSkillsSyncState();
  }
  if (_visualManualListCache) return _visualManualListCache;
  if (_visualManualListLoading) return _visualManualListLoading;
  _visualManualListLoading = (async () => {
    try {
      const result = await listStoredVisualManuals({
        ...getStudioSkillSyncOptions(),
        makeFileUrl: makeStudioSkillFileUrl
      });
      _visualManualListCache = result;
      return result;
    } catch (error) {
      console.warn("Failed to list studio visual manuals:", error);
      return [];
    } finally {
      _visualManualListLoading = null;
    }
  })();
  return _visualManualListLoading;
});
electron.ipcMain.handle("studio-visual-manual-read", async (_event, stylePath) => {
  try {
    const manual = await readStoredVisualManual({
      ...getStudioSkillSyncOptions(),
      makeFileUrl: makeStudioSkillFileUrl
    }, stylePath);
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-visual-manual-write", async (_event, stylePath, payload) => {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    await writeStoredVisualManual(getSkillsRoot(), stylePath, payload);
    const manual = await readStoredVisualManual({
      ...getStudioSkillSyncOptions(),
      makeFileUrl: makeStudioSkillFileUrl
    }, stylePath);
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-visual-manual-write-images", async (_event, stylePath, payload) => {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    await writeStoredVisualManualImages(getSkillsRoot(), stylePath, payload);
    const manual = await readStoredVisualManual({
      ...getStudioSkillSyncOptions(),
      makeFileUrl: makeStudioSkillFileUrl
    }, stylePath);
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-visual-manual-create", async (_event, payload) => {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    const stylePath = await createStoredVisualManual(getSkillsRoot(), payload);
    const manual = await readStoredVisualManual({
      ...getStudioSkillSyncOptions(),
      makeFileUrl: makeStudioSkillFileUrl
    }, stylePath);
    _visualManualListCache = null;
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-visual-manual-duplicate", async (_event, payload) => {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
    const stylePath = await duplicateStoredVisualManual(getSkillsRoot(), payload.sourceStylePath, payload);
    const manual = await readStoredVisualManual({
      ...getStudioSkillSyncOptions(),
      makeFileUrl: makeStudioSkillFileUrl
    }, stylePath);
    _visualManualListCache = null;
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("storage-get-paths", async () => {
  return {
    basePath: getStorageBasePath(),
    projectPath: getProjectDataRoot(),
    mediaPath: getMediaRoot(),
    skillsPath: getSkillsRoot(),
    cachePath: path.join(electron.app.getPath("userData"), "Cache")
  };
});
electron.ipcMain.handle("storage-select-directory", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
electron.ipcMain.handle("storage-validate-data-dir", async (_event, dirPath) => {
  try {
    if (!dirPath) return { valid: false, error: "路径不能为空" };
    const target = normalizePath(dirPath);
    if (!fs.existsSync(target)) return { valid: false, error: "目录不存在" };
    const projectsDir = path.join(target, "projects");
    const mediaDir = path.join(target, "media");
    const skillsDir = path.join(target, "skills");
    let projectCount = 0;
    let mediaCount = 0;
    let skillCount = 0;
    if (fs.existsSync(projectsDir)) {
      const files = await fs.promises.readdir(projectsDir);
      projectCount = files.filter((f) => f.endsWith(".json")).length;
      const perProjectDir = path.join(projectsDir, "_p");
      if (fs.existsSync(perProjectDir)) {
        const projectDirs = await fs.promises.readdir(perProjectDir, { withFileTypes: true });
        const dirCount = projectDirs.filter((d) => d.isDirectory() && !d.name.startsWith(".")).length;
        if (dirCount > 0) projectCount = Math.max(projectCount, dirCount);
      }
    }
    if (fs.existsSync(mediaDir)) {
      const entries = await fs.promises.readdir(mediaDir);
      mediaCount = entries.length;
    }
    if (fs.existsSync(skillsDir)) {
      const skillFiles = await listStoredStudioSkillFiles({
        sourceRoot: getStudioManualsSourceRoot(),
        storageRoot: skillsDir
      });
      skillCount = skillFiles.length;
    }
    if (projectCount === 0 && mediaCount === 0 && skillCount === 0) {
      return { valid: false, error: "该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）" };
    }
    return { valid: true, projectCount, mediaCount, skillCount };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-link-data", async (_event, dirPath) => {
  try {
    if (!dirPath) return { success: false, error: "路径不能为空" };
    const target = normalizePath(dirPath);
    if (!fs.existsSync(target)) return { success: false, error: "目录不存在" };
    const projectsDir = path.join(target, "projects");
    const mediaDir = path.join(target, "media");
    const skillsDir = path.join(target, "skills");
    const hasProjects = fs.existsSync(projectsDir);
    const hasMedia = fs.existsSync(mediaDir);
    const hasSkills = fs.existsSync(skillsDir);
    if (!hasProjects && !hasMedia && !hasSkills) {
      return { success: false, error: "该目录不包含有效的数据（需要 projects/、media/ 或 skills/ 子目录）" };
    }
    storageConfig.basePath = target;
    storageConfig.projectPath = "";
    storageConfig.mediaPath = "";
    saveStorageConfig();
    return { success: true, path: target };
  } catch (error) {
    console.error("Failed to link data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-move-data", async (_event, newPath) => {
  try {
    if (!newPath) return { success: false, error: "路径不能为空" };
    const target = normalizePath(newPath);
    const currentBase = getStorageBasePath();
    if (currentBase === target) return { success: true, path: currentBase };
    const conflictError = pathsConflict(currentBase, target);
    if (conflictError) {
      return { success: false, error: conflictError };
    }
    const targetProjectsDir = path.join(target, "projects");
    const targetMediaDir = path.join(target, "media");
    const targetSkillsDir = path.join(target, "skills");
    ensureDir(targetProjectsDir);
    ensureDir(targetMediaDir);
    ensureDir(targetSkillsDir);
    const currentProjectsDir = getProjectDataRoot();
    if (fs.existsSync(currentProjectsDir)) {
      const files = await fs.promises.readdir(currentProjectsDir);
      for (const file of files) {
        const src = path.join(currentProjectsDir, file);
        const dest = path.join(targetProjectsDir, file);
        await fs.promises.cp(src, dest, { recursive: true, force: true });
      }
    }
    const currentMediaDir = getMediaRoot();
    if (fs.existsSync(currentMediaDir)) {
      const files = await fs.promises.readdir(currentMediaDir);
      for (const file of files) {
        const src = path.join(currentMediaDir, file);
        const dest = path.join(targetMediaDir, file);
        await fs.promises.cp(src, dest, { recursive: true, force: true });
      }
    }
    const currentSkillsDir = getSkillsRoot();
    if (fs.existsSync(currentSkillsDir)) {
      const files = await fs.promises.readdir(currentSkillsDir);
      for (const file of files) {
        const src = path.join(currentSkillsDir, file);
        const dest = path.join(targetSkillsDir, file);
        await fs.promises.cp(src, dest, { recursive: true, force: true });
      }
    }
    storageConfig.basePath = target;
    storageConfig.projectPath = "";
    storageConfig.mediaPath = "";
    saveStorageConfig();
    const userData = electron.app.getPath("userData");
    if (!currentProjectsDir.startsWith(userData)) {
      await removeDir(currentProjectsDir).catch(() => {
      });
    }
    if (!currentMediaDir.startsWith(userData)) {
      await removeDir(currentMediaDir).catch(() => {
      });
    }
    if (!currentSkillsDir.startsWith(userData)) {
      await removeDir(currentSkillsDir).catch(() => {
      });
    }
    return { success: true, path: target };
  } catch (error) {
    console.error("Failed to move data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-export-data", async (_event, targetPath) => {
  try {
    if (!targetPath) return { success: false, error: "路径不能为空" };
    const exportDir = path.join(
      normalizePath(targetPath),
      `mystudio-data-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`
    );
    const exportProjectsDir = path.join(exportDir, "projects");
    const exportMediaDir = path.join(exportDir, "media");
    const exportSkillsDir = path.join(exportDir, "skills");
    ensureDir(exportProjectsDir);
    ensureDir(exportMediaDir);
    ensureDir(exportSkillsDir);
    await copyDir(getProjectDataRoot(), exportProjectsDir);
    await copyDir(getMediaRoot(), exportMediaDir);
    await copyDir(getSkillsRoot(), exportSkillsDir);
    return { success: true, path: exportDir };
  } catch (error) {
    console.error("Failed to export data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-import-data", async (_event, sourcePath) => {
  try {
    if (!sourcePath) return { success: false, error: "路径不能为空" };
    const source = normalizePath(sourcePath);
    const sourceProjectsDir = path.join(source, "projects");
    const sourceMediaDir = path.join(source, "media");
    const sourceSkillsDir = path.join(source, "skills");
    const hasProjects = fs.existsSync(sourceProjectsDir);
    const hasMedia = fs.existsSync(sourceMediaDir);
    const hasSkills = fs.existsSync(sourceSkillsDir);
    if (!hasProjects && !hasMedia && !hasSkills) {
      return { success: false, error: "源目录不包含有效数据（需要 projects/、media/ 或 skills/ 子目录）" };
    }
    const backupDir = path.join(os.tmpdir(), `mystudio-backup-${Date.now()}`);
    const currentProjectsDir = getProjectDataRoot();
    const currentMediaDir = getMediaRoot();
    const currentSkillsDir = getSkillsRoot();
    try {
      if (hasProjects && fs.existsSync(currentProjectsDir)) {
        const files = await fs.promises.readdir(currentProjectsDir);
        if (files.length > 0) {
          await copyDir(currentProjectsDir, path.join(backupDir, "projects"));
        }
      }
      if (hasMedia && fs.existsSync(currentMediaDir)) {
        const files = await fs.promises.readdir(currentMediaDir);
        if (files.length > 0) {
          await copyDir(currentMediaDir, path.join(backupDir, "media"));
        }
      }
      if (hasSkills && fs.existsSync(currentSkillsDir)) {
        const files = await fs.promises.readdir(currentSkillsDir);
        if (files.length > 0) {
          await copyDir(currentSkillsDir, path.join(backupDir, "skills"));
        }
      }
      if (hasProjects) {
        await removeDir(currentProjectsDir).catch(() => {
        });
        await copyDir(sourceProjectsDir, currentProjectsDir);
      }
      if (hasMedia) {
        await removeDir(currentMediaDir).catch(() => {
        });
        await copyDir(sourceMediaDir, currentMediaDir);
      }
      if (hasSkills) {
        await removeDir(currentSkillsDir).catch(() => {
        });
        await copyDir(sourceSkillsDir, currentSkillsDir);
      }
      const migrationFlagPath = path.join(currentProjectsDir, "_p", "_migrated.json");
      if (fs.existsSync(migrationFlagPath)) {
        fs.unlinkSync(migrationFlagPath);
        console.log("Cleared migration flag for re-evaluation after import");
      }
      await removeDir(backupDir).catch(() => {
      });
      return { success: true };
    } catch (importError) {
      console.error("Import failed, rolling back:", importError);
      const backupProjectsDir = path.join(backupDir, "projects");
      const backupMediaDir = path.join(backupDir, "media");
      const backupSkillsDir = path.join(backupDir, "skills");
      if (fs.existsSync(backupProjectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {
        });
        await copyDir(backupProjectsDir, currentProjectsDir).catch(() => {
        });
      }
      if (fs.existsSync(backupMediaDir)) {
        await removeDir(currentMediaDir).catch(() => {
        });
        await copyDir(backupMediaDir, currentMediaDir).catch(() => {
        });
      }
      if (fs.existsSync(backupSkillsDir)) {
        await removeDir(currentSkillsDir).catch(() => {
        });
        await copyDir(backupSkillsDir, currentSkillsDir).catch(() => {
        });
      }
      await removeDir(backupDir).catch(() => {
      });
      throw importError;
    }
  } catch (error) {
    console.error("Failed to import data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-validate-project-dir", async (_event, dirPath) => {
  return electron.ipcMain.emit("storage-validate-data-dir", null, dirPath);
});
electron.ipcMain.handle("storage-link-project-data", async (_event, dirPath) => {
  const target = normalizePath(dirPath);
  const basePath2 = path.dirname(target);
  storageConfig.basePath = basePath2;
  storageConfig.projectPath = "";
  storageConfig.mediaPath = "";
  saveStorageConfig();
  return { success: true, path: basePath2 };
});
electron.ipcMain.handle("storage-link-media-data", async (_event, dirPath) => {
  const target = normalizePath(dirPath);
  const basePath2 = path.dirname(target);
  storageConfig.basePath = basePath2;
  storageConfig.projectPath = "";
  storageConfig.mediaPath = "";
  saveStorageConfig();
  return { success: true, path: basePath2 };
});
electron.ipcMain.handle("storage-move-project-data", async () => {
  return { success: false, error: "请使用新的统一存储路径功能" };
});
electron.ipcMain.handle("storage-move-media-data", async () => {
  return { success: false, error: "请使用新的统一存储路径功能" };
});
electron.ipcMain.handle("storage-export-project-data", async (_event, targetPath) => {
  try {
    if (!targetPath) return { success: false, error: "路径不能为空" };
    const exportDir = path.join(
      normalizePath(targetPath),
      `mystudio-data-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`
    );
    ensureDir(path.join(exportDir, "projects"));
    ensureDir(path.join(exportDir, "media"));
    await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
    await copyDir(getMediaRoot(), path.join(exportDir, "media"));
    return { success: true, path: exportDir };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-import-project-data", async (_event, sourcePath) => {
  try {
    if (!sourcePath) return { success: false, error: "路径不能为空" };
    const source = normalizePath(sourcePath);
    const projectsDir = path.join(source, "projects");
    const mediaDir = path.join(source, "media");
    const currentProjectsDir = getProjectDataRoot();
    const currentMediaDir = getMediaRoot();
    const backupDir = path.join(os.tmpdir(), `mystudio-legacy-import-backup-${Date.now()}`);
    try {
      if (fs.existsSync(currentProjectsDir)) {
        const files = await fs.promises.readdir(currentProjectsDir);
        if (files.length > 0) {
          await copyDir(currentProjectsDir, path.join(backupDir, "projects"));
        }
      }
      if (fs.existsSync(currentMediaDir)) {
        const files = await fs.promises.readdir(currentMediaDir);
        if (files.length > 0) {
          await copyDir(currentMediaDir, path.join(backupDir, "media"));
        }
      }
      if (fs.existsSync(projectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {
        });
        await copyDir(projectsDir, currentProjectsDir);
      } else {
        await removeDir(currentProjectsDir).catch(() => {
        });
        await copyDir(source, currentProjectsDir);
      }
      if (fs.existsSync(mediaDir)) {
        await removeDir(currentMediaDir).catch(() => {
        });
        await copyDir(mediaDir, currentMediaDir);
      }
      await removeDir(backupDir).catch(() => {
      });
      return { success: true };
    } catch (importError) {
      console.error("Legacy import failed, rolling back:", importError);
      const backupProjectsDir = path.join(backupDir, "projects");
      const backupMediaDir = path.join(backupDir, "media");
      if (fs.existsSync(backupProjectsDir)) {
        await removeDir(currentProjectsDir).catch(() => {
        });
        await copyDir(backupProjectsDir, currentProjectsDir).catch(() => {
        });
      }
      if (fs.existsSync(backupMediaDir)) {
        await removeDir(currentMediaDir).catch(() => {
        });
        await copyDir(backupMediaDir, currentMediaDir).catch(() => {
        });
      }
      await removeDir(backupDir).catch(() => {
      });
      throw importError;
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-export-media-data", async (_event, targetPath) => {
  try {
    if (!targetPath) return { success: false, error: "路径不能为空" };
    const exportDir = path.join(
      normalizePath(targetPath),
      `mystudio-data-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`
    );
    ensureDir(path.join(exportDir, "projects"));
    ensureDir(path.join(exportDir, "media"));
    await copyDir(getProjectDataRoot(), path.join(exportDir, "projects"));
    await copyDir(getMediaRoot(), path.join(exportDir, "media"));
    return { success: true, path: exportDir };
  } catch (error) {
    console.error("Failed to export data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-import-media-data", async (_event, sourcePath) => {
  try {
    if (!sourcePath) return { success: false, error: "路径不能为空" };
    const target = getMediaRoot();
    const source = normalizePath(sourcePath);
    if (source === target) return { success: true };
    const backupDir = path.join(os.tmpdir(), `mystudio-media-import-backup-${Date.now()}`);
    try {
      if (fs.existsSync(target)) {
        const files = await fs.promises.readdir(target);
        if (files.length > 0) {
          await copyDir(target, backupDir);
        }
      }
      await removeDir(target);
      await copyDir(source, target);
      await removeDir(backupDir).catch(() => {
      });
      return { success: true };
    } catch (importError) {
      console.error("Media import failed, rolling back:", importError);
      if (fs.existsSync(backupDir)) {
        await removeDir(target).catch(() => {
        });
        await copyDir(backupDir, target).catch(() => {
        });
      }
      await removeDir(backupDir).catch(() => {
      });
      throw importError;
    }
  } catch (error) {
    console.error("Failed to import media data:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-get-cache-size", async () => {
  const dirs = getCacheDirs();
  const details = await Promise.all(
    dirs.map(async (dirPath) => ({
      path: dirPath,
      size: await getDirectorySize(dirPath)
    }))
  );
  const total = details.reduce((sum, item) => sum + item.size, 0);
  return { total, details };
});
electron.ipcMain.handle("storage-clear-cache", async (_event, options) => {
  try {
    const clearedBytes = await clearCache(options?.olderThanDays);
    return { success: true, clearedBytes };
  } catch (error) {
    console.error("Failed to clear cache:", error);
    return { success: false, error: String(error) };
  }
});
electron.ipcMain.handle("storage-update-config", async (_event, config) => {
  storageConfig = { ...storageConfig, ...config };
  saveStorageConfig();
  scheduleAutoClean();
  return true;
});
electron.ipcMain.handle("app-updater-get-current-version", async () => {
  return electron.app.getVersion();
});
electron.ipcMain.handle("app-updater-check", async (_event, options) => {
  const currentVersion = electron.app.getVersion();
  try {
    const update = await resolveAvailableUpdate(currentVersion);
    return {
      success: true,
      currentVersion,
      hasUpdate: !!update,
      update
    };
  } catch (error) {
    if (!options?.silent) {
      console.error("Failed to check updates:", error);
    }
    return {
      success: false,
      currentVersion,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});
electron.ipcMain.handle("app-updater-open-link", async (_event, url) => {
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl) {
    return { success: false, error: "无效下载链接" };
  }
  try {
    await electron.shell.openExternal(safeUrl);
    return { success: true };
  } catch (error) {
    console.error("Failed to open external link:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});
electron.ipcMain.handle("app-devtools-open", async (event) => {
  try {
    const targetWindow = electron.BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      return { success: false, error: "未找到当前窗口" };
    }
    targetWindow.webContents.openDevTools({ mode: "detach" });
    return { success: true };
  } catch (error) {
    console.error("Failed to open DevTools:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});
electron.ipcMain.handle("app-open-path", async (_event, targetPath) => {
  if (!isNonEmptyString(targetPath) || targetPath.includes("\0")) {
    return { success: false, error: "无效文件路径" };
  }
  try {
    const resolvedPath = resolveStudioSourcePath(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: "文件不存在" };
    }
    const error = await electron.shell.openPath(resolvedPath);
    return error ? { success: false, error } : { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("diagnostics-log-write", async (_event, entry) => {
  return diagnosticsLogService.write(entry);
});
electron.ipcMain.handle("diagnostics-log-query", async (_event, query) => {
  return diagnosticsLogService.query(query);
});
electron.ipcMain.handle("diagnostics-log-get-info", async () => {
  return diagnosticsLogService.getInfo();
});
electron.ipcMain.handle("diagnostics-log-open-folder", async () => {
  const directory = diagnosticsLogService.getDirectory();
  const error = await electron.shell.openPath(directory);
  return error ? { success: false, directory, error } : { success: true, directory };
});
electron.ipcMain.handle("diagnostics-log-export-bundle", async () => {
  return diagnosticsLogService.exportBundle();
});
electron.ipcMain.handle("diagnostics-log-clear", async () => {
  return diagnosticsLogService.clear();
});
electron.ipcMain.handle("api-model-test", async (_event, payload) => {
  const operationId = payload.operationId?.trim() || createDiagnosticsOperationId("model-test");
  writeDiagnosticsLog({
    level: "info",
    category: "ipc",
    operationId,
    message: "Model test IPC started",
    context: {
      providerId: payload.provider.id,
      providerName: payload.provider.name,
      platform: payload.provider.platform,
      model: payload.model,
      type: payload.type
    }
  });
  const result = await runModelTestRequest(payload, createDiagnosticsFetch({
    operationId,
    endpointFamily: "model-test",
    providerId: payload.provider.id,
    providerName: payload.provider.name,
    model: payload.model,
    timeoutMs: getModelTestTimeoutMs(payload.type)
  }));
  writeDiagnosticsLog({
    level: result.success ? "info" : "error",
    category: "ipc",
    operationId,
    message: result.success ? "Model test IPC completed" : "Model test IPC failed",
    context: { status: result.status, protocol: result.protocol, elapsedMs: result.elapsedMs, error: result.error }
  });
  return result;
});
electron.ipcMain.handle("api-text-completion", async (_event, payload) => {
  const operationId = createDiagnosticsOperationId("text-completion");
  writeDiagnosticsLog({
    level: "info",
    category: "ipc",
    operationId,
    message: "Text completion IPC started",
    context: {
      providerId: payload.provider.id,
      providerName: payload.provider.name,
      platform: payload.provider.platform,
      model: payload.model,
      messageCount: payload.messages.length
    }
  });
  const provider = payload.provider;
  if (provider?.platform && provider?.apiKey) {
    try {
      const result2 = await sdkGenerateText({
        provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, platform: provider.platform, name: provider.name },
        model: provider.model?.[0] || payload.model || "",
        messages: payload.messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      });
      if (result2.success) {
        writeDiagnosticsLog({
          level: "info",
          category: "ai",
          operationId,
          message: "Text completion completed through AI SDK",
          context: { providerName: provider.name, model: provider.model?.[0] || payload.model || "" }
        });
        return { success: true, text: result2.text };
      }
    } catch (_e) {
      writeDiagnosticsLog({
        level: "warn",
        category: "ai",
        operationId,
        message: "AI SDK text completion failed, falling back to HTTP",
        error: _e
      });
    }
  }
  const result = await runTextCompletionRequest(payload, createDiagnosticsFetch({
    operationId,
    endpointFamily: "text-completion",
    providerId: payload.provider.id,
    providerName: payload.provider.name,
    model: payload.model,
    timeoutMs: 3e5
  }));
  writeDiagnosticsLog({
    level: result.success ? "info" : "error",
    category: "ipc",
    operationId,
    message: result.success ? "Text completion IPC completed" : "Text completion IPC failed",
    context: { status: result.status, protocol: result.protocol, elapsedMs: result.elapsedMs, error: result.error }
  });
  return result;
});
electron.ipcMain.handle("api-text-completion-stream", async (event, args) => {
  const operationId = createDiagnosticsOperationId("text-stream");
  writeDiagnosticsLog({
    level: "info",
    category: "ipc",
    operationId,
    message: "Text completion stream IPC started",
    context: {
      providerId: args.payload.provider.id,
      providerName: args.payload.provider.name,
      platform: args.payload.provider.platform,
      model: args.payload.model,
      streamId: args.streamId
    }
  });
  const provider = args.payload.provider;
  if (provider?.platform && provider?.apiKey) {
    try {
      const stream = await sdkStreamText({
        provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, platform: provider.platform, name: provider.name },
        model: provider.model?.[0] || args.payload.model || "",
        messages: args.payload.messages,
        temperature: args.payload.temperature,
        maxTokens: args.payload.maxTokens
      });
      let fullText = "";
      for await (const chunk of stream.fullStream) {
        if (chunk.type === "text-delta") {
          fullText += chunk.text;
          if (!event.sender.isDestroyed()) {
            event.sender.send(`api-text-stream:${args.streamId}`, { delta: chunk.text });
          }
        }
      }
      writeDiagnosticsLog({
        level: "info",
        category: "ai",
        operationId,
        message: "Text completion stream completed through AI SDK",
        context: { streamId: args.streamId, textLength: fullText.length }
      });
      return { success: true, text: fullText };
    } catch (_e) {
      writeDiagnosticsLog({
        level: "warn",
        category: "ai",
        operationId,
        message: "AI SDK text stream failed, falling back to HTTP",
        context: { streamId: args.streamId },
        error: _e
      });
    }
  }
  const result = await runTextCompletionStreamRequest(args.payload, (delta) => {
    if (!event.sender.isDestroyed()) event.sender.send(`api-text-stream:${args.streamId}`, delta);
  }, createDiagnosticsFetch({
    operationId,
    endpointFamily: "text-completion-stream",
    providerId: args.payload.provider.id,
    providerName: args.payload.provider.name,
    model: args.payload.model,
    timeoutMs: 3e5
  }));
  writeDiagnosticsLog({
    level: result.success ? "info" : "error",
    category: "ipc",
    operationId,
    message: result.success ? "Text completion stream IPC completed" : "Text completion stream IPC failed",
    context: { status: result.status, protocol: result.protocol, elapsedMs: result.elapsedMs, error: result.error, streamId: args.streamId }
  });
  return result;
});
electron.ipcMain.handle("save-file-dialog", async (_event, { localPath, defaultPath, filters }) => {
  try {
    let sourcePath = null;
    const imageMatch = localPath.match(/^local-image:\/\/(.+)\/(.+)$/);
    const videoMatch = localPath.match(/^local-video:\/\/(.+)\/(.+)$/);
    if (localPath.startsWith("project-file://")) {
      sourcePath = resolveProjectFileUrl(getDataDir(), localPath);
    } else if (imageMatch) {
      sourcePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    } else if (videoMatch) {
      sourcePath = resolveLocalMediaPath(getMediaRoot(), localPath);
    } else if (localPath.startsWith("file://")) {
      sourcePath = localPath.replace("file://", "");
    } else {
      sourcePath = localPath;
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { success: false, error: "Source file not found" };
    }
    const result = await electron.dialog.showSaveDialog({
      defaultPath,
      filters
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    fs.copyFileSync(sourcePath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error("Failed to save file:", error);
    return { success: false, error: String(error) };
  }
});
function getStudioRenderRoot() {
  const base = path.join(getMediaRoot(), "studio-render");
  ensureDir(base);
  return base;
}
function getStudioAssetsRoot() {
  const base = path.join(getMediaRoot(), "studio-assets");
  ensureDir(base);
  return base;
}
function createStudioRenderName(prefix) {
  return `${prefix}-${crypto$1.randomUUID()}.mp4`;
}
function sanitizeStudioFilename(name) {
  const ext = path.extname(name).toLowerCase() || ".bin";
  const base = path.basename(name, ext).trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "material";
  return `${base}-${crypto$1.randomUUID()}${ext}`;
}
function resolveStudioSourcePath(sourcePath) {
  if (sourcePath.startsWith("file://")) return sourcePath.replace("file://", "");
  if (sourcePath.startsWith("project-file://")) {
    return resolveProjectFileUrl(getDataDir(), sourcePath);
  }
  if (sourcePath.startsWith("local-image://")) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath);
  }
  return sourcePath;
}
function ensureReadableStudioSource(sourcePath) {
  const resolved = resolveStudioSourcePath(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`素材不存在: ${sourcePath}`);
  }
  return resolved;
}
function srtTime(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor(safeSeconds % 3600 / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.floor(safeSeconds % 1 * 1e3);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
function escapeSubtitlePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
async function assertFfmpegAvailable() {
  try {
    await execFileAsync("ffmpeg", ["-version"], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error("未找到本地 ffmpeg，请先安装 ffmpeg 并确保命令行可访问");
  }
}
async function renderStudioSegment(input, outputPath) {
  const sourcePath = ensureReadableStudioSource(input.sourcePath);
  const audioPath = input.audioPath ? ensureReadableStudioSource(input.audioPath) : null;
  const duration = Math.max(0.2, Number(input.duration) || 5);
  const videoFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p";
  const audioInputArgs = audioPath ? ["-i", audioPath] : ["-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
  if (input.sourceKind === "image") {
    await execFileAsync("ffmpeg", [
      "-loop",
      "1",
      "-t",
      String(duration),
      "-i",
      sourcePath,
      ...audioInputArgs,
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-y",
      outputPath
    ], { maxBuffer: 50 * 1024 * 1024 });
    return;
  }
  await execFileAsync("ffmpeg", [
    "-i",
    sourcePath,
    ...audioInputArgs,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-t",
    String(duration),
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-y",
    outputPath
  ], { maxBuffer: 50 * 1024 * 1024 });
}
async function concatStudioVideos(inputs, outputPath, tmpDir) {
  const listPath = path.join(tmpDir, "concat.txt");
  const listContent = inputs.map((filePath) => `file '${resolveStudioSourcePath(filePath).replace(/'/g, "'\\''")}'`).join("\n");
  await fs.promises.writeFile(listPath, listContent, "utf-8");
  await execFileAsync("ffmpeg", [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-fflags",
    "+genpts",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath
  ], { maxBuffer: 50 * 1024 * 1024 });
}
async function burnStudioSubtitle(inputPath, outputPath, subtitleText, duration, tmpDir) {
  const srtPath = path.join(tmpDir, "subtitle.srt");
  const content = `1
${srtTime(0.2)} --> ${srtTime(Math.max(0.3, duration - 0.2))}
${subtitleText}

`;
  await fs.promises.writeFile(srtPath, content, "utf-8");
  await execFileAsync("ffmpeg", [
    "-i",
    inputPath,
    "-vf",
    `subtitles='${escapeSubtitlePath(srtPath)}':force_style='FontSize=24,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,Outline=2,Alignment=2'`,
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    "-y",
    outputPath
  ], { maxBuffer: 50 * 1024 * 1024 });
}
electron.ipcMain.handle("studio-render-track-candidate", async (_event, plan) => {
  const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto$1.randomUUID()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  try {
    await assertFfmpegAvailable();
    if (!plan.inputs.length) throw new Error("没有可渲染的 track 输入素材");
    const outputName = createStudioRenderName("track");
    const outputPath = path.join(getStudioRenderRoot(), outputName);
    const segmentPaths = [];
    for (const [index, input] of plan.inputs.entries()) {
      const segmentPath = path.join(tmpDir, `segment-${String(index + 1).padStart(3, "0")}.mp4`);
      await renderStudioSegment(input, segmentPath);
      segmentPaths.push(segmentPath);
    }
    const rawPath = path.join(tmpDir, "raw.mp4");
    if (segmentPaths.length === 1) {
      await fs.promises.copyFile(segmentPaths[0], rawPath);
    } else {
      await concatStudioVideos(segmentPaths, rawPath, tmpDir);
    }
    if (plan.subtitleText?.trim()) {
      await burnStudioSubtitle(rawPath, outputPath, plan.subtitleText.trim(), plan.duration, tmpDir);
    } else {
      await fs.promises.copyFile(rawPath, outputPath);
    }
    return {
      success: true,
      filePath: outputPath,
      previewUrl: `local-image://studio-render/${outputName}`
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
  }
});
electron.ipcMain.handle("studio-save-material", async (_event, payload) => {
  const operationId = createDiagnosticsOperationId("studio-save-material");
  try {
    const filename = sanitizeStudioFilename(payload.name);
    const filePath = path.join(getStudioAssetsRoot(), filename);
    const buffer = Buffer.from(payload.bytes instanceof Uint8Array ? payload.bytes : new Uint8Array(payload.bytes));
    writeDiagnosticsLog({
      level: "info",
      category: "storage",
      operationId,
      message: "Studio material save started",
      context: { name: payload.name, filename, size: buffer.length }
    });
    if (buffer.length === 0) {
      writeDiagnosticsLog({
        level: "error",
        category: "storage",
        operationId,
        message: "Studio material save failed",
        context: { name: payload.name, filename, error: "素材文件为空" }
      });
      return { success: false, error: "素材文件为空" };
    }
    await fs.promises.writeFile(filePath, buffer);
    writeDiagnosticsLog({
      level: "info",
      category: "storage",
      operationId,
      message: "Studio material save completed",
      context: { name: payload.name, filename, filePath, size: buffer.length }
    });
    return {
      success: true,
      localPath: `local-image://studio-assets/${filename}`,
      filePath,
      size: buffer.length
    };
  } catch (error) {
    writeDiagnosticsLog({
      level: "error",
      category: "storage",
      operationId,
      message: "Studio material save errored",
      context: { name: payload.name },
      error
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
electron.ipcMain.handle("studio-list-assets", async (_event, payload) => listStudioRuntimeAssets(payload));
function summarizeDiagnosticsResult(result) {
  if (Array.isArray(result)) return { count: result.length };
  if (!result || typeof result !== "object") return result;
  const record = result;
  if (Array.isArray(record.items)) {
    return { total: record.total, itemCount: record.items.length };
  }
  return {
    success: record.success,
    id: record.id,
    name: record.name,
    type: record.type,
    imported: record.imported,
    hasResult: true
  };
}
async function runAssetDiagnostics(action, context, run) {
  const operationId = createDiagnosticsOperationId(`asset-${action}`);
  writeDiagnosticsLog({
    level: "debug",
    category: "asset",
    operationId,
    message: `Asset ${action} started`,
    context
  });
  try {
    const result = await run();
    writeDiagnosticsLog({
      level: "info",
      category: "asset",
      operationId,
      message: `Asset ${action} completed`,
      context: { ...context, result: summarizeDiagnosticsResult(result) }
    });
    return result;
  } catch (error) {
    writeDiagnosticsLog({
      level: "error",
      category: "asset",
      operationId,
      message: `Asset ${action} failed`,
      context,
      error
    });
    throw error;
  }
}
electron.ipcMain.handle("assets:list", async (_event, payload) => {
  return runAssetDiagnostics("list", payload, () => listAssets(payload.type, payload.search, payload.offset, payload.limit, payload.category));
});
electron.ipcMain.handle("assets:get", async (_event, id) => {
  return runAssetDiagnostics("get", { id }, () => getAsset(id));
});
electron.ipcMain.handle("assets:get-by-name", async (_event, payload) => {
  return runAssetDiagnostics("get-by-name", payload, () => getAssetByName(payload.type, payload.name));
});
electron.ipcMain.handle("assets:batch-match", async (_event, payload) => {
  return runAssetDiagnostics("batch-match", {
    type: payload.type,
    namesCount: payload.names.length,
    namesPreview: payload.names.slice(0, 20)
  }, async () => {
    const map = await batchMatchAssets(payload.type, payload.names);
    return Array.from(map.entries()).map(([name, asset]) => ({ name, asset }));
  });
});
electron.ipcMain.handle("assets:update", async (_event, payload) => {
  return runAssetDiagnostics("update", { id: payload.id, updates: payload.updates }, () => updateAsset(payload.id, payload.updates));
});
electron.ipcMain.handle("assets:delete", async (_event, id) => {
  return runAssetDiagnostics("delete", { id }, () => deleteAsset(id));
});
electron.ipcMain.handle("assets:add", async (_event, payload) => {
  return runAssetDiagnostics("add", payload, () => addAsset({ type: payload.type, name: payload.name, sourceFilePath: payload.sourceFilePath, description: payload.description, prompt: payload.prompt, setting: payload.setting }));
});
electron.ipcMain.handle("assets:add-image", async (_event, payload) => {
  return runAssetDiagnostics("add-image", payload, () => addAssetImage(payload.assetId, payload.imageName, payload.sourceFilePath));
});
electron.ipcMain.handle("assets:replace-image", async (_event, payload) => {
  return runAssetDiagnostics("replace-image", payload, () => replaceAssetMainImage(payload.assetId, payload.sourceFilePath));
});
electron.ipcMain.handle("assets:remove-image", async (_event, payload) => {
  return runAssetDiagnostics("remove-image", payload, () => removeAssetImage(payload.assetId, payload.imageFilePath));
});
electron.ipcMain.handle("assets:rename-image", async (_event, payload) => {
  return runAssetDiagnostics("rename-image", payload, () => renameAssetImage(payload.assetId, payload.imageFilePath, payload.newName));
});
electron.ipcMain.handle("assets:select-image-file", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
electron.ipcMain.handle("assets:import-from-toonflow", async (_event, payload) => {
  return runAssetDiagnostics("import-from-toonflow", payload, async () => {
    const toonflowResult = await listStudioRuntimeAssets({ type: payload.type, offset: 0, limit: 9999 });
    if (!toonflowResult.success || !toonflowResult.items.length) {
      return { success: true, imported: 0 };
    }
    const imported = importFromToonflow(toonflowResult.items);
    return { success: true, imported };
  });
});
async function runTtsRuntimeDiagnostics(action, context, run) {
  const operationId = createDiagnosticsOperationId(`tts-${action}`);
  writeDiagnosticsLog({
    level: action === "status" ? "debug" : "info",
    category: "tts",
    operationId,
    message: `TTS runtime ${action} started`,
    context
  });
  try {
    const result = await run();
    writeDiagnosticsLog({
      level: "info",
      category: "tts",
      operationId,
      message: `TTS runtime ${action} completed`,
      context: { ...context, result }
    });
    return result;
  } catch (error) {
    writeDiagnosticsLog({
      level: "error",
      category: "tts",
      operationId,
      message: `TTS runtime ${action} failed`,
      context,
      error
    });
    throw error;
  }
}
electron.ipcMain.handle("tts-runtime-status", async () => runTtsRuntimeDiagnostics("status", {}, () => ttsRuntimeController.status()));
electron.ipcMain.handle("tts-runtime-start", async () => runTtsRuntimeDiagnostics("start", {}, () => ttsRuntimeController.start()));
electron.ipcMain.handle("tts-runtime-setup", async () => runTtsRuntimeDiagnostics("setup", {}, () => ttsRuntimeController.setup()));
electron.ipcMain.handle("tts-runtime-stop", async () => runTtsRuntimeDiagnostics("stop", {}, () => ttsRuntimeController.stop()));
electron.ipcMain.handle("tts-runtime-get-config", async () => ttsRuntimeController.getConfig());
electron.ipcMain.handle("tts-runtime-set-config", async (_event, config) => runTtsRuntimeDiagnostics("set-config", { config }, () => ttsRuntimeController.setConfig(config)));
electron.ipcMain.handle("tts-runtime-set-model-cache-dir", async (_event, dirPath) => runTtsRuntimeDiagnostics("set-model-cache-dir", { dirPath }, () => ttsRuntimeController.setModelCacheDir(dirPath)));
electron.ipcMain.handle("tts-runtime-request", async (_event, payload) => runTtsRuntimeDiagnostics("request", {
  method: payload.method,
  path: payload.path,
  body: payload.body
}, () => ttsRuntimeController.request(payload.method, payload.path, payload.body)));
electron.ipcMain.handle("tts-runtime-request-bytes", async (_event, payload) => runTtsRuntimeDiagnostics("request-bytes", {
  method: payload.method,
  path: payload.path,
  body: payload.body
}, () => ttsRuntimeController.requestBytes(payload.method, payload.path, payload.body)));
electron.ipcMain.handle("tts-runtime-request-formdata", async (_event, payload) => runTtsRuntimeDiagnostics("request-formdata", {
  path: payload.path,
  audioFilePath: payload.audioFilePath,
  referenceTextLength: payload.referenceText?.length ?? 0
}, () => ttsRuntimeController.requestFormData(payload.path, payload.audioFilePath, payload.referenceText)));
electron.ipcMain.handle("studio-merge-episode", async (_event, plan) => {
  const tmpDir = path.join(getStudioRenderRoot(), `tmp-${crypto$1.randomUUID()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  try {
    await assertFfmpegAvailable();
    if (!plan.inputs.length) throw new Error("没有可拼接的视频输入");
    plan.inputs.forEach(ensureReadableStudioSource);
    const outputName = createStudioRenderName("episode");
    const outputPath = path.join(getStudioRenderRoot(), outputName);
    await concatStudioVideos(plan.inputs, outputPath, tmpDir);
    return {
      success: true,
      filePath: outputPath,
      previewUrl: `local-image://studio-render/${outputName}`
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
  }
});
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-image",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  },
  {
    scheme: "project-file",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  },
  {
    scheme: "studio-skill",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  },
  {
    scheme: "toonflow-asset",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
]);
electron.app.whenReady().then(async () => {
  initAssetsStorage(getStorageBasePath());
  scheduleAutoClean();
  await stopLocalSidecars();
  await ensureStudioSkillsAvailableAtStartup();
  electron.protocol.handle("local-image", async (request) => {
    try {
      const filePath = resolveLocalMediaPath(getMediaRoot(), request.url);
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        // Images
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        // Videos
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        // Audio
        ".wav": "audio/wav",
        ".wave": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac"
      };
      const mimeType = mimeTypes[ext] || "application/octet-stream";
      return new Response(data, {
        headers: { "Content-Type": mimeType }
      });
    } catch (error) {
      console.error("Failed to load local image:", error);
      return new Response("Image not found", { status: 404 });
    }
  });
  electron.protocol.handle("project-file", async (request) => {
    try {
      const filePath = resolveProjectFileUrl(getDataDir(), request.url);
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: { "Content-Type": getMimeType(filePath) }
      });
    } catch (error) {
      console.error("Failed to load project file:", error);
      return new Response("File not found", { status: 404 });
    }
  });
  electron.protocol.handle("studio-skill", async (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = [
        url.hostname,
        ...url.pathname.split("/").filter(Boolean)
      ].map((part) => decodeURIComponent(part)).join("/");
      const skillsRoot = path.resolve(getSkillsRoot());
      const filePath = path.resolve(skillsRoot, relativePath);
      if (filePath !== skillsRoot && !filePath.startsWith(skillsRoot + path.sep)) {
        throw new Error("Studio skill file path escapes storage root");
      }
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: { "Content-Type": getMimeType(filePath) }
      });
    } catch (error) {
      console.error("Failed to load studio skill file:", error);
      return new Response("File not found", { status: 404 });
    }
  });
  electron.protocol.handle("toonflow-asset", async (request) => {
    try {
      const filePath = resolveToonflowAssetPath(request.url);
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: { "Content-Type": getMimeType(filePath) }
      });
    } catch (error) {
      console.error("Failed to load Toonflow asset:", error);
      return new Response("File not found", { status: 404 });
    }
  });
  createWindow();
});
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
  };
  return mimeTypes[ext] || "application/octet-stream";
}
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
