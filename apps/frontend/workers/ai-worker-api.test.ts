import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiUrl, createWorkerApi } from "./ai-worker-api";

describe("ai worker API boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds requests from the injected base URL and accepts direct image results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", imageUrl: "https://cdn.test/image.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
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

  it("preserves the exact missing-key and cancellation errors", async () => {
    const api = createWorkerApi({ getApiBaseUrl: () => "", isCancelled: () => true });
    await expect(api.generateVideo("data:image/png;base64,AA==", "prompt", {})).rejects.toThrow("未配置视频生成 API Key");
    await expect(api.pollTaskCompletion("task-1", "image", "key", "provider")).rejects.toThrow("Cancelled");
  });
});
