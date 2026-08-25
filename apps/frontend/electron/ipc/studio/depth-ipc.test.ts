import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEPTH_CHANNELS,
  DEPTH_PREPARE_CHANNEL,
  DEPTH_PROBE_CHANNEL,
  DEPTH_ROLLBACK_CHANNEL,
  validateDepthRuntimeActionReply,
  validateDepthRuntimeStatus,
} from "@rendering/contracts/depth-workflow";
import type {
  DepthRuntimeController,
  DepthRuntimeStatus,
} from "@rendering/plugins/depth/depth-runtime-controller";

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { handlers, removeHandler } = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });
  return { handlers, removeHandler };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
    removeHandler,
  },
}));

vi.mock("@rendering/plugins/video-workflow/video-pipeline-log-bundle", () => ({
  createVideoPipelineLogBundle: vi.fn(),
  writeLogBundle: vi.fn(),
}));

import { registerDepthIpcHandlers } from "./depth-ipc";

function runtimeStatus(overrides: Partial<DepthRuntimeStatus> = {}): DepthRuntimeStatus {
  return {
    state: "needs-runtime",
    setupStage: "idle",
    setupProgress: undefined,
    setupMessage: undefined,
    modelDownloaded: false,
    modelSizeMb: null,
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    cinematicPreset: "cinematic-dolly-in",
    cinematicPresetMode: "auto",
    cinematicPresetCount: 0,
    modelCacheDir: "/tmp/mystudio-depth-model",
    probeEvidence: {
      pythonAvailable: true,
      pythonVersion: "Python 3.12.7",
      workerProbe: "ready",
      workerToolVersion: "depth-estimation@0.1.0",
      modelWeightSha256: "a".repeat(64),
    },
    ...overrides,
  };
}

function createController(overrides: Partial<DepthRuntimeStatus> = {}) {
  const status = runtimeStatus(overrides);
  const controller = {
    status: vi.fn(() => status),
    ensureScanned: vi.fn(async () => undefined),
    setup: vi.fn(async () => status),
    rollback: vi.fn(async () => runtimeStatus({ state: "needs-runtime" })),
    refresh: vi.fn(async () => status),
  };
  return controller as unknown as DepthRuntimeController & typeof controller;
}

function register(controller: DepthRuntimeController) {
  return registerDepthIpcHandlers({
    controller,
    getDataRoot: () => "/tmp/mystudio-data",
    getDiagnosticsDir: () => "/tmp/mystudio-diagnostics",
    getLogBundleDir: () => "/tmp/mystudio-log-bundles",
  });
}

describe("depth runtime lifecycle IPC", () => {
  beforeEach(() => {
    handlers.clear();
    removeHandler.mockClear();
  });

  it("registers and probes the canonical handlers with the default request", async () => {
    const controller = createController({ state: "ready", modelDownloaded: true });
    const registration = register(controller);

    expect(DEPTH_CHANNELS.every((channel) => handlers.has(channel))).toBe(true);
    const reply = await handlers.get(DEPTH_PROBE_CHANNEL)?.({});

    expect(reply).toMatchObject({
      schemaVersion: 1,
      state: "ready",
      model: "depth-anything-v2-small",
      modelCacheDir: "/tmp/mystudio-depth-model",
      modelDownloaded: true,
      probe: expect.objectContaining({ workerProbe: "ready", modelWeightSha256: "a".repeat(64) }),
    });
    expect(validateDepthRuntimeStatus(reply)).toMatchObject({ success: true });
    expect(controller.refresh).toHaveBeenCalled();
    registration.dispose();
  });

  it("fails closed with a valid status when probe evidence is malformed", async () => {
    const controller = createController({
      state: "ready",
      modelDownloaded: true,
      probeEvidence: { pythonAvailable: "yes", workerProbe: "ready" } as unknown as DepthRuntimeStatus["probeEvidence"],
    });
    const registration = register(controller);

    const reply = await handlers.get(DEPTH_PROBE_CHANNEL)?.({}, { schemaVersion: 1 });

    expect(reply).toMatchObject({
      state: "error",
      modelDownloaded: false,
      probe: { pythonAvailable: false, workerProbe: "blocked" },
      message: "深度运行时状态无效",
    });
    expect(validateDepthRuntimeStatus(reply)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("fails closed with a valid action reply when prepare evidence is malformed", async () => {
    const controller = createController({
      state: "ready",
      modelDownloaded: true,
      probeEvidence: { pythonAvailable: true, workerProbe: "unknown" } as unknown as DepthRuntimeStatus["probeEvidence"],
    });
    const registration = register(controller);

    const reply = await handlers.get(DEPTH_PREPARE_CHANNEL)?.({}, { schemaVersion: 1 });

    expect(reply).toMatchObject({
      success: false,
      code: "invalid-reply",
      status: {
        state: "error",
        modelDownloaded: false,
        probe: { pythonAvailable: false, workerProbe: "blocked" },
      },
    });
    expect(validateDepthRuntimeActionReply(reply)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("rejects a null lifecycle request before prepare", async () => {
    const controller = createController();
    const registration = register(controller);
    const handler = handlers.get(DEPTH_PREPARE_CHANNEL);

    const nullReply = await handler?.({}, null);
    expect(nullReply).toMatchObject({ success: false, code: "invalid-request" });
    expect(controller.setup).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("rejects an unknown-field lifecycle request before prepare", async () => {
    const controller = createController();
    const registration = register(controller);
    const handler = handlers.get(DEPTH_PREPARE_CHANNEL);

    const unknownReply = await handler?.({}, { schemaVersion: 1, extra: true });
    expect(unknownReply).toMatchObject({ success: false, code: "invalid-request" });
    expect(controller.setup).not.toHaveBeenCalled();
    expect(validateDepthRuntimeActionReply(unknownReply)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("maps a prepare exception to the typed prepare-failed code", async () => {
    const controller = createController();
    controller.setup.mockRejectedValueOnce(new Error("worker unavailable"));
    const registration = register(controller);

    const reply = await handlers.get(DEPTH_PREPARE_CHANNEL)?.({}, { schemaVersion: 1 });

    expect(reply).toMatchObject({
      schemaVersion: 1,
      success: false,
      code: "prepare-failed",
      message: "worker unavailable",
      status: { state: "needs-runtime" },
    });
    expect(validateDepthRuntimeActionReply(reply)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("returns a successful needs-runtime state after rollback", async () => {
    const controller = createController({ state: "ready", modelDownloaded: true });
    controller.rollback.mockResolvedValueOnce(runtimeStatus({ state: "needs-runtime", modelDownloaded: false }));
    const registration = register(controller);

    const reply = await handlers.get(DEPTH_ROLLBACK_CHANNEL)?.({}, { schemaVersion: 1 });

    expect(reply).toMatchObject({
      schemaVersion: 1,
      success: true,
      status: { state: "needs-runtime", modelDownloaded: false },
    });
    expect(validateDepthRuntimeActionReply(reply)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("disposes all three canonical lifecycle handlers", () => {
    const registration = register(createController());
    expect(DEPTH_CHANNELS.every((channel) => handlers.has(channel))).toBe(true);

    registration.dispose();

    expect(DEPTH_CHANNELS.every((channel) => !handlers.has(channel))).toBe(true);
    expect(removeHandler.mock.calls.map(([channel]) => channel)).toEqual(
      expect.arrayContaining([...DEPTH_CHANNELS]),
    );
  });
});
