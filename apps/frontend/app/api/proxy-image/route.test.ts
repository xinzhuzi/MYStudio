// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const MockNextResponse = vi.hoisted(() => class extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new MockNextResponse(JSON.stringify(body), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init?.headers),
      },
    });
  }
});

vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: MockNextResponse,
}));

import { GET } from "./route";

function requestWithUrl(targetUrl?: string) {
  const nextUrl = new URL("http://localhost/api/proxy-image");
  if (targetUrl !== undefined) {
    nextUrl.searchParams.set("url", targetUrl);
  }
  return { nextUrl };
}

async function responseJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy-image route", () => {
  it("rejects missing and non-http image URLs before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(responseJson(await GET(requestWithUrl() as never))).resolves.toEqual({
      error: "Missing url parameter",
    });
    const invalidProtocol = await GET(requestWithUrl("file:///tmp/image.png") as never);

    expect(invalidProtocol.status).toBe(400);
    await expect(responseJson(invalidProtocol)).resolves.toEqual({ error: "Invalid URL protocol" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards successful image bytes with the current content-type and cache contract", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/jpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(requestWithUrl("https://cdn.test/image.jpg") as never);

    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/image.jpg", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("defaults successful image responses without content-type to image/png", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9]))));

    const response = await GET(requestWithUrl("https://cdn.test/no-type") as never);

    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns the upstream status for non-ok image responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

    const response = await GET(requestWithUrl("https://cdn.test/missing.png") as never);

    expect(response.status).toBe(404);
    await expect(responseJson(response)).resolves.toEqual({ error: "Failed to fetch image: 404" });
  });

  it("returns the current generic 500 response for fetch or body failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    const response = await GET(requestWithUrl("https://cdn.test/image.png") as never);

    expect(response.status).toBe(500);
    await expect(responseJson(response)).resolves.toEqual({ error: "Failed to proxy image" });
    expect(consoleError).toHaveBeenCalledWith("[proxy-image] Error:", expect.any(Error));
  });
});
