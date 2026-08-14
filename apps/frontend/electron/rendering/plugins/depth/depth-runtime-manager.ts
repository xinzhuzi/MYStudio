import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  DEPTH_LOCK_CONTENT,
  DEPTH_PROFILE_ID,
  DEPTH_TOOL_VERSION,
  resolveDepthRuntimePaths,
  type DepthRuntimePaths,
  type DepthRuntimeProbeResult,
} from "./depth-runtime";

const execFileAsync = promisify(execFile);

export interface DepthPrepareOptions {
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

export interface DepthPrepareResult {
  state: "ready" | "blocked";
  message: string;
  profileDir: string;
}

/**
 * Prepare the depth-estimation profile: write lock, pip install, verify imports,
 * write profile marker. Mirrors the video-use prepare pattern but simpler (no
 * tarball download — the Python package lives in apps/backend/depth_estimation/).
 */
export async function prepareDepthRuntime(options: DepthPrepareOptions): Promise<DepthPrepareResult> {
  const getStorageBase = typeof options.storageBasePath === "function"
    ? options.storageBasePath
    : () => options.storageBasePath as string;
  const storageBase = getStorageBase();
  const fileExists = options.fileExists ?? fs.existsSync;
  const mkdir = options.mkdirSync ?? fs.mkdirSync;
  const run = options.execFile ?? ((file, args, opts) => execFileAsync(file, args, opts));
  const now = options.now ?? Date.now;

  const { resolveDepthRuntimePaths } = await import("./depth-runtime");
  const paths = resolveDepthRuntimePaths(storageBase);

  // Verify managed Python exists
  if (!fileExists(paths.pythonExecutable)) {
    return {
      state: "blocked",
      message: "共享 Python 3.12 未安装，请先在设置页下载",
      profileDir: paths.depthProfileDir,
    };
  }

  // Create profile directory
  mkdir(paths.depthProfileDir, { recursive: true });

  // Write lock file
  fs.writeFileSync(paths.depthLockPath, DEPTH_LOCK_CONTENT, "utf8");
  const lockSha256 = crypto.createHash("sha256").update(DEPTH_LOCK_CONTENT).digest("hex");

  // pip install
  try {
    await run(paths.pythonExecutable, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-input",
      "--requirement", paths.depthLockPath,
    ], {
      cwd: paths.depthProfileDir,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "blocked",
      message: `pip install 失败: ${message}`,
      profileDir: paths.depthProfileDir,
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
      profileDir: paths.depthProfileDir,
    };
  }

  // Write profile marker
  const marker = {
    schemaVersion: 1,
    profileId: DEPTH_PROFILE_ID,
    pythonExecutable: paths.pythonExecutable,
    lockPath: paths.depthLockPath,
    lockSha256,
    toolVersion: DEPTH_TOOL_VERSION,
    createdAt: now(),
    verifiedAt: now(),
  };
  const markerTemp = `${paths.depthMarkerPath}.${process.pid}.tmp`;
  fs.writeFileSync(markerTemp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  fs.renameSync(markerTemp, paths.depthMarkerPath);

  return {
    state: "ready",
    message: "深度估计运行时已准备就绪",
    profileDir: paths.depthProfileDir,
  };
}

/**
 * Rollback the depth profile by removing the marker.
 */
export function rollbackDepthRuntime(
  storageBasePath: string,
  fileExists: (p: string) => boolean = fs.existsSync,
): { state: "ready" | "blocked"; message: string } {
  const paths = resolveDepthRuntimePaths(storageBasePath);
  if (!fileExists(paths.depthMarkerPath)) {
    return { state: "ready", message: "深度估计 profile 不存在，无需回滚" };
  }
  try {
    fs.unlinkSync(paths.depthMarkerPath);
    return { state: "ready", message: "深度估计 profile 已回滚" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "blocked", message: `回滚失败: ${message}` };
  }
}

export type { DepthRuntimePaths, DepthRuntimeProbeResult };
export { resolveDepthRuntimePaths, probeDepthRuntime, buildDepthWorkerEnv, buildDepthWorkerArgs } from "./depth-runtime";
