import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  UPSCALE_LOCK_CONTENT,
  UPSCALE_PROFILE_ID,
  UPSCALE_TOOL_VERSION,
  resolveUpscaleRuntimePaths,
  type UpscaleRuntimePaths,
  type UpscaleRuntimeProbeResult,
} from "./upscale-runtime";

const execFileAsync = promisify(execFile);

export interface UpscalePrepareOptions {
  storageBasePath: string | (() => string);
  backendRoot: string;
  fileExists?: (filePath: string) => boolean;
  mkdirSync?: (dirPath: string, opts?: { recursive: boolean }) => void;
  execFile?: (
    file: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout?: string; stderr?: string }>;
  now?: () => number;
}

export interface UpscalePrepareResult {
  state: "ready" | "blocked";
  message: string;
  profileDir: string;
}

/**
 * Prepare the image-upscale profile: write lock, pip install, verify imports,
 * write profile marker. Mirrors the depth prepare pattern (no tarball
 * download — the Python package lives in apps/backend/upscale/).
 */
export async function prepareUpscaleRuntime(options: UpscalePrepareOptions): Promise<UpscalePrepareResult> {
  const getStorageBase = typeof options.storageBasePath === "function"
    ? options.storageBasePath
    : () => options.storageBasePath as string;
  const storageBase = getStorageBase();
  const fileExists = options.fileExists ?? fs.existsSync;
  const mkdir = options.mkdirSync ?? fs.mkdirSync;
  const run = options.execFile ?? ((file, args, opts) => execFileAsync(file, args, opts));
  const now = options.now ?? Date.now;

  const paths = resolveUpscaleRuntimePaths(storageBase);

  // Verify managed Python exists
  if (!fileExists(paths.pythonExecutable)) {
    return {
      state: "blocked",
      message: "共享 Python 3.12 未安装，请先在设置页下载",
      profileDir: paths.upscaleProfileDir,
    };
  }

  // Create profile directory
  mkdir(paths.upscaleProfileDir, { recursive: true });

  // Write lock file
  fs.writeFileSync(paths.upscaleLockPath, UPSCALE_LOCK_CONTENT, "utf8");
  const lockSha256 = crypto.createHash("sha256").update(UPSCALE_LOCK_CONTENT).digest("hex");

  // pip install
  try {
    await run(paths.pythonExecutable, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-input",
      "--requirement", paths.upscaleLockPath,
    ], {
      cwd: paths.upscaleProfileDir,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "blocked",
      message: `pip install 失败: ${message}`,
      profileDir: paths.upscaleProfileDir,
    };
  }

  // Import smoke test
  try {
    await run(paths.pythonExecutable, ["-c", "import numpy, PIL; print('ok')"], {
      cwd: options.backendRoot,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "blocked",
      message: `依赖导入验证失败: ${message}`,
      profileDir: paths.upscaleProfileDir,
    };
  }

  // Write profile marker
  const marker = {
    schemaVersion: 1,
    profileId: UPSCALE_PROFILE_ID,
    pythonExecutable: paths.pythonExecutable,
    lockPath: paths.upscaleLockPath,
    lockSha256,
    toolVersion: UPSCALE_TOOL_VERSION,
    createdAt: now(),
    verifiedAt: now(),
  };
  const markerTemp = `${paths.upscaleMarkerPath}.${process.pid}.tmp`;
  fs.writeFileSync(markerTemp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  fs.renameSync(markerTemp, paths.upscaleMarkerPath);

  return {
    state: "ready",
    message: "图片超分运行时已准备就绪",
    profileDir: paths.upscaleProfileDir,
  };
}

/**
 * Rollback the upscale profile by removing the marker.
 */
export function rollbackUpscaleRuntime(
  storageBasePath: string,
  fileExists: (p: string) => boolean = fs.existsSync,
): { state: "ready" | "blocked"; message: string } {
  const paths = resolveUpscaleRuntimePaths(storageBasePath);
  if (!fileExists(paths.upscaleMarkerPath)) {
    return { state: "ready", message: "图片超分 profile 不存在，无需回滚" };
  }
  try {
    fs.unlinkSync(paths.upscaleMarkerPath);
    return { state: "ready", message: "图片超分 profile 已回滚" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "blocked", message: `回滚失败: ${message}` };
  }
}

export type { UpscaleRuntimePaths, UpscaleRuntimeProbeResult };
export { resolveUpscaleRuntimePaths, probeUpscaleRuntime, buildUpscaleWorkerEnv, buildUpscaleWorkerArgs } from "./upscale-runtime";
