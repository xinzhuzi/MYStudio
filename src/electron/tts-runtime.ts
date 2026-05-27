import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import type { TtsRuntimeCommandResult, TtsRuntimeStatus } from "@/types/tts";

const DEFAULT_TTS_PORT = 17593;
const DEFAULT_TTS_HOST = "127.0.0.1";

type SpawnedProcess = Pick<ChildProcessWithoutNullStreams, "pid" | "kill">;

interface FetchJsonOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TtsRuntimeControllerDeps {
  appRoot: string;
  userDataPath: string;
  port?: number;
  host?: string;
  pythonBinary?: string;
  sidecarRoots?: string[];
  fileExists?: (filePath: string) => boolean;
  ensureDir?: (dirPath: string) => void;
  spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => SpawnedProcess;
  fetchJson?: (url: string, options: FetchJsonOptions) => Promise<unknown>;
}

export interface TtsRuntimeController {
  status: () => Promise<TtsRuntimeStatus>;
  start: () => Promise<TtsRuntimeCommandResult>;
  stop: () => Promise<TtsRuntimeCommandResult>;
  request: (method: string, routePath: string, body?: unknown) => Promise<unknown>;
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

function normalizeRoutePath(routePath: string) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function sidecarMainPath(sidecarRoot: string) {
  return path.join(sidecarRoot, "manying_voicebox_tts", "main.py");
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

function makeStatus(params: {
  installed: boolean;
  running: boolean;
  port: number;
  baseUrl: string;
  cacheDir: string;
  pid?: number;
  error?: string;
}): TtsRuntimeStatus {
  return {
    installed: params.installed,
    running: params.running,
    port: params.port,
    baseUrl: params.baseUrl,
    cacheDir: params.cacheDir,
    pid: params.pid,
    error: params.error,
  };
}

export function createTtsRuntimeController(deps: TtsRuntimeControllerDeps): TtsRuntimeController {
  const port = deps.port ?? DEFAULT_TTS_PORT;
  const host = deps.host ?? DEFAULT_TTS_HOST;
  const baseUrl = `http://${host}:${port}`;
  const pythonBinary = deps.pythonBinary ?? process.env.MANYING_TTS_PYTHON ?? "python3";
  const fileExists = deps.fileExists ?? fs.existsSync;
  const ensureDir = deps.ensureDir ?? ((dirPath: string) => fs.mkdirSync(dirPath, { recursive: true }));
  const spawnProcess = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const sidecarRoots = uniquePaths([
    ...(deps.sidecarRoots ?? []),
    path.join(deps.appRoot, "src", "sidecars", "voicebox_tts_backend"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "sidecars", "voicebox_tts_backend") : "",
  ]);
  const cacheDir = path.join(deps.userDataPath, "tts-runtime");
  let child: SpawnedProcess | null = null;

  const resolveSidecarRoot = () => sidecarRoots.find((sidecarRoot) => fileExists(sidecarMainPath(sidecarRoot)));

  const isInstalled = () => resolveSidecarRoot() !== undefined;

  async function isBackendHealthy() {
    try {
      await fetchJson(`${baseUrl}/health`, { method: "GET" });
      return true;
    } catch {
      return false;
    }
  }

  async function waitUntilHealthy() {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
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
    const running = child !== null || await isBackendHealthy();
    return makeStatus({
      installed,
      running,
      port,
      baseUrl,
      cacheDir,
      pid: child?.pid,
    });
  }

  async function start(): Promise<TtsRuntimeCommandResult> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`,
      };
    }

    if (child || await isBackendHealthy()) {
      return { success: true, status: await status() };
    }

    ensureDir(cacheDir);
    child = spawnProcess(
      pythonBinary,
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
        },
      },
    );

    const healthy = await waitUntilHealthy();
    if (!healthy) {
      child?.kill();
      child = null;
      return {
        success: false,
        status: await status(),
        error: `TTS backend did not become healthy on ${baseUrl}`,
      };
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
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "当前 TTS 后端不是由 MYStudio 启动，不能从这里停止",
      };
    }
    return { success: true, status: await status() };
  }

  async function request(method: string, routePath: string, body?: unknown) {
    const hasBody = body !== undefined && method.toUpperCase() !== "GET";
    return fetchJson(`${baseUrl}${normalizeRoutePath(routePath)}`, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  }

  return {
    status,
    start,
    stop,
    request,
  };
}
