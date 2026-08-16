// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), removed: [] as string[] }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => { state.removed.push(channel); state.handlers.delete(channel); }),
  },
}));

import { registerUpscaleIpcHandlers } from "./upscale-ipc";
import type { UpscaleRuntimeController, UpscaleRuntimeStatus } from "@rendering/plugins/upscale/upscale-runtime-controller";

const UPSCALE_CHANNELS = [
  "upscale-runtime-probe",
  "upscale-runtime-prepare",
  "upscale-runtime-rollback",
  "upscale-runtime-status",
  "upscale-runtime-setup",
  "upscale-runtime-refresh",
  "upscale-runtime-scan-model",
  "upscale-runtime-download-model",
  "upscale-runtime-download-progress",
  "upscale-runtime-set-active-model",
  "upscale-run",
  "upscale-runtime-get-config",
  "upscale-runtime-set-model-cache-dir",
  "upscale-runtime-delete-model",
] as const;

function makeController(overrides: Partial<UpscaleRuntimeController> = {}): UpscaleRuntimeController {
  const status: UpscaleRuntimeStatus = {
    state: "ready",
    setupStage: "ready",
    setupProgress: undefined,
    setupMessage: undefined,
    activeModel: "realesrgan-x4plus-anime-6b",
    modelDownloaded: true,
    modelSizeMb: 17.1,
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    downloadingModel: undefined,
    modelCacheDir: "/tmp/UpscaleModel",
  };
  return {
    status: () => status,
    setup: vi.fn(async () => status),
    rollback: vi.fn(async () => status),
    refresh: vi.fn(async () => status),
    scanModelInventory: vi.fn(async () => ({ models: [] })),
    downloadModel: vi.fn(async () => ({ accepted: true, message: "ok" })),
    readDownloadProgress: vi.fn(() => ({ status: "idle", progress: 0, current: 0, total: 0 })),
    runUpscale: vi.fn(async () => ({
      artifact: {
        schemaVersion: 1,
        projectId: "p1",
        shotId: "unknown",
        status: "accepted",
        model: "realesrgan-x4plus-anime-6b",
        method: "super_res",
        scale: 4,
        inputSha256: "a".repeat(64),
        outputSha256: "b".repeat(64),
        outputPath: "/tmp/out.png",
        width: 4096,
        height: 6144,
        toolVersion: "upscale@0.1.0",
        generatedAt: 1,
      },
    })),
    setActiveModel: vi.fn(() => ({ success: true })),
    getModelCacheDir: vi.fn(() => "/tmp/UpscaleModel"),
    setModelCacheDir: vi.fn(async () => ({ success: true })),
    deleteModel: vi.fn(async () => ({ success: true })),
    paths: {
      storageBasePath: "/tmp/storage",
      pythonRuntimeDir: "/tmp/storage/python",
      pythonExecutable: "/tmp/storage/python/bin/python3",
      upscaleProfileDir: "/tmp/storage/python/profiles/upscale",
      upscaleLockPath: "/tmp/storage/python/profiles/upscale/requirements-upscale.lock",
      upscaleMarkerPath: "/tmp/storage/python/profiles/upscale/profile.json",
      ffmpegExecutable: "",
      ffprobeExecutable: "",
    },
    lastUpdatedAt: 0,
    ...overrides,
  } as UpscaleRuntimeController;
}

beforeEach(() => { state.handlers.clear(); state.removed.length = 0; });

describe("Upscale IPC", () => {
  it("registers every upscale channel as string literals and disposes them", () => {
    const controller = makeController();
    const registration = registerUpscaleIpcHandlers({ controller });
    for (const channel of UPSCALE_CHANNELS) {
      expect(state.handlers.has(channel), channel).toBe(true);
    }
    registration.dispose();
    expect(state.removed).toEqual([...UPSCALE_CHANNELS]);
  });

  it("proxies upscale-run payloads to the controller verbatim", async () => {
    const controller = makeController();
    registerUpscaleIpcHandlers({ controller });
    const handler = state.handlers.get("upscale-run")!;
    const payload = {
      schemaVersion: 1,
      projectId: "p1",
      model: "realesrgan-x4plus-anime-6b",
      inputImagePath: "workflow-images/wf/gen.png",
      outputImagePath: "workflow-images/wf/up4x-gen.png",
    };
    const result = await handler({}, payload);
    expect(controller.runUpscale).toHaveBeenCalledWith(payload);
    expect(result).toMatchObject({ artifact: { status: "accepted", scale: 4 } });
  });

  it("defaults download-model to the active model and validates payloads", async () => {
    const controller = makeController();
    registerUpscaleIpcHandlers({ controller });
    const download = state.handlers.get("upscale-runtime-download-model")! as Handler;
    await download({}, { model: "realesrgan-x4plus" });
    expect(controller.downloadModel).toHaveBeenCalledWith("realesrgan-x4plus");
    await download({}, undefined);
    expect(controller.downloadModel).toHaveBeenCalledWith("realesrgan-x4plus-anime-6b");
    await download({}, 42);
    expect(controller.downloadModel).toHaveBeenLastCalledWith("realesrgan-x4plus-anime-6b");

    const setActive = state.handlers.get("upscale-runtime-set-active-model")! as Handler;
    await setActive({}, 123);
    expect(controller.setActiveModel).not.toHaveBeenCalled();

    const setCache = state.handlers.get("upscale-runtime-set-model-cache-dir")! as Handler;
    await setCache({}, { dir: "/tmp/new-cache" });
    expect(controller.setModelCacheDir).toHaveBeenCalledWith("/tmp/new-cache");
    await setCache({}, 123);
    expect(controller.setModelCacheDir).toHaveBeenLastCalledWith("/tmp/new-cache");
  });

  it("probe returns a validated status and downgrades invalid payloads to blocked", async () => {
    const controller = makeController();
    registerUpscaleIpcHandlers({ controller });
    const probe = state.handlers.get("upscale-runtime-probe")! as Handler;
    const result = await probe({}, { schemaVersion: 1 }) as Record<string, unknown>;
    expect(result).toMatchObject({
      schemaVersion: 1,
      state: "ready",
      activeModel: "realesrgan-x4plus-anime-6b",
      modelDownloaded: true,
      modelCacheDir: "/tmp/UpscaleModel",
    });
    const invalid = await probe({}, { schemaVersion: 99, extra: true }) as Record<string, unknown>;
    expect(invalid.state).toBe("blocked");
  });
});
