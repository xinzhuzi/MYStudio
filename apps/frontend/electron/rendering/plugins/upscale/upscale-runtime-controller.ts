// Upscale runtime controller — the settings-facing lifecycle manager for the
// local image super-resolution models, mirroring the depth runtime controller:
//   - status()             → in-memory state the renderer polls every 500 ms
//   - setup()              → prepare the Python profile (lock + pip + marker)
//   - scanModelInventory() → offline "which models are downloaded" probe
//   - downloadModel(name)  → explicit, user-triggered download (never implicit)
//   - readDownloadProgress() → progress JSON written by the Python downloader
//   - runUpscale(request)  → execute one super-resolution worker run
//
// Model download policy: inference NEVER downloads. Models are downloaded
// only when the user clicks the button in 设置 → 本地配置 → 图片超分.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  DEFAULT_UPSCALE_MODEL_ID,
  UPSCALE_MODELS,
  blockedUpscaleArtifact,
  validateUpscaleArtifact,
  validateUpscaleRunRequest,
  type UpscaleArtifactV1,
  type UpscaleModelId,
  type UpscaleRunRequestV1,
} from "@rendering/contracts/upscale-workflow";
import {
  buildUpscaleWorkerArgs,
  buildUpscaleWorkerEnv,
  probeUpscaleRuntime,
  resolveUpscaleRuntimePaths,
  UPSCALE_TOOL_VERSION,
  type UpscaleRuntimePaths,
} from "./upscale-runtime";
import { captureSidecarOutput } from "@/electron/diagnostics/sidecar-log-capture";
import { prepareUpscaleRuntime, rollbackUpscaleRuntime } from "./upscale-runtime-manager";

const execFileAsync = promisify(execFile);

function sha256File(filePath: string): string {
  const digest = createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return digest.digest("hex");
}

interface UpscaleInventoryRow {
  modelName: string;
  label: string;
  downloaded: boolean;
  sizeMb: number | null;
  file: string;
  scale: number;
  cacheDir: string | null;
}

export type UpscaleSetupStage =
  | "idle"
  | "checking"
  | "preparing-profile"
  | "ready"
  | "failed";

export interface UpscaleRuntimeStatus {
  state: "needs-runtime" | "ready" | "blocked" | "error";
  message?: string;
  setupStage: UpscaleSetupStage;
  setupProgress: number | undefined;
  setupMessage: string | undefined;
  /** Currently selected super-resolution model. */
  activeModel: UpscaleModelId;
  /** True when the active model weights are present in the model cache dir. */
  modelDownloaded: boolean;
  modelSizeMb: number | null;
  downloadStatus: "idle" | "downloading" | "complete" | "error";
  downloadProgress: number;
  downloadError: string | undefined;
  /** Model currently being downloaded, if any. */
  downloadingModel: string | undefined;
  /** User-configured model cache directory (default <storageBase>/UpscaleModel). */
  modelCacheDir: string;
}

interface ControllerDeps {
  storageBasePath: string | (() => string);
  backendRoot: string;
  modelCacheDir?: () => string;
  /** Resolves a project-relative media path to an absolute path with root
   *  confinement (resolveProjectScopedFilePath). Injected by main.ts. */
  resolveProjectFilePath?: (projectId: string, relativePath: string) => string | null;
  /** Resolves a local-image:// URL to an absolute path with media-root
   *  confinement (resolveLocalMediaPath). Injected by main.ts. */
  resolveLocalMediaPath?: (url: string) => string | null;
  execFile?: ExecFileLike;
  now?: () => number;
  /** Test seams for fs operations. */
  mkdir?: (dir: string) => void;
  removeDir?: (dir: string) => void;
  unlinkFile?: (file: string) => void;
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

export interface UpscaleRunResult {
  artifact: UpscaleArtifactV1;
}

export function createUpscaleRuntimeController(deps: ControllerDeps) {
  const getPaths = () =>
    resolveUpscaleRuntimePaths(
      typeof deps.storageBasePath === "function" ? deps.storageBasePath() : deps.storageBasePath,
    );

  const state: UpscaleRuntimeStatus = {
    state: "needs-runtime",
    setupStage: "idle",
    setupProgress: undefined,
    setupMessage: undefined,
    activeModel: DEFAULT_UPSCALE_MODEL_ID,
    modelDownloaded: false,
    modelSizeMb: null,
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    downloadingModel: undefined,
    modelCacheDir: "",
  };

  const mkdirDir = deps.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  const removeDirSync = deps.removeDir ?? ((dir: string) => fs.rmSync(dir, { recursive: true, force: true }));
  const unlinkFileSync = deps.unlinkFile ?? ((file: string) => fs.unlinkSync(file));

  // --- Model cache dir + active model config (mirrors depth persistence) ----
  // Config lives at <modelRoot>/config.json; default cache dir is the root
  // itself (weights land flat as <dir>/<file>).
  // 08-19 模型目录规范:新家 <storageBase>/model/upscale;旧 <storageBase>/UpscaleModel
  // 在场且新家不存在时一次性整目录迁移(同卷 rename;失败回退旧根)。
  function upscaleModelRoot(): string {
    const base = getPaths().storageBasePath;
    const home = path.join(base, "model", "upscale");
    const legacy = path.join(base, "UpscaleModel");
    try {
      if (fs.existsSync(legacy) && !fs.existsSync(home)) {
        try {
          fs.mkdirSync(path.dirname(home), { recursive: true });
          fs.renameSync(legacy, home);
        } catch {
          // 迁移失败(权限/跨卷):回退旧根,不阻断功能
        }
      }
    } catch {
      // 探测失败:按新家走
    }
    return fs.existsSync(legacy) && !fs.existsSync(home) ? legacy : home;
  }

  function configPath(): string {
    return path.join(upscaleModelRoot(), "config.json");
  }

  function readConfig(): { modelCacheDir?: string; activeModel?: UpscaleModelId } {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as {
        modelCacheDir?: unknown;
        activeModel?: unknown;
      };
      const config: { modelCacheDir?: string; activeModel?: UpscaleModelId } = {};
      if (typeof raw.modelCacheDir === "string" && path.isAbsolute(raw.modelCacheDir)) {
        config.modelCacheDir = raw.modelCacheDir;
      }
      if (typeof raw.activeModel === "string" && raw.activeModel in UPSCALE_MODELS) {
        config.activeModel = raw.activeModel as UpscaleModelId;
      }
      return config;
    } catch {
      return {};
    }
  }

  function writeConfig(config: { modelCacheDir: string; activeModel: UpscaleModelId }): void {
    mkdirDir(upscaleModelRoot());
    const temp = `${configPath()}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fs.renameSync(temp, configPath());
  }

  function getModelCacheDir(): string {
    const override = deps.modelCacheDir?.();
    if (override) return override;
    const configured = readConfig().modelCacheDir;
    if (configured) return configured;
    return upscaleModelRoot();
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
      writeConfig({ modelCacheDir: next, activeModel: state.activeModel });
      state.modelCacheDir = next;
      await scanModelInventory();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function setActiveModel(modelName: string): { success: boolean; error?: string } {
    if (typeof modelName !== "string" || !(modelName in UPSCALE_MODELS)) {
      return { success: false, error: "未知超分模型" };
    }
    state.activeModel = modelName as UpscaleModelId;
    writeConfig({ modelCacheDir: getModelCacheDir(), activeModel: state.activeModel });
    void scanModelInventory();
    return { success: true };
  }

  async function deleteModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (state.downloadStatus === "downloading" && state.downloadingModel === modelName) {
      return { success: false, error: "模型下载中，无法删除" };
    }
    const inventory = await scanModelInventory();
    const row = inventory.models.find((entry) => entry.modelName === modelName);
    if (!row || !row.downloaded || typeof row.cacheDir !== "string" || !path.isAbsolute(row.cacheDir)) {
      return { success: false, error: "模型未下载，无需删除" };
    }
    try {
      unlinkFileSync(row.cacheDir);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    await scanModelInventory();
    return { success: true };
  }

  const runFile = deps.execFile ?? execFileAsync;
  const now = deps.now ?? Date.now;

  function progressFile(): string {
    return path.join(getPaths().upscaleProfileDir, "download-progress.json");
  }

  function buildEnv(paths: UpscaleRuntimePaths): NodeJS.ProcessEnv {
    return buildUpscaleWorkerEnv(paths, deps.backendRoot, {
      MYSTUDIO_UPSCALE_MODEL_DIR: getModelCacheDir(),
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

  function status(): UpscaleRuntimeStatus {
    if (!state.modelCacheDir) state.modelCacheDir = getModelCacheDir();
    return { ...state };
  }

  async function scanModelInventory(): Promise<{ models: UpscaleInventoryRow[] }> {
    try {
      const { stdout } = await runPython(
        ["-m", "upscale.model_inventory"],
        30_000,
      );
      const parsed = JSON.parse(stdout) as {
        models?: Array<Record<string, unknown>>;
        cacheDir?: unknown;
      };
      const models: UpscaleInventoryRow[] = (Array.isArray(parsed.models) ? parsed.models : [])
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .map((row) => ({
          modelName: typeof row.modelName === "string" ? row.modelName : "",
          label: typeof row.label === "string" ? row.label : "",
          downloaded: row.downloaded === true,
          sizeMb: typeof row.sizeMb === "number" ? row.sizeMb : null,
          file: typeof row.file === "string" ? row.file : "",
          scale: typeof row.scale === "number" ? row.scale : 0,
          cacheDir: typeof row.cacheDir === "string" ? row.cacheDir : null,
        }));
      const primary = models.find((m) => m.modelName === state.activeModel);
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
      return { models };
    } catch {
      // Fail closed: a missing managed Python or broken profile means the
      // model cannot be considered downloaded.
      state.modelDownloaded = false;
      state.modelSizeMb = null;
      return { models: [] };
    }
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
        if (progress.status === "error") state.downloadingModel = undefined;
        await scanModelInventory();
      }
    }
  }

  async function setup(): Promise<UpscaleRuntimeStatus> {
    state.setupStage = "checking";
    state.setupProgress = undefined;
    state.setupMessage = "正在检查图片超分运行时…";

    const paths = getPaths();
    const probe = await probeUpscaleRuntime(paths);
    if (probe.state === "ready") {
      state.state = "ready";
      state.setupStage = "ready";
      state.setupProgress = 100;
      state.setupMessage = "图片超分运行时已就绪";
      await scanModelInventory();
      await refreshDownloadState();
      return status();
    }

    state.setupStage = "preparing-profile";
    state.setupProgress = 20;
    state.setupMessage = "正在安装图片超分依赖…";
    const prepare = await prepareUpscaleRuntime({
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
    state.setupMessage = "图片超分运行时已就绪";
    await scanModelInventory();
    return status();
  }

  async function rollback(): Promise<UpscaleRuntimeStatus> {
    const result = rollbackUpscaleRuntime(getPaths().storageBasePath);
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
      state.downloadingModel = undefined;
    }
    return status();
  }

  let downloadChild: ReturnType<typeof spawnDownload> | null = null;

  function spawnDownload(modelName: string) {
    const paths = getPaths();
    fs.mkdirSync(paths.upscaleProfileDir, { recursive: true });
    const child = spawn(
      paths.pythonExecutable,
      [
        "-m", "upscale.download_model",
        "--model", modelName,
        "--progress", progressFile(),
      ],
      {
        cwd: deps.backendRoot,
        env: buildEnv(paths),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      },
    );
    // 模型权重网络下载:失败证据进 logs/sidecars/upscale-*
    captureSidecarOutput({
      module: "upscale",
      child,
      label: `python -m upscale.download_model --model ${modelName}`,
    });
    return child;
  }

  async function downloadModel(modelName: string): Promise<{ accepted: boolean; message: string }> {
    if (typeof modelName !== "string" || !(modelName in UPSCALE_MODELS)) {
      return { accepted: false, message: "未知超分模型" };
    }
    if (state.downloadStatus === "downloading") {
      return { accepted: false, message: "超分模型正在下载中" };
    }
    const probe = await probeUpscaleRuntime(getPaths());
    if (probe.state !== "ready") {
      return {
        accepted: false,
        message: "图片超分运行时未就绪，请先完成运行时配置",
      };
    }

    state.downloadStatus = "downloading";
    state.downloadProgress = 0;
    state.downloadError = undefined;
    state.downloadingModel = modelName;

    downloadChild = spawnDownload(modelName);
    const child = downloadChild;
    child.on("exit", () => {
      if (downloadChild === child) downloadChild = null;
      state.downloadingModel = undefined;
      void refreshDownloadState();
    });
    child.on("error", (error) => {
      state.downloadStatus = "error";
      state.downloadError = error.message;
      state.downloadingModel = undefined;
      if (downloadChild === child) downloadChild = null;
    });
    return { accepted: true, message: "超分模型下载已开始" };
  }

  async function refresh(): Promise<UpscaleRuntimeStatus> {
    const probe = await probeUpscaleRuntime(getPaths());
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

  let runSequence = 0;
  // 串行闸:同一时刻只跑一个超分 worker(MPS/内存约束);并发请求按序排队,
  // 各自拿到自己的 artifact,不互相拒绝。
  let runChain: Promise<unknown> = Promise.resolve();

  function runUpscale(request: unknown): Promise<UpscaleRunResult> {
    const execute = () => runUpscaleNow(request);
    const next = runChain.then(execute, execute);
    runChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next as Promise<UpscaleRunResult>;
  }

  /**
   * Resolve one request media reference (project-relative path or
   * local-image:// URL) to an absolute, root-confined path.
   */
  function resolveMediaRef(projectId: string, ref: string): string | null {
    if (ref.startsWith("local-image://")) {
      return deps.resolveLocalMediaPath ? deps.resolveLocalMediaPath(ref) : null;
    }
    return deps.resolveProjectFilePath ? deps.resolveProjectFilePath(projectId, ref) : null;
  }

  /**
   * Execute one super-resolution worker run. The request carries project-
   * relative paths or local-image:// URLs; main resolves them with root
   * confinement before the worker sees anything. The request/artifact JSON
   * pair is staged in a per-run workspace under the profile dir; the output
   * image is written directly by the worker to the resolved output path.
   * Guards: resolution must stay inside its root, and the output must land
   * in the same directory as the input.
   */
  /**
   * 期望有效放大倍率:优先读输入/输出 PNG 头实测(output/input);读不出
   * (如 JPEG)回退模型倍率。snap_4k 收口后有效倍率必然小于模型倍率
   * (如 1672→3840 = 2.29),按模型倍率硬校验会误杀合法产物(08-30 实弹)。
   */
  function expectedEffectiveScale(inputPath: string, outputPath: string, modelScale: number): number {
    try {
      const inputSize = readPngSize(inputPath);
      const outputSize = readPngSize(outputPath);
      if (inputSize && outputSize && inputSize.width > 0) {
        return Math.round((outputSize.width / inputSize.width) * 100) / 100;
      }
    } catch {
      // 读头失败回退模型倍率
    }
    return modelScale;
  }

  function readPngSize(filePath: string): { width: number; height: number } | null {
    try {
      const fd = fs.openSync(filePath, "r");
      try {
        const header = Buffer.alloc(24);
        const bytes = fs.readSync(fd, header, 0, 24, 0);
        if (bytes >= 24 && header.readUInt32BE(0) === 0x89504e47) {
          return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function runUpscaleNow(request: unknown): Promise<UpscaleRunResult> {
    const validated = validateUpscaleRunRequest(request);
    if (!validated.success) {
      return {
        artifact: blockedUpscaleArtifact(
          {},
          "invalid-request",
          `超分请求无效: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
          UPSCALE_TOOL_VERSION,
        ),
      };
    }
    const value: UpscaleRunRequestV1 = validated.value;
    if (!deps.resolveProjectFilePath && !deps.resolveLocalMediaPath) {
      return {
        artifact: blockedUpscaleArtifact(value, "path-resolution-unavailable", "当前环境不支持媒体路径解析", UPSCALE_TOOL_VERSION),
      };
    }
    const inputAbsolute = resolveMediaRef(value.projectId, value.inputImagePath);
    const outputAbsolute = resolveMediaRef(value.projectId, value.outputImagePath);
    if (!inputAbsolute || !outputAbsolute) {
      return {
        artifact: blockedUpscaleArtifact(value, "path-outside-project", "超分路径无法在应用存储内解析", UPSCALE_TOOL_VERSION),
      };
    }
    if (path.dirname(inputAbsolute) !== path.dirname(outputAbsolute)) {
      return {
        artifact: blockedUpscaleArtifact(value, "output-outside-input-dir", "超分输出必须与输入位于同一目录", UPSCALE_TOOL_VERSION),
      };
    }

    const paths = getPaths();
    if (!fs.existsSync(paths.upscaleMarkerPath)) {
      return {
        artifact: blockedUpscaleArtifact(value, "runtime-not-ready", "图片超分运行时未就绪，请先在设置页准备运行时", UPSCALE_TOOL_VERSION),
      };
    }

    runSequence += 1;
    const workspace = path.join(paths.upscaleProfileDir, "runs", `${now()}-${runSequence}`);
    mkdirDir(workspace);
    const requestPath = path.join(workspace, "request.json");
    const artifactPath = path.join(workspace, "artifact.json");
    const workerRequest = {
      schemaVersion: value.schemaVersion,
      projectId: value.projectId,
      shotId: value.shotId ?? "unknown",
      model: value.model,
      inputImagePath: inputAbsolute,
      outputImagePath: outputAbsolute,
      ...(value.denoise ? { denoise: true } : {}),
    };
    fs.writeFileSync(requestPath, JSON.stringify(workerRequest, null, 2), "utf8");

    try {
      try {
        await runFile(paths.pythonExecutable, buildUpscaleWorkerArgs(requestPath, artifactPath), {
          cwd: deps.backendRoot,
          env: buildEnv(paths),
          timeout: 10 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch (error) {
        // Worker exits 2 with a persisted blocked artifact; surface it when
        // readable, otherwise synthesize a typed blocked artifact.
        if (!fs.existsSync(artifactPath)) {
          const detail = error instanceof Error ? error.message : String(error);
          return {
            artifact: blockedUpscaleArtifact(value, "worker-failed", `超分 worker 执行失败: ${detail}`, UPSCALE_TOOL_VERSION),
          };
        }
      }
      const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      const artifact = validateUpscaleArtifact(raw);
      if (!artifact.success) {
        return {
          artifact: blockedUpscaleArtifact(value, "invalid-artifact", "超分返回了无效的 artifact", UPSCALE_TOOL_VERSION),
        };
      }
      if (artifact.value.status === "accepted") {
        const accepted = artifact.value;
        const expectedShotId = value.shotId ?? "unknown";
        const resolvedOutput = path.resolve(outputAbsolute);
        const expectedScale = expectedEffectiveScale(inputAbsolute, resolvedOutput, UPSCALE_MODELS[value.model].scale);
        const artifactOutput = path.resolve(accepted.outputPath);
        let mismatch: string | undefined;
        if (accepted.projectId !== value.projectId) mismatch = "projectId 不匹配";
        else if (accepted.shotId !== expectedShotId) mismatch = "shotId 不匹配";
        else if (accepted.model !== value.model) mismatch = "model 不匹配";
        else if (accepted.method !== "super_res") mismatch = "method 不匹配";
        // scale 容差校验:Real-ESRGAN 对非标准尺寸输入可能产生 ±1% 的取整偏差
        // (如 1254→5016 实际 ratio 3.999...),精确等值会误杀合法产物
        else if (typeof accepted.scale !== "number" || Math.abs(accepted.scale - expectedScale) > expectedScale * 0.01) mismatch = "scale 不匹配";
        else if (artifactOutput !== resolvedOutput) mismatch = "outputPath 不匹配";
        else if (!fs.existsSync(resolvedOutput) || !fs.statSync(resolvedOutput).isFile()) mismatch = "输出文件不存在";
        else if (accepted.outputBytes !== fs.statSync(resolvedOutput).size) mismatch = "outputBytes 不匹配";
        else if (!fs.existsSync(inputAbsolute) || !fs.statSync(inputAbsolute).isFile()) mismatch = "输入文件不存在";
        else if (accepted.outputSha256 !== sha256File(resolvedOutput)) mismatch = "outputSha256 不匹配";
        else if (accepted.inputSha256 !== sha256File(inputAbsolute)) mismatch = "inputSha256 不匹配";
        if (mismatch) {
          return {
            artifact: blockedUpscaleArtifact(value, "artifact-output-mismatch", `超分 artifact 证据校验失败: ${mismatch}`, UPSCALE_TOOL_VERSION),
          };
        }
      }
      return { artifact: artifact.value };
    } finally {
      removeDirSync(workspace);
    }
  }

  return {
    status,
    setup,
    rollback,
    refresh,
    scanModelInventory,
    downloadModel,
    readDownloadProgress,
    runUpscale,
    setActiveModel,
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

export type UpscaleRuntimeController = ReturnType<typeof createUpscaleRuntimeController>;
