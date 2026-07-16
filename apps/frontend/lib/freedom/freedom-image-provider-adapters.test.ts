import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freedomObservedFetch } from "./freedom-transport";
import {
  generateViaIdeogramEndpoint,
  generateViaMidjourneyEndpoint,
  generateViaReplicateImageEndpoint,
} from "./freedom-image-provider-adapters";

vi.mock("./freedom-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./freedom-transport")>();
  return { ...actual, freedomObservedFetch: vi.fn() };
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
});
