import { describe, expect, it, vi } from "vitest";
import { createTtsRuntimeController } from "./tts-runtime";

describe("TTS runtime controller", () => {
  it("reports the MYStudio Voicebox sidecar on port 17593", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      installed: true,
      running: false,
      port: 17593,
      baseUrl: "http://127.0.0.1:17593",
      cacheDir: "/user-data/tts-runtime",
      modelCacheDir: "/user-data/tts-models",
      defaultModelCacheDir: "/user-data/tts-models",
    });
  });

  it("starts the Python sidecar with isolated runtime data", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 42, kill: vi.fn() }));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      pythonBinary: "python3",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "python3",
      [
        "-m",
        "manying_voicebox_tts.main",
        "--host",
        "127.0.0.1",
        "--port",
        "17593",
        "--data-dir",
        "/user-data/tts-runtime",
      ],
      expect.objectContaining({
        cwd: "/backend",
        env: expect.objectContaining({
          MANYING_TTS_DATA_DIR: "/user-data/tts-runtime",
          MANYING_TTS_MODELS_DIR: "/user-data/tts-models",
          VOICEBOX_MODELS_DIR: "/user-data/tts-models",
          HF_HUB_CACHE: expect.stringContaining("huggingface"),
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
      pythonBinary: "python3",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      pythonRuntimeDir: "/project-storage/runtime/python",
    });
  });

  it("persists Python runtime download URL config for settings", async () => {
    let config = "";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
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
      pythonRuntimeDir: "/project-storage/runtime/python",
      defaultPythonRuntimeUrl: expect.stringContaining("python-build-standalone"),
    });
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
      pythonBinary: "python3",
      fileExists: (filePath) => filePath === "/custom/huggingface/hub" || filePath.includes("main.py"),
      ensureDir: vi.fn(),
      readTextFile: () => config || null,
      writeTextFile: (_filePath, value) => {
        config = value;
      },
      spawnProcess,
      fetchJson,
    });

    await expect(controller.setModelCacheDir("/custom/huggingface")).resolves.toMatchObject({ success: true });
    await expect(controller.start()).resolves.toMatchObject({ success: true });

    expect(spawnProcess).toHaveBeenCalledWith(
      "python3",
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
      pythonBinary: "python3",
      sidecarRoots: [packagedRoot],
      fileExists: (filePath) => filePath === `${packagedRoot}/manying_voicebox_tts/main.py`,
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
      spawnProcess,
      fetchJson: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true }),
    });

    const result = await controller.start();

    expect(result.success).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      "python3",
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
    const runPython = vi.fn().mockResolvedValue(undefined);
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
      pythonBinary: "python3",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
        || (extracted && filePath === "/project-storage/runtime/python/bin/python3")
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
    expect(ensureDir).toHaveBeenCalledWith("/project-storage/runtime/python");
    expect(writeFile).toHaveBeenCalledWith("/project-storage/runtime/python/python-runtime.tar.gz.partial", expect.any(Uint8Array));
    expect(renameFile).toHaveBeenCalledWith(
      "/project-storage/runtime/python/python-runtime.tar.gz.partial",
      "/project-storage/runtime/python/python-runtime.tar.gz",
    );
    expect(extractArchive).toHaveBeenCalledWith(
      "/project-storage/runtime/python/python-runtime.tar.gz",
      "/project-storage/runtime/python",
    );
    expect(removeFile).toHaveBeenCalledWith("/project-storage/runtime/python/python-runtime.tar.gz");
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
      pythonBinary: "python3",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      ensureDir: vi.fn(),
      runPython: vi.fn().mockRejectedValue(new Error("missing system python")),
      fetchRuntimeArchive,
      spawnProcess,
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    const result = await controller.start();

    expect(result.success).toBe(false);
    expect(result.error).toContain("请先到设置里的 Python 配置页完成配置");
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
      pythonBinary: "python3",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
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
    expect(result.error).toContain("点击开始配置");
    expect(runPython).toHaveBeenCalledWith("python3", ["--version"], expect.any(Object));
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("configures Python only through the explicit setup command", async () => {
    let extracted = false;
    let config = "";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      pythonBinary: "python3",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
        || (extracted && filePath === "/project-storage/runtime/python/bin/python3")
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
      runPython: vi.fn().mockResolvedValue(undefined),
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
    const runPython = vi.fn().mockResolvedValue(undefined);
    const fetchRuntimeArchive = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: new Uint8Array([1, 2, 3]),
    });
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      pythonBinary: "python3",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
        || (extracted && filePath === "/project-storage/runtime/python/bin/python3")
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
      "/project-storage/runtime/python/bin/python3",
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
      pythonBinary: "python3",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
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
      pythonRuntimeDir: "/project-storage/runtime/python",
    });
    expect(result.error).toContain("下载 Python 失败");
    expect(removeFile).toHaveBeenCalledWith("/project-storage/runtime/python/python-runtime.tar.gz.partial");
  });

  it("reports dependency installation while configuring the Python repository", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 80, kill: vi.fn() }));
    const runPython = vi.fn().mockResolvedValue(undefined);
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
        || filePath === "/project-storage/runtime/python/bin/python3"
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
      "/project-storage/runtime/python/bin/python3",
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
    const runPython = vi.fn().mockResolvedValue(undefined);
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      storageBasePath: () => "/project-storage",
      fileExists: (filePath) => (
        filePath.includes("manying_voicebox_tts/main.py")
        || filePath === "/project-storage/runtime/python/bin/python3"
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
      "/project-storage/runtime/python/bin/python3",
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
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
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
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
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
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValue(new Error("offline"));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: (filePath) => filePath.includes("manying_voicebox_tts/main.py"),
      ensureDir: vi.fn(),
      writeTextFile: vi.fn(),
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
});
