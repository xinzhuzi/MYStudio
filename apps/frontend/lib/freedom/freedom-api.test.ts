import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/api-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { resetFeatureRoundRobin } from "@/lib/ai/feature-router";
import { clearAllManagers } from "@/lib/api-key-manager";
import { generateFreedomImage } from "./freedom-api";

const provider = {
  id: "torchai",
  platform: "custom",
  name: "torchai",
  baseUrl: "https://torchai.ai/v1",
  apiKey: "sk-test",
  model: ["gpt-image-2"],
};

describe("generateFreedomImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearAllManagers();
    resetFeatureRoundRobin();
    useAPIConfigStore.setState({
      providers: [provider],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the standard size field for gpt-image requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({
      prompt: "old laborer character",
      negativePrompt: "no basket, no ragged backpack",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://torchai.ai/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-image-2",
      size: "2048x1152",
    });
    expect(requestBody.prompt).toContain("old laborer character");
    expect(requestBody.prompt).toContain("clean image");
    expect(requestBody.prompt).toContain("low visual noise");
    expect(requestBody.prompt).toContain("no basket");
    expect(requestBody.prompt).toContain("no ragged backpack");
    expect(requestBody.prompt).toContain("visual noise");
    expect(requestBody.prompt).toContain("dirty texture");
    expect(requestBody.prompt).toContain("unwanted calligraphy");
    expect(requestBody).not.toHaveProperty("aspect_ratio");
    expect(requestBody).not.toHaveProperty("resolution");
  });

  it("uses global image size settings when a freedom request omits size options", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "2K",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await generateFreedomImage({ prompt: "global freedom image" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.size).toBe("2016x1344");
  });

  it("retries gpt-image transport failures with a compact 1024 prompt before provider fallback", async () => {
    const longPrompt = [
      "男性角色四视图设定图，水墨国风，修仙古韵，工笔线描，写意晕染，宣纸质感。",
      "老苦力，年迈男性，面容沧桑，额纹与眼角细纹自然，颧骨略显，眉目沉稳疲惫。",
      "长期劳作后的瘦硬体态，粗布旧衣，破损袖口，电影质感，主体完整，细节很多。",
      "character design sheet, character turnaround, front view, side view, back view, cinematic ink wash style.",
      "plain background, readable silhouette, high quality production asset, no text, no watermark.",
    ].join("\n");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({
      prompt: longPrompt,
      aspectRatio: "16:9",
    });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.size).toBe("2048x1152");
    expect(firstBody.prompt).toContain(longPrompt);
    expect(firstBody.prompt).toContain("clean image");
    expect(firstBody.prompt).toContain("low visual noise");
    expect(firstBody.prompt).toContain("dirty texture");
    expect(firstBody.prompt).toContain("unwanted calligraphy");
    expect(retryBody.size).toBe("1024x1024");
    expect(retryBody.prompt).not.toContain("high quality production asset");
    expect(retryBody.prompt).toContain("避免文字和水印");
    expect(retryBody.prompt).toContain("clean image");
    expect(retryBody.prompt).toContain("low visual noise");
    expect(retryBody.prompt).toContain("dirty texture");
    expect(retryBody.prompt).toContain("unwanted calligraphy");
  });

  it("rotates to the next key when a gpt-image provider returns quota 403", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    useAPIConfigStore.setState({
      providers: [{
        ...provider,
        apiKey: "sk-bad\nsk-good",
      }],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: "用户额度不足, 剩余额度: ¥0.000000",
          code: "insufficient_user_quota",
        },
      }), { status: 403, statusText: "Forbidden" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateFreedomImage({
      prompt: "old laborer character",
      aspectRatio: "1:1",
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3000);

    const result = await generation;
    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Authorization ?? firstHeaders.authorization).toBe("Bearer sk-bad");
    expect(secondHeaders.Authorization ?? secondHeaders.authorization).toBe("Bearer sk-good");
  });
});
