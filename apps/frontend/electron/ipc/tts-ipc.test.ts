import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsRuntimeController } from "../tts-runtime";

const mocks = vi.hoisted(() => ({
  access: vi.fn(async () => undefined),
  getConfig: vi.fn(async () => ({ pythonRuntimeDir: "/runtime" })),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  request: vi.fn(async () => ({ success: true })),
  requestBytes: vi.fn(async () => ({ data: new ArrayBuffer(0) })),
  requestFormData: vi.fn(async () => ({ success: true })),
  resolveSourcePath: vi.fn((value: string) => `/audio/${value}`),
  setConfig: vi.fn(async () => ({ success: true })),
  setModelCacheDir: vi.fn(async () => ({ success: true })),
  setup: vi.fn(async () => ({ success: true })),
  start: vi.fn(async () => ({ success: true })),
  stat: vi.fn(async () => ({ isFile: () => true, size: 12 })),
  status: vi.fn(async () => ({ installed: true, running: true, port: 9000, baseUrl: "http://127.0.0.1:9000" })),
  stop: vi.fn(async () => ({ success: true })),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));
vi.mock("node:fs", () => ({
  default: {
    constants: { R_OK: 4 },
    promises: {
      access: mocks.access,
      stat: mocks.stat,
    },
  },
}));

import { registerTtsIpcHandlers } from "./tts-ipc";

const diagnosticsCalls: Array<{ action: string; context: Record<string, unknown> }> = [];

async function runDiagnostics<T>(
  action: string,
  context: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  diagnosticsCalls.push({ action, context });
  return run();
}

function registerHandlers() {
  registerTtsIpcHandlers({
    controller: {
      getConfig: mocks.getConfig,
      request: mocks.request,
      requestBytes: mocks.requestBytes,
      requestFormData: mocks.requestFormData,
      setConfig: mocks.setConfig,
      setModelCacheDir: mocks.setModelCacheDir,
      setup: mocks.setup,
      start: mocks.start,
      status: mocks.status,
      stop: mocks.stop,
    } as unknown as TtsRuntimeController,
    resolveSourcePath: mocks.resolveSourcePath,
    runDiagnostics,
  });
}

describe("registerTtsIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    diagnosticsCalls.length = 0;
    mocks.resolveSourcePath.mockImplementation((value: string) => `/audio/${value}`);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 12 });
    registerHandlers();
  });

  it("registers the established TTS bridge channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "tts-reference-audio-resolve",
      "tts-runtime-get-config",
      "tts-runtime-request",
      "tts-runtime-request-bytes",
      "tts-runtime-request-formdata",
      "tts-runtime-set-config",
      "tts-runtime-set-model-cache-dir",
      "tts-runtime-setup",
      "tts-runtime-start",
      "tts-runtime-status",
      "tts-runtime-stop",
    ]);
  });

  it("preserves diagnostics delegation and readable reference-audio resolution", async () => {
    const payload = { method: "POST", path: "/speak", body: { text: "台词" } };

    await expect(mocks.handlers.get("tts-runtime-request")?.({}, payload)).resolves.toEqual({ success: true });
    expect(diagnosticsCalls).toEqual([{ action: "request", context: payload }]);
    expect(mocks.request).toHaveBeenCalledWith("POST", "/speak", { text: "台词" });

    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, " reference.wav ")).resolves.toBe("/audio/reference.wav");
    expect(mocks.resolveSourcePath).toHaveBeenCalledWith("reference.wav");
    expect(mocks.access).toHaveBeenCalledWith("/audio/reference.wav", 4);
    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, "")).resolves.toBeNull();
  });
});
