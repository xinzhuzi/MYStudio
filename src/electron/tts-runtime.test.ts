import { describe, expect, it, vi } from "vitest";
import { createTtsRuntimeController } from "./tts-runtime";

describe("TTS runtime controller", () => {
  it("reports the MYStudio Voicebox sidecar on port 17593", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(controller.status()).resolves.toMatchObject({
      installed: true,
      running: false,
      port: 17593,
      baseUrl: "http://127.0.0.1:17593",
      cacheDir: "/user-data/tts-runtime",
    });
  });

  it("starts the Python sidecar with isolated runtime data", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 42, kill: vi.fn() }));
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      ensureDir: vi.fn(),
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
        cwd: "/repo/src/sidecars/voicebox_tts_backend",
      }),
    );
  });

  it("can start a sidecar copied into packaged app resources", async () => {
    const spawnProcess = vi.fn(() => ({ pid: 77, kill: vi.fn() }));
    const packagedRoot = "/resources/sidecars/voicebox_tts_backend";
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      sidecarRoots: [packagedRoot],
      fileExists: (filePath) => filePath === `${packagedRoot}/manying_voicebox_tts/main.py`,
      ensureDir: vi.fn(),
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

  it("does not claim it stopped an externally managed backend", async () => {
    const controller = createTtsRuntimeController({
      appRoot: "/repo",
      userDataPath: "/user-data",
      fileExists: () => true,
      spawnProcess: vi.fn(),
      fetchJson: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await controller.stop();

    expect(result.success).toBe(false);
    expect(result.error).toContain("不是由 MYStudio 启动");
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
});
