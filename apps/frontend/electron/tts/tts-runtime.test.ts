import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeCrypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTtsRuntimeController } from "./tts-runtime";

const mockPython312 = () => vi.fn(async (_command: string, args: string[]) => {
  if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
  return undefined;
});

describe("TTS runtime controller", () => {
  it("reports the MYStudio Voicebox sidecar on port 17593", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      installed: true,
      running: false,
      port: 17593,
      baseUrl: "http://127.0.0.1:17593",
      cacheDir: "/user-data/TTS/runtime",
      modelCacheDir: "/user-data/model/TTS",
      defaultModelCacheDir: "/user-data/model/TTS",
    });
    expect(controller.getModelCacheDir()).toBe("/user-data/model/TTS");
  });

  it("starts the Python sidecar with isolated runtime data", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 42, kill: vi.fn() }));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      [
        "-m",
        "tts.main",
        "--host",
        "127.0.0.1",
        "--port",
        "17593",
        "--data-dir",
        "/project-storage/TTS/runtime",
      ],
      expect.objectContaining({
        cwd: "/backend",
        env: expect.objectContaining({
          MANYING_TTS_DATA_DIR: "/project-storage/TTS/runtime",
          MANYING_TTS_MODELS_DIR: "/project-storage/model/TTS",
          VOICEBOX_MODELS_DIR: "/project-storage/model/TTS",
          HF_HUB_CACHE: "/project-storage/model/TTS",
          MANYING_TTS_CONTROL_TOKEN: expect.any(String),
        }),
      }),
    );
  });

  it("uses the project storage path for the deferred Python runtime", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      pythonRuntimeDir: "/project-storage/python",
    });
  });

  it("migrates the fixed legacy TTS directories and preserves the default model override", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-layout-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const legacyRuntimeDir = path.join(userDataPath, "tts-runtime");
    const legacyModelsDir = path.join(storageBasePath, "tts-models");
    const legacyModelRepoDir = path.join(legacyModelsDir, "models--example--voice");
    try {
      fs.mkdirSync(legacyRuntimeDir, { recursive: true });
      fs.mkdirSync(legacyModelRepoDir, { recursive: true });
      fs.writeFileSync(path.join(legacyRuntimeDir, "config.json"), JSON.stringify({
        modelCacheDir: legacyModelsDir,
        controlToken: "existing-token",
      }));
      fs.writeFileSync(path.join(legacyRuntimeDir, "tts.sqlite"), "sqlite-data");
      fs.writeFileSync(path.join(legacyModelRepoDir, "model.bin"), "model-data");

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir: path.join(root, "huggingface", "hub"),
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      expect(controller.getStorageLayout()).toMatchObject({
        rootDir: path.join(storageBasePath, "TTS"),
        runtimeDir: path.join(storageBasePath, "TTS", "runtime"),
        modelsDir: path.join(storageBasePath, "model", "TTS"),
        migrationState: "ready",
      });

      await expect(controller.migrateStorage()).resolves.toMatchObject({ success: true });
      expect(fs.existsSync(legacyRuntimeDir)).toBe(false);
      expect(fs.existsSync(legacyModelRepoDir)).toBe(false);
      expect(fs.readFileSync(path.join(storageBasePath, "TTS", "runtime", "tts.sqlite"), "utf8")).toBe("sqlite-data");
      expect(fs.readFileSync(path.join(storageBasePath, "model", "TTS", "models--example--voice", "model.bin"), "utf8")).toBe("model-data");
      expect(JSON.parse(fs.readFileSync(path.join(storageBasePath, "TTS", "runtime", "config.json"), "utf8")))
        .toMatchObject({ modelCacheDir: path.join(storageBasePath, "model", "TTS"), controlToken: "existing-token" });
      expect(controller.getStorageLayout().migrationState).toBe("up-to-date");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates the legacy TTS/model default cache into model/TTS and rewrites the persisted config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-legacy-cache-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const legacyCacheDir = path.join(storageBasePath, "TTS", "model");
    const runtimeConfigPath = path.join(storageBasePath, "TTS", "runtime", "config.json");
    const modelName = "models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16";
    try {
      fs.mkdirSync(path.join(legacyCacheDir, modelName), { recursive: true });
      fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
      fs.writeFileSync(path.join(legacyCacheDir, modelName, "model.bin"), "model-data");
      fs.writeFileSync(runtimeConfigPath, JSON.stringify({
        modelCacheDir: legacyCacheDir,
        controlToken: "existing-token",
      }));

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir: path.join(root, "huggingface", "hub"),
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      expect(controller.getStorageLayout()).toMatchObject({
        modelsDir: path.join(storageBasePath, "model", "TTS"),
        legacyCacheModelsDir: legacyCacheDir,
        legacyCacheModelsExists: true,
        migrationState: "ready",
      });
      expect(controller.getModelCacheDir()).toBe(legacyCacheDir);

      await expect(controller.migrateStorage()).resolves.toMatchObject({ success: true });
      expect(fs.existsSync(path.join(legacyCacheDir, modelName))).toBe(false);
      expect(fs.readFileSync(path.join(storageBasePath, "model", "TTS", modelName, "model.bin"), "utf8")).toBe("model-data");
      expect(JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8")))
        .toMatchObject({ modelCacheDir: path.join(storageBasePath, "model", "TTS"), controlToken: "existing-token" });
      expect(controller.getModelCacheDir()).toBe(path.join(storageBasePath, "model", "TTS"));
      expect(controller.getStorageLayout().migrationState).toBe("up-to-date");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("moves the global Hugging Face model cache and removes an identical legacy copy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-hf-migration-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const huggingFaceHubDir = path.join(root, "huggingface", "hub");
    const modelName = "models--hexgrad--Kokoro-82M";
    const globalModelDir = path.join(huggingFaceHubDir, modelName);
    const legacyModelDir = path.join(storageBasePath, "tts-models", modelName);
    const targetModelDir = path.join(storageBasePath, "model", "TTS", modelName);
    try {
      fs.mkdirSync(globalModelDir, { recursive: true });
      fs.mkdirSync(legacyModelDir, { recursive: true });
      fs.writeFileSync(path.join(globalModelDir, "model.bin"), "model-data");
      fs.writeFileSync(path.join(legacyModelDir, "model.bin"), "model-data");

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir,
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      await expect(controller.migrateStorage()).resolves.toMatchObject({ success: true });
      expect(fs.existsSync(globalModelDir)).toBe(false);
      expect(fs.existsSync(legacyModelDir)).toBe(false);
      expect(fs.readFileSync(path.join(targetModelDir, "model.bin"), "utf8")).toBe("model-data");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores non-TTS models in the global Hugging Face hub during migration", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-hf-migration-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const huggingFaceHubDir = path.join(root, "huggingface", "hub");
    const foreignModelName = "models--timm--vit_base_patch32_clip_224.openai";
    const foreignModelDir = path.join(huggingFaceHubDir, foreignModelName);
    try {
      fs.mkdirSync(foreignModelDir, { recursive: true });
      fs.writeFileSync(path.join(foreignModelDir, "model.bin"), "foreign-data");

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir,
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      expect(controller.getStorageLayout().migrationState).toBe("up-to-date");
      await expect(controller.migrateStorage()).resolves.toMatchObject({ success: true });
      expect(fs.existsSync(foreignModelDir)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses conflicting Hugging Face model directories without writing a target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-hf-migration-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const huggingFaceHubDir = path.join(root, "huggingface", "hub");
    const modelName = "models--hexgrad--Kokoro-82M";
    const globalModelDir = path.join(huggingFaceHubDir, modelName);
    const legacyModelDir = path.join(storageBasePath, "tts-models", modelName);
    const targetModelDir = path.join(storageBasePath, "model", "TTS", modelName);
    try {
      fs.mkdirSync(globalModelDir, { recursive: true });
      fs.mkdirSync(legacyModelDir, { recursive: true });
      fs.writeFileSync(path.join(globalModelDir, "model.bin"), "global-model");
      fs.writeFileSync(path.join(legacyModelDir, "model.bin"), "legacy-model");

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir,
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      await expect(controller.migrateStorage()).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining(modelName),
      });
      expect(fs.existsSync(globalModelDir)).toBe(true);
      expect(fs.existsSync(legacyModelDir)).toBe(true);
      expect(fs.existsSync(targetModelDir)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to migrate when a fixed TTS target already exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-tts-layout-"));
    const userDataPath = path.join(root, "user-data");
    const storageBasePath = path.join(root, "storage");
    const legacyRuntimeDir = path.join(userDataPath, "tts-runtime");
    const targetRuntimeDir = path.join(storageBasePath, "TTS", "runtime");
    try {
      fs.mkdirSync(legacyRuntimeDir, { recursive: true });
      fs.mkdirSync(targetRuntimeDir, { recursive: true });
      fs.writeFileSync(path.join(legacyRuntimeDir, "config.json"), "{}");

      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath,
        storageBasePath,
        huggingFaceHubDir: path.join(root, "huggingface", "hub"),
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
        spawnProcess: vi.fn(),
      });

      await expect(controller.migrateStorage()).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("同时存在"),
      });
      expect(fs.existsSync(legacyRuntimeDir)).toBe(true);
      expect(fs.existsSync(targetRuntimeDir)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists Python runtime download URL config for settings", async () => {
    let config = "";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: () => config || null,
      writeTextFile: (_filePath, value) => {
        config = value;
      },
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.setConfig({ pythonRuntimeUrl: "https://mirror.example/python.tar.gz" })).resolves.toMatchObject({
      success: true,
    });
    await expect(controller.getConfig()).resolves.toMatchObject({
      pythonRuntimeUrl: "https://mirror.example/python.tar.gz",
      pythonRuntimeDir: "/project-storage/python",
      defaultPythonRuntimeUrl: expect.stringContaining("python-build-standalone"),
    });
  });

  it("rejects non-HTTPS Python runtime download URLs and malformed sha256 values", async () => {
    let config = "";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      ensureDir: vi.fn(),
      readTextFile: () => config || null,
      writeTextFile: (_filePath, value) => {
        config = value;
      },
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.setConfig({ pythonRuntimeUrl: "http://evil.example/python.tar.gz" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("HTTPS"),
    });
    await expect(controller.setConfig({ pythonRuntimeUrl: "file:///evil/python.tar.gz" })).resolves.toMatchObject({
      success: false,
    });
    await expect(controller.setConfig({ pythonRuntimeSha256: "not-hex" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("sha256"),
    });
    // 全部拒绝后配置不应被写入
    await expect(controller.getConfig()).resolves.toMatchObject({ pythonRuntimeUrl: "" });
  });

  it("verifies the runtime archive sha256 before extraction and fails closed on mismatch", async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-runtime-sha-"));
    try {
      const archiveBytes = new Uint8Array(Buffer.from("fake python runtime archive payload"));
      const correctSha256 = nodeCrypto.createHash("sha256").update(archiveBytes).digest("hex");
      const wrongSha256 = "0".repeat(64);
      let config = "";
      const extractArchive = vi.fn(async (_archivePath: string, destinationDir: string) => {
        fs.mkdirSync(path.join(destinationDir, "python/bin"), { recursive: true });
        fs.writeFileSync(path.join(destinationDir, "python/bin/python3"), "#!/bin/sh\n");
      });
      const baseDeps = {
        appRoot: "/repo",
        userDataPath: "/user-data",
        storageBasePath: () => storageDir,
        fileExists: (filePath: string) => filePath.includes("tts/main.py"),
        ensureDir: vi.fn(),
        readTextFile: (filePath: string) => (filePath.endsWith(".json") ? config || null : null),
        writeTextFile: (_filePath: string, value: string) => {
          config = value;
        },
        fetchRuntimeArchive: vi.fn(async (_url: string, targetPath: string) => {
          fs.writeFileSync(targetPath, archiveBytes);
          return { ok: true, status: 200, data: archiveBytes };
        }),
        extractArchive,
        runPython: mockPython312(),
        spawnProcess: vi.fn(),
        fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
      };

      const failing = createTtsRuntimeController({ ...baseDeps });
      await failing.setConfig({ pythonRuntimeSha256: wrongSha256 });
      const failed = await failing.setup();
      expect(failed.error ?? "").toContain("sha256");
      expect(extractArchive).not.toHaveBeenCalled();

      const succeeding = createTtsRuntimeController({ ...baseDeps });
      await succeeding.setConfig({ pythonRuntimeSha256: correctSha256 });
      await succeeding.setup();
      expect(extractArchive).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it("persists a custom model cache dir for the next sidecar start", async () => {
    let config = "";
    const spawnProcess = vi.fn(() => ({ pid: 43, kill: vi.fn() }));
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath === "/custom/huggingface/hub"
        || filePath.includes("main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith(".deps-hash")) return "ready";
        return config || null;
      },
      writeTextFile: (_filePath, value) => {
        config = value;
      },
      runPython: mockPython312(),
      spawnProcess,
      fetchJson,
    });

    await expect(controller.setModelCacheDir("/custom/huggingface")).resolves.toMatchObject({ success: true });
    await expect(controller.start()).resolves.toMatchObject({ success: true });

    expect(spawnProcess).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          MANYING_TTS_MODELS_DIR: "/custom/huggingface",
          VOICEBOX_MODELS_DIR: "/custom/huggingface",
          HF_HUB_CACHE: expect.stringContaining("huggingface"),
        }),
      }),
    );
  });

  it("can start a sidecar copied into packaged app resources", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 77, kill: vi.fn() }));
    const packagedRoot = "/resources/backend";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      sidecarRoots: [packagedRoot],
      fileExists: (filePath) => (
        filePath === `${packagedRoot}/tts/main.py`
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      expect.any(Array),
      expect.objectContaining({
        cwd: packagedRoot,
      }),
    );
  });

  it("downloads Python into project storage through explicit setup", async () => {
    const ensureDir = vi.fn();
    let extracted = false;
    const writeFile = vi.fn();
    const renameFile = vi.fn();
    const removeFile = vi.fn();
    const extractArchive = vi.fn().mockImplementation(async () => {
      extracted = true;
    });
    const runPython = mockPython312();
    const fetchRuntimeArchive = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: new Uint8Array([1, 2, 3]),
      totalBytes: 3,
    });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || (extracted && filePath === "/project-storage/python/bin/python3")
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir,
      writeBinaryFile: writeFile,
      renameFile,
      removeFile,
      extractArchive,
      runPython,
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "" : null),
      writeTextFile: vi.fn(),
      spawnProcess: vi.fn(),
      fetchRuntimeArchive,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.setup();

    expect(result.success).toBe(true);
    expect(ensureDir).toHaveBeenCalledWith("/project-storage");
    expect(writeFile).toHaveBeenCalledWith("/project-storage/python-runtime.tar.gz.partial", expect.any(Uint8Array));
    expect(renameFile).toHaveBeenCalledWith(
      "/project-storage/python-runtime.tar.gz.partial",
      "/project-storage/python-runtime.tar.gz",
    );
    expect(extractArchive).toHaveBeenCalledWith(
      "/project-storage/python-runtime.tar.gz",
      "/project-storage",
    );
    expect(removeFile).toHaveBeenCalledWith("/project-storage/python-runtime.tar.gz");
    await expect(controller.status()).resolves.toMatchObject({
      setupStage: "ready",
      setupMessage: "Python 运行环境已配置",
      setupProgress: 100,
    });
  });

  it("does not configure Python from start when the runtime is missing", async () => {
    const fetchRuntimeArchive = vi.fn();
    const spawnProcess = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      ensureDir: vi.fn(),
      runPython: vi.fn().mockRejectedValue(new Error("missing system python")),
      fetchRuntimeArchive,
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("请先到设置里的本地配置页的 Python 运行环境区块完成配置");
    expect(fetchRuntimeArchive).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("does not start with system Python before TTS dependencies are configured", async () => {
    const spawnProcess = vi.fn();
    const runPython = vi.fn().mockResolvedValue(undefined);
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "fastapi\n" : null),
      writeTextFile: vi.fn(),
      runPython,
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("本地配置页的 Python 运行环境区块完成配置");
    expect(runPython).not.toHaveBeenCalledWith("python3", ["--version"], expect.any(Object));
    expect(spawnProcess).not.toHaveBeenCalled();
  });

const mockPython312WithDepsProof = (report: unknown) => vi.fn(async (_command: string, args: string[]) => {
  if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
  if (args.includes("--dry-run")) return { stdout: typeof report === "string" ? report : JSON.stringify(report), stderr: "" };
  return undefined;
});

const md5RequirementsHash = (pythonPath: string, reqContent: string) => nodeCrypto
  .createHash("md5")
  .update(`${pythonPath}\n${reqContent}`)
  .digest("hex");

describe("TTS runtime stale-marker offline self-healing", () => {
  const pythonPath = "/project-storage/python/bin/python3";

  it("heals a stale dependency marker after the offline dry-run proof and starts", async () => {
    // 场景:Python 已安装、依赖实际就绪,但 .deps-hash marker 因升级等原因失配
    // (用户截图中的 "TTS Python 依赖未配置 / 0%" 必须被离线证明自愈,不再 fail-closed)
    const reqContent = "fastapi\nuvicorn\n";
    const expectedReqHash = md5RequirementsHash(pythonPath, reqContent);
    const spawnProcess = vi.fn(() => ({ pid: 120, kill: vi.fn() }));
    let markerValue = "stale-hash-from-old-version";
    const writeTextFile = vi.fn((filePath: string, value: string) => {
      if (filePath.endsWith(".deps-hash")) markerValue = value;
    });
    const runPython = mockPython312WithDepsProof({ version: "1", install: [] });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return reqContent;
        if (filePath.endsWith(".deps-hash")) return markerValue;
        return null;
      },
      writeTextFile,
      runPython,
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect("stale-hash-from-old-version").not.toBe(expectedReqHash);
    expect(writeTextFile).toHaveBeenCalledWith("/project-storage/TTS/runtime/.deps-hash", expectedReqHash);
    expect(runPython).toHaveBeenCalledWith(
      pythonPath,
      ["-m", "pip", "install", "--dry-run", "--no-index", "--report", "-", "--quiet", "-r", "/backend/requirements.txt"],
      expect.any(Object),
    );
    expect(spawnProcess).toHaveBeenCalled();
    await expect(controller.status()).resolves.toMatchObject({
      setupStage: "ready",
      dependenciesReady: true,
    });
  });

  it("heals a missing dependency marker the same way on a fresh install", async () => {
    const reqContent = "fastapi\n";
    const expectedReqHash = md5RequirementsHash(pythonPath, reqContent);
    const spawnProcess = vi.fn(() => ({ pid: 121, kill: vi.fn() }));
    const writeTextFile = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? reqContent : null),
      writeTextFile,
      runPython: mockPython312WithDepsProof({ install: [] }),
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith("/project-storage/TTS/runtime/.deps-hash", expectedReqHash);
    expect(spawnProcess).toHaveBeenCalled();
  });

  it("fails closed when the offline proof reports pending installs", async () => {
    const spawnProcess = vi.fn();
    const writeTextFile = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return "fastapi\n";
        if (filePath.endsWith(".deps-hash")) return "stale-hash";
        return null;
      },
      writeTextFile,
      runPython: mockPython312WithDepsProof({ install: [{ name: "fastapi", version: "1.0.0" }] }),
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("本地配置页的 Python 运行环境区块点击开始配置");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the probe emits malformed JSON", async () => {
    const spawnProcess = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return "fastapi\n";
        if (filePath.endsWith(".deps-hash")) return "stale-hash";
        return null;
      },
      writeTextFile: vi.fn(),
      runPython: mockPython312WithDepsProof("this is not json"),
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("本地配置页");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the probe command itself fails", async () => {
    const spawnProcess = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return "fastapi\n";
        if (filePath.endsWith(".deps-hash")) return "stale-hash";
        return null;
      },
      writeTextFile: vi.fn(),
      runPython: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
        throw new Error("pip crashed");
      }),
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("本地配置页的 Python 运行环境区块点击开始配置");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps the matching-marker fast path and never probes pip", async () => {
    const reqContent = "fastapi\n";
    const expectedReqHash = md5RequirementsHash(pythonPath, reqContent);
    const spawnProcess = vi.fn(() => ({ pid: 122, kill: vi.fn() }));
    const runPython = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
      throw new Error("pip must not be invoked when the marker matches");
    });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return reqContent;
        if (filePath.endsWith(".deps-hash")) return expectedReqHash;
        return null;
      },
      writeTextFile: vi.fn(),
      runPython,
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(runPython).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalled();
  });

  it("reports explicit sidecar/python/dependency truth in status", async () => {
    const reqContent = "fastapi\n";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return reqContent;
        if (filePath.endsWith(".deps-hash")) return md5RequirementsHash(pythonPath, reqContent);
        return null;
      },
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      installed: true,
      sidecarAvailable: true,
      pythonInstalled: true,
      pythonExecutablePath: pythonPath,
      dependenciesReady: true,
    });
  });

  it("reports dependency truth as false when Python is not installed", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      sidecarAvailable: true,
      pythonInstalled: false,
      pythonExecutablePath: undefined,
      dependenciesReady: false,
    });
  });

  it("reads requirements from the active sidecar root, not persisted install history", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      readTextFile: (filePath) => {
        if (filePath.endsWith("config.json")) {
          return JSON.stringify({
            installedItems: [
              { label: "TTS Python 依赖", detail: "/old-install/backend/requirements.txt", status: "installed" },
            ],
          });
        }
        if (filePath === "/old-install/backend/requirements.txt") return "stale-content\n";
        if (filePath.endsWith("requirements.txt")) return "fastapi\n";
        return null;
      },
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.readRequirements()).resolves.toEqual({
      content: "fastapi\n",
      path: "/backend/requirements.txt",
    });
  });

  it("scanModelInventory returns offline model statuses without spawning the backend", async () => {
    const pythonPath = "/project-storage/python/bin/python3";
    const inventoryPayload = { models: [
      { model_name: "qwen-tts-0.6B", downloaded: true, downloading: false, loaded: false },
      { model_name: "qwen-tts-1.7B", downloaded: false, downloading: false, loaded: false },
    ] };
    const runPython = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
      if (args.some((a) => a.includes("model_inventory"))) return { stdout: JSON.stringify(inventoryPayload) };
      return undefined;
    });
    const spawnProcess = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "fastapi\n" : null),
      runPython,
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const inventory = await controller.scanModelInventory();

    expect(inventory).toHaveLength(2);
    expect(inventory[0]).toMatchObject({ model_name: "qwen-tts-0.6B", downloaded: true });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("scanModelInventory fails closed to an empty list when Python is missing", async () => {
    const spawnProcess = vi.fn();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.scanModelInventory()).resolves.toEqual([]);
  });

  it("scanModelInventory fails closed to an empty list on malformed JSON", async () => {
    const pythonPath = "/project-storage/python/bin/python3";
    const runPython = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "--version") return { stdout: "Python 3.12.7\n", stderr: "" };
      if (args.some((a) => a.includes("model_inventory"))) return { stdout: "not json" };
      return undefined;
    });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === pythonPath
        || filePath.endsWith("requirements.txt")
      ),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "fastapi\n" : null),
      runPython,
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.scanModelInventory()).resolves.toEqual([]);
  });
});

  it("rejects a managed Python runtime that is not Python 3.12", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 44, kill: vi.fn() }));
    const runPython = vi.fn().mockResolvedValue({ stdout: "Python 3.9.6\n" });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython,
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Python 3.12");
    expect(runPython).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      ["--version"],
      expect.any(Object),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("filters legacy system Python install records from runtime config", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      readTextFile: (filePath) => (
        filePath.endsWith("config.json")
          ? JSON.stringify({
              installedItems: [
                { label: "Python 运行环境", detail: "python3", status: "skipped" },
                { label: "Python 运行环境", detail: "/project-storage/runtime/python/python/bin/python3", status: "installed" },
                { label: "TTS Python 依赖", detail: "/backend/requirements.txt", status: "failed" },
              ],
            })
          : null
      ),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.getConfig()).resolves.toMatchObject({
      installedItems: [
        expect.objectContaining({ label: "TTS Python 依赖", status: "failed" }),
      ],
    });
    await expect(controller.getConfig()).resolves.not.toMatchObject({
      installedItems: expect.arrayContaining([
        expect.objectContaining({ label: "Python 运行环境", detail: "python3" }),
        expect.objectContaining({ label: "Python 运行环境", detail: "/project-storage/runtime/python/python/bin/python3" }),
      ]),
    });
  });

  it("configures Python only through the explicit setup command", async () => {
    let extracted = false;
    let config = "";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || (extracted && filePath === "/project-storage/python/bin/python3")
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return "";
        if (filePath.endsWith("config.json")) return config || null;
        return null;
      },
      writeTextFile: (filePath, value) => {
        if (filePath.endsWith("config.json")) config = value;
      },
      writeBinaryFile: vi.fn(),
      renameFile: vi.fn(),
      removeFile: vi.fn(),
      extractArchive: vi.fn().mockImplementation(async () => {
        extracted = true;
      }),
      runPython: mockPython312(),
      fetchRuntimeArchive: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: new Uint8Array([1, 2, 3]),
      }),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.setup()).resolves.toMatchObject({ success: true });
    await expect(controller.getConfig()).resolves.toMatchObject({
      installedItems: expect.arrayContaining([
        expect.objectContaining({ label: "Python 运行环境", status: "installed" }),
        expect.objectContaining({ label: "TTS Python 依赖", status: "installed" }),
      ]),
    });
  });

  it("uses managed Python 3.12 runtime during explicit setup even when system Python exists", async () => {
    let extracted = false;
    const runPython = mockPython312();
    const fetchRuntimeArchive = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: new Uint8Array([1, 2, 3]),
    });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || (extracted && filePath === "/project-storage/python/bin/python3")
        || filePath.endsWith("requirements.txt")
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "fastapi\n" : null),
      writeTextFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      renameFile: vi.fn(),
      removeFile: vi.fn(),
      extractArchive: vi.fn().mockImplementation(async () => {
        extracted = true;
      }),
      runPython,
      fetchRuntimeArchive,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.setup()).resolves.toMatchObject({ success: true });

    expect(fetchRuntimeArchive).toHaveBeenCalled();
    expect(runPython).not.toHaveBeenCalledWith("python3", ["-m", "pip", "install", "-r", "/backend/requirements.txt"], expect.any(Object));
    expect(runPython).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      ["-m", "pip", "install", "-r", "/backend/requirements.txt"],
      expect.any(Object),
    );
  });

  it("reports Python download progress and cleans partial archives on failure", async () => {
    const removeFile = vi.fn();
    const runPython = vi.fn().mockRejectedValue(new Error("missing system python"));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      removeFile,
      runPython,
      spawnProcess: vi.fn(),
      fetchRuntimeArchive: vi.fn(async (_url, _dest, onProgress) => {
        onProgress?.({ downloadedBytes: 25, totalBytes: 100, progress: 25 });
        return { ok: false, status: 503, data: new Uint8Array(), totalBytes: 100 };
      }),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.setup();

    expect(result.success).toBe(false);
    expect(result.status).toMatchObject({
      setupStage: "failed",
      setupMessage: "Python 下载失败",
      setupProgress: 25,
      pythonRuntimeDir: "/project-storage/python",
    });
    expect(result.error).toContain("下载 Python 失败");
    expect(removeFile).toHaveBeenCalledWith("/project-storage/python-runtime.tar.gz.partial");
  });

  it("reports dependency installation while configuring the Python repository", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 80, kill: vi.fn() }));
    const runPython = mockPython312();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
        || filePath.endsWith("requirements.txt")
      ),
      readTextFile: (filePath) => (filePath.endsWith("requirements.txt") ? "fastapi\n" : null),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
      runPython,
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.setup();

    expect(result.success).toBe(true);
    expect(runPython).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      ["-m", "pip", "install", "-r", "/backend/requirements.txt"],
      expect.any(Object),
    );
    expect(result.status).toMatchObject({
      setupStage: "ready",
      setupProgress: 100,
    });
  });

  it("reinstalls dependencies when the Python runtime path changes", async () => {
    const writes: Array<[string, string]> = [];
    const runPython = mockPython312();
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
        || filePath.endsWith("requirements.txt")
      ),
      readTextFile: (filePath) => {
        if (filePath.endsWith("requirements.txt")) return "fastapi\n";
        if (filePath.endsWith(".deps-hash")) return "old-python-path";
        return null;
      },
      ensureDir: vi.fn(),
      writeTextFile: (filePath, value) => writes.push([filePath, value]),
      runPython,
      spawnProcess: vi.fn(() => ({ pid: 81, kill: vi.fn() })),
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    await expect(controller.setup()).resolves.toMatchObject({ success: true });

    expect(runPython).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      ["-m", "pip", "install", "-r", "/backend/requirements.txt"],
      expect.any(Object),
    );
    expect(writes.some(([filePath]) => filePath.endsWith(".deps-hash"))).toBe(true);
  });

  it("does not treat a stale already-running backend as the new default start state", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 88, kill: vi.fn() }));
    const findListeningPids = vi.fn().mockResolvedValue([39835]);
    const killProcess = vi.fn().mockReturnValue(true);
    const fetchJson = vi.fn()
      .mockResolvedValueOnce({ ok: true, service: "manying-voicebox-tts" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, service: "manying-voicebox-tts" });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess,
      fetchJson,
      findListeningPids,
      killProcess,
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(killProcess).toHaveBeenCalledWith(39835);
    expect(spawnProcess).toHaveBeenCalled();
  });

  it("refuses to start when the local TTS port is occupied by a process it cannot clean up", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ ok: true, service: "manying-voicebox-tts" });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py"),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
      spawnProcess: vi.fn(),
      fetchJson,
      findListeningPids: vi.fn().mockResolvedValue([]),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("端口已被本地 TTS 残留进程占用");
  });

  it("stops an already-running backend through the local shutdown endpoint", async () => {
    const fetchJson = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ message: "TTS backend shutting down" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      ensureDir: vi.fn(),
      spawnProcess: vi.fn(),
      fetchJson,
    });

    const result = await controller.stop();

    expect(result.success).toBe(true);
    expect(fetchJson).toHaveBeenCalledWith("http://127.0.0.1:17593/shutdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manying-TTS-Token": "token-1",
      },
      body: JSON.stringify({ token: "token-1" }),
    });
  });

  it("cleans up a stale MYStudio backend process when the old sidecar has no shutdown route", async () => {
    const findListeningPids = vi.fn().mockResolvedValue([39835]);
    const killProcess = vi.fn().mockReturnValue(true);
    const fetchJson = vi.fn()
      .mockResolvedValueOnce({ ok: true, service: "manying-voicebox-tts" })
      .mockRejectedValueOnce(new Error("not found"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      ensureDir: vi.fn(),
      spawnProcess: vi.fn(),
      fetchJson,
      findListeningPids,
      killProcess,
    });

    const result = await controller.stop();

    expect(result.success).toBe(true);
    expect(findListeningPids).toHaveBeenCalledWith(17593, "127.0.0.1");
    expect(killProcess).toHaveBeenCalledWith(39835);
  });

  it("does not report running when the spawned sidecar is not healthy", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 99, kill: vi.fn() }));
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValue(new Error("offline"));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess,
      fetchJson,
    });

    await expect(controller.start()).resolves.toMatchObject({ success: true });
    await expect(controller.status()).resolves.toMatchObject({
      running: false,
      error: expect.stringContaining("不可达"),
    });
  });

  it("proxies JSON requests to the local backend base URL", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ models: [] });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
      fetchJson,
    });

    await expect(controller.request("GET", "/models/status")).resolves.toEqual({ models: [] });
    expect(fetchJson).toHaveBeenCalledWith("http://127.0.0.1:17593/models/status", {
      method: "GET",
      headers: {
        "X-Manying-TTS-Token": "token-1",
      },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("prepares Whisper alignment through the managed TTS runtime and shared model cache", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 101, kill: vi.fn() }));
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ models: [{ model_name: "whisper-large-v3-turbo", downloaded: false, downloading: false }] })
      .mockResolvedValueOnce({ message: "download started" })
      .mockResolvedValueOnce({ status: "downloading", progress: 50 })
      .mockResolvedValueOnce({ models: [{ model_name: "whisper-large-v3-turbo", downloaded: true, downloading: false }] })
      .mockResolvedValue({ ok: true });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("tts/main.py")
        || filePath === "/project-storage/python/bin/python3"
      ),
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess,
      fetchJson,
      sleep: vi.fn(async () => undefined),
      alignmentModelPollIntervalMs: 0,
      alignmentModelPollAttempts: 2,
    });

    await expect(controller.prepareAlignmentModel()).resolves.toMatchObject({ success: true });
    expect(fetchJson).toHaveBeenCalledWith(
      "http://127.0.0.1:17593/models/download",
      expect.objectContaining({ body: JSON.stringify({ model_name: "whisper-large-v3-turbo" }) }),
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      "/project-storage/python/bin/python3",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          MANYING_TTS_MODELS_DIR: "/project-storage/model/TTS",
          VOICEBOX_MODELS_DIR: "/project-storage/model/TTS",
        }),
      }),
    );
  });

  it("fails closed when Whisper model download reports an error", async () => {
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ models: [{ model_name: "whisper-large-v3-turbo", downloaded: false, downloading: false }] })
      .mockResolvedValueOnce({ message: "download started" })
      .mockResolvedValueOnce({ status: "error", error: "network unavailable" })
      .mockResolvedValue({ ok: true });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("tts/main.py") || filePath === "/project-storage/python/bin/python3",
      ensureDir: vi.fn(),
      readTextFile: (filePath) => (filePath.endsWith(".deps-hash") ? "ready" : null),
      writeTextFile: vi.fn(),
      runPython: mockPython312(),
      spawnProcess: vi.fn(() => ({ pid: 102, kill: vi.fn() })),
      fetchJson,
      sleep: vi.fn(async () => undefined),
      alignmentModelPollIntervalMs: 0,
      alignmentModelPollAttempts: 1,
    });

    await expect(controller.prepareAlignmentModel()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("network unavailable"),
    });
    await expect(controller.status()).resolves.toMatchObject({
      setupStage: "failed",
      setupMessage: "Whisper 对齐模型下载失败",
    });
  });

  it("preserves storyboard emotion fields across the Electron JSON bridge", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ id: "generation-1", status: "queued" });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
      fetchJson,
    });
    const body = {
      text: "逐镜对白",
      emotion: "紧张",
      voice_style: "中文角色对白，紧张，停顿自然。",
    };

    await controller.request("POST", "/generate", body);

    expect(fetchJson).toHaveBeenCalledWith("http://127.0.0.1:17593/generate", {
      method: "POST",
      headers: {
        "X-Manying-TTS-Token": "token-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    });
  });

  it("adds backend route context to failed proxied requests", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });

    await expect(controller.request("GET", "/models/status")).rejects.toThrow(
      "本地 TTS 后端请求失败: GET http://127.0.0.1:17593/models/status: fetch failed",
    );
  });

  it("decodes nested backend errors without losing the legacy thrown message", async () => {
    const body = {
      error: {
        detail: {
          error_code: "provider-unavailable",
          message: "模型暂不可用",
          retryable: true,
          status_code: 503,
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const fetchMock = vi.fn().mockResolvedValue(new Response(rawBody, {
      status: 503,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
    });

    const rejection = controller.request("GET", "/models/status");
    await expect(rejection).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: true,
      status: 503,
      envelope: {
        code: "provider-unavailable",
        message: "模型暂不可用",
        retryable: true,
        status: 503,
      },
      message: `本地 TTS 后端请求失败: GET http://127.0.0.1:17593/models/status: ${rawBody}`,
    });
  });

  it("classifies an aborted transport as non-retryable", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    });

    await expect(controller.request("GET", "/models/status")).rejects.toMatchObject({
      code: "aborted",
      retryable: false,
      message: "本地 TTS 后端请求失败: GET http://127.0.0.1:17593/models/status: aborted",
    });
  });

  it("classifies transient HTTP statuses as retryable and validation errors as terminal", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "请求参数无效" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "服务繁忙" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
      spawnProcess: vi.fn(),
    });

    await expect(controller.request("POST", "/generate", { text: "台词" })).rejects.toMatchObject({
      status: 400,
      retryable: false,
      envelope: { code: "http-error", retryable: false, status: 400 },
    });
    await expect(controller.request("POST", "/generate", { text: "台词" })).rejects.toMatchObject({
      status: 429,
      retryable: true,
      envelope: { code: "http-error", retryable: true, status: 429 },
    });
  });

  it("uploads multipart voice samples with a bounded request and decodes JSON responses", async () => {
    const readFileSync = vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("wav-bytes"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "sample-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath: "/user-data",
        fileExists: () => true,
        readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
        spawnProcess: vi.fn(),
      });

      await expect(controller.requestFormData("/profiles/profile-1/samples", "/tmp/reference.wav", "台词"))
        .resolves.toEqual({ id: "sample-1" });

      expect(readFileSync).toHaveBeenCalledWith("/tmp/reference.wav");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:17593/profiles/profile-1/samples");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({ "X-Manying-TTS-Token": "token-1" });
      expect(options.headers?.["Content-Type"] ?? "").toMatch(/^multipart\/form-data; boundary=/);
      const multipartBody = Buffer.from(options.body as Uint8Array).toString("utf8");
      expect(multipartBody).toContain('name="file"');
      expect(multipartBody).toContain("wav-bytes");
      expect(multipartBody).toContain('name="reference_text"');
      expect(multipartBody).toContain("台词");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    } finally {
      readFileSync.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("surfaces multipart HTTP errors with the shared retry envelope", async () => {
    const readFileSync = vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("wav-bytes"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "服务繁忙" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })));
    try {
      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath: "/user-data",
        fileExists: () => true,
        readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
        spawnProcess: vi.fn(),
      });

      await expect(controller.requestFormData("/profiles/profile-1/samples", "/tmp/reference.wav"))
        .rejects.toMatchObject({
          code: "http-error",
          status: 503,
          retryable: true,
          envelope: { code: "http-error", status: 503, retryable: true },
        });
    } finally {
      readFileSync.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("classifies multipart aborts and deadline timeouts distinctly", async () => {
    const readFileSync = vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("wav-bytes"));
    try {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));
      const abortedController = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath: "/user-data",
        fileExists: () => true,
        readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
        spawnProcess: vi.fn(),
      });
      await expect(abortedController.requestFormData("/profiles/profile-1/samples", "/tmp/reference.wav"))
        .rejects.toMatchObject({ code: "aborted", retryable: false });

      vi.unstubAllGlobals();
      vi.useFakeTimers();
      const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      }));
      vi.stubGlobal("fetch", fetchMock);
      const timeoutController = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath: "/user-data",
        fileExists: () => true,
        readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
        spawnProcess: vi.fn(),
        requestTimeoutMs: 25,
      });
      const rejection = timeoutController.requestFormData("/profiles/profile-1/samples", "/tmp/reference.wav");
      const expected = expect(rejection).rejects.toMatchObject({ code: "timeout", retryable: true });
      await vi.advanceTimersByTimeAsync(25);
      await expected;
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:17593/profiles/profile-1/samples",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      readFileSync.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("aborts a stalled request at the bounded runtime deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchJson = vi.fn((_url: string, options: { signal?: AbortSignal }) => new Promise<unknown>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      }));
      const controller = createTtsRuntimeController({
        appRoot: "/repo",
        userDataPath: "/user-data",
        fileExists: () => true,
        readTextFile: () => JSON.stringify({ controlToken: "token-1" }),
        spawnProcess: vi.fn(),
        fetchJson,
        requestTimeoutMs: 25,
      });

      const rejection = controller.request("GET", "/models/status");
      const expected = expect(rejection).rejects.toMatchObject({
        code: "timeout",
        retryable: true,
        message: "本地 TTS 后端请求失败: GET http://127.0.0.1:17593/models/status: TTS backend request timed out after 25ms",
      });
      await vi.advanceTimersByTimeAsync(25);
      await expected;
      expect(fetchJson).toHaveBeenCalledWith(
        "http://127.0.0.1:17593/models/status",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
