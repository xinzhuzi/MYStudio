import { afterEach, describe, expect, it, vi } from "vitest";
import { corsFetch as canonicalCorsFetch } from "./network/cors-fetch";
import { corsFetch as facadeCorsFetch } from "./cors-fetch";

describe("corsFetch compatibility facade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-exports the canonical network helper", () => {
    expect(facadeCorsFetch).toBe(canonicalCorsFetch);
  });

  it("proxies the normalized URL and serialized headers in Vite development", async () => {
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const init: RequestInit = {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    };

    await expect(canonicalCorsFetch(new URL("https://example.com/models"), init)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/__api_proxy?url=https%3A%2F%2Fexample.com%2Fmodels",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-headers": JSON.stringify({ authorization: "Bearer test-token" }),
        },
      },
    );
  });
});
