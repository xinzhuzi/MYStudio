// @vitest-environment node

import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StudioAuthProxy,
  createStudioAuthToken,
  isLoopbackAddress,
  isStudioProxyUrlAllowed,
} from "./studio-auth-proxy";

interface ResponseBody {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

describe("StudioAuthProxy", () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let proxy: StudioAuthProxy;
  let token: string;

  beforeEach(async () => {
    upstream = http.createServer((req, res) => {
      if ((req.url ?? "").startsWith("/events")) {
        res.writeHead(200, {
          "content-type": "text/event-stream;charset=utf-8",
          "cache-control": "no-cache",
        });
        res.write("data: {\"type\":\"init\"}\n\n");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`upstream:${req.url}`);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;
    token = createStudioAuthToken();
    proxy = new StudioAuthProxy(
      { host: "127.0.0.1", port: upstreamPort },
      { sessionId: "session-a", token },
    );
    await proxy.listen();
  });

  afterEach(async () => {
    await proxy.close().catch(() => undefined);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("binds to a loopback URL and rejects missing tokens", async () => {
    expect(isStudioProxyUrlAllowed(`http://127.0.0.1:${proxy.port}/`, proxy.port)).toBe(true);
    expect(isStudioProxyUrlAllowed(`http://localhost:${proxy.port}/`, proxy.port)).toBe(false);
    const res = await request(proxy.port, "/");
    expect(res.status).toBe(401);
  });

  it("authenticates the first request with query token and strips it upstream", async () => {
    const res = await request(proxy.port, `/?mystudioStudioToken=${token}&mystudioSessionId=session-a`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("upstream:/");
    expect(String(res.headers["set-cookie"])).toContain("mystudio_studio_token=");
  });

  it("authenticates subsequent asset requests with the HttpOnly cookie", async () => {
    const first = await request(proxy.port, `/?mystudioStudioToken=${token}`);
    const cookie = String(first.headers["set-cookie"]).split(";", 1)[0]!;
    const asset = await request(proxy.port, "/static/app.js", { cookie });
    expect(asset.status).toBe(200);
    expect(asset.body).toBe("upstream:/static/app.js");
  });

  it("protects /events SSE through the same token gate", async () => {
    const rejected = await request(proxy.port, "/events");
    expect(rejected.status).toBe(401);
    const accepted = await request(proxy.port, "/events", {
      authorization: `Bearer ${token}`,
      stopAfterFirstChunk: true,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toContain("\"type\":\"init\"");
  });

  it("rotates tokens and invalidates the previous session", async () => {
    const previous = await request(proxy.port, `/?mystudioStudioToken=${token}`);
    const previousCookie = String(previous.headers["set-cookie"]).split(";", 1)[0]!;
    proxy.rotateSession({ sessionId: "session-b", token: "b".repeat(64) });
    const rejected = await request(proxy.port, "/", { cookie: previousCookie });
    expect(rejected.status).toBe(401);
    const accepted = await request(proxy.port, `/?mystudioStudioToken=${"b".repeat(64)}`);
    expect(accepted.status).toBe(200);
  });

  it("closes and releases the proxy port", async () => {
    const port = proxy.port;
    await proxy.close();
    await expect(request(port, "/")).rejects.toThrow();
  });
});

describe("isLoopbackAddress", () => {
  it("accepts only loopback socket addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.4")).toBe(false);
  });
});

function request(
  port: number,
  path: string,
  options: {
    readonly cookie?: string;
    readonly authorization?: string;
    readonly stopAfterFirstChunk?: boolean;
  } = {},
): Promise<ResponseBody> {
  return new Promise<ResponseBody>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (options.stopAfterFirstChunk) {
          req.destroy();
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        }
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    if (options.cookie) req.setHeader("Cookie", options.cookie);
    if (options.authorization) req.setHeader("Authorization", options.authorization);
    req.on("error", reject);
    req.end();
  });
}

