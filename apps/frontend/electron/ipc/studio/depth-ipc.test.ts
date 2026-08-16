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
    ...overrides,
  };
}

function createController(overrides: Partial<DepthRuntimeStatus> = {}) {
  const status = runtimeStatus(overrides);
  const controller = {
    status: vi.fn(() => status),
    setup: vi.fn(async () => status),
    rollback: vi.fn(async () => runtimeStatus({ state: "needs-runtime" })),
  };
  return controller as unknown as DepthRuntimeController & typeof controller;
}

function register(controller: DepthRuntimeController) {
  return registerDepthIpcHandlers({
    controller,
    getDataRoot: () => "/tmp/mystudio-data",
    getDiagnosticsDir: () => "/tmp/mystudio-diagnostics",
    getExportDir: () => "/tmp/mystudio-exports",
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
    });
    expect(validateDepthRuntimeStatus(reply)).toMatchObject({ success: true });
    expect(controller.status).toHaveBeenCalled();
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
