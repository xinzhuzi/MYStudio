import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  validateHyperFramesOverlayArtifact,
  validateHyperFramesOverlayRequest,
  type HyperFramesOverlayArtifactV1,
  type HyperFramesOverlayRequestV1,
} from "@rendering/contracts/video-workflow";
import {
  HYPERFRAMES_NPM_VERSION,
  buildSharedToolchainEnv,
  probeHyperFramesRuntime,
  resolveVideoWorkflowRuntimePaths,
  sha256File,
  type VideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimeProbeResult,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { writeVideoWorkflowJson } from "@rendering/plugins/video-workflow/video-workflow-artifact-store";
import { rejectSymlinkComponentsUnderRoot } from "@rendering/plugins/remotion/manifest/remotion-audio-source-verification";

const execFileAsync = promisify(execFile);

type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

export type HyperFramesAdapterResult =
  | { state: "ready"; artifact: HyperFramesOverlayArtifactV1; artifactPath?: string }
  | { state: "blocked" | "error"; code: string; message: string; artifactPath?: string };

export interface HyperFramesProbeResult {
  state: "ready" | "blocked" | "error";
  message: string;
  runtime: VideoWorkflowRuntimeProbeResult;
}

export interface HyperFramesAdapterOptions {
  storageBasePath: string | (() => string);
  /** Explicit Electron runtime for non-Electron hosts such as build runners. */
  electronExecutable?: string | (() => string);
  workspaceRootForProject: (projectId: string) => string;
  workerPath?: string;
  probeRuntime?: (paths: VideoWorkflowRuntimePaths) => Promise<VideoWorkflowRuntimeProbeResult>;
  resolveBrowserPath?: () => Promise<string | undefined>;
  execFile?: ExecFileLike;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") throw new Error(`${field} 不能包含路径分隔符或目录跳转`);
  return value;
}

function verifyAcceptedArtifactBinding(
  artifact: HyperFramesOverlayArtifactV1,
  request: HyperFramesOverlayRequestV1,
): { code: "artifact-identity-mismatch" | "artifact-output-invalid"; message: string } | undefined {
  if (artifact.projectId !== request.projectId
    || artifact.chapterId !== request.chapterId
    || artifact.revision !== request.revision
    || artifact.sourceArtifactSha256 !== request.sourceArtifactSha256
    || artifact.inputSha256 !== request.inputSha256
    || artifact.alphaFormat !== request.alphaFormat
    || !isDeepStrictEqual(artifact.windows, request.windows)) {
    return { code: "artifact-identity-mismatch", message: "HyperFrames artifact identity/windows 与本次请求不一致" };
  }
  if (!artifact.outputPath || !path.isAbsolute(artifact.outputPath) || artifact.outputPath !== request.outputPath) {
    return { code: "artifact-output-invalid", message: "HyperFrames artifact 输出路径与本次请求不一致" };
  }
  try {
    const stat = fs.lstatSync(artifact.outputPath);
    if (!stat.isFile() || stat.size <= 0 || sha256File(artifact.outputPath) !== artifact.outputSha256) {
      return { code: "artifact-output-invalid", message: "HyperFrames artifact 输出文件或 SHA-256 无效" };
    }
  } catch (error) {
    return { code: "artifact-output-invalid", message: `HyperFrames artifact 输出验证失败: ${errorMessage(error)}` };
  }
  return undefined;
}

export function buildHyperFramesWorkerArgs(workerPath: string, requestPath: string, outputPath: string): string[] {
  return [workerPath, "--request", requestPath, "--output", outputPath];
}

function createNoopArtifact(request: HyperFramesOverlayRequestV1, now: number): HyperFramesOverlayArtifactV1 {
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    chapterId: request.chapterId,
    revision: request.revision,
    status: "noop",
    sourceArtifactSha256: request.sourceArtifactSha256,
    inputSha256: request.inputSha256,
    alphaFormat: request.alphaFormat,
    windows: [],
    toolVersion: `hyperframes@${HYPERFRAMES_NPM_VERSION}/no-op`,
    generatedAt: now,
  };
}

export function createHyperFramesAdapter(options: HyperFramesAdapterOptions) {
  const getPaths = () => resolveVideoWorkflowRuntimePaths(
    typeof options.storageBasePath === "function" ? options.storageBasePath() : options.storageBasePath,
    process.platform,
    typeof options.electronExecutable === "function"
      ? options.electronExecutable()
      : options.electronExecutable ?? process.execPath,
  );
  const resolveBrowserPath = options.resolveBrowserPath ?? (async () => undefined);
  const probeRuntime = options.probeRuntime ?? ((runtimePaths) => probeHyperFramesRuntime(runtimePaths, {}, { browserPath: runtimePaths.hyperFramesBrowserPath }));
  const runFile = options.execFile ?? execFileAsync;
  const now = options.now ?? Date.now;

  async function probe(): Promise<HyperFramesProbeResult> {
    const paths = getPaths();
    const browserPath = await resolveBrowserPath();
    const runtime = options.probeRuntime
      ? await probeRuntime(paths)
      : await probeHyperFramesRuntime(paths, {}, { browserPath });
    if (runtime.state !== "ready") return { state: "blocked", message: runtime.message ?? "HyperFrames Electron Node/浏览器/FFmpeg 运行时未就绪", runtime };
    if (!options.workerPath || !path.isAbsolute(options.workerPath) || !fs.existsSync(options.workerPath)) {
      return { state: "blocked", message: "HyperFrames worker 未随应用准备，拒绝静默跳过", runtime };
    }
    return { state: "ready", message: "HyperFrames worker 已准备", runtime };
  }

  async function renderOverlay(request: HyperFramesOverlayRequestV1): Promise<HyperFramesAdapterResult> {
    const validatedRequest = validateHyperFramesOverlayRequest(request);
    if (!validatedRequest.success) return { state: "blocked", code: "invalid-request", message: validatedRequest.issues.map((item) => `${item.path}: ${item.message}`).join("; ") };
    let normalizedRequest: HyperFramesOverlayRequestV1;
    try {
      const normalized = validateHyperFramesOverlayRequest(JSON.parse(JSON.stringify(validatedRequest.value)) as unknown);
      if (!normalized.success) return { state: "blocked", code: "invalid-request", message: normalized.issues.map((item) => `${item.path}: ${item.message}`).join("; ") };
      normalizedRequest = normalized.value;
    } catch (error) {
      return { state: "blocked", code: "invalid-request", message: `HyperFrames request 无法规范化为 JSON: ${errorMessage(error)}` };
    }
    let safeProjectId: string;
    let safeChapterId: string;
    try {
      safeProjectId = safeSegment(normalizedRequest.projectId, "projectId");
      safeChapterId = safeSegment(normalizedRequest.chapterId, "chapterId");
    } catch (error) {
      return { state: "blocked", code: "invalid-request", message: errorMessage(error) };
    }
    const workspaceRoot = options.workspaceRootForProject(safeProjectId);
    if (!path.isAbsolute(workspaceRoot)) return { state: "blocked", code: "workspace-root-invalid", message: "HyperFrames workspaceRoot 必须是绝对路径" };
    const revisionDir = path.join(workspaceRoot, safeChapterId, `r${normalizedRequest.revision}`);
    const extension = normalizedRequest.alphaFormat === "prores-4444-mov" ? "mov" : "webm";
    const managedOutputPath = path.join(revisionDir, `hyperframes-overlay.${extension}`);
    if (!path.isAbsolute(normalizedRequest.outputPath) || normalizedRequest.outputPath !== managedOutputPath) {
      return { state: "blocked", code: "output-path-invalid", message: "HyperFrames outputPath 必须是当前受管章节 revision 输出" };
    }
    const artifactPath = path.join(revisionDir, "hyperframes-artifact.json");
    if (normalizedRequest.windows.length === 0) {
      const artifact = createNoopArtifact(normalizedRequest, now());
      try {
        await rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath);
        fs.mkdirSync(revisionDir, { recursive: true });
        await rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath);
        writeVideoWorkflowJson(artifactPath, artifact);
        await rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath);
        return { state: "ready", artifact, artifactPath };
      } catch (error) {
        return { state: "blocked", code: "artifact-write-failed", message: `HyperFrames no-op artifact 写入失败: ${errorMessage(error)}`, artifactPath };
      }
    }
    const paths = getPaths();
    const browserPath = await resolveBrowserPath();
    const runtime = options.probeRuntime
      ? await probeRuntime(paths)
      : await probeHyperFramesRuntime(paths, {}, { browserPath });
    if (runtime.state !== "ready") return { state: "blocked", code: "runtime-not-ready", message: runtime.message ?? "HyperFrames Electron Node/浏览器/FFmpeg 运行时未就绪" };
    if (!options.workerPath || !path.isAbsolute(options.workerPath) || !fs.existsSync(options.workerPath)) {
      return { state: "blocked", code: "worker-missing", message: "HyperFrames worker 未随应用准备，拒绝静默跳过" };
    }
    if (!browserPath || !path.isAbsolute(browserPath) || !fs.existsSync(browserPath)) {
      return { state: "blocked", code: "browser-path-missing", message: "HyperFrames 缺少已验证浏览器路径，拒绝隐式 browser ensure" };
    }
    const requestPath = path.join(revisionDir, "hyperframes-request.json");
    try {
      await Promise.all([
        rejectSymlinkComponentsUnderRoot(workspaceRoot, requestPath),
        rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath),
        rejectSymlinkComponentsUnderRoot(workspaceRoot, managedOutputPath),
      ]);
      fs.mkdirSync(revisionDir, { recursive: true });
      await Promise.all([
        rejectSymlinkComponentsUnderRoot(workspaceRoot, requestPath),
        rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath),
        rejectSymlinkComponentsUnderRoot(workspaceRoot, managedOutputPath),
      ]);
      writeVideoWorkflowJson(requestPath, normalizedRequest);
      await runFile(paths.electronExecutable, buildHyperFramesWorkerArgs(options.workerPath, requestPath, artifactPath), {
        cwd: paths.hyperFramesProfileDir,
        env: buildSharedToolchainEnv(paths, {
          ELECTRON_RUN_AS_NODE: "1",
          MYSTUDIO_HYPERFRAMES_WORKER: "1",
          MYSTUDIO_HYPERFRAMES_PROFILE_DIR: paths.hyperFramesProfileDir,
          MYSTUDIO_HYPERFRAMES_CLI: paths.hyperFramesCliPath,
          MYSTUDIO_HYPERFRAMES_NODE: paths.electronExecutable,
          HYPERFRAMES_BROWSER_PATH: browserPath,
          PRODUCER_HEADLESS_SHELL_PATH: browserPath,
        }),
        timeout: 30 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      await Promise.all([
        rejectSymlinkComponentsUnderRoot(workspaceRoot, artifactPath),
        rejectSymlinkComponentsUnderRoot(workspaceRoot, managedOutputPath),
      ]);
      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
      const artifact = validateHyperFramesOverlayArtifact(parsed);
      if (!artifact.success) return { state: "blocked", code: "artifact-invalid", message: artifact.issues.map((item) => `${item.path}: ${item.message}`).join("; "), artifactPath };
      if (artifact.value.status !== "accepted") return { state: "blocked", code: "artifact-not-accepted", message: "HyperFrames worker 未返回 accepted artifact", artifactPath };
      const bindingIssue = verifyAcceptedArtifactBinding(artifact.value, normalizedRequest);
      if (bindingIssue) return { state: "blocked", ...bindingIssue, artifactPath };
      return { state: "ready", artifact: artifact.value, artifactPath };
    } catch (error) {
      return { state: "blocked", code: "worker-failed", message: `HyperFrames worker 执行失败: ${errorMessage(error)}`, artifactPath };
    }
  }

  return { get paths() { return getPaths(); }, probe, renderOverlay };
}
