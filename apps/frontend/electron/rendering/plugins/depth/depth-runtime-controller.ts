// Depth runtime controller — the settings-facing lifecycle manager for the
// depth estimation model, mirroring the TtsRuntimeController pattern in a
// minimal form:
//   - status()           → in-memory state the renderer polls every 500 ms
//   - setup()            → prepare the Python profile (lock + pip + marker)
//   - scanModelInventory() → offline "is the model downloaded" probe
//   - downloadModel()    → explicit, user-triggered download (never implicit)
//   - readDownloadProgress() → progress JSON written by the Python downloader
//
// Model download policy: inference NEVER downloads. The model is downloaded
// only when the user clicks the button in 设置 → 本地配置 → 深度估计模型.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildDepthWorkerEnv,
  probeDepthRuntime,
  resolveDepthRuntimePaths,
  type DepthRuntimePaths,
} from "./depth-runtime";
import { prepareDepthRuntime, rollbackDepthRuntime } from "./depth-runtime-manager";

const execFileAsync = promisify(execFile);

interface DepthInventoryRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  cacheDir: string | null;
  repoCacheDir: string | null;
}

export type DepthSetupStage =
  | "idle"
  | "checking"
  | "preparing-profile"
  | "ready"
  | "failed";

export interface DepthRuntimeStatus {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message?: string;
  setupStage: DepthSetupStage;
  setupProgress: number | undefined;
  setupMessage: string | undefined;
  /** True when the depth model weights are present in the HF cache. */
  modelDownloaded: boolean;
  modelSizeMb: number | null;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  /** Currently selected cinematic camera preset (render-time, plan-independent). */
  cinematicPreset: string;
  /** "auto" = AI 按剧本逐镜选择（per-shot map）；"manual" = 全局 cinematicPreset。 */
  cinematicPresetMode: "auto" | "manual";
  /** Number of per-shot preset entries from the latest AI analysis. */
  cinematicPresetCount: number;
  /** User-configured model cache directory (default <storageBase>/DeepModel). */
  modelCacheDir: string;
}

export const DEPTH_CINEMATIC_PRESETS = [
  "cinematic-dolly-in",
  "cinematic-dolly-out",
  "cinematic-crane-up",
  "cinematic-crane-down",
  "cinematic-orbit",
  "cinematic-parallax-lr",
  "cinematic-parallax-ud",
  "cinematic-ken-burns-3d",
  "cinematic-handheld",
  "cinematic-dutch-roll",
  "cinematic-vertigo",
  "cinematic-spiral",
  "cinematic-arc-left",
  "cinematic-arc-right",
  "cinematic-reveal-tilt-up",
  "cinematic-drift",
  "cinematic-fall",
  "cinematic-zoom-in",
  "cinematic-zoom-out",
  "cinematic-tilt-down",
  "cinematic-pan-left",
  "cinematic-pan-right",
  "cinematic-whip-pan",
  "cinematic-pedestal-up",
  "cinematic-pedestal-down",
  "cinematic-tracking-left",
  "cinematic-tracking-right",
  "cinematic-fly-through",
  "cinematic-pull-back-reveal",
  "cinematic-crash-zoom",
  "cinematic-slow-push",
  "cinematic-rise-and-pull",
  "cinematic-descend-and-push",
  "cinematic-impact",
  "cinematic-breathing",
] as const;

export type DepthCinematicPreset = (typeof DEPTH_CINEMATIC_PRESETS)[number];

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  execFile?: ExecFileLike;
  now?: () => number;
  /** Test seams for fs operations. */
  mkdir?: (dir: string) => void;
  removeDir?: (dir: string) => void;
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  },
) => Promise<{ stdout?: string; stderr?: string }>;

export function createDepthRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveDepthRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );

  // 首次状态查询前的懒扫描标志——启动时无人触发 scanModelInventory,
  // status() 直接回初始 modelDownloaded:false 会让一键成片误报"模型未下载"。
  let inventoryScanned = false;

  const state: DepthRuntimeStatus = {
    state: "needs-runtime",
    setupStage: "idle",
    setupProgress: undefined,
    setupMessage: undefined,
    modelDownloaded: false,
    modelSizeMb: null,
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    cinematicPreset: "cinematic-dolly-in",
    cinematicPresetMode: "auto",
    cinematicPresetCount: 0,
    modelCacheDir: "",
  };

  /** Per-shot AI presets (auto mode). Keyed by shotId; "__default" is the chapter default. */
  let presetByShotId: Record<string, string> = {};

  const mkdirDir = deps.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  const removeDirSync = deps.removeDir ?? ((dir: string) => fs.rmSync(dir, { recursive: true, force: true }));

  // --- Model cache dir config (mirrors TTS config persistence) -------------
  // Config lives at <storageBase>/DeepModel/config.json; default cache dir is
  // <storageBase>/DeepModel itself (HF repos land as <DeepModel>/models--org--name).
  function deepModelRoot(): string {
    return path.join(getPaths().storageBasePath, "DeepModel");
  }

  function configPath(): string {
    return path.join(deepModelRoot(), "config.json");
  }

  function readConfig(): { modelCacheDir?: string } {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as { modelCacheDir?: unknown };
      return typeof raw.modelCacheDir === "string" && path.isAbsolute(raw.modelCacheDir)
        ? { modelCacheDir: raw.modelCacheDir }
        : {};
    } catch {
      return {};
    }
  }

  function writeConfig(config: { modelCacheDir: string }): void {
    mkdirDir(deepModelRoot());
    const temp = `${configPath()}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fs.renameSync(temp, configPath());
  }

  function getModelCacheDir(): string {
    const override = deps.modelCacheDir?.();
    if (override) return override;
    const configured = readConfig().modelCacheDir;
    if (configured) return configured;
    return deepModelRoot();
  }

  async function setModelCacheDir(dirPath: string): Promise<{ success: boolean; error?: string }> {
    const next = dirPath.trim();
    if (!next || !path.isAbsolute(next)) {
      return { success: false, error: "模型缓存路径必须是绝对路径" };
    }
    if (state.downloadStatus === "downloading") {
      return { success: false, error: "模型下载中，请等待完成后再切换缓存路径" };
    }
    try {
      mkdirDir(next);
      writeConfig({ modelCacheDir: next });
      state.modelCacheDir = next;
      await scanModelInventory();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function deleteModel(): Promise<{ success: boolean; error?: string }> {
    if (state.downloadStatus === "downloading") {
      return { success: false, error: "模型下载中，无法删除" };
    }
    // Remove every known repo-cache location reported by the inventory.
    const inventory = await scanModelInventory();
    const repoDirs = inventory.models
      .map((row) => row.repoCacheDir)
      .filter((dir): dir is string => typeof dir === "string" && dir.startsWith("/"));
    if (repoDirs.length === 0) {
      return { success: false, error: "模型未下载，无需删除" };
    }
    try {
      for (const dir of new Set(repoDirs)) removeDirSync(dir);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    await scanModelInventory();
    return { success: true };
  }

  const runFile = deps.execFile ?? execFileAsync;
  const now = deps.now ?? Date.now;

  function progressFile(): string {
    return path.join(getPaths().depthProfileDir, "download-progress.json");
  }

  function buildEnv(paths: DepthRuntimePaths): NodeJS.ProcessEnv {
    return buildDepthWorkerEnv(paths, deps.backendRoot, {
      MYSTUDIO_DEPTH_MODEL_DIR: getModelCacheDir(),
    });
  }

  async function runPython(
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    const paths = getPaths();
    const result = await runFile(paths.pythonExecutable, args, {
      cwd: deps.backendRoot,
      env: buildEnv(paths),
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  function status(): DepthRuntimeStatus {
    if (!state.modelCacheDir) state.modelCacheDir = getModelCacheDir();
    return { ...state };
  }

  /** 状态查询前的懒扫描：从未扫描过则跑一次离线探测（幂等，秒级）。 */
  async function ensureScanned(): Promise<void> {
    if (inventoryScanned) return;
    await scanModelInventory();
  }

  async function scanModelInventory(): Promise<{ models: DepthInventoryRow[] }> {
    try {
      const { stdout } = await runPython(
        ["-m", "depth_estimation.model_inventory"],
        30_000,
      );
      const parsed = JSON.parse(stdout) as {
        models?: Array<Record<string, unknown>>;
        cacheDir?: unknown;
      };
      const models: DepthInventoryRow[] = (Array.isArray(parsed.models) ? parsed.models : [])
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .map((row) => ({
          modelName: typeof row.modelName === "string" ? row.modelName : "",
          label: typeof row.label === "string" ? row.label : "",
          downloaded: row.downloaded === true,
          sizeMb: typeof row.sizeMb === "number" ? row.sizeMb : null,
          repoId: typeof row.repoId === "string" ? row.repoId : "",
          cacheDir: typeof row.cacheDir === "string" ? row.cacheDir : null,
          repoCacheDir: typeof row.repoCacheDir === "string" ? row.repoCacheDir : null,
        }));
      const primary = models.find((m) => m.modelName === "depth-anything-v2-small");
      state.modelDownloaded = Boolean(primary?.downloaded);
      state.modelSizeMb = primary?.sizeMb ?? null;
      if (typeof parsed.cacheDir === "string" && parsed.cacheDir) {
        state.modelCacheDir = parsed.cacheDir;
      } else if (!state.modelCacheDir) {
        state.modelCacheDir = getModelCacheDir();
      }
      if (state.downloadStatus !== "downloading") {
        state.downloadStatus = state.modelDownloaded ? "complete" : "idle";
        state.downloadProgress = state.modelDownloaded ? 100 : 0;
      }
      inventoryScanned = true;
      return { models };
    } catch {
      // Fail closed: a missing managed Python or broken profile means the
      // model cannot be considered downloaded.
      state.modelDownloaded = false;
      state.modelSizeMb = null;
      return { models: [] };
    }
  }

  function readDownloadProgress(): DepthRuntimeStatus["downloadStatus"] extends never ? never : {
    status: "idle" | "downloading" | "complete" | "error";
    progress: number;
    current: number;
    total: number;
    error?: string;
  } {
    try {
      const raw = JSON.parse(fs.readFileSync(progressFile(), "utf8")) as Record<string, unknown>;
      const status = raw.status;
      if (status === "downloading" || status === "complete" || status === "error") {
        return {
          status,
          progress: typeof raw.progress === "number" ? raw.progress : 0,
          current: typeof raw.current === "number" ? raw.current : 0,
          total: typeof raw.total === "number" ? raw.total : 0,
          error: typeof raw.error === "string" ? raw.error : undefined,
        };
      }
    } catch {
      // No progress file yet.
    }
    return { status: "idle", progress: 0, current: 0, total: 0 };
  }

  async function refreshDownloadState(): Promise<void> {
    const progress = readDownloadProgress();
    if (progress.status !== "idle") {
      state.downloadStatus = progress.status;
      state.downloadProgress = progress.progress;
      state.downloadError = progress.error;
      if (progress.status === "complete" || progress.status === "error") {
        await scanModelInventory();
      }
    }
  }

  async function setup(): Promise<DepthRuntimeStatus> {
    state.setupStage = "checking";
    state.setupProgress = undefined;
    state.setupMessage = "正在检查深度估计运行时…";

    const paths = getPaths();
    const probe = await probeDepthRuntime(paths);
    if (probe.state === "ready") {
      state.state = "ready";
      state.setupStage = "ready";
      state.setupProgress = 100;
      state.setupMessage = "深度估计运行时已就绪";
      await scanModelInventory();
      await refreshDownloadState();
      return status();
    }

    state.setupStage = "preparing-profile";
    state.setupProgress = 20;
    state.setupMessage = "正在安装深度估计依赖…";
    const prepare = await prepareDepthRuntime({
      storageBasePath: paths.storageBasePath,
      backendRoot: deps.backendRoot,
    });
    if (prepare.state !== "ready") {
      state.state = "blocked";
      state.setupStage = "failed";
      state.setupProgress = undefined;
      state.setupMessage = prepare.message;
      return status();
    }

    state.state = "ready";
    state.setupStage = "ready";
    state.setupProgress = 100;
    state.setupMessage = "深度估计运行时已就绪";
    await scanModelInventory();
    return status();
  }

  async function rollback(): Promise<DepthRuntimeStatus> {
    const result = rollbackDepthRuntime(getPaths().storageBasePath);
    state.state = result.state === "ready" ? "needs-runtime" : "blocked";
    state.setupStage = "idle";
    state.setupProgress = undefined;
    state.setupMessage = result.message;
    if (result.state === "ready") {
      state.modelDownloaded = false;
      state.modelSizeMb = null;
      state.downloadStatus = "idle";
      state.downloadProgress = 0;
      state.downloadError = undefined;
    }
    return status();
  }

  let downloadChild: ReturnType<typeof spawnDownload> | null = null;

  function spawnDownload() {
    // Lazy import to keep child_process typing simple in tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const paths = getPaths();
    fs.mkdirSync(paths.depthProfileDir, { recursive: true });
    const child = spawn(
      paths.pythonExecutable,
      [
        "-m", "depth_estimation.download_model",
        "--model", "depth-anything-v2-small",
        "--progress", progressFile(),
      ],
      {
        cwd: deps.backendRoot,
        env: buildEnv(paths),
        stdio: ["ignore", "ignore", "ignore"],
        detached: false,
      },
    );
    return child;
  }

  async function downloadModel(): Promise<{ accepted: boolean; message: string }> {
    if (state.downloadStatus === "downloading") {
      return { accepted: false, message: "深度模型正在下载中" };
    }
    const probe = await probeDepthRuntime(getPaths());
    if (probe.state !== "ready") {
      return {
        accepted: false,
        message: "深度估计运行时未就绪，请先完成运行时配置",
      };
    }

    state.downloadStatus = "downloading";
    state.downloadProgress = 0;
    state.downloadError = undefined;

    downloadChild = spawnDownload();
    const child = downloadChild;
    child.on("exit", () => {
      if (downloadChild === child) downloadChild = null;
      void refreshDownloadState();
    });
    child.on("error", (error) => {
      state.downloadStatus = "error";
      state.downloadError = error.message;
      if (downloadChild === child) downloadChild = null;
    });
    return { accepted: true, message: "深度模型下载已开始" };
  }

  async function refresh(): Promise<DepthRuntimeStatus> {
    const probe = await probeDepthRuntime(getPaths());
    state.state = probe.state === "ready" ? "ready" : probe.state;
    if (probe.state !== "ready" && !state.setupMessage) {
      state.setupMessage = probe.message;
    }
    if (probe.state === "ready" && state.setupStage !== "failed") {
      state.setupStage = "ready";
    }
    await scanModelInventory();
    await refreshDownloadState();
    return status();
  }

  function setCinematicPreset(preset: string): boolean {
    if (!(DEPTH_CINEMATIC_PRESETS as readonly string[]).includes(preset)) {
      return false;
    }
    state.cinematicPreset = preset;
    // A manual pick implies manual mode.
    state.cinematicPresetMode = "manual";
    return true;
  }

  function setCinematicPresetMode(mode: "auto" | "manual"): boolean {
    state.cinematicPresetMode = mode;
    return true;
  }

  /** Replace the per-shot AI preset map (auto mode). Invalid values are dropped. */
  function setCinematicPresetMap(map: Record<string, string>): number {
    const allowed = DEPTH_CINEMATIC_PRESETS as readonly string[];
    const next: Record<string, string> = {};
    for (const [shotId, preset] of Object.entries(map)) {
      if (!/^[A-Za-z0-9._-]+$/.test(shotId) || !allowed.includes(preset)) continue;
      next[shotId] = preset;
    }
    presetByShotId = next;
    state.cinematicPresetCount = Object.keys(next).length;
    return state.cinematicPresetCount;
  }

  /** Resolve the preset for one shot: auto mode consults the AI map; manual uses the global. */
  function getCinematicPresetForShot(shotId?: string): string {
    if (state.cinematicPresetMode === "manual") {
      return state.cinematicPreset;
    }
    if (shotId && presetByShotId[shotId]) return presetByShotId[shotId];
    return presetByShotId.__default ?? state.cinematicPreset;
  }

  function getCinematicPreset(): string {
    return getCinematicPresetForShot(undefined);
  }

  return {
    status,
    ensureScanned,
    setup,
    rollback,
    refresh,
    scanModelInventory,
    downloadModel,
    readDownloadProgress,
    setCinematicPreset,
    setCinematicPresetMode,
    setCinematicPresetMap,
    getCinematicPreset,
    getCinematicPresetForShot,
    getModelCacheDir,
    setModelCacheDir,
    deleteModel,
    get paths() {
      return getPaths();
    },
    get lastUpdatedAt() {
      return now();
    },
  };
}

export type DepthRuntimeController = ReturnType<typeof createDepthRuntimeController>;
