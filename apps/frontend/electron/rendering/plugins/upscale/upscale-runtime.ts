import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const UPSCALE_PROFILE_ID = "upscale-managed-python-v1" as const;
export const UPSCALE_TOOL_VERSION = "upscale@0.1.0" as const;

/** Lock file content for the image upscale sidecar. Reuses torch from TTS deps. */
export const UPSCALE_LOCK_CONTENT = [
  "# MYStudio image-upscale lock — reuses managed Python 3.12",
  "# Core inference deps (torch already in TTS requirements.txt)",
  "numpy>=1.24.0",
  "pillow>=10.0.0",
  "",
].join("\n");

export interface UpscaleRuntimePaths {
  storageBasePath: string;
  pythonRuntimeDir: string;
  pythonExecutable: string;
  upscaleProfileDir: string;
  upscaleLockPath: string;
  upscaleMarkerPath: string;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
}

export interface UpscaleRuntimeProbeResult {
  state: "ready" | "needs-runtime" | "blocked" | "error";
  paths: UpscaleRuntimePaths;
  missing: string[];
  message?: string;
}

export interface UpscaleRuntimeProbeDeps {
  fileExists?: (filePath: string) => boolean;
  execFile?: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout?: string; stderr?: string }>;
}

/**
 * Resolve image-upscale runtime paths from the shared storage base.
 * Reuses the same managed Python that TTS/depth/video-use provision.
 */
export function resolveUpscaleRuntimePaths(
  storageBasePath: string,
  platform: NodeJS.Platform = process.platform,
): UpscaleRuntimePaths {
  if (!path.isAbsolute(storageBasePath)) throw new Error(`storageBasePath 必须是绝对路径: ${storageBasePath}`);
  const pythonRuntimeDir = path.join(storageBasePath, "python");
  const pythonExecutable = platform === "win32"
    ? path.join(pythonRuntimeDir, "python.exe")
    : path.join(pythonRuntimeDir, "bin", "python3");
  const upscaleProfileDir = path.join(pythonRuntimeDir, "profiles", "upscale");
  return {
    storageBasePath,
    pythonRuntimeDir,
    pythonExecutable,
    upscaleProfileDir,
    upscaleLockPath: path.join(upscaleProfileDir, "requirements-upscale.lock"),
    upscaleMarkerPath: path.join(upscaleProfileDir, "profile.json"),
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
 * Probe the image-upscale runtime readiness.
 * Checks: managed Python 3.12 exists, profile marker present and valid,
 * lock file SHA-256 matches, import smoke passes.
 */
export async function probeUpscaleRuntime(
  paths: UpscaleRuntimePaths,
  deps: UpscaleRuntimeProbeDeps = {},
): Promise<UpscaleRuntimeProbeResult> {
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];

  if (!fileExists(paths.pythonExecutable)) {
    return {
      state: "needs-runtime",
      paths,
      missing: ["managed-python"],
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
      message: `图片超分必须复用 managed Python 3.12, 实际: ${pythonVersion ?? "unknown"}`,
    };
  }

  if (!fileExists(paths.upscaleMarkerPath)) {
    return {
      state: "needs-runtime",
      paths,
      missing: ["upscale-profile"],
      message: "请先在设置页准备图片超分运行时 profile",
    };
  }

  // Validate profile marker
  const marker = readJsonFile(paths.upscaleMarkerPath);
  if (!marker
    || marker.schemaVersion !== 1
    || marker.profileId !== UPSCALE_PROFILE_ID
    || marker.pythonExecutable !== paths.pythonExecutable
    || marker.lockPath !== paths.upscaleLockPath
    || typeof marker.lockSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(marker.lockSha256)
    || !fileExists(paths.upscaleLockPath)) {
    return {
      state: "blocked",
      paths,
      missing: ["upscale-profile-invalid"],
      message: "图片超分 profile marker、lock 或 managed Python 路径不一致",
    };
  }

  // Import smoke: numpy + PIL (torch comes from the shared TTS requirements)
  try {
    await run(paths.pythonExecutable, ["-c", "import numpy, PIL; print('ok')"], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: paths.upscaleProfileDir,
    });
  } catch {
    missing.push("import-smoke");
    return {
      state: "blocked",
      paths,
      missing,
      message: "图片超分依赖导入失败 (numpy, PIL)",
    };
  }

  return { state: "ready", paths, missing: [] };
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
 * Build the worker environment, mirroring the depth pattern.
 * PYTHONPATH points at the backend root so `upscale` is importable.
 */
export function buildUpscaleWorkerEnv(
  paths: UpscaleRuntimePaths,
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
 * Build the CLI args for invoking the upscale worker.
 */
export function buildUpscaleWorkerArgs(inputPath: string, outputPath: string): string[] {
  return ["-m", "upscale.worker", "--run", "--input", inputPath, "--output", outputPath];
}
