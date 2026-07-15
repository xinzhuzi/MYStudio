import { describe, expect, it, vi } from "vitest";

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
  });
});
