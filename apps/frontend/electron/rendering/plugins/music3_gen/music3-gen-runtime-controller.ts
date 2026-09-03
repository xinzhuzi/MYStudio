import fs from "node:fs";
import { createMusic3BinaryManager } from "./music3-gen-binary-manager";
import {
  execFileAsync, type ControllerDeps, type MlxServConfig, type Music3GenRuntimeStatus,
  MLXSERV_HEALTH_TIMEOUT_MS, MLXSERV_IDLE_SHUTDOWN_MS, MLXSERV_WEIGHTS_HOME,
  MLXSERV_WEIGHTS_PACK, MLXSERV_WEIGHTS_STAGING, MLXSERV_WEIGHTS_MIN_RAM_BYTES,
  LONG_JOB_AGENT,
  type MlxServRuntimeStatus, type MlxServWeightsInstallState,
  type Music3GenGenerateResult, type Music3GenModelRow, type ProbePayload,
} from "./music3-gen-runtime-consts";
export type { Music3GenRuntimeStatus } from "./music3-gen-runtime-consts";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import { captureSidecarOutput } from "@/electron/diagnostics/sidecar-log-capture";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { MUSIC3_GENERATE_TIMEOUT_MS, MUSIC3_MAX_DURATION_S, MUSIC3_MIN_DURATION_S, buildWavName } from "./music3-gen-runtime-consts";

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

  const serverState: {
    child: ReturnType<typeof spawn> | null;
    starting: boolean;
    baseUrl: string;
    idleTimer: NodeJS.Timeout | null;
  } = { child: null, starting: false, baseUrl: "", idleTimer: null };
  const doFetch = deps.fetchFn ?? fetch;
  const healthTimeoutMs = deps.healthTimeoutMs ?? MLXSERV_HEALTH_TIMEOUT_MS;
  const binaryManager = createMusic3BinaryManager({ deps, getPaths });
  const { mlxServ, buildEnv, profileDir, progressFile, saveMlxServConfig, checkWeightsDir, detectBinary, installMlxServeBinary } = binaryManager;


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

  // ---- bf16 权重获取流程(08-19:ModelScope 全量 → 本地转 MLX,自动填 weightsDir)----

  function mlxservWeightsProgressFile(): string {
    return path.join(profileDir(), "mlxserv-weights-progress.json");
  }

  /** 与后端 install_mlxserv_weights.py 的 5 分钟心跳上限同参。 */
  const MLXSERV_WEIGHTS_STALE_MS = 5 * 60_000;

  function mlxservWeightsInstallTarget(): { staging: string; pack: string } {
    const home = path.join(getPaths().storageBasePath, MLXSERV_WEIGHTS_HOME);
    return { staging: path.join(home, MLXSERV_WEIGHTS_STAGING), pack: path.join(home, MLXSERV_WEIGHTS_PACK) };
  }

  function readMlxServWeightsInstall(): MlxServWeightsInstallState | undefined {
    let raw: Partial<MlxServWeightsInstallState> & { updatedAt?: number };
    try {
      raw = JSON.parse(fs.readFileSync(mlxservWeightsProgressFile(), "utf8")) as typeof raw;
    } catch {
      return undefined;
    }
    const status = raw.status;
    if (status !== "downloading" && status !== "converting" && status !== "complete" && status !== "error") {
      return undefined;
    }
    // 陈旧检测:后端进程心跳停止(应用退出/被杀)超过上限,视为中断而非进行中。
    if ((status === "downloading" || status === "converting") && typeof raw.updatedAt === "number") {
      if (Date.now() - raw.updatedAt > MLXSERV_WEIGHTS_STALE_MS) {
        return {
          status: "error",
          progress: typeof raw.progress === "number" ? raw.progress : 0,
          stage: raw.stage,
          error: "权重获取已中断(进程心跳停止),可重新发起;已下载部分会断点续传",
        };
      }
    }
    return {
      status,
      progress: typeof raw.progress === "number" ? raw.progress : 0,
      stage: typeof raw.stage === "string" ? raw.stage : undefined,
      filename: typeof raw.filename === "string" ? raw.filename : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
    };
  }

  function isMlxServWeightsBusy(install: MlxServWeightsInstallState | undefined): boolean {
    return install?.status === "downloading" || install?.status === "converting";
  }

  async function installMlxServWeights(): Promise<{ accepted: boolean; message: string }> {
    // 转换步骤依赖 mlx(Apple Silicon),整条流程只对该平台开放。
    // 平台探测可注入(单测在 Linux CI 上需模拟 darwin/arm64),默认取宿主真实值。
    const hostPlatform = deps.platform ?? process.platform;
    const hostArch = deps.arch ?? process.arch;
    if (hostPlatform !== "darwin" || hostArch !== "arm64") {
      return { accepted: false, message: "权重获取仅支持 Apple Silicon(转换需 MLX)" };
    }
    // 内存门禁:bf16 推理常驻≈34.9GB,不够不让下,避免「下完 28.5GB 到生成才爆」
    // (08-19 用户裁定:本机只用 bf16;不同平台按硬件选模型)。
    const totalMem = deps.totalMemBytes ? deps.totalMemBytes() : os.totalmem();
    if (totalMem < MLXSERV_WEIGHTS_MIN_RAM_BYTES) {
      return {
        accepted: false,
        message: `本机内存 ${(totalMem / 1024 ** 3).toFixed(0)} GB 不满足 bf16 权重要求(需 48GB+);请使用轻量 MusicGen`,
      };
    }
    const current = readMlxServWeightsInstall();
    if (isMlxServWeightsBusy(current)) {
      return { accepted: false, message: "权重获取已在进行中" };
    }
    const { staging, pack } = mlxservWeightsInstallTarget();
    // 目标产物已完整:直接指向,不重复下载。
    if (checkWeightsDir(pack).ready) {
      configureMlxServ({ weightsDir: pack });
      return { accepted: true, message: `bf16 权重已就绪(${pack}),已自动指向` };
    }
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { accepted: false, message: "共享 Python 3.12 未安装(转换步骤需要 mlx)" };
    }
    fs.mkdirSync(staging, { recursive: true });
    const child = spawnProcess(
      paths.pythonExecutable,
      [
        "-m", "music3_gen.install_mlxserv_weights",
        "--src", staging,
        "--out", pack,
        "--progress", mlxservWeightsProgressFile(),
      ],
      { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );
    // 28.5GB 长下载:断点续传/网络中断的诊断证据进 logs/sidecars/music3-*
    captureSidecarOutput({
      module: "music3",
      child,
      label: `python -m music3_gen.install_mlxserv_weights --out ${pack}`,
    });
    child.on("exit", () => {
      const after = readMlxServWeightsInstall();
      if (after?.status === "complete") {
        // 成功收尾:自动指向新产物(零拷贝,不搬目录)。
        configureMlxServ({ weightsDir: pack });
      }
    });
    return {
      accepted: true,
      message: "bf16 权重获取已开始:ModelScope 全量下载(约 28.5 GB,20 MB/s 直连约 25-40 分钟)→ 本地转 MLX(约 1 分钟);可随时中断,重试断点续传",
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
        { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
      );
      // stderr 全程捕获进 logs/sidecars/music3-*(自有 ~/.mlx-serve/logs/ 之外的进程侧视角)
      captureSidecarOutput({
        module: "music3",
        child,
        label: `mlx-serve serve --model ${mlxServ.weightsDir} --port ${mlxServ.port}`,
      });
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
    lyrics?: string;
    seed?: number;
    seconds?: number;
    steps?: number;
    songName?: string;
    outputDir: string;
  }): Promise<Music3GenGenerateResult> {
    const ensured = await ensureServer();
    if (!ensured.ok) {
      return { status: "blocked", code: ensured.code, message: ensured.message };
    }
    const seed = Number.isInteger(input.seed) ? (input.seed as number) : 7;
    const seconds = Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, input.seconds ?? 60));
    const steps = Math.min(100, Math.max(4, input.steps ?? 30));
    const safeName = buildWavName("bgm3-mlxserv", seed, input.songName);
    const outputPath = path.join(input.outputDir, safeName);
    try {
      // 生成调用走长任务 dispatcher(见 LONG_JOB_AGENT 注释);单测注入的 fetchFn 优先。
      const generateFetch =
        deps.fetchFn ??
        ((input: RequestInfo | URL, init?: RequestInit) =>
          undiciFetch(input as never, { ...(init as object), dispatcher: LONG_JOB_AGENT } as never) as unknown as Promise<Response>);
      const response = await generateFetch(`${ensured.baseUrl}/v1/audio/music-generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          lyrics: input.lyrics?.trim() || "[Instrumental]",
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
      // The Python probe covers the Pocket/HuggingFace route. When the user
      // explicitly selects mlx-serve, readiness comes from the configured
      // local weights + executable instead of an HF snapshot.
      const mlxStatus = mlxServStatus();
      const mlxServReady = mlxServ.preferredEngine === "mlxserv"
        && mlxStatus.weightsReady
        && mlxStatus.binaryFound;
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
        downloaded: parsed.status === "ready" || mlxServReady,
        sizeMb: typeof parsed.sizeMb === "number" ? parsed.sizeMb : null,
        repoId: "PocketAiHub/MiniMax-Music3-MLX",
        availability: available ? "ok" : "unsupported",
        unsupportedReason: available ? undefined : parsed.availability?.reason,
        layout: parsed.layout,
        modelDir: parsed.modelDir,
        engine: parsed.engine,
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
      return { accepted: true, message: "MiniMax-Music3 模型下载已开始(约 28.5 GB,bf16)" };
    } catch (error) {
      state.downloadStatus = "error";
      state.downloadError = error instanceof Error ? error.message : String(error);
      return { accepted: false, message: "模型下载启动失败" };
    }
  }

  async function generateMusic3(input: {
    prompt: string;
    lyrics?: string;
    seed?: number;
    seconds?: number;
    steps?: number;
    songName?: string;
    outputDir: string;
    engine?: "pocket" | "mlxserv";
  }): Promise<Music3GenGenerateResult> {
    // 引擎选路:显式参数 > 首选配置;mlx-serve 路线权重不就绪时回退 pocket 并说明。
    // 防静默降级(08-20):带人声歌词的请求只有 mlx-serve(bf16)能兑现,
    // 权重不就绪/选了 pocket 时直接阻断——绝不静默给用户一首伴奏。
    const requested = input.engine ?? mlxServ.preferredEngine;
    const vocalLyrics = input.lyrics?.trim() && input.lyrics.trim() !== "[Instrumental]";
    if (vocalLyrics && requested !== "mlxserv") {
      return {
        status: "blocked",
        code: "lyrics-requires-mlxserv",
        message: "带人声歌词的生成必须走 mlx-serve(bf16)路线;请在设置 → 本地音乐生成 将首选引擎切到「指向版」(或获取权重)",
      };
    }
    if (requested === "mlxserv") {
      const weights = checkWeightsDir(mlxServ.weightsDir);
      if (weights.ready) {
        return generateViaMlxServ(input);
      }
      if (vocalLyrics) {
        return {
          status: "blocked",
          code: "lyrics-requires-mlxserv",
          message: `带人声歌词的生成必须走 mlx-serve(bf16),当前权重未就绪(${weights.reason});不会静默降级为纯伴奏`,
        };
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
    songName?: string;
    outputDir: string;
  }): Promise<Music3GenGenerateResult> {
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { status: "blocked", code: "runtime-missing", message: "共享 Python 3.12 未安装" };
    }
    const seed = Number.isInteger(input.seed) ? (input.seed as number) : 7;
    const seconds = Math.min(MUSIC3_MAX_DURATION_S, Math.max(MUSIC3_MIN_DURATION_S, input.seconds ?? 60));
    const steps = Math.min(30, Math.max(1, input.steps ?? 30));
    const safeName = buildWavName("bgm3", seed, input.songName);
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
      mlxServWeightsInstall: readMlxServWeightsInstall(),
      hostTotalRamGb: Math.round(((deps.totalMemBytes ? deps.totalMemBytes() : os.totalmem()) / 1024 ** 3) * 10) / 10,
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
    installMlxServWeights,
  };
}

export type Music3GenRuntimeController = ReturnType<typeof createMusic3GenRuntimeController>;


export { MLXSERV_DEFAULT_PORT, MUSIC3_GENERATE_TIMEOUT_MS, MUSIC3_MAX_DURATION_S, MUSIC3_MIN_DURATION_S, buildWavName } from "./music3-gen-runtime-consts";
