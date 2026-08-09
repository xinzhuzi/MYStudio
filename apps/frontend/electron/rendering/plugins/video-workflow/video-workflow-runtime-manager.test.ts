import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HYPERFRAMES_PACKAGE,
  NODE22_SHA256,
  NODE22_TARBALL_URL,
  VIDEO_USE_HELPER_SHA256,
  VIDEO_USE_LOCK_CONTENT,
  VIDEO_USE_TARBALL_URL,
  createVideoWorkflowRuntimeManager,
  type VideoWorkflowRuntimeManager,
  type VideoWorkflowRuntimeManagerOps,
} from "./video-workflow-runtime-manager";
import {
  resolveVideoWorkflowRuntimePaths,
} from "./video-workflow-runtime";

type Harness = {
  root: string;
  manager: VideoWorkflowRuntimeManager;
  paths: ReturnType<typeof resolveVideoWorkflowRuntimePaths>;
  downloads: string[];
  runs: Array<{ file: string; args: string[] }>;
  setRunFailure: (value: "pip-install" | "pip-check" | "import-smoke" | null) => void;
  setHashFailure: (value: boolean) => void;
};

function createHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-runtime-manager-"));
  const storageBasePath = path.join(root, "storage");
  const paths = resolveVideoWorkflowRuntimePaths(storageBasePath, "darwin");
  fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
  fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");
  fs.chmodSync(paths.pythonExecutable, 0o755);

  const downloads: string[] = [];
  const runs: Array<{ file: string; args: string[] }> = [];
  let runFailure: "pip-install" | "pip-check" | "import-smoke" | null = null;
  let hashFailure = false;

  const download: VideoWorkflowRuntimeManagerOps["download"] = async (url, destinationPath) => {
    downloads.push(url);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, "archive", "utf8");
  };

  const extract: VideoWorkflowRuntimeManagerOps["extract"] = async (archivePath, destinationPath) => {
    fs.mkdirSync(destinationPath, { recursive: true });
    if (path.basename(archivePath) === "source.tar.gz") {
      const sourceRoot = path.join(destinationPath, "video-use-commit");
      for (const relativePath of Object.keys(VIDEO_USE_HELPER_SHA256)) {
        const filePath = path.join(sourceRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, relativePath, "utf8");
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
    runs.push({ file, args: [...args] });
    const commandKind = args[0] === "-m" && args[1] === "pip" && args[2] === "install"
      ? "pip-install"
      : args[0] === "-m" && args[1] === "pip" && args[2] === "check"
        ? "pip-check"
        : args[0] === "-c"
          ? "import-smoke"
          : null;
    if (commandKind && commandKind === runFailure) throw new Error(`${commandKind} failed in test`);
    if (args[0] === "--version") {
      return { stdout: file.endsWith(`${path.sep}node`) ? "v22.22.3" : "Python 3.12.7", stderr: "" };
    }
    if (args[0] === "install") {
      const prefixIndex = args.indexOf("--prefix");
      const profileDir = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;
      if (profileDir) {
        const cliPath = path.join(profileDir, "node_modules", ".bin", "hyperframes");
        fs.mkdirSync(path.dirname(cliPath), { recursive: true });
        fs.writeFileSync(cliPath, "hyperframes", "utf8");
        fs.chmodSync(cliPath, 0o755);
      }
    }
    return { stdout: "", stderr: "" };
  };

  const hashFile: VideoWorkflowRuntimeManagerOps["hashFile"] = (filePath) => {
    if (hashFailure && filePath.endsWith("node.tar.gz")) return "bad-node-hash";
    if (filePath.endsWith("node.tar.gz")) return NODE22_SHA256;
    const helper = Object.entries(VIDEO_USE_HELPER_SHA256).find(([relativePath]) => filePath.endsWith(relativePath));
    if (helper) return hashFailure ? "bad-helper-hash" : helper[1];
    return "a".repeat(64);
  };

  const manager = createVideoWorkflowRuntimeManager(
    storageBasePath,
    { download, extract, run, hashFile },
    { platform: "darwin", arch: "arm64" },
  );
  return {
    root,
    manager,
    paths,
    downloads,
    runs,
    setRunFailure: (value) => { runFailure = value; },
    setHashFailure: (value) => { hashFailure = value; },
  };
}

describe("video workflow runtime manager", () => {
  it("installs video-use into the managed Python profile without a venv or private FFmpeg", async () => {
    const harness = createHarness();
    await harness.manager.prepareVideoUse();

    expect(harness.downloads).toEqual([VIDEO_USE_TARBALL_URL]);
    expect(fs.existsSync(harness.paths.videoUseMarkerPath)).toBe(true);
    expect(fs.readFileSync(harness.paths.videoUseLockPath, "utf8")).toBe(VIDEO_USE_LOCK_CONTENT);
    expect(harness.runs.filter(({ file }) => file === harness.paths.pythonExecutable).map(({ args }) => args)).toEqual([
      ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--requirement", expect.any(String)],
      ["-m", "pip", "check", "--disable-pip-version-check"],
      ["-c", "import librosa, matplotlib, PIL, numpy"],
    ]);
    expect(harness.runs.flatMap(({ args }) => args)).not.toContain("venv");
    expect(harness.downloads.some((url) => url.includes("ffmpeg"))).toBe(false);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("rejects a non-executable managed Python before downloading a profile", async () => {
    const harness = createHarness();
    fs.chmodSync(harness.paths.pythonExecutable, 0o644);

    await expect(harness.manager.prepareVideoUse()).rejects.toThrow("managed Python executable 不可执行");
    expect(harness.downloads).toEqual([]);
    expect(fs.existsSync(harness.paths.videoUseMarkerPath)).toBe(false);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("rejects a helper hash mismatch before replacing an existing profile", async () => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.videoUseProfileDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "old", "utf8");
    harness.setHashFailure(true);

    await expect(harness.manager.prepareVideoUse()).rejects.toThrow("helper SHA-256");
    expect(fs.readFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "utf8")).toBe("old");
    expect(fs.existsSync(harness.paths.videoUseMarkerPath)).toBe(false);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("keeps the previous profile when pip installation fails", async () => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.videoUseProfileDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "old", "utf8");
    harness.setRunFailure("pip-install");

    await expect(harness.manager.prepareVideoUse()).rejects.toThrow("pip install 验证失败");
    expect(fs.readFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "utf8")).toBe("old");
    expect(fs.existsSync(`${harness.paths.videoUseProfileDir}.previous`)).toBe(false);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it.each([
    ["pip-check" as const, "pip check 验证失败"],
    ["import-smoke" as const, "video-use 依赖导入验证失败"],
  ])("keeps the previous profile when %s fails", async (failure, expectedMessage) => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.videoUseProfileDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "old", "utf8");
    harness.setRunFailure(failure);

    await expect(harness.manager.prepareVideoUse()).rejects.toThrow(expectedMessage);
    expect(fs.readFileSync(path.join(harness.paths.videoUseProfileDir, "old.txt"), "utf8")).toBe("old");
    expect(fs.existsSync(harness.paths.videoUseMarkerPath)).toBe(false);
    expect(fs.existsSync(`${harness.paths.videoUseProfileDir}.previous`)).toBe(false);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("verifies Node 22 before installing the pinned HyperFrames package", async () => {
    const harness = createHarness();
    await harness.manager.prepareHyperFrames();

    expect(harness.downloads).toEqual([NODE22_TARBALL_URL]);
    expect(harness.runs.some(({ args }) => args.includes(HYPERFRAMES_PACKAGE))).toBe(true);
    expect(fs.existsSync(harness.paths.hyperFramesCliPath)).toBe(true);
    expect(fs.existsSync(harness.paths.hyperFramesMarkerPath)).toBe(true);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("rejects a Node tarball hash mismatch without replacing the existing runtime", async () => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.nodeRuntimeDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.nodeRuntimeDir, "old.txt"), "old", "utf8");
    harness.setHashFailure(true);

    await expect(harness.manager.prepareHyperFrames()).rejects.toThrow("Node 22 tarball SHA-256");
    expect(fs.readFileSync(path.join(harness.paths.nodeRuntimeDir, "old.txt"), "utf8")).toBe("old");
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("restores the previous verified profile on rollback", async () => {
    const harness = createHarness();
    await harness.manager.prepareVideoUse();
    fs.writeFileSync(path.join(harness.paths.videoUseProfileDir, "release.txt"), "old", "utf8");
    await harness.manager.prepareVideoUse();
    expect(fs.existsSync(`${harness.paths.videoUseProfileDir}.previous`)).toBe(true);

    await harness.manager.rollbackVideoUse();
    expect(fs.readFileSync(path.join(harness.paths.videoUseProfileDir, "release.txt"), "utf8")).toBe("old");
    expect(fs.readdirSync(path.dirname(harness.paths.videoUseProfileDir)).some((entry) =>
      entry.startsWith(`${path.basename(harness.paths.videoUseProfileDir)}.failed-`),
    )).toBe(true);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });
});
