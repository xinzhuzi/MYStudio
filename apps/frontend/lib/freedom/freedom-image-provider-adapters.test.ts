import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freedomObservedFetch, pollForFreedomResult } from "./freedom-transport";
import {
  generateViaIdeogramEndpoint,
  generateViaKlingImageEndpoint,
  generateViaMidjourneyEndpoint,
  generateViaReplicateImageEndpoint,
} from "./freedom-image-provider-adapters";

vi.mock("./freedom-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./freedom-transport")>();
  return { ...actual, freedomObservedFetch: vi.fn(), pollForFreedomResult: vi.fn() };
});

function response(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn(async () => data),
    text: vi.fn(async () => JSON.stringify(data)),
  } as unknown as Response;
}

describe("freedom image provider adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(pollForFreedomResult).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps Midjourney options and polls the submitted task", async () => {
    vi.mocked(freedomObservedFetch)
      .mockResolvedValueOnce(response({ code: 1, result: "task-1" }))
      .mockResolvedValueOnce(response({ status: "SUCCESS", imageUrl: "https://image.test/mj.png" }));
    const saveImage = vi.fn(() => "media-1");

    const pending = generateViaMidjourneyEndpoint({
      prompt: "ink hero",
      aspectRatio: "16:9",
      extraParams: { speed: "turbo", stylization: 300, weirdness: 5 },
    }, "niji-6", "key", "https://api.test/v1", saveImage);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      url: "https://image.test/mj.png", taskId: "task-1", mediaId: "media-1",
    });
    const submit = vi.mocked(freedomObservedFetch).mock.calls[0];
    expect(submit[0]).toBe("https://api.test/mj/submit/imagine");
    expect(JSON.parse(String(submit[1]?.body))).toMatchObject({
      prompt: "ink hero --ar 16:9 --s 300 --weird 5",
      accountFilter: { modes: ["TURBO"] },
      botType: "NIJI_JOURNEY",
    });
  });

  it("maps Ideogram multipart fields and persists the direct image", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ data: [{ url: "https://image.test/ideo.png" }] }));
    const saveImage = vi.fn(() => "media-2");

    await expect(generateViaIdeogramEndpoint({
      prompt: "scene",
      aspectRatio: "16:9",
      negativePrompt: "blur",
      extraParams: { style: "realistic", num_images: 2 },
    }, "ideogram_generate_V_3_TURBO", "key", "https://api.test/v1", saveImage)).resolves.toEqual({
      url: "https://image.test/ideo.png", mediaId: "media-2",
    });

    const form = vi.mocked(freedomObservedFetch).mock.calls[0][1]?.body as FormData;
    expect(Object.fromEntries(form.entries())).toMatchObject({
      model: "ideogram_generate_V_3_TURBO",
      prompt: "scene",
      aspect_ratio: "16x9",
      rendering_speed: "TURBO",
      style_type: "REALISTIC",
      negative_prompt: "blur",
      num_images: "2",
    });
  });

  it("returns a direct Replicate output without polling", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ output: ["https://image.test/replicate.png"] }));
    const saveImage = vi.fn(() => "media-3");

    await expect(generateViaReplicateImageEndpoint({
      prompt: "character", aspectRatio: "9:16", width: 768, extraParams: { quality: 90 },
    }, "owner/model", "key", "https://api.test/v1", saveImage)).resolves.toEqual({
      url: "https://image.test/replicate.png", mediaId: "media-3",
    });
    expect(freedomObservedFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(freedomObservedFetch).mock.calls[0][1]?.body))).toEqual({
      model: "owner/model",
      input: { prompt: "character", aspect_ratio: "9:16", width: 768, quality: 90 },
    });
  });

  it("submits native Kling image requests and persists direct output", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ data: [{ url: "https://image.test/kling.png" }] }));
    const saveImage = vi.fn(() => "media-kling");
    await expect(generateViaKlingImageEndpoint({ prompt: "ink scene", aspectRatio: "16:9" }, "kling-image-v1-5", "key", "https://api.test/v1", vi.fn(), saveImage)).resolves.toEqual({ url: "https://image.test/kling.png", mediaId: "media-kling" });
    expect(freedomObservedFetch).toHaveBeenCalledWith("https://api.test/kling/v1/images/generations", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(vi.mocked(freedomObservedFetch).mock.calls[0][1]?.body))).toMatchObject({ model: "kling-v1-5", aspect_ratio: "16:9" });
  });

  it("falls back when the native Kling POST fails", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValue(response({ error: "unsupported" }, false, 404));
    const fallback = vi.fn(async () => ({ url: "https://image.test/fallback.png" }));
    await expect(generateViaKlingImageEndpoint({ prompt: "fallback" }, "kling-image-v2", "key", "https://api.test/v1", fallback, vi.fn())).resolves.toEqual({ url: "https://image.test/fallback.png" });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("polls native Kling tasks and surfaces terminal polling errors", async () => {
    vi.mocked(freedomObservedFetch).mockResolvedValueOnce(response({ task_id: "task-1" }));
    vi.mocked(pollForFreedomResult).mockResolvedValue("https://image.test/polled.png");
    const pending = generateViaKlingImageEndpoint({ prompt: "poll" }, "kling-image-v2", "key", "https://api.test/v1", vi.fn(), vi.fn(() => "media-poll"));
    await expect(pending).resolves.toMatchObject({ url: "https://image.test/polled.png", taskId: "task-1" });
    expect(pollForFreedomResult).toHaveBeenCalledWith("https://api.test/kling/v1/images/generations/task-1", "key", 2000, 60);
  });
});
