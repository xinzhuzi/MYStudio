import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveDepthRuntimePaths } from "./depth-runtime";
import { prepareDepthRuntime, rollbackDepthRuntime } from "./depth-runtime-manager";

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-depth-manager-"));
  const storageBasePath = path.join(root, "storage");
  const backendRoot = path.join(root, "backend");
  const modelCacheDir = path.join(root, "models");
  const paths = resolveDepthRuntimePaths(storageBasePath, "darwin");
  fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
  fs.mkdirSync(backendRoot, { recursive: true });
  fs.mkdirSync(modelCacheDir, { recursive: true });
  fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");
  return { storageBasePath, backendRoot, modelCacheDir, paths };
}

function successfulExec() {
  return vi.fn(async (_file: string, args: string[]) => {
    if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
    if (args[0] === "-m" && args[1] === "depth_estimation.worker") {
      return {
        stdout: JSON.stringify({
          status: "blocked",
          toolVersion: "depth-estimation@0.1.0",
          model: { status: "blocked", code: "model-not-downloaded" },
        }),
        stderr: "",
      };
    }
    return { stdout: "ok\n", stderr: "" };
  });
}

describe("depth runtime manager", () => {
  it("promotes a verified staging profile and leaves no staging directory", async () => {
    const harness = createHarness();
    const execFile = successfulExec();

    const result = await prepareDepthRuntime({
      storageBasePath: harness.storageBasePath,
      backendRoot: harness.backendRoot,
      modelCacheDir: harness.modelCacheDir,
      execFile,
      now: () => 1234,
    });

    expect(result.state).toBe("ready");
    expect(fs.existsSync(harness.paths.depthLockPath)).toBe(true);
    expect(fs.existsSync(harness.paths.depthMarkerPath)).toBe(true);
    expect(fs.readdirSync(path.dirname(harness.paths.depthProfileDir)).some((name) => name.includes(".staging-"))).toBe(false);
    expect(execFile).toHaveBeenCalledWith(
      harness.paths.pythonExecutable,
      ["-m", "depth_estimation.worker", "--probe"],
      expect.objectContaining({
        cwd: harness.backendRoot,
        env: expect.objectContaining({ MYSTUDIO_DEPTH_MODEL_DIR: harness.modelCacheDir }),
      }),
    );
  });

  it("restores the previous verified profile on rollback", async () => {
    const harness = createHarness();
    expect((await prepareDepthRuntime({
      storageBasePath: harness.storageBasePath,
      backendRoot: harness.backendRoot,
      execFile: successfulExec(),
    })).state).toBe("ready");
    fs.writeFileSync(path.join(harness.paths.depthProfileDir, "previous.txt"), "keep", "utf8");
    expect((await prepareDepthRuntime({
      storageBasePath: harness.storageBasePath,
      backendRoot: harness.backendRoot,
      execFile: successfulExec(),
    })).state).toBe("ready");

    const result = rollbackDepthRuntime(harness.storageBasePath);

    expect(result).toMatchObject({ state: "ready", message: "深度估计 profile 已恢复到上一版本" });
    expect(fs.readFileSync(path.join(harness.paths.depthProfileDir, "previous.txt"), "utf8")).toBe("keep");
  });

  it("restores the active profile when post-promotion worker verification fails", async () => {
    const harness = createHarness();
    fs.mkdirSync(harness.paths.depthProfileDir, { recursive: true });
    fs.writeFileSync(path.join(harness.paths.depthProfileDir, "active.txt"), "keep", "utf8");
    const execFile = successfulExec();
    execFile.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
      if (args[0] === "-m" && args[1] === "depth_estimation.worker") {
        return { stdout: JSON.stringify({ status: "ready" }), stderr: "" };
      }
      return { stdout: "ok\n", stderr: "" };
    });

    const result = await prepareDepthRuntime({
      storageBasePath: harness.storageBasePath,
      backendRoot: harness.backendRoot,
      execFile,
    });

    expect(result.state).toBe("blocked");
    expect(fs.readFileSync(path.join(harness.paths.depthProfileDir, "active.txt"), "utf8")).toBe("keep");
  });
});
