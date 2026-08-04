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

  it("accepts legacy direct media URLs without a status field", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ imageUrl: "https://cdn.test/legacy-image.png" }))
      .mockResolvedValueOnce(jsonResponse({ videoUrl: "https://cdn.test/legacy-video.mp4" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .resolves.toBe("https://cdn.test/legacy-image.png");
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", { apiKey: "key" }))
      .resolves.toBe("https://cdn.test/legacy-video.mp4");
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

  it("keeps the legacy per-media API key aliases typed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "completed", imageUrl: "https://cdn.test/image.png" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", videoUrl: "https://cdn.test/video.mp4" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    await expect(api.generateImage("prompt", "negative", { imageApiKey: "image-key" })).resolves.toBe("https://cdn.test/image.png");
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", { videoApiKey: "video-key" }))
      .resolves.toBe("https://cdn.test/video.mp4");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ apiKey: "image-key" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ apiKey: "video-key" });
  });

  it("decodes queued submit responses and polls the typed result envelope", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "processing", taskId: "image-task" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", result: { url: "https://cdn.test/queued.png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    const result = api.generateImage("prompt", "negative", { apiKey: "key" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe("https://cdn.test/queued.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("composes the active run signal into image submission", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({
      getApiBaseUrl: () => "https://api.test",
      isCancelled: () => false,
      signal: controller.signal,
    });

    const request = api.generateImage("prompt", "negative", { apiKey: "key" });
    const forwardedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    const rejection = expect(request).rejects.toMatchObject({ envelope: { code: "aborted", retryable: false } });
    controller.abort();

    await rejection;
    expect(forwardedSignal).toBeInstanceOf(AbortSignal);
    expect(forwardedSignal).not.toBe(controller.signal);
    expect(forwardedSignal.aborted).toBe(true);
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
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", { apiKey: "key" }))
      .rejects.toMatchObject({
        message: "Invalid API response: no taskId or videoUrl",
        envelope: { code: "invalid-response", retryable: false },
      });
  });

  it("rejects malformed payloads and completed tasks without a URL", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(["not-an-object"])));
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .rejects.toMatchObject({ envelope: { code: "malformed-response", provider: "memefast" } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "completed", result: { url: 42 } })));
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .rejects.toMatchObject({ envelope: { code: "malformed-response", provider: "memefast" } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "completed" })));
    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .rejects.toMatchObject({
        message: "Task completed but no URL in result",
        envelope: { code: "missing-result-url", retryable: false },
      });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "completed", result: {} })));
    await expect(api.pollTaskCompletion("empty-task", "image", "key", "memefast"))
      .rejects.toMatchObject({
        message: "Task completed but no URL in result",
        envelope: { code: "missing-result-url", retryable: false },
      });
  });

  it("preserves nested provider errors in a typed HTTP error envelope", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: { detail: { message: "nested provider failure" } } }, 400),
    ));

    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .rejects.toMatchObject({
        message: "nested provider failure",
        envelope: { code: "http-error", status: 400, retryable: false, provider: "memefast" },
      });
  });

  it("rejects progress outside the documented 0-100 range and accepts both boundaries", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "processing", progress: -1 })));
    await expect(api.pollTaskCompletion("negative-progress", "image", "key", "memefast"))
      .rejects.toMatchObject({
        message: "Invalid API response: progress must be between 0 and 100",
        envelope: { code: "malformed-response", retryable: false, provider: "memefast" },
      });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "processing", progress: 101 })));
    await expect(api.pollTaskCompletion("overflow-progress", "image", "key", "memefast"))
      .rejects.toMatchObject({ envelope: { code: "malformed-response", provider: "memefast" } });

    vi.useFakeTimers();
    const onProgress = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "processing", progress: 0 }))
      .mockResolvedValueOnce(jsonResponse({ status: "processing", progress: 100 }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", imageUrl: "https://cdn.test/ranged.png" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = api.pollTaskCompletion("valid-progress", "image", "key", "memefast", onProgress);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe("https://cdn.test/ranged.png");
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([0, 100]);
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
    await expect(api.pollTaskCompletion("failed-task", "image", "key", "memefast"))
      .rejects.toMatchObject({
        message: "backend failed",
        envelope: { code: "provider-error", retryable: false },
      });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ status: "completed", result: {} })));
    await expect(api.pollTaskCompletion("empty-task", "image", "key", "memefast"))
      .rejects.toMatchObject({
        message: "Task completed but no URL in result",
        envelope: { code: "missing-result-url", retryable: false },
      });

    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ status: "processing" }))));
    const timeout = expect(api.pollTaskCompletion("timeout-task", "image", "key", "memefast")).rejects.toThrow("Task timeout-task timed out after 120s");
    await vi.advanceTimersByTimeAsync(120000);
    await timeout;
  });

  it("normalizes cancellation and AbortSignal failures without retrying", async () => {
    const cancelledApi = createWorkerApi({ getApiBaseUrl: () => "", isCancelled: () => true });
    await expect(cancelledApi.pollTaskCompletion("task-1", "image", "key", "provider"))
      .rejects.toMatchObject({ message: "Cancelled", envelope: { code: "cancelled", retryable: false } });

    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({ getApiBaseUrl: () => "https://api.test", isCancelled: () => false, signal: controller.signal });

    await expect(api.generateImage("prompt", "negative", { apiKey: "key" }))
      .rejects.toMatchObject({ envelope: { code: "aborted", retryable: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a request deadline and reports timeout separately from caller abort", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createWorkerApi({
      getApiBaseUrl: () => "https://api.test",
      isCancelled: () => false,
      requestTimeoutMs: 50,
    });

    const request = api.generateImage("prompt", "negative", { apiKey: "key" });
    const timeout = expect(request).rejects.toMatchObject({
      message: "API request timed out after 50ms",
      envelope: { code: "timeout", retryable: true, provider: "memefast" },
    });
    await vi.advanceTimersByTimeAsync(50);

    await timeout;
    expect(vi.getTimerCount()).toBe(0);
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
    const downloadSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(downloadSignal).toBeInstanceOf(AbortSignal);
    expect(downloadSignal).not.toBe(controller.signal);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 })));
    await expect(api.fetchAsBlob("https://cdn.test/missing.mp4")).rejects.toThrow("Failed to download: 404");

    const cancelledApi = createWorkerApi({ getApiBaseUrl: () => "", isCancelled: () => true });
    const cancelledFetch = vi.fn();
    vi.stubGlobal("fetch", cancelledFetch);
    await expect(cancelledApi.fetchAsBlob("https://cdn.test/cancel.mp4")).rejects.toThrow("Cancelled");
    expect(cancelledFetch).not.toHaveBeenCalled();
  });
});
