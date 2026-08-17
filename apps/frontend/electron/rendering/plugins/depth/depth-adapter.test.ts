import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDepthAdapter } from "./depth-adapter";
import { resolveDepthRuntimePaths } from "./depth-runtime";

describe("depth adapter", () => {
  it("uses the injected custom model cache for the render worker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-depth-adapter-"));
    const storageBasePath = path.join(root, "storage");
    const backendRoot = path.join(root, "backend");
    const customModelCache = path.join(root, "custom-model-cache");
    const paths = resolveDepthRuntimePaths(storageBasePath, "darwin");
    const execFile = vi.fn(async () => {
      throw new Error("stop after environment capture");
    });
    const adapter = createDepthAdapter({
      storageBasePath,
      backendRoot,
      modelCacheDir: () => customModelCache,
      probeRuntime: async () => ({
        state: "ready",
        paths,
        missing: [],
        evidence: {
          pythonAvailable: true,
          workerProbe: "ready",
          modelWeightSha256: "a".repeat(64),
        },
      }),
      execFile,
    });

    const result = await adapter.estimateDepth({
      schemaVersion: 1,
      projectId: "project-a",
      shotId: "shot-1",
      inputImagePath: path.join(root, "input.png"),
      outputDepthPath: path.join(root, "output", "depth.png"),
      model: "depth-anything-v2-small",
    });

    expect(result).toMatchObject({ state: "blocked", code: "worker-failed" });
    expect(execFile).toHaveBeenCalledWith(
      paths.pythonExecutable,
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ MYSTUDIO_DEPTH_MODEL_DIR: customModelCache }),
      }),
    );
  });
});
