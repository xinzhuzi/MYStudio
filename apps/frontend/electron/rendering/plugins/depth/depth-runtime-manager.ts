import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  DEPTH_LOCK_CONTENT,
  DEPTH_PROFILE_ID,
  DEPTH_TOOL_VERSION,
  buildDepthWorkerEnv,
  probeDepthRuntime,
  resolveDepthRuntimePaths,
  type DepthRuntimePaths,
  type DepthRuntimeProbeEvidence,
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
  modelCacheDir?: string;
}

export interface DepthPrepareResult {
  state: "ready" | "blocked";
  message: string;
  profileDir: string;
  probeEvidence?: DepthRuntimeProbeEvidence;
}

function removeOwnPath(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function promoteStaging(targetPath: string, stagingPath: string): string | undefined {
  const previousPath = `${targetPath}.previous`;
  const hadTarget = fs.existsSync(targetPath);
  if (fs.existsSync(previousPath)) {
    fs.renameSync(previousPath, `${previousPath}.stale-${Date.now()}`);
  }
  if (hadTarget) fs.renameSync(targetPath, previousPath);
  try {
    fs.renameSync(stagingPath, targetPath);
    return hadTarget ? previousPath : undefined;
  } catch (error) {
    if (hadTarget && fs.existsSync(previousPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(previousPath, targetPath);
    }
    throw error;
  }
}

function restorePromotedTarget(targetPath: string, previousPath: string | undefined): void {
  removeOwnPath(targetPath);
  if (previousPath && fs.existsSync(previousPath)) fs.renameSync(previousPath, targetPath);
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

  const stagingPath = `${paths.depthProfileDir}.staging-${crypto.randomUUID()}`;
  const stagingLockPath = path.join(stagingPath, path.basename(paths.depthLockPath));
  const stagingMarkerPath = path.join(stagingPath, path.basename(paths.depthMarkerPath));
  mkdir(stagingPath, { recursive: true });
  fs.writeFileSync(stagingLockPath, DEPTH_LOCK_CONTENT, "utf8");
  const lockSha256 = crypto.createHash("sha256").update(DEPTH_LOCK_CONTENT).digest("hex");
  let verifiedEvidence: DepthRuntimeProbeEvidence | undefined;

  try {
    await run(paths.pythonExecutable, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-input",
      "--requirement", stagingLockPath,
    ], {
      cwd: stagingPath,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await run(paths.pythonExecutable, ["-c", "import numpy, PIL; print('ok')"], {
      cwd: options.backendRoot,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
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
    fs.writeFileSync(stagingMarkerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const previousPath = promoteStaging(paths.depthProfileDir, stagingPath);
    const probe = await probeDepthRuntime(paths, {
      backendRoot: options.backendRoot,
      execFile: run,
      env: buildDepthWorkerEnv(paths, options.backendRoot, {
        ...(options.modelCacheDir ? { MYSTUDIO_DEPTH_MODEL_DIR: options.modelCacheDir } : {}),
      }),
    });
    if (probe.state !== "ready") {
      restorePromotedTarget(paths.depthProfileDir, previousPath);
      return {
        state: "blocked",
        message: probe.message ?? "深度估计运行时验证失败",
        profileDir: paths.depthProfileDir,
        probeEvidence: probe.evidence,
      };
    }
    verifiedEvidence = probe.evidence;
  } catch (error) {
    removeOwnPath(stagingPath);
    return {
      state: "blocked",
      message: `深度估计运行时准备失败: ${error instanceof Error ? error.message : String(error)}`,
      profileDir: paths.depthProfileDir,
    };
  }

  return {
    state: "ready",
    message: "深度估计运行时已准备就绪",
    profileDir: paths.depthProfileDir,
    probeEvidence: verifiedEvidence,
  };
}

/**
 * Rollback the active depth profile, restoring the previous verified profile
 * when one exists. The displaced profile is retained for recovery.
 */
export function rollbackDepthRuntime(
  storageBasePath: string,
  fileExists: (p: string) => boolean = fs.existsSync,
): { state: "ready" | "blocked"; message: string } {
  const paths = resolveDepthRuntimePaths(storageBasePath);
  if (!fileExists(paths.depthProfileDir)) {
    return { state: "ready", message: "深度估计 profile 不存在，无需回滚" };
  }
  try {
    const previousPath = `${paths.depthProfileDir}.previous`;
    const rolledBackPath = `${paths.depthProfileDir}.rolled-back-${Date.now()}`;
    fs.renameSync(paths.depthProfileDir, rolledBackPath);
    if (fileExists(previousPath)) fs.renameSync(previousPath, paths.depthProfileDir);
    return {
      state: "ready",
      message: fileExists(paths.depthProfileDir)
        ? "深度估计 profile 已恢复到上一版本"
        : "深度估计 profile 已回滚",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "blocked", message: `回滚失败: ${message}` };
  }
}

export type { DepthRuntimePaths, DepthRuntimeProbeResult };
export { resolveDepthRuntimePaths, probeDepthRuntime, buildDepthWorkerEnv, buildDepthWorkerArgs } from "./depth-runtime";
