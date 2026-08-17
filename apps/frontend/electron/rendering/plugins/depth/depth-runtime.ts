import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import type { DepthRuntimeProbeEvidenceV1 } from "@rendering/contracts/depth-workflow";

const execFileAsync = promisify(execFile);

export const DEPTH_PROFILE_ID = "depth-managed-python-v1" as const;
export const DEPTH_TOOL_VERSION = "depth-estimation@0.1.0" as const;

/** Lock file content for the depth estimation sidecar. Reuses torch + transformers from TTS deps. */
export const DEPTH_LOCK_CONTENT = [
  "# MYStudio depth-estimation lock — reuses managed Python 3.12",
  "# Core inference deps (torch/transformers already in TTS requirements.txt)",
  "numpy>=1.24.0",
  "pillow>=10.0.0",
  "",
].join("\n");

export interface DepthRuntimePaths {
  storageBasePath: string;
  pythonRuntimeDir: string;
  pythonExecutable: string;
  depthProfileDir: string;
  depthLockPath: string;
  depthMarkerPath: string;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
}

export interface DepthRuntimeProbeResult {
  state: "ready" | "needs-runtime" | "blocked" | "error";
  paths: DepthRuntimePaths;
  missing: string[];
  evidence: DepthRuntimeProbeEvidence;
  message?: string;
}

export type DepthRuntimeProbeEvidence = DepthRuntimeProbeEvidenceV1;

export interface DepthRuntimeProbeDeps {
  fileExists?: (filePath: string) => boolean;
  backendRoot?: string;
  env?: NodeJS.ProcessEnv;
  execFile?: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout?: string; stderr?: string }>;
}

/**
 * Resolve depth-estimation runtime paths from the shared storage base.
 * Reuses the same managed Python that TTS/video-use provision.
 */
export function resolveDepthRuntimePaths(
  storageBasePath: string,
  platform: NodeJS.Platform = process.platform,
): DepthRuntimePaths {
  if (!path.isAbsolute(storageBasePath)) throw new Error(`storageBasePath 必须是绝对路径: ${storageBasePath}`);
  const pythonRuntimeDir = path.join(storageBasePath, "python");
  const pythonExecutable = platform === "win32"
    ? path.join(pythonRuntimeDir, "python.exe")
    : path.join(pythonRuntimeDir, "bin", "python3");
  const depthProfileDir = path.join(pythonRuntimeDir, "profiles", "depth");
  return {
    storageBasePath,
    pythonRuntimeDir,
    pythonExecutable,
    depthProfileDir,
    depthLockPath: path.join(depthProfileDir, "requirements-depth.lock"),
    depthMarkerPath: path.join(depthProfileDir, "profile.json"),
    ffmpegExecutable: resolveSharedExecutable("MYSTUDIO_FFMPEG_PATH"),
    ffprobeExecutable: resolveSharedExecutable("MYSTUDIO_FFPROBE_PATH"),
  };
}

function resolveSharedExecutable(...environmentKeys: string[]): string {
  for (const environmentKey of environmentKeys) {
    const configured = process.env[environmentKey]?.trim() ?? "";
    if (path.isAbsolute(configured)) return configured;
  }
  return "";
}

/**
 * Probe the depth-estimation runtime readiness.
 * Checks: managed Python 3.12 exists, profile marker present and valid,
 * lock file SHA-256 matches, import smoke passes.
 */
export async function probeDepthRuntime(
  paths: DepthRuntimePaths,
  deps: DepthRuntimeProbeDeps = {},
): Promise<DepthRuntimeProbeResult> {
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];
  const baseEvidence: DepthRuntimeProbeEvidence = {
    pythonAvailable: fileExists(paths.pythonExecutable),
    workerProbe: "not-run",
  };

  if (!baseEvidence.pythonAvailable) {
    return {
      state: "needs-runtime",
      paths,
      missing: ["managed-python"],
      evidence: baseEvidence,
      message: "请先在设置页下载共享 Python 3.12 运行时",
    };
  }

  // Probe Python version
  let pythonVersion: string | undefined;
  try {
    const result = await run(paths.pythonExecutable, ["--version"], {
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    pythonVersion = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
  } catch {
    missing.push("python-probe");
  }

  if (!pythonVersion || !/^Python\s+3\.12\./.test(pythonVersion)) {
    return {
      state: "blocked",
      paths,
      missing: ["python-version"],
      evidence: { ...baseEvidence, pythonVersion },
      message: `深度估计必须复用 managed Python 3.12, 实际: ${pythonVersion ?? "unknown"}`,
    };
  }

  if (!fileExists(paths.depthMarkerPath)) {
    return {
      state: "needs-runtime",
      paths,
      missing: ["depth-profile"],
      evidence: { ...baseEvidence, pythonVersion },
      message: "请先在设置页准备深度估计运行时 profile",
    };
  }

  // Validate profile marker
  const marker = readJsonFile(paths.depthMarkerPath);
  const actualLockSha256 = fileExists(paths.depthLockPath)
    ? cryptoSha256(fs.readFileSync(paths.depthLockPath))
    : undefined;
  if (!marker
    || marker.schemaVersion !== 1
    || marker.profileId !== DEPTH_PROFILE_ID
    || marker.pythonExecutable !== paths.pythonExecutable
    || marker.lockPath !== paths.depthLockPath
    || typeof marker.lockSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(marker.lockSha256)
    || marker.lockSha256 !== actualLockSha256) {
    return {
      state: "blocked",
      paths,
      missing: ["depth-profile-invalid"],
      evidence: { ...baseEvidence, pythonVersion },
      message: "深度估计 profile marker、lock 或 managed Python 路径不一致",
    };
  }

  // Import smoke: numpy + PIL
  try {
    await run(paths.pythonExecutable, ["-c", "import numpy, PIL; print('ok')"], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: paths.depthProfileDir,
    });
  } catch {
    missing.push("import-smoke");
    return {
      state: "blocked",
      paths,
      missing,
      evidence: { ...baseEvidence, pythonVersion },
      message: "深度估计依赖导入失败 (numpy, PIL)",
    };
  }

  const worker = await probeWorker(paths, run, deps, pythonVersion);
  if (worker.state === "blocked") {
    return {
      state: "blocked",
      paths,
      missing: ["worker-probe"],
      evidence: worker.evidence,
      message: worker.message,
    };
  }

  return { state: "ready", paths, missing: [], evidence: worker.evidence };
}

function cryptoSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function probeWorker(
  paths: DepthRuntimePaths,
  run: NonNullable<DepthRuntimeProbeDeps["execFile"]>,
  deps: DepthRuntimeProbeDeps,
  pythonVersion: string,
): Promise<{ state: "ready" | "blocked"; evidence: DepthRuntimeProbeEvidence; message?: string }> {
  const backendRoot = deps.backendRoot ?? process.cwd();
  const evidence: DepthRuntimeProbeEvidence = {
    pythonAvailable: true,
    pythonVersion,
    workerProbe: "blocked",
  };
  try {
    const result = await run(paths.pythonExecutable, ["-m", "depth_estimation.worker", "--probe"], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: backendRoot,
      env: deps.env ?? buildDepthWorkerEnv(paths, backendRoot),
    });
    const parsed = JSON.parse(result.stdout ?? "") as unknown;
    if (!isRecord(parsed) || typeof parsed.toolVersion !== "string" || !isRecord(parsed.model)) {
      return { state: "blocked", evidence, message: "深度估计 worker probe 返回无效" };
    }
    const workerToolVersion = parsed.toolVersion;
    if (parsed.status === "ready") {
      const weightSha = parsed.model.weightSha256;
      if (typeof weightSha !== "string" || !/^[a-f0-9]{64}$/.test(weightSha)) {
        return {
          state: "blocked",
          evidence: { ...evidence, workerToolVersion },
          message: "深度估计 worker 未返回有效的模型权重 SHA-256",
        };
      }
      return {
        state: "ready",
        evidence: {
          pythonAvailable: true,
          pythonVersion,
          workerProbe: "ready",
          workerToolVersion,
          modelWeightSha256: weightSha,
        },
      };
    }
    if (parsed.status === "blocked" && parsed.model.code === "model-not-downloaded") {
      return {
        state: "ready",
        evidence: {
          pythonAvailable: true,
          pythonVersion,
          workerProbe: "model-not-downloaded",
          workerToolVersion,
        },
      };
    }
    const message = typeof parsed.model.message === "string"
      ? parsed.model.message
      : "深度估计 worker probe 未就绪";
    return { state: "blocked", evidence: { ...evidence, workerToolVersion }, message };
  } catch (error) {
    return {
      state: "blocked",
      evidence,
      message: `深度估计 worker probe 失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Build the worker environment, mirroring the video-use pattern.
 * PYTHONPATH points at the backend root so `depth_estimation` is importable.
 */
export function buildDepthWorkerEnv(
  paths: DepthRuntimePaths,
  backendRoot: string,
  extra: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const toolDirectories = [paths.ffmpegExecutable, paths.ffprobeExecutable]
    .filter((value) => path.isAbsolute(value))
    .map((value) => path.dirname(value));
  return {
    ...process.env,
    ...extra,
    MYSTUDIO_FFMPEG_PATH: paths.ffmpegExecutable,
    MYSTUDIO_FFPROBE_PATH: paths.ffprobeExecutable,
    PYTHONPATH: [backendRoot, process.env.PYTHONPATH ?? ""].filter(Boolean).join(path.delimiter),
    PATH: [...toolDirectories, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

/**
 * Build the CLI args for invoking the depth worker.
 */
export function buildDepthWorkerArgs(inputPath: string, outputPath: string): string[] {
  return ["-m", "depth_estimation.worker", "--run", "--input", inputPath, "--output", outputPath];
}
