import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiCorsProxyPlugin } from "./api-cors-proxy";

type CapturedMiddleware = (req: Readable & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}, res: FakeResponse) => Promise<void>;

class FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  chunks: Buffer[] = [];

  writeHead = vi.fn((status: number, headers?: Record<string, string>) => {
    this.status = status;
    this.headers = headers;
    return this;
  });

  end = vi.fn((chunk?: string | Buffer) => {
    if (typeof chunk === "string") {
      this.chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      this.chunks.push(chunk);
    }
    return this;
  });

  text() {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}

function createHarness() {
  let path = "";
  let middleware: CapturedMiddleware | undefined;
  const plugin = apiCorsProxyPlugin();
  plugin.configureServer?.({
    middlewares: {
      use: vi.fn((registeredPath: string, handler: CapturedMiddleware) => {
        path = registeredPath;
        middleware = handler;
      }),
    },
  } as never);
  if (!middleware) {
    throw new Error("apiCorsProxyPlugin did not register middleware");
  }
  return { path, middleware };
}

function createRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
}) {
  const request = Readable.from(options.body ? [Buffer.from(options.body)] : []) as Readable & {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  };
  request.method = options.method;
  request.url = options.url;
  request.headers = options.headers ?? {};
  return request;
}

async function runMiddleware(options: Parameters<typeof createRequest>[0]) {
  const { path, middleware } = createHarness();
  const response = new FakeResponse();
  await middleware(createRequest(options), response);
  return { path, response };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiCorsProxyPlugin", () => {
  it("registers the development proxy middleware and handles OPTIONS with the current CORS contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { path, response } = await runMiddleware({ method: "OPTIONS", url: "/?url=https://api.test" });

    expect(path).toBe("/__api_proxy");
    expect(response.writeHead).toHaveBeenCalledWith(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    expect(response.end).toHaveBeenCalledWith();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the current 400 response when the target URL parameter is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { response } = await runMiddleware({ method: "GET", url: "/missing" });

    expect(response.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
    expect(JSON.parse(response.text())).toEqual({ error: "Missing ?url= parameter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards method, parsed proxy headers, request body, response status, content-type, and CORS", async () => {
    const fetchMock = vi.fn(async () => new Response("proxied", {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { response } = await runMiddleware({
      method: "POST",
      url: "/?url=https%3A%2F%2Fapi.test%2Fsubmit",
      headers: { "x-proxy-headers": JSON.stringify({ Authorization: "Bearer test" }) },
      body: "payload",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.test/submit", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
      body: expect.any(Buffer),
    });
    expect(Buffer.from(fetchMock.mock.calls[0][1].body).toString("utf-8")).toBe("payload");
    expect(response.writeHead).toHaveBeenCalledWith(201, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    });
    expect(response.text()).toBe("proxied");
  });

  it("keeps malformed proxy headers empty and omits bodies for GET requests", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runMiddleware({
      method: "GET",
      url: "/?url=https%3A%2F%2Fapi.test%2Fitems",
      headers: { "x-proxy-headers": "{not-json" },
      body: "ignored",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.test/items", {
      method: "GET",
      headers: {},
      body: undefined,
    });
  });

  it("returns the current 502 JSON payload with detail and cause when forwarding fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket closed", { cause: { code: "ECONNRESET" } });
    }));

    const { response } = await runMiddleware({
      method: "GET",
      url: "/?url=https%3A%2F%2Fapi.test%2Fitems",
    });

    expect(response.writeHead).toHaveBeenCalledWith(502, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    expect(JSON.parse(response.text())).toEqual({
      error: "Proxy request failed",
      detail: "socket closed",
      cause: "ECONNRESET",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[api-cors-proxy] Unexpected error: socket closed | cause: ECONNRESET",
    );
  });
});
