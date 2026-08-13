import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HYPERFRAMES_PACKAGE,
  NPM_SHA256,
  NPM_TARBALL_URL,
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
  runs: Array<{ file: string; args: string[]; env?: NodeJS.ProcessEnv }>;
  setRunFailure: (value: "pip-install" | "pip-check" | "import-smoke" | null) => void;
  setHashFailure: (value: boolean) => void;
};

function createHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-runtime-manager-"));
  const storageBasePath = path.join(root, "storage");
  const electronExecutable = path.join(root, "electron");
  fs.writeFileSync(electronExecutable, "#!/bin/sh\n", "utf8");
  fs.chmodSync(electronExecutable, 0o755);
  const paths = resolveVideoWorkflowRuntimePaths(storageBasePath, "darwin", electronExecutable);
  fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
  fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");
  fs.chmodSync(paths.pythonExecutable, 0o755);

  const downloads: string[] = [];
  const runs: Array<{ file: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
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
    // npm tarball: create package/ with bin/npm-cli.js
    const npmRoot = path.join(destinationPath, "package");
    fs.mkdirSync(path.join(npmRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(npmRoot, "bin", "npm-cli.js"), "#!/usr/bin/env node\nconsole.log('npm')", "utf8");
    fs.chmodSync(path.join(npmRoot, "bin", "npm-cli.js"), 0o755);
  };

  const run: VideoWorkflowRuntimeManagerOps["run"] = async (file, args, options) => {
    runs.push({ file, args: [...args], env: options?.env });
    const commandKind = args[0] === "-m" && args[1] === "pip" && args[2] === "install"
      ? "pip-install"
      : args[0] === "-m" && args[1] === "pip" && args[2] === "check"
        ? "pip-check"
        : args[0] === "-c"
          ? "import-smoke"
          : null;
    if (commandKind && commandKind === runFailure) throw new Error(`${commandKind} failed in test`);
    if (args[0] === "--version") {
      return { stdout: file === electronExecutable ? "v24.17.0" : "Python 3.12.7", stderr: "" };
    }
    // npm install: create hyperframes CLI + runtimeVersion.js
    if (args.length > 0 && args[0]?.endsWith("npm-cli.js") && args[1] === "install") {
      const profileDir = options?.cwd ?? "";
      const cliDir = path.join(profileDir, "node_modules", "hyperframes", "bin");
      const distDir = path.join(profileDir, "node_modules", "hyperframes", "dist");
      fs.mkdirSync(cliDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(cliDir, "hyperframes.mjs"), "#!/usr/bin/env node\n", "utf8");
      fs.writeFileSync(path.join(distDir, "runtimeVersion.js"), "var MINIMUM_NODE_MAJOR = 22;\n", "utf8");
    }
    return { stdout: "", stderr: "" };
  };

  const hashFile: VideoWorkflowRuntimeManagerOps["hashFile"] = (filePath) => {
    if (hashFailure && filePath.endsWith("npm.tgz")) return "bad-npm-hash";
    if (filePath.endsWith("npm.tgz")) return NPM_SHA256;
    const helper = Object.entries(VIDEO_USE_HELPER_SHA256).find(([relativePath]) => filePath.endsWith(relativePath));
    if (helper) return hashFailure ? "bad-helper-hash" : helper[1];
    return "a".repeat(64);
  };

  const manager = createVideoWorkflowRuntimeManager(
    storageBasePath,
    { download, extract, run, hashFile },
    { platform: "darwin", arch: "arm64", electronExecutable },
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

  it("installs HyperFrames via npm with Electron's built-in Node and verifies the CLI entry", async () => {
    const harness = createHarness();
    await harness.manager.prepareHyperFrames();

    expect(harness.downloads).toEqual([NPM_TARBALL_URL]);
    expect(harness.runs.some(({ args }) => args.includes(HYPERFRAMES_PACKAGE))).toBe(true);
    expect(fs.existsSync(harness.paths.hyperFramesCliPath)).toBe(true);
    expect(fs.existsSync(harness.paths.hyperFramesMarkerPath)).toBe(true);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("rejects an npm tarball hash mismatch without replacing the existing profile", async () => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.hyperFramesProfileDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.hyperFramesProfileDir, "old.txt"), "old", "utf8");
    harness.setHashFailure(true);

    await expect(harness.manager.prepareHyperFrames()).rejects.toThrow("npm tarball SHA-256");
    expect(fs.readFileSync(path.join(harness.paths.hyperFramesProfileDir, "old.txt"), "utf8")).toBe("old");
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("injects ELECTRON_RUN_AS_NODE for all HyperFrames Node invocations", async () => {
    const harness = createHarness();
    await harness.manager.prepareHyperFrames();

    const hyperframesRuns = harness.runs.filter(({ file }) => file === harness.paths.electronExecutable);
    expect(hyperframesRuns.length).toBeGreaterThan(0);
    for (const run of hyperframesRuns) {
      expect(run.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    }
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("restores the previous verified profile on rollback", async () => {
    const harness = createHarness();
    await harness.manager.prepareVideoUse();
    fs.writeFileSync(path.join(harness.paths.videoUseProfileDir, "release.txt"), "old", "utf8");
    await expect(harness.manager.update("video-use")).resolves.toMatchObject({ success: true });
    expect(fs.existsSync(`${harness.paths.videoUseProfileDir}.previous`)).toBe(true);

    await harness.manager.rollbackVideoUse();
    expect(fs.readFileSync(path.join(harness.paths.videoUseProfileDir, "release.txt"), "utf8")).toBe("old");
    expect(fs.readdirSync(path.dirname(harness.paths.videoUseProfileDir)).some((entry) =>
      entry.startsWith(`${path.basename(harness.paths.videoUseProfileDir)}.failed-`),
    )).toBe(true);
    fs.rmSync(harness.root, { recursive: true, force: true });
  });
});
