import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiUrl, createWorkerApi } from "./ai-worker-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ai worker API boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds requests from the injected base URL and accepts direct image results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "completed", imageUrl: "https://cdn.test/image.png" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    expect(buildApiUrl("/health", "https://api.test")).toBe("https://api.test/health");
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" })).resolves.toBe("https://cdn.test/image.png");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/ai/image",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("builds requests from worker self origin and falls back to the path without a runtime origin", () => {
    vi.stubGlobal("self", { location: { origin: "https://worker.test" } });
    expect(buildApiUrl("/health")).toBe("https://worker.test/health");

    vi.stubGlobal("self", undefined);
    expect(buildApiUrl("/health")).toBe("/health");
  });

  it("preserves the exact missing-key and cancellation errors", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "", isCancelled: () => true });
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", {})).rejects.toThrow("未配置视频生成 API Key");
    await expect(api.pollTaskCompletion("task-1", "image", "key", "provider")).rejects.toThrow("Cancelled");
  });

  it("passes typed provider and duration settings through the media requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "completed", imageUrl: "https://cdn.test/image.png" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", videoUrl: "https://cdn.test/video.mp4" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    await api.generateImage("prompt", "negative", { apiKey: "key", imageProvider: "mock" });
    await api.generateVideo("data:image/png;base64,AA==", "prompt", { apiKey: "key", videoProvider: "mock", duration: 7 });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ provider: "mock" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ provider: "mock", duration: 7 });
  });

  it("forwards the active run signal to image submission", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "completed", imageUrl: "https://cdn.test/image.png" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({
      getApiBaseUrl: () => "https://api.test",
      isCancelled: () => false,
      signal: controller.signal,
    });

    await api.generateImage("prompt", "negative", { apiKey: "key" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/ai/image",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("surfaces media submit failures and invalid submit envelopes", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ message: "image down" }, 400)));
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" })).rejects.toThrow("image down");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ error: "video down" }, 500)));
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", { apiKey: "key" })).rejects.toThrow("video down");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "processing" })));
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" })).rejects.toThrow("Invalid API response: no taskId or imageUrl");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "processing" })));
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", { apiKey: "key" })).rejects.toThrow("Invalid API response: no taskId or videoUrl");
  });

  it("rejects unprepared local image references before any media request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    await expect(
      api.generateImage("prompt", "negative", { apiKey: "key" }, undefined, ["file:///tmp/reference.png"]),
    ).rejects.toThrow("参考图必须在主线程完成缩略后再发送");
    await expect(
      api.generateVideo("file:///tmp/source.png", "prompt", { apiKey: "key" }),
    ).rejects.toThrow("参考图必须在主线程完成缩略后再发送");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized data image payloads before any media request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });
    const oversizedDataUrl = `data:image/jpeg;base64,${Buffer.alloc(1_000_000, 7).toString("base64")}`;

    await expect(
      api.generateVideo(oversizedDataUrl, "prompt", { apiKey: "key" }),
    ).rejects.toThrow("参考图缩略图必须严格小于 1000000 bytes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls task progress, retries non-OK polling responses, and returns the completed URL", async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "processing", progress: 25 }))
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", result: { videoUrl: "https://cdn.test/video.mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    const result = api.pollTaskCompletion("task-1", "video", "key", "memefast", onProgress);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe("https://cdn.test/video.mp4");
    expect(onProgress).toHaveBeenCalledWith(25);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.test/api/ai/task/task-1?provider=memefast&type=video",
      "https://api.test/api/ai/task/task-1?provider=memefast&type=video",
      "https://api.test/api/ai/task/task-1?provider=memefast&type=video",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer key" },
    });
  });

  it("surfaces failed, completed-without-url, and timed-out task polling states", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "failed", error: "backend failed" })));
    await expect(api.pollTaskCompletion("failed-task", "image", "key", "memefast")).rejects.toThrow("backend failed");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "completed", result: {} })));
    await expect(api.pollTaskCompletion("empty-task", "image", "key", "memefast")).rejects.toThrow("Task completed but no URL in result");

    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ status: "processing" }))));
    const timeout = expect(api.pollTaskCompletion("timeout-task", "image", "key", "memefast")).rejects.toThrow("Task timeout-task timed out after 120s");
    await vi.advanceTimersByTimeAsync(120000);
    await timeout;
  });

  it("downloads media blobs and surfaces blob download failure or cancellation", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("video-bytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({
      getApiBaseUrl: () => "https://api.test",
      isCancelled: () => false,
      signal: controller.signal,
    });

    const blob = await api.fetchAsBlob("https://cdn.test/video.mp4");

    expect(await blob.text()).toBe("video-bytes");
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/video.mp4", { signal: controller.signal });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 })));
    await expect(api.fetchAsBlob("https://cdn.test/missing.mp4")).rejects.toThrow("Failed to download: 404");

    const cancelledApi = createWorkerApi({ getApiBaseUrl: () => "", isCancelled: () => true });
    const cancelledFetch = vi.fn();
    vi.stubGlobal("fetch", cancelledFetch);
    await expect(cancelledApi.fetchAsBlob("https://cdn.test/cancel.mp4")).rejects.toThrow("Cancelled");
    expect(cancelledFetch).not.toHaveBeenCalled();
  });
});
