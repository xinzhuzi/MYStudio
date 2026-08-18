// Local sfx generation runtime controller — short one-shot sound effects with
// seed determinism. Same explicit-download policy as depth/audio-gen: models
// download ONLY from the settings panel; generation fails closed with
// "model-not-downloaded" otherwise. Generated WAVs feed the sfx binding flow
// (08-19-local-sfx-generation P1: exports dir first, same as BGM).

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";

const execFileAsync = promisify(execFile);

/** 与 backend/sfx_gen/worker.py 的钳制保持同参 */
export const SFX_MIN_DURATION_S = 0.5;
export const SFX_MAX_DURATION_S = 5;

export type SfxGenSetupStage = "idle" | "checking" | "ready" | "failed";

export interface SfxGenModelRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  repoId: string;
  enabled?: boolean;
}

export interface SfxGenRuntimeStatus {
  setupStage: SfxGenSetupStage;
  setupMessage: string | undefined;
  models: SfxGenModelRow[];
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

export interface SfxGenGenerateResult {
  status: "accepted" | "blocked";
  outputPath?: string;
  outputSha256?: string;
  durationS?: number;
  samplingRate?: number;
  seed?: number;
  code?: string;
  message?: string;
}

export function createSfxGenRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveVideoWorkflowRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );
  const spawnProcess = deps.spawnProcess ?? spawn;
  const runFile = deps.execFileFn ?? execFileAsync;

  const state: SfxGenRuntimeStatus = {
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
    return path.join(getPaths().pythonRuntimeDir, "profiles", "sfx-gen");
  }

  function progressFile(): string {
    return path.join(profileDir(), "download-progress.json");
  }

  async function scanModelInventory(): Promise<SfxGenModelRow[]> {
    try {
      const { stdout } = await runFile(
        getPaths().pythonExecutable,
        ["-m", "sfx_gen.model_inventory"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout ?? "{}") as { models?: SfxGenModelRow[] };
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

  async function setup(): Promise<SfxGenRuntimeStatus> {
    state.setupStage = "checking";
    state.setupMessage = "正在检查本地音效生成运行时…";
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      state.setupStage = "failed";
      state.setupMessage = "共享 Python 3.12 未安装，请先完成 Python 运行环境配置";
      return status();
    }
    try {
      await runFile(
        paths.pythonExecutable,
        ["-m", "sfx_gen.worker", "--probe"],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch {
      state.setupStage = "failed";
      state.setupMessage = "音效生成依赖未安装（需要 torch/transformers，随 Python 运行环境提供）";
      return status();
    }
    state.setupStage = "ready";
    state.setupMessage = "本地音效生成运行时已就绪";
    await scanModelInventory();
    return status();
  }

  async function downloadModel(modelName = "sfx-musicgen-small"): Promise<{ accepted: boolean; message: string }> {
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
          "-m", "sfx_gen.download_model",
          "--model", modelName,
          "--progress", progressFile(),
        ],
        { cwd: deps.backendRoot, env: buildEnv(), stdio: ["ignore", "ignore", "ignore"] },
      );
      downloader.on("exit", () => {
        refreshDownloadState();
        void scanModelInventory();
      });
      return { accepted: true, message: "音效模型下载已开始" };
    } catch (error) {
      state.downloadStatus = "error";
      state.downloadError = error instanceof Error ? error.message : String(error);
      return { accepted: false, message: "模型下载启动失败" };
    }
  }

  async function generateSfx(input: {
    prompt: string;
    seed?: number;
    seconds?: number;
    model?: string;
    outputDir: string;
  }): Promise<SfxGenGenerateResult> {
    const paths = getPaths();
    if (!fs.existsSync(paths.pythonExecutable)) {
      return { status: "blocked", code: "runtime-missing", message: "共享 Python 3.12 未安装" };
    }
    const seed = Number.isInteger(input.seed) ? (input.seed as number) : 0;
    const seconds = Math.min(SFX_MAX_DURATION_S, Math.max(SFX_MIN_DURATION_S, input.seconds ?? 2));
    const safeName = `sfx-${Date.now()}-${seed}.wav`;
    const outputPath = path.join(input.outputDir, safeName);
    const artifactPath = path.join(input.outputDir, `${safeName}.json`);
    try {
      const { stdout } = await runFile(
        paths.pythonExecutable,
        [
          "-m", "sfx_gen.worker", "--generate",
          "--prompt", input.prompt,
          "--seed", String(seed),
          "--seconds", String(seconds),
          "--model", input.model ?? "sfx-musicgen-small",
          "--output", outputPath,
          "--artifact", artifactPath,
        ],
        { cwd: deps.backendRoot, env: buildEnv(), timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 },
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
        message: typeof parsed.message === "string" ? parsed.message : "音效生成失败",
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

  function status(): SfxGenRuntimeStatus {
    refreshDownloadState();
    return { ...state, models: [...state.models] };
  }

  return {
    status,
    setup,
    scanModelInventory,
    downloadModel,
    generateSfx,
  };
}

export type SfxGenRuntimeController = ReturnType<typeof createSfxGenRuntimeController>;
