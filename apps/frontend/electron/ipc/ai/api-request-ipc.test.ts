import { describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

const { sdkStreamTextMock } = vi.hoisted(() => ({
  sdkStreamTextMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock("../../../lib/ai/ai-sdk-bridge", () => ({
  sdkGenerateText: vi.fn(),
  sdkStreamText: sdkStreamTextMock,
}));

import { registerApiRequestIpcHandlers } from "./api-request-ipc";

describe("registerApiRequestIpcHandlers", () => {
  it("registers the four established API channels and rejects non-HTTP image URLs", async () => {
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
    expect([...handlers.keys()].sort()).toEqual([
      "api-image-request",
      "api-model-test",
      "api-text-completion",
      "api-text-completion-stream",
    ]);
    await expect(handlers.get("api-image-request")?.({}, { url: "file:///tmp/image.png" }))
      .rejects.toThrow("仅支持 http/https 图片 API 请求");
    await expect(handlers.get("api-image-request")?.({}, { url: "not-a-url" }))
      .rejects.toThrow();
  });

  it.each(["", "   "]) (
    "rejects an empty image URL (%j) before making a request",
    async (url) => {
      await expect(handlers.get("api-image-request")?.({}, { url })).rejects.toThrow();
    },
  );

  it.each(["ftp://example.com/image.png", "data:image/png;base64,aW1hZ2U="]) (
    "rejects unsupported image URL protocols (%s)",
    async (url) => {
      await expect(handlers.get("api-image-request")?.({}, { url }))
        .rejects.toThrow("仅支持 http/https 图片 API 请求");
    },
  );

  it("sends AI SDK stream deltas as strings for the preload callback contract", async () => {
    sdkStreamTextMock.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "sdk-delta" };
      })(),
    });
    registerApiRequestIpcHandlers({ createOperationId: (prefix) => `${prefix}-1`, writeDiagnosticsLog: vi.fn() });
    const send = vi.fn();
    const payload = {
      provider: {
        id: "provider-1",
        platform: "openai-compatible",
        name: "Provider 1",
        baseUrl: "https://provider.example.com/v1",
        apiKey: "secret",
        model: ["fallback-model"],
      },
      model: "requested-model",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    await expect(handlers.get("api-text-completion-stream")?.({
      sender: { isDestroyed: () => false, send },
    }, { payload, streamId: "stream-1" })).resolves.toEqual({
      success: true,
      text: "sdk-delta",
    });
    expect(send).toHaveBeenCalledWith("api-text-stream:stream-1", "sdk-delta");
  });
});
