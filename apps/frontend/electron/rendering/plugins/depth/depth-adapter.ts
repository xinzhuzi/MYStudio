import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  validateDepthEstimationArtifact,
  validateDepthEstimationRequest,
  blockedDepthArtifact,
  type DepthEstimationArtifactV1,
  type DepthEstimationRequestV1,
} from "@rendering/contracts/depth-workflow";
import {
  buildDepthWorkerArgs,
  buildDepthWorkerEnv,
  probeDepthRuntime,
  resolveDepthRuntimePaths,
  DEPTH_TOOL_VERSION,
  type DepthRuntimePaths,
  type DepthRuntimeProbeResult,
} from "./depth-runtime";

const execFileAsync = promisify(execFile);

export type DepthAdapterResult =
  | { state: "ready"; artifact: DepthEstimationArtifactV1; artifactPath?: string }
  | { state: "blocked"; code: string; message: string; artifactPath?: string };

export interface DepthProbeResult {
  state: "ready" | "blocked" | "error";
  message: string;
  runtime: DepthRuntimeProbeResult;
}

export interface DepthAdapterOptions {
  storageBasePath: string | (() => string);
  backendRoot: string;
  probeRuntime?: (paths: DepthRuntimePaths) => Promise<DepthRuntimeProbeResult>;
  execFile?: (
    file: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout?: string; stderr?: string }>;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`${field} 不能包含路径分隔符或目录跳转`);
  }
  return value;
}

export function createDepthAdapter(options: DepthAdapterOptions) {
  const getPaths = () => resolveDepthRuntimePaths(
    typeof options.storageBasePath === "function" ? options.storageBasePath() : options.storageBasePath,
  );
  const runFile = options.execFile ?? execFileAsync;

  async function probe(): Promise<DepthProbeResult> {
    const paths = getPaths();
    const runtime = options.probeRuntime
      ? await options.probeRuntime(paths)
      : await probeDepthRuntime(paths);
    if (runtime.state !== "ready") {
      return {
        state: "blocked",
        message: runtime.message ?? "深度估计运行时未就绪",
        runtime,
      };
    }
    return { state: "ready", message: "深度估计运行时已就绪", runtime };
  }

  async function estimateDepth(request: DepthEstimationRequestV1): Promise<DepthAdapterResult> {
    const validated = validateDepthEstimationRequest(request);
    if (!validated.success) {
      return {
        state: "blocked",
        code: "invalid-request",
        message: validated.issues.map((item) => `${item.path}: ${item.message}`).join("; "),
      };
    }

    const safeProjectId = safeSegment(request.projectId, "projectId");
    const safeShotId = safeSegment(request.shotId, "shotId");

    const paths = getPaths();
    const workspaceDir = path.join(
      paths.storageBasePath,
      "projects",
      "_p",
      safeProjectId,
      "remotion",
      "depth",
      safeShotId,
    );
    const requestPath = path.join(workspaceDir, "depth-request.json");
    const artifactPath = path.join(workspaceDir, "depth-artifact.json");

    // Check runtime readiness
    const runtime = options.probeRuntime
      ? await options.probeRuntime(paths)
      : await probeDepthRuntime(paths);
    if (runtime.state !== "ready") {
      return {
        state: "blocked",
        code: "runtime-not-ready",
        message: runtime.message ?? "深度估计运行时未就绪",
        artifactPath,
      };
    }

    try {
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");

      await runFile(
        paths.pythonExecutable,
        buildDepthWorkerArgs(requestPath, artifactPath),
        {
          cwd: options.backendRoot,
          env: buildDepthWorkerEnv(paths, options.backendRoot),
          timeout: 10 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );

      if (!fs.existsSync(artifactPath)) {
        const artifact = blockedDepthArtifact(request, "artifact-missing", "worker 未生成 artifact", DEPTH_TOOL_VERSION);
        writeArtifact(artifactPath, artifact);
        return { state: "blocked", code: "artifact-missing", message: "深度估计 worker 未生成 artifact", artifactPath };
      }

      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
      const artifact = validateDepthEstimationArtifact(parsed);
      if (!artifact.success) {
        return {
          state: "blocked",
          code: "artifact-invalid",
          message: artifact.issues.map((item) => `${item.path}: ${item.message}`).join("; "),
          artifactPath,
        };
      }
      if (artifact.value.status !== "accepted") {
        return {
          state: "blocked",
          code: "artifact-not-accepted",
          message: artifact.value.message ?? "深度估计 worker 未返回 accepted",
          artifactPath,
        };
      }

      return { state: "ready", artifact: artifact.value, artifactPath };
    } catch (error) {
      const artifact = blockedDepthArtifact(request, "worker-failed", errorMessage(error), DEPTH_TOOL_VERSION);
      try { writeArtifact(artifactPath, artifact); } catch { /* best-effort */ }
      return {
        state: "blocked",
        code: "worker-failed",
        message: `深度估计 worker 执行失败: ${errorMessage(error)}`,
        artifactPath,
      };
    }
  }

  return { get paths() { return getPaths(); }, probe, estimateDepth };
}

function writeArtifact(artifactPath: string, artifact: DepthEstimationArtifactV1): void {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, artifactPath);
}
