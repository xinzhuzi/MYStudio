// Video QC runtime paths/env — mirrors depth/upscale runtime modules.
//
// video_qc 的 probe/inventory/download 路径零重依赖(不 import torch),
// 复用 TTS/video-use 预备的 managed Python;推理路径(权重+架构 vendor 后)
// 再评估是否需要独立 profile(届时加 requirements lock,照 depth 模式)。

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VIDEO_QC_TOOL_VERSION = "video-qc@0.1.0";

export interface VideoQcRuntimePaths {
  storageBasePath: string;
  pythonExecutable: string;
  /** 进度 JSON 与 run 工作区落点(managed python profiles 目录下) */
  videoQcProfileDir: string;
}

export function resolveVideoQcRuntimePaths(
  storageBasePath: string,
  platform: NodeJS.Platform = process.platform,
): VideoQcRuntimePaths {
  if (!path.isAbsolute(storageBasePath)) {
    throw new Error(`storageBasePath 必须是绝对路径: ${storageBasePath}`);
  }
  const pythonRuntimeDir = path.join(storageBasePath, "python");
  const pythonExecutable = platform === "win32"
    ? path.join(pythonRuntimeDir, "python.exe")
    : path.join(pythonRuntimeDir, "bin", "python3");
  return {
    storageBasePath,
    pythonExecutable,
    videoQcProfileDir: path.join(pythonRuntimeDir, "profiles", "video-qc"),
  };
}

export function buildVideoQcWorkerEnv(
  backendRoot: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: backendRoot,
    ...extra,
  };
}

export async function probeVideoQcRuntime(
  paths: VideoQcRuntimePaths,
): Promise<{ state: "ready" | "needs-runtime"; message?: string }> {
  if (!fs.existsSync(paths.pythonExecutable)) {
    return {
      state: "needs-runtime",
      message: "未找到 managed Python,请先在设置 → 本地配置 → Python 完成 Python 运行时准备",
    };
  }
  try {
    const { stdout } = await execFileAsync(paths.pythonExecutable, ["--version"], { timeout: 15_000 });
    const version = stdout.trim();
    if (!/Python 3/.test(version)) {
      return { state: "needs-runtime", message: `video_qc 需要 Python 3,实际: ${version || "unknown"}` };
    }
    return { state: "ready" };
  } catch (error) {
    return {
      state: "needs-runtime",
      message: `Python 探测失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
