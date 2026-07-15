import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerImageHostIpcHandlers } from "./image-host-ipc";

describe("registerImageHostIpcHandlers", () => {
  const writeDiagnosticsLog = vi.fn();
  const readImageSource = vi.fn(async () => ({ buffer: Buffer.from("image"), mimeType: "image/png" }));

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { url: "https://cdn.example.com/image.png" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    registerImageHostIpcHandlers({
      createOperationId: () => "image-host-1",
      writeDiagnosticsLog,
      readImageSource,
    });
  });

  it("returns the existing configuration error and records start/completion diagnostics", async () => {
    await expect(handlers.get("image-host-upload")?.({}, {
      provider: { name: "Missing", platform: "custom" },
      apiKey: "",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({ success: false, error: "图床上传地址未配置" });

    expect(writeDiagnosticsLog).toHaveBeenCalledTimes(2);
    expect(writeDiagnosticsLog).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: "image-host-1",
      message: "Image host upload failed",
    }));
  });

  it("extracts a configured nested response URL", async () => {
    await expect(handlers.get("image-host-upload")?.({}, {
      provider: {
        name: "Custom",
        platform: "custom",
        baseUrl: "https://upload.example.com",
        responseUrlField: "data.url",
      },
      apiKey: "secret",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({
      success: true,
      url: "https://cdn.example.com/image.png",
      deleteUrl: undefined,
    });
  });
});
