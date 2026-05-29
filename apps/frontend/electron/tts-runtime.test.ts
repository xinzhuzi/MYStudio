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
      spawnProcess: vi.fn(),
      fetchJson,
    });

    await expect(controller.request("GET", "/models/status")).resolves.toEqual({ models: [] });
    expect(fetchJson).toHaveBeenCalledWith("http://127.0.0.1:17593/models/status", {
      method: "GET",
      headers: undefined,
      body: undefined,
    });
  });

  it("adds backend route context to failed proxied requests", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });

    await expect(controller.request("GET", "/models/status")).rejects.toThrow(
      "本地 TTS 后端请求失败: GET http://127.0.0.1:17593/models/status: fetch failed",
    );
  });
});
