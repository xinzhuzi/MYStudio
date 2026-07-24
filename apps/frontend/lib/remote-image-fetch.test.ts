// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRemoteImageBlob, fetchRemoteImageDataUrl } from "./remote-image-fetch";

describe("remote-image-fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the image accept header and converts remote images to data URLs", async () => {
    const fetchImage = vi.fn(async () => new Response("image", {
      status: 200,
      headers: { "content-type": "image/png" },
    }));

    await expect(fetchRemoteImageDataUrl("https://cdn.example.test/image.png", { fetchImage }))
      .resolves.toBe("data:image/png;base64,aW1hZ2U=");
    expect(fetchImage).toHaveBeenCalledWith("https://cdn.example.test/image.png", expect.objectContaining({
      headers: { Accept: "image/*, */*;q=0.8" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects non-OK responses before reading the body", async () => {
    const fetchImage = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(fetchRemoteImageBlob("https://cdn.example.test/missing.png", { fetchImage }))
      .rejects.toThrow("请求失败: 404");
  });

  it("rejects oversized content-length before reading the body", async () => {
    const fetchImage = vi.fn(async () => new Response("tiny", {
      status: 200,
      headers: { "content-length": "5" },
    }));

    await expect(fetchRemoteImageBlob("https://cdn.example.test/huge.png", {
      fetchImage,
      maxBytes: 4,
    })).rejects.toThrow("图片超过 4 bytes");
  });

  it("rejects streamed overflows when content-length is absent", async () => {
    const fetchImage = vi.fn(async () => new Response("image", { status: 200 }));

    await expect(fetchRemoteImageBlob("https://cdn.example.test/stream.png", {
      fetchImage,
      maxBytes: 4,
    })).rejects.toThrow("图片超过 4 bytes");
  });
});
