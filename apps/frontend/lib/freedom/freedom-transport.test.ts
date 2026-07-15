// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { observedFetch, uploadBase64Image } = vi.hoisted(() => ({
  observedFetch: vi.fn(),
  uploadBase64Image: vi.fn(),
}));

vi.mock("@/lib/diagnostics/network", () => ({ observedFetch }));
vi.mock("@/lib/diagnostics/logger", () => ({ createOperationId: () => "operation-1" }));
vi.mock("@/lib/utils/image-upload", () => ({ uploadBase64Image }));

import {
  buildFreedomEndpoint,
  dataUrlToBlob,
  extractFreedomImageUrl,
  extractFreedomVideoUrl,
  getFreedomRootBaseUrl,
  inferFreedomEndpointFamily,
  pollForFreedomResult,
  toUploadHttpUrl,
} from "./freedom-transport";

describe("freedom transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves endpoint and response-format normalization", () => {
    expect(buildFreedomEndpoint("https://api.example.com", "images/generations"))
      .toBe("https://api.example.com/v1/images/generations");
    expect(buildFreedomEndpoint("https://api.example.com/v2/", "videos"))
      .toBe("https://api.example.com/v2/videos");
    expect(getFreedomRootBaseUrl("https://api.example.com/v1/"))
      .toBe("https://api.example.com");
    expect(inferFreedomEndpointFamily("https://api.example.com/v1/chat/completions"))
      .toBe("freedom-chat-completions");
    expect(extractFreedomImageUrl({ data: [{ b64_json: "abc" }] }))
      .toBe("data:image/png;base64,abc");
    expect(extractFreedomImageUrl({ choices: [{ message: { content: "![result](https://img.test/a.png)" } }] }))
      .toBe("https://img.test/a.png");
    expect(extractFreedomVideoUrl({ response: { url: "https://video.test/a.mp4" } }))
      .toBe("https://video.test/a.mp4");
  });

  it("preserves data-url and upload routing", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,SGk=");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(2);
    await expect(toUploadHttpUrl({ role: "single", dataUrl: "https://img.test/a.png", fileName: "a.png" }))
      .resolves.toBe("https://img.test/a.png");
    uploadBase64Image.mockResolvedValue("https://uploaded.test/a.png");
    await expect(toUploadHttpUrl({ role: "single", dataUrl: "data:image/png;base64,SGk=", fileName: "a.png" }))
      .resolves.toBe("https://uploaded.test/a.png");
  });

  it("preserves polling success, failure, and timeout semantics", async () => {
    observedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "completed", output: "https://img.test/result.png" }),
    });
    await expect(pollForFreedomResult("https://api.test/tasks/1", "key", 0, 1, "op", "task"))
      .resolves.toBe("https://img.test/result.png");

    observedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "failed", error: "provider failed" }),
    });
    await expect(pollForFreedomResult("https://api.test/tasks/2", "key", 0, 1))
      .rejects.toThrow("Generation failed: provider failed");

    observedFetch.mockResolvedValueOnce({ ok: false });
    await expect(pollForFreedomResult("https://api.test/tasks/3", "key", 0, 1))
      .resolves.toBeNull();
  });
});
