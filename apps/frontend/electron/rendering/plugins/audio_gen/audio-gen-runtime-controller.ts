// Local music generation runtime controller — MusicGen model management +
// CLI generation worker. Same explicit-download policy as depth/image-gen:
// models download ONLY from the settings panel; generation fails closed with
// "model-not-downloaded" otherwise. Generated WAVs feed the existing
// chapter shared-audio import flow (BGM track).

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";

const execFileAsync = promisify(execFile);

export type AudioGenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface AudioGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
}

export interface AudioGenRuntimeStatus {
  setupStage: AudioGenSetupStage;
  setupMessage: string | undefined;
  models: AudioGenModelRow[];
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
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

export interface AudioGenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  code?: string;
  message?: string;
}

export function createAudioGenRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveVideoWorkflowRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );
  const spawnProcess = deps.spawnProcess ?? spawn;
  const runFile = deps.execFileFn ?? execFileAsync;

  const state: AudioGenRuntimeStatus = {
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
    return path.join(getPaths().pythonRuntimeDir, "profiles", "audio-gen");
  }

  function progressFile(): string {
    return path.join(profileDir(), "download-progress.json");
  }

  async function scanModelInventory(): Promise<AudioGenModelRow[]> {
    try {
      const { stdout } = await runFile(
        getPaths().pythonExecutable,
        ["-m", "audio_gen.model_inventory"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout ?? "{}") as { models?: AudioGenModelRow[] };
      state.models = Array.isArray(parsed.models) ? parsed.models : [];
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

  async function setup(): Promise<AudioGenRuntimeStatus> {
    state.setupStage = "checking";
    state.setupMessage = "正在检查本地音乐生成运行时…";
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      state.setupStage = "failed";
      state.setupMessage = "共享 Python 3.12 未安装，请先完成 Python 运行环境配置";
      return status();
    }
    try {
      await runFile(
        paths.pythonExecutable,
        ["-m", "audio_gen.worker", "--probe"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch {
      state.setupStage = "failed";
      state.setupMessage = "音频生成依赖未安装（需要 torch/transformers，随 Python 运行环境提供）";
      return status();
    }
    state.setupStage = "ready";
    state.setupMessage = "本地音乐生成运行时已就绪";
    await scanModelInventory();
    return status();
  }

  async function downloadModel(): Promise<{ accepted: boolean; message: string }> {
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
          "-m", "audio_gen.download_model",
          "--model", "musicgen-small",
          "--progress", progressFile(),
        ],
        { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "ignore", "ignore"] },
      );
      downloader.on("exit", () => {
        refreshDownloadState();
        void scanModelInventory();
      });
      return { accepted: true, message: "MusicGen 模型下载已开始" };
    } catch (error) {
      state.downloadStatus = "error";
      state.downloadError = error instanceof Error ? error.message : String(error);
      return { accepted: false, message: "模型下载启动失败" };
    }
  }

  async function generateMusic(input: {
    prompt: string;
    seconds?: number;
    outputDir: string;
  }): Promise<AudioGenGenerateResult> {
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { status: "blocked", code: "runtime-missing", message: "共享 Python 3.12 未安装" };
    }
    const safeName = `bgm-${Date.now()}.wav`;
    const outputPath = path.join(input.outputDir, safeName);
    const artifactPath = path.join(input.outputDir, `${safeName}.json`);
    try {
      const { stdout } = await runFile(
        paths.pythonExecutable,
        [
          "-m", "audio_gen.worker", "--generate",
          "--prompt", input.prompt,
          "--seconds", String(Math.min(60, Math.max(5, input.seconds ?? 15))),
          "--output", outputPath,
          "--artifact", artifactPath,
        ],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout || "{}") as Record<string, unknown>;
      if (parsed.status === "accepted") {
        return {
          status: "accepted",
          outputPath: typeof parsed.outputPath === "string" ? parsed.outputPath : outputPath,
          outputSha256: typeof parsed.outputSha256 === "string" ? parsed.outputSha256 : undefined,
          durationS: typeof parsed.durationS === "number" ? parsed.durationS : undefined,
          samplingRate: typeof parsed.samplingRate === "number" ? parsed.samplingRate : undefined,
        };
      }
      return {
        status: "blocked",
        code: typeof parsed.code === "string" ? parsed.code : "generation-failed",
        message: typeof parsed.message === "string" ? parsed.message : "BGM 生成失败",
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

  function status(): AudioGenRuntimeStatus {
    refreshDownloadState();
    return { ...state, models: [...state.models] };
  }

  return {
    status,
    setup,
    scanModelInventory,
    downloadModel,
    generateMusic,
  };
}

export type AudioGenRuntimeController = ReturnType<typeof createAudioGenRuntimeController>;
