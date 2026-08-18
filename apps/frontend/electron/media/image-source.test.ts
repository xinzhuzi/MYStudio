import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageSourceReader } from "./image-source";

describe("createImageSourceReader", () => {
  const originalMaxBytes = process.env.MYSTUDIO_IMAGE_SOURCE_MAX_BYTES;

  afterEach(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.MYSTUDIO_IMAGE_SOURCE_MAX_BYTES;
    } else {
      process.env.MYSTUDIO_IMAGE_SOURCE_MAX_BYTES = originalMaxBytes;
    }
  });

  it("preserves data URLs and local-file MIME detection", async () => {
    const fileExists = vi.fn((filePath: string) => filePath === "/images/frame.webp");
    const readFile = vi.fn(() => Buffer.from("local-image"));
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      isAbsoluteImageSourceAllowed: () => true,
      fileExists,
      readFile,
    });

    await expect(readImageSource("data:image/jpeg;base64,aGVsbG8=")).resolves.toMatchObject({
      mimeType: "image/jpeg",
      buffer: Buffer.from("hello"),
    });
    await expect(readImageSource("/images/frame.webp")).resolves.toMatchObject({
      mimeType: "image/webp",
      buffer: Buffer.from("local-image"),
    });
    expect(fileExists).toHaveBeenCalledWith("/images/frame.webp");
  });

  it("keeps remote response validation and MIME forwarding inside the reader boundary", async () => {
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/avif" },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }) as unknown as Response);
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      fetchImage,
    });

    await expect(readImageSource("https://images.example.test/frame")).resolves.toMatchObject({
      mimeType: "image/avif",
      buffer: Buffer.from([1, 2, 3]),
    });
    expect(fetchImage).toHaveBeenCalledWith(
      "https://images.example.test/frame",
      expect.objectContaining({ headers: { Accept: "image/*, */*;q=0.8" } }),
    );
  });

  it("rejects oversized remote images before reading the response body", async () => {
    process.env.MYSTUDIO_IMAGE_SOURCE_MAX_BYTES = "4";
    const arrayBuffer = vi.fn(async () => Uint8Array.from([1, 2, 3, 4, 5]).buffer);
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? "5" : "image/png"),
      },
      arrayBuffer,
    }) as unknown as Response);
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      fetchImage,
    });

    await expect(readImageSource("https://images.example.test/frame")).rejects.toThrow("图片超过 4 bytes");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("cancels remote streams when the downloaded body exceeds the byte limit", async () => {
    process.env.MYSTUDIO_IMAGE_SOURCE_MAX_BYTES = "4";
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2]) })
      .mockResolvedValueOnce({ done: false, value: Uint8Array.from([3, 4, 5]) });
    const fetchImage = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null),
      },
      body: {
        getReader: () => ({ read, cancel }),
      },
    }) as unknown as Response);
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      fetchImage,
    });

    await expect(readImageSource("https://images.example.test/frame")).rejects.toThrow("图片超过 4 bytes");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects missing local files without reading them", async () => {
    const fileExists = vi.fn(() => false);
    const readFile = vi.fn();
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      isAbsoluteImageSourceAllowed: () => true,
      fileExists,
      readFile,
    });

    await expect(readImageSource("/images/missing.png")).rejects.toThrow("本地图片不存在");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("fails closed on absolute and file:// sources without an allowlist guard", async () => {
    const readFile = vi.fn();
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      readFile,
    });

    await expect(readImageSource("/Users/x/.ssh/id_rsa")).rejects.toThrow("不在应用允许的目录范围内");
    await expect(readImageSource("file:///Users/x/.ssh/id_rsa")).rejects.toThrow("不在应用允许的目录范围内");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads absolute sources only when the allowlist guard accepts them", async () => {
    const readFile = vi.fn(() => Buffer.from("png-bytes"));
    const readImageSource = createImageSourceReader({
      getDataDir: () => "/data",
      getMediaRoot: () => "/media",
      isAbsoluteImageSourceAllowed: (resolvedPath) => resolvedPath.startsWith("/media/"),
      fileExists: () => true,
      readFile,
    });

    await expect(readImageSource("/media/shot.png")).resolves.toMatchObject({ buffer: Buffer.from("png-bytes") });
    await expect(readImageSource("/Users/x/.ssh/id_rsa")).rejects.toThrow("不在应用允许的目录范围内");
    await expect(readImageSource("file:///media/shot.png")).resolves.toMatchObject({
      buffer: Buffer.from("png-bytes"),
    });
  });
});
