import { describe, expect, it, vi } from "vitest";

const generateImageMock = vi.fn();

vi.mock("ai", () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

import {
  buildOpenAIImageRequestBody,
  extractImageGenerationResult,
  normalizeImagePromptForGeneration,
  resolveGptImageSize,
  sdkGenerateImage,
  validateGptImageSize,
} from "./ai-sdk-bridge";

describe("image standard request helpers", () => {
  it("maps gpt-image-2 aspect ratio and resolution to a valid size", () => {
    const resolved = resolveGptImageSize({
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(resolved).toMatchObject({
      size: "2048x1152",
      templateName: "openai-size",
    });
    expect(validateGptImageSize(resolved.size)).toEqual({ valid: true });
  });

  it("builds the OpenAI Images body with size instead of provider extension fields", () => {
    const { body, templateName } = buildOpenAIImageRequestBody({
      model: "gpt-image-2",
      prompt: "old laborer character",
      aspectRatio: "16:9",
      resolution: "2K",
      referenceImages: ["data:image/png;base64,abc"],
    });

    expect(templateName).toBe("openai-size");
    expect(body).toMatchObject({
      model: "gpt-image-2",
      n: 1,
      size: "2048x1152",
      image_urls: ["data:image/png;base64,abc"],
    });
    expect(body.prompt).toEqual(expect.stringContaining("old laborer character"));
    expect(body.prompt).toEqual(expect.stringContaining("clean image"));
    expect(body.prompt).toEqual(expect.stringContaining("low visual noise"));
    expect(body.negative_prompt).toEqual(expect.stringContaining("visual noise"));
    expect(body.negative_prompt).toEqual(expect.stringContaining("dirty texture"));
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("resolution");
  });

  it("normalizes image prompts with denoise and clean-image constraints", () => {
    const normalized = normalizeImagePromptForGeneration({
      prompt: "old laborer character",
      negativePrompt: "blurry",
    });

    expect(normalized.prompt).toContain("old laborer character");
    expect(normalized.prompt).toContain("clean image");
    expect(normalized.prompt).toContain("low visual noise");
    expect(normalized.negativePrompt).toContain("blurry");
    expect(normalized.negativePrompt).toContain("visual noise");
    expect(normalized.negativePrompt).toContain("dirty texture");
    expect(normalized.negativePrompt).toContain("jpeg artifacts");
  });

  it("extracts b64_json, direct URLs, and async task identifiers", () => {
    expect(extractImageGenerationResult({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    })).toMatchObject({ imageUrl: "data:image/png;base64,aGVsbG8=" });

    expect(extractImageGenerationResult({
      data: [{ url: "https://cdn.example.com/image.png" }],
    })).toMatchObject({ imageUrl: "https://cdn.example.com/image.png" });

    expect(extractImageGenerationResult({ id: "task-1" })).toMatchObject({ taskId: "task-1" });
  });

  it("uses the AI SDK image model with the resolved standard size", async () => {
    generateImageMock.mockResolvedValueOnce({
      image: { base64: "aGVsbG8=", mediaType: "image/png", uint8Array: new Uint8Array() },
      images: [{ base64: "aGVsbG8=", mediaType: "image/png", uint8Array: new Uint8Array() }],
      warnings: [],
      responses: [],
      providerMetadata: {},
      usage: {},
    });

    const result = await sdkGenerateImage({
      provider: {
        id: "relay",
        platform: "openai-compatible",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
      },
      model: "gpt-image-2",
      prompt: "old laborer character",
      aspectRatio: "16:9",
      resolution: "2K",
      maxRetries: 0,
    });

    expect(result).toMatchObject({
      success: true,
      imageUrl: "data:image/png;base64,aGVsbG8=",
      size: "2048x1152",
      templateName: "openai-size",
    });
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("old laborer character"),
      size: "2048x1152",
      n: 1,
      maxRetries: 0,
    }));
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("clean image"),
    }));
  });
});
