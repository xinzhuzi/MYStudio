// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readImageAsBase64 } from "./image-storage";

describe("readImageAsBase64", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns existing data URLs without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(readImageAsBase64("data:image/png;base64,aW1hZ2U=")).resolves.toBe("data:image/png;base64,aW1hZ2U=");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts successful remote images to data URLs", async () => {
    const fetchMock = vi.fn(async () => new Response("image", {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readImageAsBase64("https://cdn.example.test/image.png")).resolves.toBe("data:image/png;base64,aW1hZ2U=");
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.test/image.png", expect.objectContaining({
      headers: { Accept: "image/*, */*;q=0.8" },
    }));
  });

  it("returns null for non-OK remote image responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

    await expect(readImageAsBase64("https://cdn.example.test/missing.png")).resolves.toBeNull();
  });

  it("returns null before reading oversized remote image responses", async () => {
    const fetchMock = vi.fn(async () => new Response("tiny", {
      status: 200,
      headers: { "content-length": String(512 * 1024 * 1024 + 1) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readImageAsBase64("https://cdn.example.test/huge.png")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
