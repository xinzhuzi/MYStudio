// MiniMax-Music3 (MLX) runtime controller — whole-song BGM engine.
// Same explicit-download policy as audio-gen/sfx-gen: the ~12 GB repo snapshot
// downloads ONLY from the settings panel; generation fails closed with
// "model-not-downloaded" otherwise. Generation is minutes-scale (whole song),
// so the IPC timeout is generous and progress is user-observable via exports.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";

const execFileAsync = promisify(execFile);

/** 与 backend/music3_gen/worker.py 的钳制保持同参(整曲域 10-300s) */
export const MUSIC3_MIN_DURATION_S = 10;
export const MUSIC3_MAX_DURATION_S = 300;
/** 整曲生成为分钟级;给足执行窗口(backend 硬限 30min,这里同参) */
export const MUSIC3_GENERATE_TIMEOUT_MS = 30 * 60_000;

export type Music3GenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface Music3GenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
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
}

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  spawnProcess?: typeof spawn;
  execFileFn?: ExecFileLike;
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
  code?: string;
  message?: string;
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

  async function scanModelInventory(): Promise<Music3GenModelRow[]> {
    try {
      const { stdout } = await runFile(
        getPaths().pythonExecutable,
        ["-m", "music3_gen.worker", "--probe"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout ?? "{}") as {
        status?: string;
        model?: string;
        depsOk?: boolean;
        sizeMb?: number | null;
      };
      state.models = [{
        modelName: parsed.model ?? "minimax-music3-mlx",
        label: "MiniMax-Music3(MLX 整曲引擎)",
        downloaded: parsed.status === "ready",
        sizeMb: typeof parsed.sizeMb === "number" ? parsed.sizeMb : null,
        repoId: "PocketAiHub/MiniMax-Music3-MLX",
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
        };
      }
      return {
        status: "blocked",
        code: typeof parsed.code === "string" ? parsed.code : "generation-failed",
        message: typeof parsed.message === "string" ? parsed.message : "整曲生成失败",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const modelMissing = message.includes("model-not-downloaded") || message.includes("未下载");
      return {
        status: "blocked",
        code: modelMissing ? "model-not-downloaded" : "generation-failed",
        message,
      };
    }
  }

  function status(): Music3GenRuntimeStatus {
    refreshDownloadState();
    return { ...state, models: [...state.models], modelCacheDir: deps.modelCacheDir?.() };
  }

  return {
    status,
    setup,
    scanModelInventory,
    downloadModel,
    generateMusic3,
  };
}

export type Music3GenRuntimeController = ReturnType<typeof createMusic3GenRuntimeController>;
