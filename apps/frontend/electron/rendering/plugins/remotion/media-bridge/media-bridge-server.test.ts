import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaBridgeServer } from "./media-bridge-server";

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function request(
  port: number,
  urlPath: string,
  options: { method?: string; range?: string } = {},
): Promise<FetchResult> {
  return new Promise<FetchResult>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: options.method ?? "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    if (options.range) {
      req.setHeader("Range", options.range);
    }
    req.on("error", reject);
    req.end();
  });
}

describe("MediaBridgeServer", () => {
  let dir: string;
  let filePath: string;
  const payload = Buffer.from("hello media bridge payload");
  let server: MediaBridgeServer;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-bridge-"));
    filePath = path.join(dir, "clip.png");
    fs.writeFileSync(filePath, payload);
    server = new MediaBridgeServer();
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("serves a full GET with correct headers", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const [{ url }] = server.buildUrls(session, ["a1"]);
    const res = await request(server.port, new URL(url).pathname);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(payload.length));
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.equals(payload)).toBe(true);
  });

  it("answers HEAD without a body", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/a1`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers["content-length"]).toBe(String(payload.length));
    expect(res.body.length).toBe(0);
  });

  it("serves a single Range as 206", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/a1`, { range: "bytes=0-4" });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-4/${payload.length}`);
    expect(res.body.equals(payload.subarray(0, 5))).toBe(true);
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/a1`, { range: "bytes=999999-" });
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${payload.length}`);
  });

  it("rejects methods other than GET/HEAD with 405", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/a1`, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toContain("GET");
  });

  it("returns 401 for an unknown token", async () => {
    const res = await request(server.port, `/deadbeef/a1`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown asset in a valid session", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/nope`);
    expect(res.status).toBe(404);
  });

  it("does not resolve traversal segments (route requires exactly token/assetId)", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const res = await request(server.port, `/${session.token}/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(404);
  });

  it("returns 401 after a session is revoked", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const token = session.token;
    // Second session keeps the server alive after revoking the first.
    server.createSession();
    await server.revokeSession(session);
    const res = await request(server.port, `/${token}/a1`);
    expect(res.status).toBe(401);
  });

  it("closes the server when the last session is revoked", async () => {
    const session = server.createSession();
    session.register("a1", filePath);
    const port = server.port;
    await server.revokeSession(session);
    await expect(request(port, `/${session.token}/a1`)).rejects.toThrow();
  });

  it("revokes all sessions on close (app quit)", async () => {
    const s1 = server.createSession();
    const s2 = server.createSession();
    s1.register("a1", filePath);
    s2.register("b1", filePath);
    await server.close();
    expect(s1.isRevoked).toBe(true);
    expect(s2.isRevoked).toBe(true);
  });
});
