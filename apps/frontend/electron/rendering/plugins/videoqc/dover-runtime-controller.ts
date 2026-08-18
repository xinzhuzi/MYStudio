// Video QC (DOVER 观感层) runtime controller — 设置面生命周期管理器,
// 镜像 upscale-runtime-controller 的形状,去掉 profile 安装(probe 路径零重依赖),
// 增加 runVideoQcScore(编排器消费)与 baselines 读写(按系列基线)。
//
// 降级语义(08-19 立项网络现实,见 apps/backend/video_qc/model_cache.py 头注):
// 权重源未配置/架构未 vendor → probe blocked(code=model-not-downloaded /
// arch-unavailable),QC 链把 aesthetic 层标 skipped,不阻塞渲染交付。

import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  buildVideoQcWorkerEnv,
  probeVideoQcRuntime,
  resolveVideoQcRuntimePaths,
  VIDEO_QC_TOOL_VERSION,
  type VideoQcRuntimePaths,
} from "./video-qc-runtime";

const execFileAsync = promisify(execFile);

export type VideoQcSetupStage = "idle" | "checking" | "ready" | "failed";

export interface VideoQcRuntimeStatus {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message?: string;
  setupStage: VideoQcSetupStage;
  /** DOVER 推理就绪态:权重+架构齐才 true */
  modelReady: boolean;
  modelCode?: string;
  modelMessage?: string;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  modelCacheDir: string;
}

export interface VideoQcBaselineEntry {
  seriesId: string;
  meanFused: number;
  sigma: number;
  sampleCount: number;
  updatedAt: number;
}

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  execFile?: (file: string, args: string[], options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  }) => Promise<{ stdout?: string; stderr?: string }>;
  now?: () => number;
}

export type VideoQcScoreOutcome =
  | { status: "accepted"; overall: { fused: number; aesthetic: number; technical: number }; slices?: Array<{ shotId: string; fused: number }>; elapsedMs: number }
  | { status: "blocked"; code: string; message: string };

export function createVideoQcRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveVideoQcRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );

  const state: VideoQcRuntimeStatus = {
    state: "needs-runtime",
    setupStage: "idle",
    modelReady: false,
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    modelCacheDir: "",
  };

  const runFile = deps.execFile ?? execFileAsync;
  const now = deps.now ?? Date.now;

  // --- config(缓存目录持久化,<storageBase>/VideoQcModel/config.json) ---
  function videoQcModelRoot(): string {
    return path.join(getPaths().storageBasePath, "VideoQcModel");
  }

  function configPath(): string {
    return path.join(videoQcModelRoot(), "config.json");
  }

  function readConfig(): { modelCacheDir?: string } {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as { modelCacheDir?: unknown };
      if (typeof raw.modelCacheDir === "string" && path.isAbsolute(raw.modelCacheDir)) {
        return { modelCacheDir: raw.modelCacheDir };
      }
    } catch {
      // 首次读或坏文件
    }
    return {};
  }

  function writeConfig(modelCacheDir: string): void {
    fs.mkdirSync(videoQcModelRoot(), { recursive: true });
    const temp = `${configPath()}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ modelCacheDir }, null, 2)}\n`, "utf8");
    fs.renameSync(temp, configPath());
  }

  function getModelCacheDir(): string {
    return readConfig().modelCacheDir ?? videoQcModelRoot();
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
      fs.mkdirSync(next, { recursive: true });
      writeConfig(next);
      state.modelCacheDir = next;
      await refreshModelProbe();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- python 执行 ---
  function buildEnv(_paths: VideoQcRuntimePaths): NodeJS.ProcessEnv {
    return buildVideoQcWorkerEnv(deps.backendRoot, {
      MYSTUDIO_VIDEO_QC_MODEL_DIR: getModelCacheDir(),
    });
  }

  async function runPython(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    const paths = getPaths();
    const result = await runFile(paths.pythonExecutable, args, {
      cwd: deps.backendRoot,
      env: buildEnv(paths),
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  function status(): VideoQcRuntimeStatus {
    if (!state.modelCacheDir) state.modelCacheDir = getModelCacheDir();
    return { ...state };
  }

  async function refreshModelProbe(): Promise<void> {
    try {
      const { stdout } = await runPython(["-m", "video_qc.worker", "--probe"], 30_000);
      const parsed = JSON.parse(stdout) as {
        status?: string;
        model?: { status?: string; code?: string; message?: string };
      };
      const model = parsed.model ?? {};
      state.modelReady = parsed.status === "ready" && model.status === "ready";
      state.modelCode = typeof model.code === "string" ? model.code : undefined;
      state.modelMessage = typeof model.message === "string" ? model.message : undefined;
      if (state.downloadStatus !== "downloading") {
        state.downloadStatus = state.modelReady ? "complete" : "idle";
        state.downloadProgress = state.modelReady ? 100 : 0;
      }
    } catch {
      // fail closed:managed Python 缺失/坏 → 模型不可用
      state.modelReady = false;
    }
  }

  async function scanModelInventory(): Promise<{ models: Array<{ name: string; label: string; downloaded: boolean; sizeMb: number; pinned: boolean }>; cacheDir: string }> {
    try {
      const { stdout } = await runPython(["-m", "video_qc.model_inventory"], 30_000);
      const parsed = JSON.parse(stdout) as {
        models?: Array<Record<string, unknown>>;
        cacheDir?: unknown;
      };
      const models = (Array.isArray(parsed.models) ? parsed.models : [])
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .map((row) => ({
          name: typeof row.name === "string" ? row.name : "",
          label: typeof row.label === "string" ? row.label : "",
          downloaded: row.downloaded === true,
          sizeMb: typeof row.sizeMb === "number" ? row.sizeMb : 0,
          pinned: row.pinned === true,
        }));
      if (typeof parsed.cacheDir === "string" && parsed.cacheDir) state.modelCacheDir = parsed.cacheDir;
      return { models, cacheDir: state.modelCacheDir };
    } catch {
      return { models: [], cacheDir: getModelCacheDir() };
    }
  }

  function progressFile(): string {
    return path.join(getPaths().videoQcProfileDir, "download-progress.json");
  }

  function readDownloadProgress(): {
    status: "idle" | "downloading" | "complete" | "error";
    progress: number;
    current: number;
    total: number;
    error?: string;
  } {
    try {
      const raw = JSON.parse(fs.readFileSync(progressFile(), "utf8")) as Record<string, unknown>;
      if (raw.status === "downloading" || raw.status === "complete" || raw.status === "error") {
        return {
          status: raw.status,
          progress: typeof raw.progress === "number" ? raw.progress : 0,
          current: typeof raw.current === "number" ? raw.current : 0,
          total: typeof raw.total === "number" ? raw.total : 0,
          error: typeof raw.error === "string" ? raw.error : undefined,
        };
      }
    } catch {
      // 无进度文件
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
        await refreshModelProbe();
      }
    }
  }

  async function setup(): Promise<VideoQcRuntimeStatus> {
    state.setupStage = "checking";
    state.message = "正在检查成片观感评分运行时…";
    const probe = await probeVideoQcRuntime(getPaths());
    if (probe.state === "ready") {
      state.state = "ready";
      state.setupStage = "ready";
      state.message = "观感评分运行时已就绪";
      await refreshModelProbe();
      await refreshDownloadState();
      return status();
    }
    state.state = "blocked";
    state.setupStage = "failed";
    state.message = probe.message;
    return status();
  }

  async function rollback(): Promise<VideoQcRuntimeStatus> {
    // video_qc 无独立 profile(复用 managed python),回滚=回到未探测态
    state.state = "needs-runtime";
    state.setupStage = "idle";
    state.message = undefined;
    state.modelReady = false;
    state.downloadStatus = "idle";
    state.downloadProgress = 0;
    state.downloadError = undefined;
    return status();
  }

  async function refresh(): Promise<VideoQcRuntimeStatus> {
    const probe = await probeVideoQcRuntime(getPaths());
    state.state = probe.state === "ready" ? "ready" : probe.state;
    if (probe.state !== "ready" && !state.message) state.message = probe.message;
    if (probe.state === "ready" && state.setupStage !== "failed") state.setupStage = "ready";
    await refreshModelProbe();
    await refreshDownloadState();
    return status();
  }

  async function downloadModel(modelName: string): Promise<{ accepted: boolean; message: string }> {
    if (modelName !== "dover-mobile") {
      return { accepted: false, message: "未知观感评分模型" };
    }
    if (state.downloadStatus === "downloading") {
      return { accepted: false, message: "观感评分模型正在下载中" };
    }
    const probe = await probeVideoQcRuntime(getPaths());
    if (probe.state !== "ready") {
      return { accepted: false, message: "观感评分运行时未就绪，请先完成 Python 运行时配置" };
    }
    state.downloadStatus = "downloading";
    state.downloadProgress = 0;
    state.downloadError = undefined;
    const paths = getPaths();
    fs.mkdirSync(paths.videoQcProfileDir, { recursive: true });
    const child = spawn(
      paths.pythonExecutable,
      ["-m", "video_qc.download_model", "--model", modelName, "--progress", progressFile()],
      { cwd: deps.backendRoot, env: buildEnv(paths), stdio: ["ignore", "ignore", "ignore"], detached: false },
    );
    child.on("exit", () => {
      void refreshDownloadState();
    });
    child.on("error", (error) => {
      state.downloadStatus = "error";
      state.downloadError = error.message;
    });
    return { accepted: true, message: "观感评分模型下载已开始" };
  }

  async function deleteModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (modelName !== "dover-mobile") return { success: false, error: "未知观感评分模型" };
    try {
      const { stdout } = await runPython(
        ["-c", "from video_qc.model_cache import delete_cached_model; import json; print(json.dumps({'removed': delete_cached_model('dover-mobile')}))"],
        30_000,
      );
      const parsed = JSON.parse(stdout) as { removed?: boolean };
      await refreshModelProbe();
      return { success: true, ...(parsed.removed ? {} : { error: "模型未下载，无需删除" }) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- 评分执行(编排器消费) ---
  async function runVideoQcScore(request: {
    projectId: string;
    chapterId: string;
    videoPath: string;
    mode: "whole" | "slices";
    slices?: Array<{ shotId: string; startS: number; durationS: number }>;
  }): Promise<VideoQcScoreOutcome> {
    const paths = getPaths();
    fs.mkdirSync(paths.videoQcProfileDir, { recursive: true });
    const workspace = path.join(paths.videoQcProfileDir, "runs", `${now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(workspace, { recursive: true });
    const requestPath = path.join(workspace, "request.json");
    const artifactPath = path.join(workspace, "artifact.json");
    try {
      fs.writeFileSync(requestPath, JSON.stringify({ ...request, model: "dover-mobile" }, null, 2), "utf8");
      try {
        await runFile(paths.pythonExecutable, ["-m", "video_qc.worker", "--run", "--input", requestPath, "--output", artifactPath], {
          cwd: deps.backendRoot,
          env: buildEnv(paths),
          timeout: 10 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch {
        // worker exit 2 + blocked artifact 已落盘;读不到再综合成 blocked
      }
      if (!fs.existsSync(artifactPath)) {
        return { status: "blocked", code: "worker-failed", message: "观感评分 worker 未产出 artifact" };
      }
      const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
      if (raw.status === "accepted") {
        const overall = raw.overall as { fused: number; aesthetic: number; technical: number } | undefined;
        if (!overall || ![overall.fused, overall.aesthetic, overall.technical].every((v) => typeof v === "number")) {
          return { status: "blocked", code: "invalid-artifact", message: "观感评分返回了无效的分数" };
        }
        const slices = Array.isArray(raw.slices)
          ? (raw.slices as Array<Record<string, unknown>>)
              .filter((row) => typeof row.shotId === "string" && typeof row.fused === "number")
              .map((row) => ({ shotId: row.shotId as string, fused: row.fused as number }))
          : undefined;
        return {
          status: "accepted",
          overall,
          ...(slices ? { slices } : {}),
          elapsedMs: typeof raw.elapsedMs === "number" ? raw.elapsedMs : 0,
        };
      }
      return {
        status: "blocked",
        code: typeof raw.code === "string" ? raw.code : "unknown",
        message: typeof raw.message === "string" ? raw.message : "观感评分被阻塞",
      };
    } catch (error) {
      return { status: "blocked", code: "worker-failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
      try {
        fs.rmSync(workspace, { recursive: true, force: true });
      } catch {
        // 清理失败不致命
      }
    }
  }

  // --- baselines(按系列基线,<storageBase>/VideoQcModel/baselines.json) ---
  function baselinesPath(): string {
    return path.join(videoQcModelRoot(), "baselines.json");
  }

  function readBaselines(): Record<string, VideoQcBaselineEntry> {
    try {
      const raw = JSON.parse(fs.readFileSync(baselinesPath(), "utf8")) as Record<string, unknown>;
      const result: Record<string, VideoQcBaselineEntry> = {};
      for (const [seriesId, value] of Object.entries(raw)) {
        if (typeof value === "object" && value !== null) {
          const entry = value as Record<string, unknown>;
          if (
            typeof entry.meanFused === "number" &&
            typeof entry.sigma === "number" &&
            typeof entry.sampleCount === "number"
          ) {
            result[seriesId] = {
              seriesId,
              meanFused: entry.meanFused,
              sigma: entry.sigma,
              sampleCount: entry.sampleCount,
              updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
            };
          }
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  function recordBaseline(seriesId: string, fused: number): VideoQcBaselineEntry {
    const safeSeriesId = seriesId.trim() || "default";
    const all = readBaselines();
    const previous = all[safeSeriesId];
    // 在线均值/方差更新(Welford 简化:σ 用样本标准差近似)
    const sampleCount = (previous?.sampleCount ?? 0) + 1;
    const meanFused = previous ? previous.meanFused + (fused - previous.meanFused) / sampleCount : fused;
    const sigma = previous
      ? Math.sqrt(
          ((previous.sampleCount * previous.sigma ** 2 + (fused - previous.meanFused) * (fused - meanFused)) / sampleCount) || 0,
        )
      : 0;
    const entry: VideoQcBaselineEntry = { seriesId: safeSeriesId, meanFused, sigma, sampleCount, updatedAt: now() };
    all[safeSeriesId] = entry;
    fs.mkdirSync(videoQcModelRoot(), { recursive: true });
    const temp = `${baselinesPath()}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(all, null, 2), "utf8");
    fs.renameSync(temp, baselinesPath());
    return entry;
  }

  return {
    status,
    setup,
    rollback,
    refresh,
    scanModelInventory,
    downloadModel,
    readDownloadProgress,
    getModelCacheDir,
    setModelCacheDir,
    deleteModel,
    runVideoQcScore,
    readBaselines,
    recordBaseline,
    get toolVersion() {
      return VIDEO_QC_TOOL_VERSION;
    },
  };
}

export type VideoQcRuntimeController = ReturnType<typeof createVideoQcRuntimeController>;
