import { afterEach, describe, expect, it, vi } from "vitest";
import { extractChatCompletionsImage, generateFreedomImageViaChat } from "./freedom-image-chat";

describe("Freedom chat image adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts multimodal, markdown, and embedded base64 formats", () => {
    expect(extractChatCompletionsImage({ choices: [{ message: { content: [
      { type: "image_url", image_url: { url: "https://cdn.test/image.png" } },
    ] } }] })).toBe("https://cdn.test/image.png");
    expect(extractChatCompletionsImage({ choices: [{ message: { content: "![result](https://cdn.test/markdown.png)" } }] }))
      .toBe("https://cdn.test/markdown.png");
    expect(extractChatCompletionsImage({ choices: [{ message: { content: "data:image/png;base64,QUJD" } }] }))
      .toBe("data:image/png;base64,QUJD");
  });

  it("submits references and returns the media facade result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "image", data: "QUJD" }] } }],
    }), { status: 200 }));
    const saveMedia = vi.fn(() => "media-1");

    await expect(generateFreedomImageViaChat({
      prompt: "mountain",
      aspectRatio: "16:9",
      referenceImages: ["ref.png"],
    }, "gemini-image", "key", "https://api.test/v1", saveMedia)).resolves.toEqual({
      url: "data:image/png;base64,QUJD",
      mediaId: "media-1",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Generate an image with aspect ratio 16:9: mountain" },
      { type: "image_url", image_url: { url: "ref.png" } },
    ]);
  });

  it("preserves HTTP and missing-image errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    await expect(generateFreedomImageViaChat({ prompt: "x" }, "model", "key", "https://api.test", vi.fn()))
      .rejects.toMatchObject({ message: expect.stringContaining("quota: 429"), status: 429 });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(generateFreedomImageViaChat({ prompt: "x" }, "model", "key", "https://api.test", vi.fn()))
      .rejects.toThrow("未能从聊天响应中提取图片 URL");
  });
});
