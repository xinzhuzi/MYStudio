import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGE_GEN_CHANNELS,
  IMAGE_GEN_PREPARE_CHANNEL,
  IMAGE_GEN_PROBE_CHANNEL,
  IMAGE_GEN_ROLLBACK_CHANNEL,
  validateImageGenRuntimeActionReply,
  validateImageGenRuntimeStatus,
} from "@rendering/contracts/image-gen-workflow";
import type {
  ImageGenModelRow,
  ImageGenRuntimeController,
} from "@rendering/plugins/image_gen/image-gen-runtime-controller";

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { handlers, removeHandler } = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel));
  return { handlers, removeHandler };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler,
  },
}));

import { registerImageGenIpcHandlers } from "./image-gen-ipc";

function lifecycleStatus(state: "ready" | "needs-runtime" = "needs-runtime") {
  return {
    schemaVersion: 1 as const,
    state,
    activeModel: "qwen-image-edit-2511" as const,
    modelCacheDir: "/tmp/mystudio-image-model",
    modelDownloaded: state === "ready",
    pythonAvailable: true,
  };
}

function createController(
  activeModel: "qwen-image-edit-2511" | "z-image-turbo" | "flux2-klein-9b" | "krea2-turbo" = "qwen-image-edit-2511",
  models: ImageGenModelRow[] = [],
) {
  const legacy = {
    running: false,
    setupStage: "idle" as const,
    setupMessage: undefined,
    models,
    activeModel,
    downloadStatus: {},
    downloadProgress: {},
    downloadError: {},
  };
  return {
    status: vi.fn(() => legacy),
    getModelCacheDir: vi.fn(() => "/tmp/mystudio-image-model"),
    probeLifecycle: vi.fn(async () => ({ ...lifecycleStatus(), activeModel })),
    prepareLifecycle: vi.fn(async () => ({ ...lifecycleStatus("ready"), activeModel })),
    rollbackLifecycle: vi.fn(async () => lifecycleStatus()),
    setup: vi.fn(async () => legacy),
    stop: vi.fn(async () => undefined),
    scanModelInventory: vi.fn(async () => []),
    downloadModel: vi.fn(async () => ({ accepted: true, message: "ok" })),
    setActiveModel: vi.fn(() => true),
  } as unknown as ImageGenRuntimeController & Record<string, ReturnType<typeof vi.fn>>;
}

describe("local image generation lifecycle IPC", () => {
  beforeEach(() => {
    handlers.clear();
    removeHandler.mockClear();
  });

  it("registers typed probe/prepare/rollback handlers", async () => {
    const controller = createController();
    const registration = registerImageGenIpcHandlers({ controller });
    expect(IMAGE_GEN_CHANNELS.every((channel) => handlers.has(channel))).toBe(true);
    const probe = await handlers.get(IMAGE_GEN_PROBE_CHANNEL)?.({});
    expect(validateImageGenRuntimeStatus(probe)).toMatchObject({ success: true });
    const prepare = await handlers.get(IMAGE_GEN_PREPARE_CHANNEL)?.({}, { schemaVersion: 1 });
    expect(prepare).toMatchObject({ success: true, status: { state: "ready" } });
    expect(validateImageGenRuntimeActionReply(prepare)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("rejects null requests and maps rollback to needs-runtime", async () => {
    const controller = createController();
    const registration = registerImageGenIpcHandlers({ controller });
    const invalid = await handlers.get(IMAGE_GEN_PREPARE_CHANNEL)?.({}, null);
    expect(invalid).toMatchObject({ success: false, code: "invalid-request" });
    expect(controller.prepareLifecycle).not.toHaveBeenCalled();
    const rollback = await handlers.get(IMAGE_GEN_ROLLBACK_CHANNEL)?.({}, { schemaVersion: 1 });
    expect(rollback).toMatchObject({ success: true, status: { state: "needs-runtime" } });
    registration.dispose();
  });

  it("reports the controller's selected engine through lifecycle IPC", async () => {
    const controller = createController("flux2-klein-9b");
    const registration = registerImageGenIpcHandlers({ controller });
    const probe = await handlers.get(IMAGE_GEN_PROBE_CHANNEL)?.({});
    expect(probe).toMatchObject({ activeModel: "flux2-klein-9b", modelDownloaded: false });
    expect(validateImageGenRuntimeStatus(probe)).toMatchObject({ success: true });
    registration.dispose();
  });

  it("keeps Krea2 selected and blocks it when small pieces are missing", async () => {
    const controller = createController("krea2-turbo", [
      {
        modelName: "krea2-turbo",
        label: "Krea2 Turbo",
        downloaded: true,
        sizeMb: 35_000,
        repoId: "krea/Krea-2-Turbo",
        smallPiecesReady: false,
      },
    ]);
    const registration = registerImageGenIpcHandlers({ controller });
    const invalid = await handlers.get(IMAGE_GEN_PREPARE_CHANNEL)?.({}, null);
    expect(invalid).toMatchObject({
      success: false,
      status: { activeModel: "krea2-turbo", modelDownloaded: false },
    });
    registration.dispose();
  });

  it("disposes all canonical handlers", () => {
    const registration = registerImageGenIpcHandlers({ controller: createController() });
    registration.dispose();
    expect(IMAGE_GEN_CHANNELS.every((channel) => !handlers.has(channel))).toBe(true);
    expect(removeHandler.mock.calls.map(([channel]) => channel)).toEqual(expect.arrayContaining([...IMAGE_GEN_CHANNELS]));
  });
});
