import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildSharedToolchainEnv,
  buildHyperFramesProfileMarker,
  buildVideoUseProfileMarker,
  resolveVideoWorkflowRuntimePaths,
  sha256File,
  writeProfileMarker,
  type VideoWorkflowRuntimePaths,
} from "./video-workflow-runtime";

export const VIDEO_USE_TARBALL_URL =
  "https://github.com/browser-use/video-use/archive/92c2b34e44c205cbc2acae7f6ca7c1c219d5dd66.tar.gz";
export const VIDEO_USE_SOURCE_COMMIT = "92c2b34e44c205cbc2acae7f6ca7c1c219d5dd66";
export const VIDEO_USE_SOURCE_URL = "https://github.com/browser-use/video-use";
export const NODE22_VERSION = "22.22.3";
export const NODE22_TARBALL_URL =
  `https://nodejs.org/dist/v${NODE22_VERSION}/node-v${NODE22_VERSION}-darwin-arm64.tar.gz`;
export const NODE22_SHA256 = "0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207";
export const HYPERFRAMES_PACKAGE = "hyperframes@0.7.101";

export const VIDEO_USE_HELPER_SHA256 = {
  "helpers/render.py": "bef2d6b47659c1d734b47556403276d05f0585e72d4b2d1da159c22b4cad69ed",
  "helpers/grade.py": "f5df58e81f31c95a621ffba5973fd866f6662fc481a36ebd37a2e68eb81220c2",
  "helpers/timeline_view.py": "69aee88e4204f86127740cca9de6a6eaa75a558df1bb07745dd62f69a3c2e9cf",
  "helpers/pack_transcripts.py": "f9e419def5f0a014d5e1fd16fdad801013ae068854c1d474c3492297e2304f4b",
} as const;

/** Direct dependencies declared by the pinned upstream pyproject.toml. */
export const VIDEO_USE_LOCK_CONTENT = `# MYStudio video-use profile; derived from upstream pyproject.toml at ${VIDEO_USE_SOURCE_COMMIT}
requests
librosa
matplotlib
pillow
numpy
`;

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
};

export interface VideoWorkflowRuntimeManagerOps {
  download: (url: string, destinationPath: string) => Promise<void>;
  extract: (archivePath: string, destinationPath: string) => Promise<void>;
  run: (file: string, args: string[], options?: CommandOptions) => Promise<{ stdout?: string; stderr?: string }>;
  hashFile?: (filePath: string) => string;
}

export type RuntimePluginId = "video-use" | "hyperframes";

export type RuntimeActionResult = {
  success: boolean;
  message?: string;
  runtime?: VideoWorkflowRuntimePaths;
};

export interface VideoWorkflowRuntimeManager {
  prepare: (pluginId: RuntimePluginId) => Promise<RuntimeActionResult>;
  update: (pluginId: RuntimePluginId) => Promise<RuntimeActionResult>;
  repair: (pluginId: RuntimePluginId) => Promise<RuntimeActionResult>;
  rollback: (pluginId: RuntimePluginId) => Promise<RuntimeActionResult>;
  prepareVideoUse: () => Promise<VideoWorkflowRuntimePaths>;
  prepareHyperFrames: () => Promise<VideoWorkflowRuntimePaths>;
  rollbackVideoUse: () => Promise<void>;
  rollbackHyperFrames: () => Promise<void>;
}

const execFileAsync = promisify(execFile);

const defaultOps: VideoWorkflowRuntimeManagerOps = {
  async download(url, destinationPath) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败 (${response.status}): ${url}`);
    const data = new Uint8Array(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, data);
  },
  async extract(archivePath, destinationPath) {
    fs.mkdirSync(destinationPath, { recursive: true });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationPath], {
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  },
  async run(file, args, options) {
    return execFileAsync(file, args, {
      cwd: options?.cwd,
      env: options?.env,
      timeout: options?.timeout ?? 30 * 60_000,
      maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024,
    });
  },
};

function randomSuffix(): string {
  return `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
}

function removeOwnPath(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function findArchiveRoot(extractDir: string, requiredRelativePath: string): string {
  const direct = path.join(extractDir, requiredRelativePath);
  if (fs.existsSync(direct)) return extractDir;
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    const nested = path.join(extractDir, directories[0].name);
    if (fs.existsSync(path.join(nested, requiredRelativePath))) return nested;
  }
  throw new Error(`归档缺少预期文件: ${requiredRelativePath}`);
}

function assertAbsolute(filePath: string, label: string): void {
  if (!path.isAbsolute(filePath)) throw new Error(`${label} 必须是绝对路径`);
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  if (!isFile(filePath)) return false;
  if (platform === "win32") return true;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandError(stage: string, error: unknown): Error {
  return new Error(`${stage}失败: ${error instanceof Error ? error.message : String(error)}`);
}

function promoteStaging(targetPath: string, stagingPath: string): string | undefined {
  const previousPath = `${targetPath}.previous`;
  const stalePreviousPath = `${previousPath}.${Date.now()}`;
  const hadTarget = fs.existsSync(targetPath);
  if (fs.existsSync(previousPath)) fs.renameSync(previousPath, stalePreviousPath);
  if (hadTarget) fs.renameSync(targetPath, previousPath);
  try {
    fs.renameSync(stagingPath, targetPath);
    return hadTarget ? previousPath : undefined;
  } catch (error) {
    if (hadTarget && fs.existsSync(previousPath) && !fs.existsSync(targetPath)) fs.renameSync(previousPath, targetPath);
    throw error;
  }
}

function restorePromotedTarget(targetPath: string, previousPath: string | undefined): void {
  removeOwnPath(targetPath);
  if (previousPath && fs.existsSync(previousPath)) fs.renameSync(previousPath, targetPath);
}

function writeVideoUseManifest(upstreamRoot: string): void {
  const manifestPath = path.join(upstreamRoot, "mystudio-video-use-manifest.json");
  const helperSha256 = Object.fromEntries(
    Object.entries(VIDEO_USE_HELPER_SHA256).map(([relativePath, expected]) => [relativePath, expected]),
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    sourceUrl: VIDEO_USE_SOURCE_URL,
    sourceCommit: VIDEO_USE_SOURCE_COMMIT,
    helperSha256,
    generatedBy: "MYStudio video-workflow-runtime-manager",
    generatedAt: Date.now(),
  }, null, 2)}\n`, "utf8");
}

function verifyVideoUseHelpers(upstreamRoot: string, hashFile: (filePath: string) => string): void {
  for (const [relativePath, expectedHash] of Object.entries(VIDEO_USE_HELPER_SHA256)) {
    const helperPath = path.join(upstreamRoot, relativePath);
    if (!isFile(helperPath)) throw new Error(`固定 video-use helper 不存在: ${relativePath}`);
    if (hashFile(helperPath) !== expectedHash) throw new Error(`video-use helper SHA-256 不匹配: ${relativePath}`);
  }
}

function restorePrevious(targetPath: string): void {
  const previousPath = `${targetPath}.previous`;
  if (!fs.existsSync(previousPath)) throw new Error("没有可回滚的已验证运行时组合");
  const failedPath = `${targetPath}.failed-${Date.now()}`;
  if (fs.existsSync(targetPath)) fs.renameSync(targetPath, failedPath);
  fs.renameSync(previousPath, targetPath);
}

export function createVideoWorkflowRuntimeManager(
  storageBasePath: string,
  injected: Partial<VideoWorkflowRuntimeManagerOps> = {},
  environment: { platform?: NodeJS.Platform; arch?: string } = {},
): VideoWorkflowRuntimeManager {
  assertAbsolute(storageBasePath, "storageBasePath");
  const platform = environment.platform ?? process.platform;
  const arch = environment.arch ?? process.arch;
  const paths = resolveVideoWorkflowRuntimePaths(storageBasePath, platform);
  const ops = { ...defaultOps, ...injected };
  const hashFile = ops.hashFile ?? sha256File;

  const runVerified = async (
    stage: string,
    file: string,
    args: string[],
    options?: CommandOptions,
  ): Promise<{ stdout?: string; stderr?: string }> => {
    try {
      return await ops.run(file, args, options);
    } catch (error) {
      throw commandError(stage, error);
    }
  };

  const prepareVideoUse = async (): Promise<VideoWorkflowRuntimePaths> => {
    assertAbsolute(paths.pythonExecutable, "managed Python");
    if (!isFile(paths.pythonExecutable)) throw new Error("managed Python executable 不存在，请先在插件配置页的 Python 运行环境区块完成准备");
    if (!isExecutableFile(paths.pythonExecutable, platform)) throw new Error("managed Python executable 不可执行，请在插件配置页的 Python 运行环境区块修复运行时");
    const stagingPath = `${paths.videoUseProfileDir}.staging-${randomSuffix()}`;
    const archivePath = path.join(stagingPath, "source.tar.gz");
    const extractPath = path.join(stagingPath, "extract");
    try {
      fs.mkdirSync(stagingPath, { recursive: true });
      await ops.download(VIDEO_USE_TARBALL_URL, archivePath);
      await ops.extract(archivePath, extractPath);
      const sourceRoot = findArchiveRoot(extractPath, "helpers/render.py");
      const upstreamRoot = path.join(stagingPath, "upstream");
      fs.cpSync(sourceRoot, upstreamRoot, { recursive: true });
      verifyVideoUseHelpers(upstreamRoot, hashFile);
      writeVideoUseManifest(upstreamRoot);
      const lockPath = path.join(stagingPath, "requirements-video-use.lock");
      fs.writeFileSync(lockPath, VIDEO_USE_LOCK_CONTENT, "utf8");
      const verificationEnv = buildSharedToolchainEnv(paths);
      await runVerified("pip install 验证", paths.pythonExecutable, [
        "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--requirement", lockPath,
      ], { cwd: upstreamRoot, env: verificationEnv });
      await runVerified("pip check 验证", paths.pythonExecutable, [
        "-m", "pip", "check", "--disable-pip-version-check",
      ], { cwd: upstreamRoot, env: verificationEnv });
      await runVerified("video-use 依赖导入验证", paths.pythonExecutable, [
        "-c", "import librosa, matplotlib, PIL, numpy",
      ], { cwd: upstreamRoot, env: verificationEnv });
      removeOwnPath(extractPath);
      removeOwnPath(archivePath);
      const previousPath = promoteStaging(paths.videoUseProfileDir, stagingPath);
      try {
        writeProfileMarker(paths.videoUseMarkerPath, buildVideoUseProfileMarker(paths, hashFile(paths.videoUseLockPath)));
      } catch (error) {
        restorePromotedTarget(paths.videoUseProfileDir, previousPath);
        throw error;
      }
      return paths;
    } catch (error) {
      removeOwnPath(stagingPath);
      throw error;
    }
  };

  const prepareHyperFrames = async (): Promise<VideoWorkflowRuntimePaths> => {
    if (platform !== "darwin" || arch !== "arm64") {
      throw new Error("HyperFrames Node 22 runtime 首版只支持 macOS Apple Silicon");
    }
    const stagingPath = `${paths.nodeRuntimeDir}.staging-${randomSuffix()}`;
    const archivePath = path.join(stagingPath, "node.tar.gz");
    const extractPath = path.join(stagingPath, "extract");
    try {
      fs.mkdirSync(stagingPath, { recursive: true });
      await ops.download(NODE22_TARBALL_URL, archivePath);
      if (hashFile(archivePath) !== NODE22_SHA256) throw new Error("Node 22 tarball SHA-256 不匹配");
      await ops.extract(archivePath, extractPath);
      const nodeRoot = findArchiveRoot(extractPath, "bin/node");
      fs.cpSync(nodeRoot, stagingPath, { recursive: true });
      const nodeExecutable = path.join(stagingPath, "bin", "node");
      const npmExecutable = path.join(stagingPath, "bin", "npm");
      const nodeVersion = await ops.run(nodeExecutable, ["--version"]);
      if (!/^v22\./.test(`${nodeVersion.stdout ?? ""}${nodeVersion.stderr ?? ""}`.trim())) {
        throw new Error("下载的 Node 运行时不是 Node 22");
      }
      const profileDir = path.join(stagingPath, "profiles", "hyperframes");
      fs.mkdirSync(profileDir, { recursive: true });
      await ops.run(npmExecutable, [
        "install", "--no-audit", "--no-fund", "--prefix", profileDir, HYPERFRAMES_PACKAGE,
      ], { cwd: profileDir, env: { ...process.env, PATH: `${path.dirname(nodeExecutable)}:${process.env.PATH ?? ""}` } });
      const cliPath = path.join(profileDir, "node_modules", ".bin", "hyperframes");
      if (!fs.existsSync(cliPath)) throw new Error("HyperFrames CLI 安装后未找到可执行入口");
      removeOwnPath(extractPath);
      removeOwnPath(archivePath);
      const previousPath = promoteStaging(paths.nodeRuntimeDir, stagingPath);
      try {
        writeProfileMarker(paths.hyperFramesMarkerPath, buildHyperFramesProfileMarker(paths));
      } catch (error) {
        restorePromotedTarget(paths.nodeRuntimeDir, previousPath);
        throw error;
      }
      return paths;
    } catch (error) {
      removeOwnPath(stagingPath);
      throw error;
    }
  };

  const rollbackVideoUse = async (): Promise<void> => restorePrevious(paths.videoUseProfileDir);
  const rollbackHyperFrames = async (): Promise<void> => restorePrevious(paths.nodeRuntimeDir);

  const action = (fn: () => Promise<VideoWorkflowRuntimePaths>) => async (): Promise<RuntimeActionResult> => {
    try {
      return { success: true, runtime: await fn() };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
  const rollbackAction = (fn: () => Promise<void>) => async (): Promise<RuntimeActionResult> => {
    try {
      await fn();
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    prepare: (pluginId) => pluginId === "video-use" ? action(prepareVideoUse)() : action(prepareHyperFrames)(),
    update: (pluginId) => pluginId === "video-use" ? action(prepareVideoUse)() : action(prepareHyperFrames)(),
    repair: (pluginId) => pluginId === "video-use" ? action(prepareVideoUse)() : action(prepareHyperFrames)(),
    rollback: (pluginId) => pluginId === "video-use" ? rollbackAction(rollbackVideoUse)() : rollbackAction(rollbackHyperFrames)(),
    prepareVideoUse,
    prepareHyperFrames,
    rollbackVideoUse,
    rollbackHyperFrames,
  };
}
