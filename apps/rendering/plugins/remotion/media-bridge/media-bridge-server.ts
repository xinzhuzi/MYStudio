import fs from "node:fs";
import http from "node:http";
import { AddressInfo } from "node:net";
import { MediaBridgeSession, createSessionToken } from "./media-bridge-session";
import { resolveContentType } from "./media-content-type";

/**
 * A localhost-only capability server for Remotion preview/render media.
 *
 * Binds strictly to 127.0.0.1. Each session owns a 256-bit token and an
 * assetId -> absolute path whitelist; URLs are `http://127.0.0.1:<port>/<token>/<assetId>`
 * and contain no local file names. The server closes once it has no sessions.
 */
export interface MediaBridgeUrl {
  readonly assetId: string;
  readonly url: string;
}

const HOST = "127.0.0.1";
const RANGE_PREFIX = "bytes=";

interface ParsedRoute {
  readonly token: string;
  readonly assetId: string;
}

/** Parse `/<token>/<assetId>` without touching the filesystem. */
function parseRoute(rawUrl: string): ParsedRoute | undefined {
  const pathname = rawUrl.split("?", 1)[0] ?? "";
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) {
    return undefined;
  }
  const [token, assetId] = segments;
  return { token: decodeURIComponent(token), assetId: decodeURIComponent(assetId) };
}

interface ParsedRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Parse a single-interval Range header against a known size.
 * Returns undefined when the header is absent; throws a sentinel for malformed
 * or unsatisfiable ranges so the caller can answer 416.
 */
function parseSingleRange(header: string | undefined, size: number): ParsedRange | undefined {
  if (!header) {
    return undefined;
  }
  if (!header.startsWith(RANGE_PREFIX)) {
    throw new RangeError("unsupported-range-unit");
  }
  const spec = header.slice(RANGE_PREFIX.length);
  if (spec.includes(",")) {
    throw new RangeError("multiple-ranges-unsupported");
  }
  const [startText, endText] = spec.split("-");
  if (startText === "" && endText === "") {
    throw new RangeError("empty-range");
  }

  let start: number;
  let end: number;
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("bad-suffix");
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Number(endText);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new RangeError("non-integer");
    }
  }
  if (start < 0 || end < start || start >= size) {
    throw new RangeError("unsatisfiable");
  }
  return { start, end: Math.min(end, size - 1) };
}

export class MediaBridgeServer {
  private readonly server: http.Server;
  private readonly sessions = new Map<string, MediaBridgeSession>();
  private listening = false;

  constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  /** Start listening on an ephemeral 127.0.0.1 port. Idempotent. */
  async listen(): Promise<void> {
    if (this.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, HOST, () => {
        this.server.removeListener("error", onError);
        this.listening = true;
        resolve();
      });
    });
  }

  get port(): number {
    const address = this.server.address() as AddressInfo | null;
    if (!address || typeof address === "string") {
      throw new Error("媒体桥 server 尚未监听");
    }
    return address.port;
  }

  /** Create a new session and register it under a fresh token. */
  createSession(): MediaBridgeSession {
    const session = new MediaBridgeSession(createSessionToken());
    this.sessions.set(session.token, session);
    return session;
  }

  /** Build capability URLs for a session's assets. */
  buildUrls(session: MediaBridgeSession, assetIds: readonly string[]): MediaBridgeUrl[] {
    return assetIds.map((assetId) => ({
      assetId,
      url: `http://${HOST}:${this.port}/${session.token}/${encodeURIComponent(assetId)}`,
    }));
  }

  /**
   * Revoke a session's token. When no sessions remain the server closes so it
   * never lingers as an open localhost port.
   */
  async revokeSession(session: MediaBridgeSession): Promise<void> {
    session.revoke();
    this.sessions.delete(session.token);
    if (this.sessions.size === 0) {
      await this.close();
    }
  }

  /** Force-close the server and revoke all sessions (app quit). */
  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.revoke();
    }
    this.sessions.clear();
    if (!this.listening) {
      return;
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.listening = false;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.writeHead(405).end();
      return;
    }
    const route = parseRoute(req.url ?? "");
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    const session = this.sessions.get(route.token);
    if (!session || session.isRevoked) {
      res.writeHead(401).end();
      return;
    }
    const absolutePath = session.resolve(route.assetId);
    if (!absolutePath) {
      res.writeHead(404).end();
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      res.writeHead(404).end();
      return;
    }
    if (!stat.isFile() || stat.size <= 0) {
      res.writeHead(404).end();
      return;
    }

    const size = stat.size;
    const contentType = resolveContentType(absolutePath);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");

    let range: ParsedRange | undefined;
    try {
      range = parseSingleRange(req.headers.range, size);
    } catch {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.writeHead(416).end();
      return;
    }

    if (range) {
      const length = range.end - range.start + 1;
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(length));
      if (method === "HEAD") {
        res.writeHead(206).end();
        return;
      }
      res.writeHead(206);
      fs.createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(size));
    if (method === "HEAD") {
      res.writeHead(200).end();
      return;
    }
    res.writeHead(200);
    fs.createReadStream(absolutePath).pipe(res);
  }
}
