import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDepthRuntimeController } from "./depth-runtime-controller";
import { resolveDepthRuntimePaths } from "./depth-runtime";

describe("depth runtime controller lifecycle", () => {
  it("completes prepare, ready, rollback, and needs-runtime with injected execution", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-depth-controller-"));
    const storageBasePath = path.join(root, "storage");
    const backendRoot = path.join(root, "backend");
    const modelCacheDir = path.join(root, "models");
    const paths = resolveDepthRuntimePaths(storageBasePath, "darwin");
    fs.mkdirSync(path.dirname(paths.pythonExecutable), { recursive: true });
    fs.mkdirSync(backendRoot, { recursive: true });
    fs.mkdirSync(modelCacheDir, { recursive: true });
    fs.writeFileSync(paths.pythonExecutable, "managed-python", "utf8");

    const execFile = vi.fn(async (_file: string, args: string[]) => {
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
      if (args[0] === "-m" && args[1] === "depth_estimation.model_inventory") {
        return {
          stdout: JSON.stringify({
            cacheDir: modelCacheDir,
            models: [{
              modelName: "depth-anything-v2-small",
              label: "Depth Anything V2 Small",
              downloaded: false,
              sizeMb: null,
              repoId: "depth-anything/Depth-Anything-V2-Small-hf",
              cacheDir: null,
              repoCacheDir: null,
            }],
          }),
          stderr: "",
        };
      }
      return { stdout: "ok\n", stderr: "" };
    });
    const controller = createDepthRuntimeController({
      storageBasePath,
      backendRoot,
      modelCacheDir: () => modelCacheDir,
      execFile,
      now: () => 1234,
    });

    const prepared = await controller.setup();
    expect(prepared).toMatchObject({
      state: "ready",
      setupStage: "ready",
      modelDownloaded: false,
      probeEvidence: {
        pythonAvailable: true,
        pythonVersion: "Python 3.12.7",
        workerProbe: "model-not-downloaded",
      },
    });
    expect(fs.existsSync(paths.depthMarkerPath)).toBe(true);

    const rolledBack = await controller.rollback();
    expect(rolledBack).toMatchObject({
      state: "needs-runtime",
      setupStage: "idle",
      modelDownloaded: false,
    });
    expect(fs.existsSync(paths.depthProfileDir)).toBe(false);

    const refreshed = await controller.refresh();
    expect(refreshed).toMatchObject({
      state: "needs-runtime",
      probeEvidence: { pythonAvailable: true, workerProbe: "not-run" },
    });
  });
});
