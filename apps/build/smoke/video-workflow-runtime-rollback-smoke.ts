import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HYPERFRAMES_PACKAGE,
  NODE22_SHA256,
  NODE22_TARBALL_URL,
  VIDEO_USE_HELPER_SHA256,
  VIDEO_USE_TARBALL_URL,
  createVideoWorkflowRuntimeManager,
  type VideoWorkflowRuntimeManagerOps,
} from "@rendering/plugins/video-workflow/video-workflow-runtime-manager";
import { resolveVideoWorkflowRuntimePaths } from "@rendering/plugins/video-workflow/video-workflow-runtime";

type RollbackRecord = {
  prepared: boolean;
  failedUpdateRejected: boolean;
  failedUpdatePreservedCurrent: boolean;
  rolledBack: boolean;
  restoredVersion: string;
  failedDirectoryRetained: boolean;
};

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
}

async function main(): Promise<void> {
  const reportPath = argumentValue("--report");
  if (!reportPath) throw new Error("缺少 --report <path>");

  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-runtime-rollback-smoke-"));
  const storageBasePath = path.join(isolatedRoot, "storage");
  const paths = resolveVideoWorkflowRuntimePaths(storageBasePath, "darwin");
  fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
  fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");
  fs.chmodSync(paths.pythonExecutable, 0o755);

  let failedPipInstall = false;
  let failedNpmInstall = false;
  const download: VideoWorkflowRuntimeManagerOps["download"] = async (url, destinationPath) => {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, url, "utf8");
  };
  const extract: VideoWorkflowRuntimeManagerOps["extract"] = async (archivePath, destinationPath) => {
    fs.mkdirSync(destinationPath, { recursive: true });
    if (path.basename(archivePath) === "source.tar.gz") {
      const sourceRoot = path.join(destinationPath, "video-use-commit");
      for (const relativePath of Object.keys(VIDEO_USE_HELPER_SHA256)) {
        const helperPath = path.join(sourceRoot, relativePath);
        fs.mkdirSync(path.dirname(helperPath), { recursive: true });
        fs.writeFileSync(helperPath, relativePath, "utf8");
      }
      return;
    }
    const nodeRoot = path.join(destinationPath, "node-v22.22.3-darwin-arm64");
    fs.mkdirSync(path.join(nodeRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(nodeRoot, "bin", "node"), "node", "utf8");
    fs.writeFileSync(path.join(nodeRoot, "bin", "npm"), "npm", "utf8");
    fs.chmodSync(path.join(nodeRoot, "bin", "node"), 0o755);
    fs.chmodSync(path.join(nodeRoot, "bin", "npm"), 0o755);
  };
  const run: VideoWorkflowRuntimeManagerOps["run"] = async (file, args) => {
    if (args[0] === "--version") return { stdout: file.endsWith(`${path.sep}node`) ? "v22.22.3" : "Python 3.12.7" };
    if (args[0] === "-m" && args[1] === "pip" && args[2] === "install" && failedPipInstall) {
      throw new Error("intentional isolated pip install failure");
    }
    if (args[0] === "install") {
      if (failedNpmInstall) throw new Error("intentional isolated npm install failure");
      const prefixIndex = args.indexOf("--prefix");
      const profileDir = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;
      if (profileDir) {
        const cliPath = path.join(profileDir, "node_modules", ".bin", "hyperframes");
        fs.mkdirSync(path.dirname(cliPath), { recursive: true });
        fs.writeFileSync(cliPath, HYPERFRAMES_PACKAGE, "utf8");
        fs.chmodSync(cliPath, 0o755);
      }
    }
    return { stdout: "", stderr: "" };
  };
  const hashFile: VideoWorkflowRuntimeManagerOps["hashFile"] = (filePath) => {
    if (filePath.endsWith("node.tar.gz")) return NODE22_SHA256;
    const helper = Object.entries(VIDEO_USE_HELPER_SHA256).find(([relativePath]) => filePath.endsWith(relativePath));
    return helper?.[1] ?? "a".repeat(64);
  };

  const manager = createVideoWorkflowRuntimeManager(
    storageBasePath,
    { download, extract, run, hashFile },
    { platform: "darwin", arch: "arm64" },
  );

  const videoUseFirst = await manager.prepare("video-use");
  if (!videoUseFirst.success || !videoUseFirst.runtime) {
    throw new Error(`video-use 首次准备失败: ${videoUseFirst.message ?? "未返回运行时"}`);
  }
  fs.writeFileSync(path.join(videoUseFirst.runtime.videoUseProfileDir, "version.txt"), "video-use-v1", "utf8");
  const videoUseUpdate = await manager.update("video-use");
  if (!videoUseUpdate.success) throw new Error(`video-use 更新失败: ${videoUseUpdate.message ?? "未知错误"}`);
  fs.writeFileSync(path.join(paths.videoUseProfileDir, "version.txt"), "video-use-v2", "utf8");
  failedPipInstall = true;
  const failedVideoUseUpdate = await manager.update("video-use");
  const failedUpdateRejected = !failedVideoUseUpdate.success;
  requireEqual(fs.readFileSync(path.join(paths.videoUseProfileDir, "version.txt"), "utf8"), "video-use-v2", "video-use 失败更新保护");
  const videoUseRollback = await manager.rollback("video-use");
  requireEqual(videoUseRollback.success, true, "video-use 回滚动作");
  requireEqual(fs.readFileSync(path.join(paths.videoUseProfileDir, "version.txt"), "utf8"), "video-use-v1", "video-use 回滚版本");
  const videoUseFailedDirectoryRetained = fs.readdirSync(path.dirname(paths.videoUseProfileDir)).some((entry) => entry.startsWith(`${path.basename(paths.videoUseProfileDir)}.failed-`));

  const hyperFramesFirst = await manager.prepare("hyperframes");
  if (!hyperFramesFirst.success || !hyperFramesFirst.runtime) {
    throw new Error(`HyperFrames 首次准备失败: ${hyperFramesFirst.message ?? "未返回运行时"}`);
  }
  fs.writeFileSync(path.join(hyperFramesFirst.runtime.nodeRuntimeDir, "version.txt"), "hyperframes-v1", "utf8");
  const hyperFramesUpdate = await manager.update("hyperframes");
  if (!hyperFramesUpdate.success) throw new Error(`HyperFrames 更新失败: ${hyperFramesUpdate.message ?? "未知错误"}`);
  fs.writeFileSync(path.join(paths.nodeRuntimeDir, "version.txt"), "hyperframes-v2", "utf8");
  failedNpmInstall = true;
  const failedHyperFramesUpdate = await manager.update("hyperframes");
  const hyperFramesFailedUpdateRejected = !failedHyperFramesUpdate.success;
  requireEqual(fs.readFileSync(path.join(paths.nodeRuntimeDir, "version.txt"), "utf8"), "hyperframes-v2", "HyperFrames 失败更新保护");
  const hyperFramesRollback = await manager.rollback("hyperframes");
  requireEqual(hyperFramesRollback.success, true, "HyperFrames 回滚动作");
  requireEqual(fs.readFileSync(path.join(paths.nodeRuntimeDir, "version.txt"), "utf8"), "hyperframes-v1", "HyperFrames 回滚版本");
  const hyperFramesFailedDirectoryRetained = fs.readdirSync(path.dirname(paths.nodeRuntimeDir)).some((entry) => entry.startsWith(`${path.basename(paths.nodeRuntimeDir)}.failed-`));

  const report = {
    schemaVersion: 1,
    ok: failedUpdateRejected && hyperFramesFailedUpdateRejected && videoUseFailedDirectoryRetained && hyperFramesFailedDirectoryRetained,
    isolated: true,
    userRuntimeMutated: false,
    isolatedRootRemoved: true,
    storageBasePath,
    actionApi: {
      prepare: "manager.prepare(pluginId)",
      update: "manager.update(pluginId)",
      rollback: "manager.rollback(pluginId)",
    },
    sourceVersions: {
      videoUse: { source: VIDEO_USE_TARBALL_URL, restored: "video-use-v1" },
      hyperframes: { package: HYPERFRAMES_PACKAGE, nodeTarball: NODE22_TARBALL_URL, restored: "hyperframes-v1" },
    },
    videoUse: {
      prepared: true,
      failedUpdateRejected,
      failedUpdatePreservedCurrent: true,
      rolledBack: true,
      restoredVersion: "video-use-v1",
      failedDirectoryRetained: videoUseFailedDirectoryRetained,
    } satisfies RollbackRecord,
    hyperframes: {
      prepared: true,
      failedUpdateRejected: hyperFramesFailedUpdateRejected,
      failedUpdatePreservedCurrent: true,
      rolledBack: true,
      restoredVersion: "hyperframes-v1",
      failedDirectoryRetained: hyperFramesFailedDirectoryRetained,
    } satisfies RollbackRecord,
  };
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
  if (!report.ok) throw new Error(`isolated rollback smoke failed: ${JSON.stringify(report)}`);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
