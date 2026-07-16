import { afterEach, describe, expect, it, vi } from "vitest";
import { generateVideoViaReplicate } from "./freedom-replicate-video";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("generateVideoViaReplicate", () => {
  it("submits a prediction and polls it to a successful video result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-1", status: "starting" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "pred-1",
        status: "succeeded",
        output: "https://video.test/result.mp4",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateVideoViaReplicate(
      {
        prompt: "ink-wash hero walking through rain",
        aspectRatio: "16:9",
        duration: 5,
        resolution: "1080p",
      },
      "wan-video-model",
      "sk-replicate",
      "https://relay.test/v1",
      { pollIntervalMs: 0, maxPollAttempts: 1 },
    );

    expect(result).toEqual({
      url: "https://video.test/result.mp4",
      taskId: "pred-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://relay.test/replicate/v1/predictions");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://relay.test/replicate/v1/predictions/pred-1");

    const submitInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(submitInit.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-replicate",
    });
    expect(JSON.parse(String(submitInit.body))).toEqual({
      model: "wan-video-model",
      input: {
        prompt: "ink-wash hero walking through rain",
        aspect_ratio: "16:9",
        duration: 5,
        resolution: "1080p",
      },
    });
  });
});
