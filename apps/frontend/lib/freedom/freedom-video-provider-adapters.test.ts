import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { freedomObservedFetch } from "./freedom-transport";
import {
  generateVideoViaKling,
  generateVideoViaOpenAIOfficial,
  generateVideoViaUnified,
} from "./freedom-video-provider-adapters";

vi.mock("./freedom-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./freedom-transport")>();
  return {
    ...actual,
    freedomObservedFetch: vi.fn(),
    toUploadHttpUrl: vi.fn(async (file: { dataUrl: string }) => file.dataUrl),
  };
});

function response(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => data),
    text: vi.fn(async () => JSON.stringify(data)),
  } as unknown as Response;
}

describe("freedom video provider adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useAPIConfigStore.setState({ modelEndpointTypes: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps official Sora multipart fields and accepts a direct URL", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ id: "video-1", url: "https://video.test/sora.mp4" }));

    await expect(generateVideoViaOpenAIOfficial({
      prompt: "camera move", aspectRatio: "9:16", resolution: "720p", duration: 6,
    }, "sora-2", "key", "https://api.test/v1")).resolves.toEqual({
      url: "https://video.test/sora.mp4", taskId: "video-1",
    });
    const form = vi.mocked(freedomObservedFetch).mock.calls[0][1]?.body as FormData;
    expect(Object.fromEntries(form.entries())).toMatchObject({
      model: "sora-2", prompt: "camera move", seconds: "6",
    });
  });

  it("keeps Grok unified aspect ratio and resolution at the top level", async () => {
    useAPIConfigStore.setState({ modelEndpointTypes: { "grok-video": ["grok", "异步"] } });
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ id: "task-2", url: "https://video.test/grok.mp4" }));

    await generateVideoViaUnified({
      prompt: "wide shot", aspectRatio: "16:9", resolution: "720p", duration: 8,
    }, "grok-video", "key", "https://api.test/v1");

    expect(JSON.parse(String(vi.mocked(freedomObservedFetch).mock.calls[0][1]?.body))).toMatchObject({
      model: "grok-video",
      prompt: "wide shot",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 8,
    });
  });

  it("polls the matching Kling endpoint and returns its task result", async () => {
    vi.mocked(freedomObservedFetch)
      .mockResolvedValueOnce(response({ data: { task_id: "task-3" } }))
      .mockResolvedValueOnce(response({
        data: { task_status: "succeed", task_result: { videos: [{ url: "https://video.test/kling.mp4" }] } },
      }));

    const pending = generateVideoViaKling({ prompt: "motion", duration: 5 }, "kling-v2-6", "key", "https://api.test/v1");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ url: "https://video.test/kling.mp4", taskId: "task-3" });
    expect(vi.mocked(freedomObservedFetch).mock.calls[0][0]).toBe("https://api.test/kling/v1/videos/text2video");
    expect(vi.mocked(freedomObservedFetch).mock.calls[1][0]).toBe("https://api.test/kling/v1/videos/text2video/task-3");
  });
});
