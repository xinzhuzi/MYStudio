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
  stat: vi.fn(async () => ({ isFile: (): boolean => true, size: 12 })),
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
    mocks.access.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ isFile: (): boolean => true, size: 12 });
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

  it("delegates runtime lifecycle and configuration commands with diagnostics", async () => {
    await expect(mocks.handlers.get("tts-runtime-status")?.({})).resolves.toEqual({
      installed: true,
      running: true,
      port: 9000,
      baseUrl: "http://127.0.0.1:9000",
    });
    await expect(mocks.handlers.get("tts-runtime-start")?.({})).resolves.toEqual({ success: true });
    await expect(mocks.handlers.get("tts-runtime-setup")?.({})).resolves.toEqual({ success: true });
    await expect(mocks.handlers.get("tts-runtime-stop")?.({})).resolves.toEqual({ success: true });
    await expect(mocks.handlers.get("tts-runtime-get-config")?.({})).resolves.toEqual({ pythonRuntimeDir: "/runtime" });

    const config = { pythonRuntimeUrl: "https://example.test/python.zip" };
    await expect(mocks.handlers.get("tts-runtime-set-config")?.({}, config)).resolves.toEqual({ success: true });
    await expect(mocks.handlers.get("tts-runtime-set-model-cache-dir")?.({}, "/models/cache")).resolves.toEqual({ success: true });

    expect(diagnosticsCalls).toEqual([
      { action: "status", context: {} },
      { action: "start", context: {} },
      { action: "setup", context: {} },
      { action: "stop", context: {} },
      { action: "set-config", context: { config } },
      { action: "set-model-cache-dir", context: { dirPath: "/models/cache" } },
    ]);
  });

  it("preserves bytes/formdata argument forwarding without leaking reference text", async () => {
    const bytesPayload = { method: "GET", path: "/audio", body: { sample: true } };
    const formDataPayload = { path: "/reference", audioFilePath: "/tmp/reference.wav", referenceText: "台词" };

    await expect(mocks.handlers.get("tts-runtime-request-bytes")?.({}, bytesPayload)).resolves.toEqual({ data: new ArrayBuffer(0) });
    await expect(mocks.handlers.get("tts-runtime-request-formdata")?.({}, formDataPayload)).resolves.toEqual({ success: true });

    expect(mocks.requestBytes).toHaveBeenCalledWith("GET", "/audio", { sample: true });
    expect(mocks.requestFormData).toHaveBeenCalledWith("/reference", "/tmp/reference.wav", "台词");
    expect(diagnosticsCalls).toContainEqual({ action: "request-bytes", context: bytesPayload });
    expect(diagnosticsCalls).toContainEqual({
      action: "request-formdata",
      context: { path: "/reference", audioFilePath: "/tmp/reference.wav", referenceTextLength: 2 },
    });
    expect(JSON.stringify(diagnosticsCalls)).not.toContain("台词");
  });

  it("returns null for unsafe or unreadable reference audio paths", async () => {
    mocks.resolveSourcePath.mockReturnValueOnce("relative/audio.wav");
    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, "relative.wav")).resolves.toBeNull();

    mocks.resolveSourcePath.mockReturnValue("/audio/not-a-file.wav");
    mocks.stat.mockResolvedValueOnce({ isFile: () => false, size: 12 });
    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, "not-a-file.wav")).resolves.toBeNull();

    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 0 });
    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, "empty.wav")).resolves.toBeNull();

    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 12 });
    mocks.access.mockRejectedValueOnce(new Error("EACCES"));
    await expect(mocks.handlers.get("tts-reference-audio-resolve")?.({}, "denied.wav")).resolves.toBeNull();
  });
});
