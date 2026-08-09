import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  validateHyperFramesOverlayArtifact,
  validateHyperFramesOverlayRequest,
  type HyperFramesOverlayArtifactV1,
  type HyperFramesOverlayRequestV1,
} from "@rendering/contracts/video-workflow";
import {
  buildSharedToolchainEnv,
  probeHyperFramesRuntime,
  resolveVideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimeProbeResult,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";
import { writeVideoWorkflowJson } from "@rendering/plugins/video-workflow/video-workflow-artifact-store";

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
    toolVersion: "hyperframes@0.7.101/no-op",
    generatedAt: now,
  };
}

export function createHyperFramesAdapter(options: HyperFramesAdapterOptions) {
  const getPaths = () => resolveVideoWorkflowRuntimePaths(
    typeof options.storageBasePath === "function" ? options.storageBasePath() : options.storageBasePath,
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
    if (runtime.state !== "ready") return { state: "blocked", message: runtime.message ?? "HyperFrames Node 22/浏览器/FFmpeg 运行时未就绪", runtime };
    if (!options.workerPath || !path.isAbsolute(options.workerPath) || !fs.existsSync(options.workerPath)) {
      return { state: "blocked", message: "HyperFrames worker 未随应用准备，拒绝静默跳过", runtime };
    }
    return { state: "ready", message: "HyperFrames worker 已准备", runtime };
  }

  async function renderOverlay(request: HyperFramesOverlayRequestV1): Promise<HyperFramesAdapterResult> {
    const validatedRequest = validateHyperFramesOverlayRequest(request);
    if (!validatedRequest.success) return { state: "blocked", code: "invalid-request", message: validatedRequest.issues.map((item) => `${item.path}: ${item.message}`).join("; ") };
    const safeProjectId = safeSegment(request.projectId, "projectId");
    const safeChapterId = safeSegment(request.chapterId, "chapterId");
    const revisionDir = path.join(options.workspaceRootForProject(safeProjectId), safeChapterId, `r${request.revision}`);
    const artifactPath = path.join(revisionDir, "hyperframes-artifact.json");
    if (request.windows.length === 0) {
      const artifact = createNoopArtifact(request, now());
      try {
        writeVideoWorkflowJson(artifactPath, artifact);
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
    if (runtime.state !== "ready") return { state: "blocked", code: "runtime-not-ready", message: runtime.message ?? "HyperFrames Node 22/浏览器/FFmpeg 运行时未就绪" };
    if (!options.workerPath || !path.isAbsolute(options.workerPath) || !fs.existsSync(options.workerPath)) {
      return { state: "blocked", code: "worker-missing", message: "HyperFrames worker 未随应用准备，拒绝静默跳过" };
    }
    if (!browserPath || !path.isAbsolute(browserPath) || !fs.existsSync(browserPath)) {
      return { state: "blocked", code: "browser-path-missing", message: "HyperFrames 缺少已验证浏览器路径，拒绝隐式 browser ensure" };
    }
    const requestPath = path.join(revisionDir, "hyperframes-request.json");
    try {
      fs.mkdirSync(revisionDir, { recursive: true });
      fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
      await runFile(paths.nodeExecutable, buildHyperFramesWorkerArgs(options.workerPath, requestPath, artifactPath), {
        cwd: paths.hyperFramesProfileDir,
        env: buildSharedToolchainEnv(paths, {
          MYSTUDIO_HYPERFRAMES_WORKER: "1",
          MYSTUDIO_HYPERFRAMES_PROFILE_DIR: paths.hyperFramesProfileDir,
          MYSTUDIO_HYPERFRAMES_CLI: paths.hyperFramesCliPath,
          MYSTUDIO_HYPERFRAMES_NODE: paths.nodeExecutable,
          HYPERFRAMES_BROWSER_PATH: browserPath,
          PRODUCER_HEADLESS_SHELL_PATH: browserPath,
          PATH: [path.dirname(paths.nodeExecutable), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
        }),
        timeout: 30 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
      const artifact = validateHyperFramesOverlayArtifact(parsed);
      if (!artifact.success) return { state: "blocked", code: "artifact-invalid", message: artifact.issues.map((item) => `${item.path}: ${item.message}`).join("; "), artifactPath };
      if (artifact.value.status !== "accepted") return { state: "blocked", code: "artifact-not-accepted", message: "HyperFrames worker 未返回 accepted artifact", artifactPath };
      return { state: "ready", artifact: artifact.value, artifactPath };
    } catch (error) {
      return { state: "blocked", code: "worker-failed", message: `HyperFrames worker 执行失败: ${errorMessage(error)}`, artifactPath };
    }
  }

  return { get paths() { return getPaths(); }, probe, renderOverlay };
}
