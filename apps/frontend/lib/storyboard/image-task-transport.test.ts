import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeImageTaskUrl,
  pollImageTaskUrl,
  waitForAbortableDelay,
} from "./image-task-transport";

describe("image task transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes string and array URL fields", () => {
    expect(normalizeImageTaskUrl("one.png")).toBe("one.png");
    expect(normalizeImageTaskUrl(["two.png"])).toBe("two.png");
    expect(normalizeImageTaskUrl([])).toBeUndefined();
    expect(normalizeImageTaskUrl({ url: "three.png" })).toBeUndefined();
  });

  it("polls pending tasks and accepts nested successful image results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: "succeeded", result: { images: [{ url: ["done.png"] }] } },
      }), { status: 200 }));

    await expect(pollImageTaskUrl({
      taskId: "task-1",
      apiKey: "key",
      baseUrl: "https://images.example.test/v1/",
      pollIntervalMs: 0,
    })).resolves.toBe("done.png");
    expect(fetchMock.mock.calls[0][0].toString()).toMatch(/^https:\/\/images\.example\.test\/v1\/tasks\/task-1\?_ts=/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer key" } });
  });

  it("preserves request, provider failure, and timeout semantics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    await expect(pollImageTaskUrl({ taskId: "bad", apiKey: "key", baseUrl: "https://api.test", maxAttempts: 1 }))
      .rejects.toThrow("查询任务失败: 503");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "failed", error: "quota" }), { status: 200 }));
    await expect(pollImageTaskUrl({ taskId: "failed", apiKey: "key", baseUrl: "https://api.test", maxAttempts: 1 }))
      .rejects.toThrow("quota");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "processing" }), { status: 200 }));
    await expect(pollImageTaskUrl({ taskId: "slow", apiKey: "key", baseUrl: "https://api.test", maxAttempts: 1, pollIntervalMs: 0 }))
      .resolves.toBeUndefined();
  });

  it("reports progress and honors cancellation", async () => {
    const progress = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      result: { url: "done.png" },
    }), { status: 200 }));
    await expect(pollImageTaskUrl({ taskId: "done", apiKey: "key", baseUrl: "https://api.test", onProgress: progress }))
      .resolves.toBe("done.png");
    expect(progress.mock.calls.map((call) => call[0])).toEqual([0, 100]);

    const controller = new AbortController();
    controller.abort();
    await expect(pollImageTaskUrl({ taskId: "cancelled", apiKey: "key", baseUrl: "https://api.test", signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels an active polling delay without issuing another request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }),
    );
    const controller = new AbortController();
    const polling = pollImageTaskUrl({
      taskId: "active-delay",
      apiKey: "key",
      baseUrl: "https://api.test",
      pollIntervalMs: 60_000,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("provides an abortable delay for caller retry backoff", async () => {
    const controller = new AbortController();
    const delay = waitForAbortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(delay).rejects.toMatchObject({ name: "AbortError" });
  });

  it("supports caller-compatible HTTP messages and no-cache polling", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404 }));

    await expect(pollImageTaskUrl({
      taskId: "missing",
      apiKey: "key",
      baseUrl: "https://api.test",
      notFoundMessage: "任务不存在",
      requestErrorMessage: (status) => `Failed to check task status: ${status}`,
      noCache: true,
    })).rejects.toThrow("任务不存在");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: {
        Authorization: "Bearer key",
        "Cache-Control": "no-cache",
      },
    });
  });

  it("preserves a caller-specific failure fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "failed" }), { status: 200 }));
    await expect(pollImageTaskUrl({
      taskId: "failed-end-frame",
      apiKey: "key",
      baseUrl: "https://api.test",
      failureFallbackMessage: "尾帧生成失败",
    })).rejects.toThrow("尾帧生成失败");
  });
});
