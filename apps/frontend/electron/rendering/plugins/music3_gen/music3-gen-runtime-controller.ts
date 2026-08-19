// MiniMax-Music3 (MLX) runtime controller — whole-song BGM engine.
// Same explicit-download policy as audio-gen/sfx-gen: the ~12 GB repo snapshot
// downloads ONLY from the settings panel; generation fails closed with
// "model-not-downloaded" otherwise. Generation is minutes-scale (whole song),
// so the IPC timeout is generous and progress is user-observable via exports.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";

const execFileAsync = promisify(execFile);

/** 与 backend/music3_gen/worker.py 的钳制保持同参(整曲域 10-300s) */
export const MUSIC3_MIN_DURATION_S = 10;
export const MUSIC3_MAX_DURATION_S = 300;
/** 整曲生成为分钟级;给足执行窗口(backend 硬限 30min,这里同参) */
export const MUSIC3_GENERATE_TIMEOUT_MS = 30 * 60_000;

// ---- mlx-serve 指向引擎路线(08-19-music3-mlxserv-connector)----
// 指向本地已转换的 MiniMax-Music3 MLX 权重目录(8bit/bf16 均可,布局同 convert_music3_weights.py 产物)
// (Zig+MLX,OpenAI 兼容 HTTP)。零 Python、零权重拷贝:直接指向已下载目录。
export const MLXSERV_DEFAULT_PORT = 11273; // 避开 MLX Core 常用默认 11234
const MLXSERV_HEALTH_TIMEOUT_MS = 5 * 60_000; // 13GB 冷装载预算
const MLXSERV_IDLE_SHUTDOWN_MS = 10 * 60_000;
const MLXSERV_REQUIRED_WEIGHTS = [
  "language_model.safetensors",
  "rvq_depth_decoder.safetensors",
  "transformer.safetensors",
  "condition_encoder.safetensors",
  "vocoder.safetensors",
] as const;
const MLXSERV_REQUIRED_DIRS = ["tokenizer", "music_tokenizer"] as const;
const MLXSERV_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/mlx-serve",
  "/usr/local/bin/mlx-serve",
];
/** MYStudio 管理的 mlx-serve 二进制(自动下载到插件目录;2026-08-19 用户裁定:开箱即用不依赖 brew)。 */
const MLXSERV_DOWNLOAD_URL = "https://github.com/ddalcu/mlx-serve/releases/download/v26.8.9/mlx-serve-bin-macos-arm64.tar.gz";
const MLXSERV_MANAGED_DIR_NAME = "mlx-serve-managed";

export interface MlxServConfig {
  /** 已下载的 MLX 权重目录(MiniMax-Music3 MLX 转换产物,8bit/bf16 均可) */
  weightsDir: string;
  /** 空 = 自动探测(PATH / homebrew 常规位) */
  binaryPath: string;
  port: number;
  /** 首选引擎:pocket(PocketAiHub 下载版)/ mlxserv(指向版) */
  preferredEngine: "pocket" | "mlxserv";
}

export interface MlxServRuntimeStatus {
  config: MlxServConfig;
  weightsReady: boolean;
  weightsReason: string;
  binaryPath: string | null;
  binaryFound: boolean;
  serverRunning: boolean;
  serverStarting: boolean;
}

export type Music3GenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface Music3GenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  /** 平台×硬件门控(08-19):不同平台按硬件选择不同模型 */
  availability: "ok" | "unsupported";
  unsupportedReason?: string;
}

export interface Music3HardwareProfile {
  platform: string;
  machine: string;
  mlxImportable: boolean;
}

export interface Music3GenRuntimeStatus {
  setupStage: Music3GenSetupStage;
  setupMessage: string | undefined;
  models: Music3GenModelRow[];
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  /** 模型实际落盘目录(与本地音乐生成/TTS 共用缓存),供设置页展示+打开 */
  modelCacheDir?: string;
  /** 最近一次 probe 的宿主硬件画像(平台门控依据) */
  hardwareProfile?: Music3HardwareProfile;
  /** mlx-serve 指向路线状态(08-19-music3-mlxserv-connector) */
  mlxServ?: MlxServRuntimeStatus;
}

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  spawnProcess?: typeof spawn;
  execFileFn?: ExecFileLike;
  /** 注入以便单测;默认全局 fetch(Node 18+) */
  fetchFn?: typeof fetch;
  /** 覆盖探测候选(单测);默认 MLXSERV_BINARY_CANDIDATES */
  binaryCandidates?: readonly string[];
  /** 覆盖健康等待预算(单测);默认 MLXSERV_HEALTH_TIMEOUT_MS */
  healthTimeoutMs?: number;
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

export interface Music3GenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  seed?: number;
  /** 生成路线:pocket(PocketAiHub 脚本)/ mlx-serve(HTTP) */
  engine?: "pocket" | "mlx-serve";
  code?: string;
  message?: string;
}

interface ProbePayload {
  status?: string;
  model?: string;
  depsOk?: boolean;
  sizeMb?: number | null;
  hardware?: { platform?: string; machine?: string; mlxImportable?: boolean };
  availability?: { available?: boolean; reason?: string };
}

export function createMusic3GenRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveVideoWorkflowRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );
  const spawnProcess = deps.spawnProcess ?? spawn;
  const runFile = deps.execFileFn ?? execFileAsync;

  const state: Music3GenRuntimeStatus = {
    setupStage: "idle",
    setupMessage: undefined,
    models: [],
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
  };

  function buildEnv(): NodeJS.ProcessEnv {
    const modelCacheDir = deps.modelCacheDir?.();
    return {
      ...process.env,
      PYTHONPATH: deps.backendRoot,
      ...(modelCacheDir ? { MYSTUDIO_AUDIO_MODEL_DIR: modelCacheDir } : {}),
    };
  }

  function profileDir(): string {
    return path.join(getPaths().pythonRuntimeDir, "profiles", "music3-gen");
  }

  function progressFile(): string {
    return path.join(profileDir(), "download-progress.json");
  }

  // ---- mlx-serve 路线:配置/完整性/探测/服务器/生成 ----

  const mlxServ: MlxServConfig = loadMlxServConfig();
  const serverState: {
    child: ReturnType<typeof spawn> | null;
    starting: boolean;
    baseUrl: string;
    idleTimer: NodeJS.Timeout | null;
  } = { child: null, starting: false, baseUrl: "", idleTimer: null };
  const doFetch = deps.fetchFn ?? fetch;
  const binaryCandidates = deps.binaryCandidates ?? MLXSERV_BINARY_CANDIDATES;
  const healthTimeoutMs = deps.healthTimeoutMs ?? MLXSERV_HEALTH_TIMEOUT_MS;

  function mlxServConfigPath(): string {
    return path.join(getPaths().storageBasePath, "music3-mlxserv-config.json");
  }

  function loadMlxServConfig(): MlxServConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(mlxServConfigPath(), "utf8")) as Partial<MlxServConfig>;
      return {
        weightsDir: typeof raw.weightsDir === "string" ? raw.weightsDir : "",
        binaryPath: typeof raw.binaryPath === "string" ? raw.binaryPath : "",
        port: Number.isInteger(raw.port) && (raw.port as number) > 0 ? (raw.port as number) : MLXSERV_DEFAULT_PORT,
        preferredEngine: raw.preferredEngine === "mlxserv" ? "mlxserv" : "pocket",
      };
    } catch {
      return { weightsDir: "", binaryPath: "", port: MLXSERV_DEFAULT_PORT, preferredEngine: "pocket" };
    }
  }

  function saveMlxServConfig(): void {
    try {
      fs.mkdirSync(path.dirname(mlxServConfigPath()), { recursive: true });
      fs.writeFileSync(mlxServConfigPath(), JSON.stringify(mlxServ, null, 2), "utf8");
    } catch {
      // 配置写失败不阻断生成;下次读取回退默认。
    }
  }

  function checkWeightsDir(dir: string): { ready: boolean; reason: string } {
    if (!dir) return { ready: false, reason: "未指定权重目录" };
    if (!fs.existsSync(dir)) return { ready: false, reason: `权重目录不存在: ${dir}` };
    for (const name of MLXSERV_REQUIRED_WEIGHTS) {
      if (!fs.existsSync(path.join(dir, name))) {
        return { ready: false, reason: `缺少权重文件 ${name}(应为 MiniMax-Music3 MLX 转换产物目录,8bit/bf16 均可)` };
      }
    }
    for (const name of MLXSERV_REQUIRED_DIRS) {
      if (!fs.statSync(path.join(dir, name)).isDirectory()) {
        return { ready: false, reason: `缺少目录 ${name}/` };
      }
    }
    return { ready: true, reason: "" };
  }

  function detectBinary(): string | null {
    if (mlxServ.binaryPath) return fs.existsSync(mlxServ.binaryPath) ? mlxServ.binaryPath : null;
    // MYStudio 管理的自动下载版(优先级最高——用户点「检查运行时」后自动就位)
    const managed = managedBinaryPath();
    if (managed) return managed;
    for (const candidate of binaryCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** MYStudio 管理的二进制路径(userData/mlx-serve-managed/);未下载返回 null。 */
  function managedBinaryPath(): string | null {
    const dir = path.join(typeof deps.storageBasePath === "function" ? deps.storageBasePath() : (deps.storageBasePath ?? ""), MLXSERV_MANAGED_DIR_NAME);
    const bin = path.join(dir, "mlx-serve");
    try {
      return fs.existsSync(bin) ? bin : null;
    } catch {
      return null;
    }
  }



  /**
   * 自动下载+安装 mlx-serve 二进制到 userData/mlx-serve-managed/(62MB tar.gz)。
   * 2026-08-19 用户裁定:开箱即用,不依赖 brew。幂等:已存在则跳过。
   */
  async function installMlxServeBinary(): Promise<{ installed: boolean; path?: string; error?: string }> {
    const dir = path.join(typeof deps.storageBasePath === "function" ? deps.storageBasePath() : (deps.storageBasePath ?? ""), MLXSERV_MANAGED_DIR_NAME);
    const bin = path.join(dir, "mlx-serve");
    if (fs.existsSync(bin)) return { installed: true, path: bin };
    if (!deps.storageBasePath) return { installed: false, error: "缺少 storageBasePath" };
    const marker = path.join(dir, ".installing");
    if (fs.existsSync(marker)) return { installed: false, error: "另一进程正在安装" };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(marker, String(Date.now()));
      const tarPath = path.join(dir, "mlx-serve.tar.gz");
      // 下载(不支持进度——62MB 可接受)
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("curl", ["-sL", MLXSERV_DOWNLOAD_URL, "-o", tarPath]);
      // 解压(release tar.gz 含顶层 mlx-serve-macos-arm64/ 目录,须剥层否则二进制落在子目录里)
      await execFileAsync("tar", ["-xzf", tarPath, "-C", dir, "--strip-components", "1"]);
      fs.unlinkSync(tarPath);
      // 给执行权限
      fs.chmodSync(bin, 0o755);
      fs.unlinkSync(marker);
      if (!fs.existsSync(bin)) {
        return { installed: false, error: "解压后未找到 mlx-serve 二进制" };
      }
      return { installed: true, path: bin };
    } catch (error) {
      try { fs.unlinkSync(marker); } catch { /* 忽略 */ }
      return { installed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function mlxServStatus(): MlxServRuntimeStatus {
    const weights = checkWeightsDir(mlxServ.weightsDir);
    return {
      config: { ...mlxServ },
      weightsReady: weights.ready,
      weightsReason: weights.reason,
      binaryPath: detectBinary(),
      binaryFound: detectBinary() !== null,
      serverRunning: serverState.child !== null && serverState.child.exitCode === null,
      serverStarting: serverState.starting,
    };
  }

  function scheduleIdleShutdown(): void {
    if (serverState.idleTimer) clearTimeout(serverState.idleTimer);
    serverState.idleTimer = setTimeout(() => {
      stopServer("空闲回收");
    }, MLXSERV_IDLE_SHUTDOWN_MS);
    serverState.idleTimer.unref?.();
  }

  function stopServer(reason: string): void {
    if (serverState.idleTimer) {
      clearTimeout(serverState.idleTimer);
      serverState.idleTimer = null;
    }
    if (serverState.child) {
      try {
        serverState.child.kill();
      } catch {
        // 进程可能已退出
      }
      serverState.child = null;
      state.setupMessage = `mlx-serve 已停止(${reason})`;
    }
  }

  async function ensureServer(): Promise<{ ok: true; baseUrl: string } | { ok: false; code: string; message: string }> {
    const weights = checkWeightsDir(mlxServ.weightsDir);
    if (!weights.ready) {
      return { ok: false, code: "mlxserv-weights-missing", message: weights.reason };
    }
    const binary = detectBinary();
    if (!binary) {
      return {
        ok: false,
        code: "mlxserv-binary-missing",
        message: "未找到 mlx-serve 引擎。安装:brew tap ddalcu/mlx-serve https://github.com/ddalcu/mlx-serve && brew install mlx-serve(或在配置中手动指定路径)",
      };
    }
    const baseUrl = `http://127.0.0.1:${mlxServ.port}`;
    // 已在跑且健康:直接复用(用户自己的 MLX Core/CLI 实例同端口时优先复用)
    if (await healthCheck(baseUrl)) return { ok: true, baseUrl };
    if (serverState.child && serverState.child.exitCode === null) {
      // 子进程在但未就绪:等待其完成装载
      const waited = await waitHealthy(baseUrl);
      return waited
        ? { ok: true, baseUrl }
        : { ok: false, code: "mlxserv-start-timeout", message: `mlx-serve 启动/装载超时(${MLXSERV_HEALTH_TIMEOUT_MS / 60000} 分钟)` };
    }
    if (serverState.starting) {
      const waited = await waitHealthy(baseUrl);
      return waited
        ? { ok: true, baseUrl }
        : { ok: false, code: "mlxserv-start-timeout", message: "mlx-serve 启动/装载超时" };
    }
    serverState.starting = true;
    try {
      const child = spawnProcess(
        binary,
        ["serve", "--model", mlxServ.weightsDir, "--port", String(mlxServ.port), "--host", "127.0.0.1"],
        { stdio: ["ignore", "ignore", "ignore"], env: { ...process.env } },
      );
      serverState.child = child;
      serverState.baseUrl = baseUrl;
      child.on("exit", () => {
        if (serverState.child === child) serverState.child = null;
      });
      const ready = await waitHealthy(baseUrl);
      if (!ready) {
        stopServer("启动失败");
        return { ok: false, code: "mlxserv-start-failed", message: "mlx-serve 启动后未就绪(看日志:~/.mlx-serve/logs/)" };
      }
      scheduleIdleShutdown();
      return { ok: true, baseUrl };
    } finally {
      serverState.starting = false;
    }
  }

  async function healthCheck(baseUrl: string): Promise<boolean> {
    try {
      const response = await doFetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function waitHealthy(baseUrl: string): Promise<boolean> {
    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await healthCheck(baseUrl)) return true;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  }

  function parseWav(bytes: Uint8Array): { samplingRate: number; channels: number; durationS: number } {
    // RIFF 头:采样率@24(LE)、声道@22;走块找 data 算时长;解析失败回退 44100/2/未知。
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== 0x46464952) throw new Error("not RIFF");
      let offset = 12;
      let samplingRate = 44100;
      let channels = 2;
      let bitsPerSample = 16;
      while (offset + 8 <= bytes.byteLength) {
        const chunkId = view.getUint32(offset, true);
        const chunkSize = view.getUint32(offset + 4, true);
        if (chunkId === 0x20746d66) {
          channels = view.getUint16(offset + 10, true);
          samplingRate = view.getUint32(offset + 12, true);
          bitsPerSample = view.getUint16(offset + 22, true);
        } else if (chunkId === 0x61746164) {
          const bytesPerFrame = (channels * bitsPerSample) / 8;
          return {
            samplingRate,
            channels,
            durationS: bytesPerFrame > 0 ? Number((chunkSize / bytesPerFrame / samplingRate).toFixed(3)) : 0,
          };
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
      return { samplingRate, channels, durationS: 0 };
    } catch {
      return { samplingRate: 44100, channels: 2, durationS: 0 };
    }
  }

  async function generateViaMlxServ(input: {
    prompt: string;
    seed?: number;
    seconds?: number;
    steps?: number;
    outputDir: string;
  }): Promise<Music3GenGenerateResult> {
    const ensured = await ensureServer();
    if (!ensured.ok) {
      return { status: "blocked", code: ensured.code, message: ensured.message };
    }
    const seed = Number.isInteger(input.seed) ? (input.seed as number) : 7;
    const seconds = Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, input.seconds ?? 60));
    const steps = Math.min(100, Math.max(4, input.steps ?? 30));
    const safeName = `bgm3-mlxserv-${Date.now()}-${seed}.wav`;
    const outputPath = path.join(input.outputDir, safeName);
    try {
      const response = await doFetch(`${ensured.baseUrl}/v1/audio/music-generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          lyrics: "[Instrumental]",
          duration_seconds: seconds,
          steps,
          seed,
        }),
        signal: AbortSignal.timeout(MUSIC3_GENERATE_TIMEOUT_MS),
      });
      scheduleIdleShutdown();
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          status: "blocked",
          code: response.status === 400 ? "mlxserv-bad-request" : "generation-failed",
          message: `mlx-serve ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 44) {
        return { status: "blocked", code: "generation-failed", message: `mlx-serve 返回过短(${bytes.byteLength}B)` };
      }
      fs.mkdirSync(input.outputDir, { recursive: true });
      fs.writeFileSync(outputPath, bytes);
      const meta = parseWav(bytes);
      return {
        status: "accepted",
        outputPath,
        outputSha256: createHash("sha256").update(bytes).digest("hex"),
        durationS: meta.durationS,
        samplingRate: meta.samplingRate,
        seed,
        engine: "mlx-serve",
      };
    } catch (error) {
      scheduleIdleShutdown();
      const message = error instanceof Error ? error.message : String(error);
      return { status: "blocked", code: "generation-failed", message };
    }
  }

  function configureMlxServ(partial: Partial<MlxServConfig>): MlxServRuntimeStatus {
    if (typeof partial.weightsDir === "string") mlxServ.weightsDir = partial.weightsDir;
    if (typeof partial.binaryPath === "string") mlxServ.binaryPath = partial.binaryPath;
    if (Number.isInteger(partial.port) && (partial.port as number) > 0) mlxServ.port = partial.port as number;
    if (partial.preferredEngine === "mlxserv" || partial.preferredEngine === "pocket") {
      mlxServ.preferredEngine = partial.preferredEngine;
    }
    if (serverState.child && serverState.baseUrl !== `http://127.0.0.1:${mlxServ.port}`) {
      stopServer("配置变更");
    }
    saveMlxServConfig();
    return mlxServStatus();
  }

  async function scanModelInventory(): Promise<Music3GenModelRow[]> {
    try {
      const { stdout } = await runFile(
        getPaths().pythonExecutable,
        ["-m", "music3_gen.worker", "--probe"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout ?? "{}") as ProbePayload;
      if (parsed.hardware?.platform) {
        state.hardwareProfile = {
          platform: parsed.hardware.platform,
          machine: parsed.hardware.machine ?? "unknown",
          mlxImportable: parsed.hardware.mlxImportable !== false,
        };
      }
      const available = parsed.availability?.available !== false;
      state.models = [{
        modelName: parsed.model ?? "minimax-music3-mlx",
        label: "MiniMax-Music3(MLX 整曲引擎)",
        downloaded: parsed.status === "ready",
        sizeMb: typeof parsed.sizeMb === "number" ? parsed.sizeMb : null,
        repoId: "PocketAiHub/MiniMax-Music3-MLX",
        availability: available ? "ok" : "unsupported",
        unsupportedReason: available ? undefined : parsed.availability?.reason,
      }];
      return state.models;
    } catch {
      state.models = [];
      return state.models;
    }
  }

  function refreshDownloadState(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(progressFile(), "utf8")) as Record<string, unknown>;
      const status = raw.status;
      if (status === "downloading" || status === "complete" || status === "error") {
        state.downloadStatus = status;
        state.downloadProgress = typeof raw.progress === "number" ? raw.progress : 0;
        state.downloadError = typeof raw.error === "string" ? raw.error : undefined;
      }
    } catch {
      // No progress file.
    }
  }

  async function setup(): Promise<Music3GenRuntimeStatus> {
    state.setupStage = "checking";
    state.setupMessage = "正在检查 MiniMax-Music3 运行时…";
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      state.setupStage = "failed";
      state.setupMessage = "共享 Python 3.12 未安装，请先完成 Python 运行环境配置";
      return status();
    }
    try {
      const { stdout } = await runFile(
        paths.pythonExecutable,
        ["-m", "music3_gen.worker", "--probe"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout ?? "{}") as { depsOk?: boolean };
      if (parsed.depsOk === false) {
        state.setupStage = "failed";
        state.setupMessage = "MLX 依赖未安装(需要 mlx/numpy,随 Python 运行环境提供)";
        return status();
      }
    } catch {
      state.setupStage = "failed";
      state.setupMessage = "Music3 运行时探测失败(需要 mlx/numpy,随 Python 运行环境提供)";
      return status();
    }
    state.setupStage = "ready";
    state.setupMessage = "MiniMax-Music3 运行时就绪";
    await scanModelInventory();
    return status();
  }

  async function downloadModel(modelName = "minimax-music3-mlx"): Promise<{ accepted: boolean; message: string }> {
    if (state.downloadStatus === "downloading") {
      return { accepted: false, message: "模型正在下载中" };
    }
    const row = state.models.find((model) => model.modelName === modelName);
    if (row && row.availability === "unsupported") {
      return { accepted: false, message: row.unsupportedReason ?? "本机硬件不满足该模型运行要求" };
    }
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { accepted: false, message: "共享 Python 3.12 未安装" };
    }
    fs.mkdirSync(profileDir(), { recursive: true });
    state.downloadStatus = "downloading";
    state.downloadProgress = 0;
    try {
      const downloader = spawnProcess(
        paths.pythonExecutable,
        [
          "-m", "music3_gen.download_model",
          "--model", modelName,
          "--progress", progressFile(),
        ],
        { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "ignore", "ignore"] },
      );
      downloader.on("exit", () => {
        refreshDownloadState();
        void scanModelInventory();
      });
      return { accepted: true, message: "MiniMax-Music3 模型下载已开始(约 12 GB)" };
    } catch (error) {
      state.downloadStatus = "error";
      state.downloadError = error instanceof Error ? error.message : String(error);
      return { accepted: false, message: "模型下载启动失败" };
    }
  }

  async function generateMusic3(input: {
    prompt: string;
    seed?: number;
    seconds?: number;
    steps?: number;
    outputDir: string;
    engine?: "pocket" | "mlxserv";
  }): Promise<Music3GenGenerateResult> {
    // 引擎选路:显式参数 > 首选配置;mlx-serve 路线权重不就绪时回退 pocket 并说明。
    const requested = input.engine ?? mlxServ.preferredEngine;
    if (requested === "mlxserv") {
      const weights = checkWeightsDir(mlxServ.weightsDir);
      if (weights.ready) {
        return generateViaMlxServ(input);
      }
      const fallback = await generateViaPocket(input);
      return {
        ...fallback,
        message: fallback.status === "accepted"
          ? `${fallback.message ?? ""}(mlx-serve 权重未就绪,已走 PocketAiHub 路线)`
          : `mlx-serve 权重未就绪(${weights.reason});PocketAiHub 路线:${fallback.message ?? ""}`,
      };
    }
    return generateViaPocket(input);
  }

  async function generateViaPocket(input: {
    prompt: string;
    seed?: number;
    seconds?: number;
    steps?: number;
    outputDir: string;
  }): Promise<Music3GenGenerateResult> {
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { status: "blocked", code: "runtime-missing", message: "共享 Python 3.12 未安装" };
    }
    const seed = Number.isInteger(input.seed) ? (input.seed as number) : 7;
    const seconds = Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, input.seconds ?? 60));
    const steps = Math.min(30, Math.max(1, input.steps ?? 30));
    const safeName = `bgm3-${Date.now()}-${seed}.wav`;
    const outputPath = path.join(input.outputDir, safeName);
    const artifactPath = path.join(input.outputDir, `${safeName}.json`);
    try {
      const { stdout } = await runFile(
        paths.pythonExecutable,
        [
          "-m", "music3_gen.worker", "--generate",
          "--prompt", input.prompt,
          "--seed", String(seed),
          "--seconds", String(seconds),
          "--steps", String(steps),
          "--output", outputPath,
          "--artifact", artifactPath,
        ],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: MUSIC3_GENERATE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout || "{}") as Record<string, unknown>;
      if (parsed.status === "accepted") {
        return {
          status: "accepted",
          outputPath: typeof parsed.outputPath === "string" ? parsed.outputPath : outputPath,
          outputSha256: typeof parsed.outputSha256 === "string" ? parsed.outputSha256 : undefined,
          durationS: typeof parsed.durationS === "number" ? parsed.durationS : undefined,
          samplingRate: typeof parsed.samplingRate === "number" ? parsed.samplingRate : undefined,
          seed,
          engine: "pocket",
        };
      }
      return {
        status: "blocked",
        code: typeof parsed.code === "string" ? parsed.code : "generation-failed",
        message: typeof parsed.message === "string" ? parsed.message : "整曲生成失败",
      };
    } catch (error) {
      // worker 以非零退出表达 blocked 时,payload JSON 打在 stdout——优先恢复。
      const stdoutOf = (error as { stdout?: unknown }).stdout;
      if (typeof stdoutOf === "string" && stdoutOf.trim().startsWith("{")) {
        try {
          const recovered = JSON.parse(stdoutOf) as { status?: string; code?: string; message?: string };
          if (recovered.status === "blocked") {
            return {
              status: "blocked",
              code: typeof recovered.code === "string" ? recovered.code : "generation-failed",
              message: typeof recovered.message === "string" ? recovered.message : "整曲生成失败",
            };
          }
        } catch {
          // fall through to message sniffing
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      const modelMissing = message.includes("model-not-downloaded") || message.includes("未下载");
      const platformUnsupported = message.includes("platform-unsupported") || message.includes("Apple Silicon");
      return {
        status: "blocked",
        code: modelMissing ? "model-not-downloaded" : platformUnsupported ? "platform-unsupported" : "generation-failed",
        message,
      };
    }
  }

  function status(): Music3GenRuntimeStatus {
    refreshDownloadState();
    return {
      ...state,
      models: [...state.models],
      modelCacheDir: deps.modelCacheDir?.(),
      hardwareProfile: state.hardwareProfile,
      mlxServ: mlxServStatus(),
    };
  }

  return {
    status,
    setup,
    scanModelInventory,
    downloadModel,
    generateMusic3,
    configureMlxServ,
    stopServer,
    installMlxServeBinary,
  };
}

export type Music3GenRuntimeController = ReturnType<typeof createMusic3GenRuntimeController>;
