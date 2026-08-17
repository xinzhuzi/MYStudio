import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEPTH_LOCK_CONTENT,
  DEPTH_PROFILE_ID,
  probeDepthRuntime,
  resolveDepthRuntimePaths,
} from "./depth-runtime";

function createRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-depth-probe-"));
  const storageBasePath = path.join(root, "storage");
  const backendRoot = path.join(root, "backend");
  const paths = resolveDepthRuntimePaths(storageBasePath, "darwin");
  fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
  fs.mkdirSync(paths.depthProfileDir, { recursive: true });
  fs.mkdirSync(backendRoot, { recursive: true });
  fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");
  fs.writeFileSync(paths.depthLockPath, DEPTH_LOCK_CONTENT, "utf8");
  fs.writeFileSync(paths.depthMarkerPath, `${JSON.stringify({
    schemaVersion: 1,
    profileId: DEPTH_PROFILE_ID,
    pythonExecutable: paths.pythonExecutable,
    lockPath: paths.depthLockPath,
    lockSha256: crypto.createHash("sha256").update(DEPTH_LOCK_CONTENT).digest("hex"),
  })}\n`, "utf8");
  return { backendRoot, paths };
}

function execProbe(workerPayload: Record<string, unknown>) {
  return vi.fn(async (_file: string, args: string[]) => {
    if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
    if (args[0] === "-c") return { stdout: "ok\n", stderr: "" };
    return { stdout: JSON.stringify(workerPayload), stderr: "" };
  });
}

describe("depth runtime probe", () => {
  it("returns Python, worker, and model weight SHA evidence", async () => {
    const runtime = createRuntime();
    const weightSha = "a".repeat(64);
    const execFile = execProbe({
      status: "ready",
      toolVersion: "depth-estimation@0.1.0",
      model: { status: "ready", weightSha256: weightSha },
    });

    const result = await probeDepthRuntime(runtime.paths, {
      backendRoot: runtime.backendRoot,
      execFile,
    });

    expect(result).toMatchObject({
      state: "ready",
      missing: [],
      evidence: {
        pythonAvailable: true,
        pythonVersion: "Python 3.12.7",
        workerProbe: "ready",
        workerToolVersion: "depth-estimation@0.1.0",
        modelWeightSha256: weightSha,
      },
    });
    expect(execFile).toHaveBeenCalledWith(
      runtime.paths.pythonExecutable,
      ["-m", "depth_estimation.worker", "--probe"],
      expect.objectContaining({ cwd: runtime.backendRoot }),
    );
  });

  it("accepts a healthy worker when the explicitly downloaded model is absent", async () => {
    const runtime = createRuntime();
    const result = await probeDepthRuntime(runtime.paths, {
      backendRoot: runtime.backendRoot,
      execFile: execProbe({
        status: "blocked",
        toolVersion: "depth-estimation@0.1.0",
        model: { status: "blocked", code: "model-not-downloaded" },
      }),
    });

    expect(result).toMatchObject({
      state: "ready",
      evidence: { workerProbe: "model-not-downloaded" },
    });
  });

  it("blocks a tampered lock before invoking the worker", async () => {
    const runtime = createRuntime();
    fs.writeFileSync(runtime.paths.depthLockPath, "tampered", "utf8");
    const execFile = execProbe({});

    const result = await probeDepthRuntime(runtime.paths, {
      backendRoot: runtime.backendRoot,
      execFile,
    });

    expect(result).toMatchObject({
      state: "blocked",
      missing: ["depth-profile-invalid"],
      evidence: { workerProbe: "not-run" },
    });
    expect(execFile).not.toHaveBeenCalledWith(
      runtime.paths.pythonExecutable,
      ["-m", "depth_estimation.worker", "--probe"],
      expect.anything(),
    );
  });

  it("blocks an invalid worker probe payload", async () => {
    const runtime = createRuntime();
    const result = await probeDepthRuntime(runtime.paths, {
      backendRoot: runtime.backendRoot,
      execFile: execProbe({ status: "ready" }),
    });

    expect(result).toMatchObject({
      state: "blocked",
      missing: ["worker-probe"],
      evidence: { workerProbe: "blocked" },
    });
  });
});
