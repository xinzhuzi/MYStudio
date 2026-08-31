import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSfxGenRuntimeController } from "./sfx-gen-runtime-controller";

describe("sfx runtime model cache contract", () => {
  it("passes the dedicated SFX cache env to the worker", async () => {
    const storageBasePath = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-sfx-controller-"));
    const pythonExecutable = path.join(storageBasePath, "python", "bin", "python3");
    fs.mkdirSync(path.dirname(pythonExecutable), { recursive: true });
    fs.writeFileSync(pythonExecutable, "managed-python", "utf8");
    const modelCacheDir = path.join(storageBasePath, "model", "sfx");
    const execFileFn = vi.fn(async (_file: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      expect(options.env?.MYSTUDIO_SFX_MODEL_DIR).toBe(modelCacheDir);
      expect(options.env?.MYSTUDIO_AUDIO_MODEL_DIR).toBeUndefined();
      return { stdout: JSON.stringify({ status: "blocked", code: "model-not-downloaded", message: "missing" }) };
    });
    const controller = createSfxGenRuntimeController({
      storageBasePath,
      backendRoot: "/fake/backend",
      modelCacheDir: () => modelCacheDir,
      execFileFn,
    });

    const result = await controller.generateSfx({ prompt: "whoosh", outputDir: path.join(storageBasePath, "exports") });

    expect(result).toMatchObject({ status: "blocked", code: "model-not-downloaded" });
    expect(execFileFn).toHaveBeenCalledTimes(1);
  });
});
