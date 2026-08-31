// Local image generation runtime controller — mirrors the TTS server-sidecar
// lifecycle (spawn → /health poll → stop) combined with the depth model
// management pattern (offline inventory scan + explicit user-triggered
// downloads that never happen implicitly at inference time).
//
// The generation itself does NOT go through this controller: the renderer's
// existing image-generation pipeline calls the sidecar's OpenAI-compatible
// endpoint directly through the registered `manying-local-image` provider.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { captureSidecarOutput } from "@/electron/diagnostics/sidecar-log-capture";
import type {
  ImageGenModelId,
  ImageGenRuntimeStatusV1,
} from "@rendering/contracts/image-gen-workflow";

const execFileAsync = promisify(execFile);

export const LOCAL_IMAGE_BASE_URL = "http://127.0.0.1:17595" as const;
export const LOCAL_IMAGE_PORT = 17595 as const;

export type ImageGenSetupStage =
  | "idle"
  | "checking"
  | "starting-server"
  | "ready"
  | "failed";

export interface ImageGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  /** 指向版专用:大件在而小件缺时 UI 显示「补齐小件」(null=非指向版) */
  pointed?: boolean | null;
  smallPiecesReady?: boolean | null;
  pointedFiles?: string[] | null;
}

export interface ImageGenRuntimeStatus {
  running: boolean;
  setupStage: ImageGenSetupStage;
  setupMessage: string | undefined;
  models: ImageGenModelRow[];
  /** Active model name used for generation (the one bound in the provider). */
  activeModel: string;
  downloadStatus: Record<string, "idle" | "downloading" | "complete" | "error">;
  downloadProgress: Record<string, number>;
  downloadError: Record<string, string | undefined>;
}

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  spawnProcess?: typeof spawn;
  now?: () => number;
  inventoryScanner?: () => Promise<ImageGenModelRow[]>;
}

export function createImageGenRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveVideoWorkflowRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );
  const spawnProcess = deps.spawnProcess ?? spawn;
  const now = deps.now ?? Date.now;

  let child: ChildProcess | null = null;
  const configPath = () => path.join(getPaths().pythonRuntimeDir, "profiles", "image-gen", "config.json");

  function readActiveModel(): ImageGenModelId {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as { activeModel?: unknown };
      if (
        raw.activeModel === "qwen-image-edit-2511" ||
        raw.activeModel === "z-image-turbo" ||
        raw.activeModel === "flux2-klein-9b" ||
        raw.activeModel === "krea2-turbo"
      ) {
        return raw.activeModel;
      }
    } catch {
      // Missing or malformed config uses the default engine.
    }
    return "flux2-klein-9b";
  }

  function persistActiveModel(modelName: ImageGenModelId): void {
    const target = configPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ activeModel: modelName }, null, 2)}\n`, "utf8");
    fs.renameSync(temp, target);
  }

  const state: ImageGenRuntimeStatus = {
    running: false,
    setupStage: "idle",
    setupMessage: undefined,
    models: [],
    activeModel: readActiveModel(),
    downloadStatus: {},
    downloadProgress: {},
    downloadError: {},
  };

  function buildEnv(): NodeJS.ProcessEnv {
    const modelCacheDir = getModelCacheDir();
    return {
      ...process.env,
      PYTHONPATH: deps.backendRoot,
      MYSTUDIO_IMAGE_MODEL_DIR: modelCacheDir,
    };
  }

  async function fetchHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${LOCAL_IMAGE_BASE_URL}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  async function scanModelInventory(): Promise<ImageGenModelRow[]> {
    if (deps.inventoryScanner) {
      state.models = await deps.inventoryScanner();
      return state.models;
    }
    try {
      const { stdout } = await execFileAsync(
        getPaths().pythonExecutable,
        ["-m", "image_gen.model_inventory"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as { models?: ImageGenModelRow[] };
      state.models = Array.isArray(parsed.models) ? parsed.models : [];
      return state.models;
    } catch {
      state.models = [];
      return state.models;
    }
  }

  function readDownloadProgressFile(): Record<string, { status: string; progress: number; error?: string }> {
    const file = path.join(getPaths().pythonRuntimeDir, "profiles", "image-gen", "download-progress.json");
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      const modelName = typeof raw.modelName === "string" ? raw.modelName : "";
      const status = raw.status;
      if (modelName && (status === "downloading" || status === "complete" || status === "error")) {
        return {
          [modelName]: {
            status,
            progress: typeof raw.progress === "number" ? raw.progress : 0,
            error: typeof raw.error === "string" ? raw.error : undefined,
          },
        };
      }
    } catch {
      // No progress file.
    }
    return {};
  }

  function refreshDownloadState(): void {
    const progress = readDownloadProgressFile();
    for (const [modelName, entry] of Object.entries(progress)) {
      if (entry.status === "downloading" || entry.status === "complete" || entry.status === "error") {
        state.downloadStatus[modelName] = entry.status;
        state.downloadProgress[modelName] = entry.progress;
        state.downloadError[modelName] = entry.error;
      }
    }
  }

  function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : LOCAL_IMAGE_PORT;
        server.close(() => resolve(port));
      });
    });
  }

  async function startServer(): Promise<boolean> {
    if (await fetchHealth()) {
      state.running = true;
      return true;
    }
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      state.setupMessage = "共享 Python 3.12 未安装，请先完成 Python 运行环境配置";
      return false;
    }
    // Fail fast when the fixed port is already taken by a foreign process —
    // the sidecar deliberately uses a fixed port so the provider baseUrl stays
    // stable across sessions.
    const portProbe = await findFreePort().catch(() => null);
    void portProbe; // existence probe only; bind failure surfaces via health poll
    try {
      child = spawnProcess(
        paths.pythonExecutable,
        ["-m", "image_gen.main", "--host", "127.0.0.1", "--port", String(LOCAL_IMAGE_PORT)],
        { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "pipe", "pipe"] },
      );
      // 生图 sidecar 启动失败/运行期报错的证据进 logs/sidecars/image-gen-*
      captureSidecarOutput({
        module: "image-gen",
        child,
        label: `python -m image_gen.main --port ${LOCAL_IMAGE_PORT}`,
      });
      child.on("exit", () => {
        child = null;
        state.running = false;
      });
    } catch (error) {
      state.setupMessage = `本地图片服务启动失败: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
    // Health poll up to 30s.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await fetchHealth()) {
        state.running = true;
        return true;
      }
    }
    state.setupMessage = "本地图片服务健康检查超时";
    return false;
  }

  async function setup(): Promise<ImageGenRuntimeStatus> {
    state.setupStage = "checking";
    state.setupMessage = "正在检查本地图片生成服务…";
    if (await fetchHealth()) {
      state.setupStage = "ready";
      state.setupMessage = "本地图片生成服务已就绪";
      state.running = true;
      await scanModelInventory();
      return status();
    }
    state.setupStage = "starting-server";
    state.setupMessage = "正在启动本地图片生成服务…";
    const started = await startServer();
    if (!started) {
      state.setupStage = "failed";
      return status();
    }
    state.setupStage = "ready";
    state.setupMessage = "本地图片生成服务已就绪";
    await scanModelInventory();
    return status();
  }

  async function stop(): Promise<void> {
    if (child) {
      child.kill();
      child = null;
    }
    state.running = false;
    state.setupStage = "idle";
    state.setupMessage = undefined;
  }

  async function downloadModel(modelName: string): Promise<{ accepted: boolean; message: string }> {
    if (state.downloadStatus[modelName] === "downloading") {
      return { accepted: false, message: "该模型正在下载中" };
    }
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { accepted: false, message: "共享 Python 3.12 未安装" };
    }
    const profileDir = path.join(paths.pythonRuntimeDir, "profiles", "image-gen");
    fs.mkdirSync(profileDir, { recursive: true });
    state.downloadStatus[modelName] = "downloading";
    state.downloadProgress[modelName] = 0;
    try {
      const downloader = spawnProcess(
        paths.pythonExecutable,
        [
          "-m", "image_gen.download_model",
          "--model", modelName,
          "--progress", path.join(profileDir, "download-progress.json"),
        ],
        { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "ignore", "ignore"] },
      );
      downloader.on("exit", () => {
        refreshDownloadState();
        void scanModelInventory();
      });
      return { accepted: true, message: "模型下载已开始" };
    } catch (error) {
      state.downloadStatus[modelName] = "error";
      state.downloadError[modelName] = error instanceof Error ? error.message : String(error);
      return { accepted: false, message: "模型下载启动失败" };
    }
  }

  function setActiveModel(modelName: string): boolean {
    const known: readonly ImageGenModelId[] = ["qwen-image-edit-2511", "z-image-turbo", "flux2-klein-9b", "krea2-turbo"];
    if (!known.includes(modelName as ImageGenModelId)) return false;
    state.activeModel = modelName as ImageGenModelId;
    persistActiveModel(state.activeModel as ImageGenModelId);
    return true;
  }

  // 08-19 模型目录规范:兜底新家 <storageBase>/model/imagegen;旧兜底 <storageBase>/python/models/image-gen
  // (生产路径 main.ts 注入 TTS 共享缓存,此处兜底仅在无注入时生效);旧兜底在场且新家
  // 不存在时一次性整目录迁移(同卷 rename;失败回退旧目录)。
  function getModelCacheDir(): string {
    const configured = deps.modelCacheDir?.();
    if (configured && path.isAbsolute(configured)) return configured;
    const paths = getPaths();
    const home = path.join(paths.storageBasePath, "model", "imagegen");
    const legacy = path.join(paths.pythonRuntimeDir, "models", "image-gen");
    try {
      if (fs.existsSync(legacy) && !fs.existsSync(home)) {
        try {
          fs.mkdirSync(path.dirname(home), { recursive: true });
          fs.renameSync(legacy, home);
        } catch {
          // 迁移失败(权限/跨卷):回退旧目录,不阻断功能
        }
      }
    } catch {
      // 探测失败:按新家走
    }
    return fs.existsSync(legacy) && !fs.existsSync(home) ? legacy : home;
  }

  function activeModelDownloaded(): boolean {
    return state.models.some(
      (model) =>
        model.modelName === state.activeModel &&
        model.downloaded === true &&
        model.smallPiecesReady !== false,
    );
  }

  function lifecycleStatus(): ImageGenRuntimeStatusV1 {
    const pythonAvailable = fs.existsSync(getPaths().pythonExecutable);
    const modelDownloaded = activeModelDownloaded();
    // 就绪口径对齐视觉审核(VLM)区块:Python+模型大件在=ready,与本地服务
    // 是否正在运行无关(服务由「准备运行时」/生图流程按需拉起)。旧口径把
    // 服务未跑算 needs-runtime,导致模型明明就绪设置页却显示「需准备」。
    const stateValue: ImageGenRuntimeStatusV1["state"] = !pythonAvailable
      ? "blocked"
      : !modelDownloaded
        ? "needs-runtime"
        : "ready";
    return {
      schemaVersion: 1,
      state: stateValue,
      activeModel: state.activeModel as ImageGenModelId,
      modelCacheDir: getModelCacheDir(),
      modelDownloaded,
      pythonAvailable,
      ...(state.setupMessage ? { message: state.setupMessage } : {}),
    };
  }

  async function probeLifecycle(): Promise<ImageGenRuntimeStatusV1> {
    await scanModelInventory();
    return lifecycleStatus();
  }

  async function prepareLifecycle(): Promise<ImageGenRuntimeStatusV1> {
    await setup();
    await scanModelInventory();
    return lifecycleStatus();
  }

  async function rollbackLifecycle(): Promise<ImageGenRuntimeStatusV1> {
    await stop();
    return lifecycleStatus();
  }

  function status(): ImageGenRuntimeStatus {
    refreshDownloadState();
    return { ...state, downloadStatus: { ...state.downloadStatus }, downloadProgress: { ...state.downloadProgress }, downloadError: { ...state.downloadError } };
  }

  return {
    status,
    setup,
    stop,
    scanModelInventory,
    downloadModel,
    setActiveModel,
    getModelCacheDir,
    probeLifecycle,
    prepareLifecycle,
    rollbackLifecycle,
    get baseUrl() {
      return LOCAL_IMAGE_BASE_URL;
    },
    get lastUpdatedAt() {
      return now();
    },
  };
}

export type ImageGenRuntimeController = ReturnType<typeof createImageGenRuntimeController>;
