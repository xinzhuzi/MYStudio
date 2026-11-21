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
  FREEDOM_POLL_INTERVAL_MS,
  FREEDOM_POLL_MAX_ATTEMPTS,
  getFreedomRootBaseUrl,
  inferFreedomEndpointFamily,
  pollForFreedomResult,
  toUploadHttpUrl,
} from "./generation-transport";

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

    // 完成但响应无图址:null 仍由调用方按各自语义处理(fallback/报错)——超时不再走 null(见下)
    observedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "completed" }),
    });
    await expect(pollForFreedomResult("https://api.test/tasks/3", "key", 0, 1))
      .resolves.toBeNull();
  });

  it("treats non-OK poll responses as terminal instead of silently burning attempts", async () => {
    observedFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(pollForFreedomResult("https://api.test/tasks/404", "key", 0, 3, "op", "task-404"))
      .rejects.toThrow("任务不存在或已过期(Task not found)·任务号 task-404");

    observedFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(pollForFreedomResult("https://api.test/tasks/400", "key", 0, 3))
      .rejects.toThrow("查询任务状态失败(HTTP 400)");
  });

  it("keeps retrying retryable HTTP codes and transient network errors", async () => {
    observedFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: "https://img.test/ok.png" }) });
    await expect(pollForFreedomResult("https://api.test/tasks/retry", "key", 0, 5))
      .resolves.toBe("https://img.test/ok.png");
  });

  it("maps expired and canceled statuses into terminal failure", async () => {
    for (const status of ["expired", "canceled"]) {
      observedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status }) });
      await expect(pollForFreedomResult(`https://api.test/tasks/${status}`, "key", 0, 1))
        .rejects.toThrow(`Generation failed: ${status}`);
    }
  });

  it("throws the real cause when the polling budget is exhausted", async () => {
    observedFetch.mockResolvedValue({ ok: true, json: async () => ({ status: "processing" }) });
    await expect(pollForFreedomResult("https://api.test/tasks/slow", "key", 0, 2, "op", "task-slow"))
      .rejects.toThrow("图片生成超时(已轮询 2 次");
  });

  it("keeps the freedom poll budget aligned with the 1500s bridge wall", () => {
    expect(FREEDOM_POLL_INTERVAL_MS).toBe(2000);
    expect(FREEDOM_POLL_MAX_ATTEMPTS).toBe(750);
    expect(FREEDOM_POLL_INTERVAL_MS * FREEDOM_POLL_MAX_ATTEMPTS).toBe(1_500_000);
  });
});
