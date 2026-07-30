import crypto from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { pipeline } from "node:stream";

const LOOPBACK_HOST = "127.0.0.1";
const AUTH_QUERY_PARAM = "mystudioStudioToken";
const AUTH_COOKIE_NAME = "mystudio_studio_token";

export interface StudioAuthProxyTarget {
  readonly host: "127.0.0.1";
  readonly port: number;
}

export interface StudioAuthProxySession {
  readonly sessionId: string;
  readonly token: string;
}

export interface StudioAuthProxySnapshot {
  readonly port: number;
  readonly target: StudioAuthProxyTarget;
  readonly sessionId: string;
  readonly url: string;
}

export function createStudioAuthToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isStudioProxyUrlAllowed(rawUrl: string, proxyPort: number): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:"
      && url.hostname === LOOPBACK_HOST
      && url.port === String(proxyPort);
  } catch {
    return false;
  }
}

export class StudioAuthProxy {
  private readonly server: http.Server;
  private listening = false;
  private session: StudioAuthProxySession;

  constructor(
    private readonly target: StudioAuthProxyTarget,
    session: StudioAuthProxySession,
  ) {
    this.session = session;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<void> {
    if (this.listening) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, LOOPBACK_HOST, () => {
        this.server.removeListener("error", onError);
        this.listening = true;
        resolve();
      });
    });
  }

  get port(): number {
    const address = this.server.address() as AddressInfo | null;
    if (!address || typeof address === "string") {
      throw new Error("Remotion Studio auth proxy 尚未监听");
    }
    return address.port;
  }

  snapshot(): StudioAuthProxySnapshot {
    return {
      port: this.port,
      target: this.target,
      sessionId: this.session.sessionId,
      url: this.buildSessionUrl(),
    };
  }

  rotateSession(session: StudioAuthProxySession): StudioAuthProxySnapshot {
    this.session = session;
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (!this.listening) return;
    const closeAllConnections = (this.server as http.Server & {
      closeAllConnections?: () => void;
    }).closeAllConnections;
    if (typeof closeAllConnections === "function") {
      closeAllConnections.call(this.server);
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.listening = false;
  }

  private buildSessionUrl(): string {
    const url = new URL(`http://${LOOPBACK_HOST}:${this.port}/`);
    url.searchParams.set(AUTH_QUERY_PARAM, this.session.token);
    url.searchParams.set("mystudioSessionId", this.session.sessionId);
    return url.toString();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    const auth = this.authorize(req);
    if (!auth.authorized) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    if (auth.fromQuery) {
      res.setHeader(
        "Set-Cookie",
        `${AUTH_COOKIE_NAME}=${this.session.token}; HttpOnly; SameSite=Strict; Path=/`,
      );
    }

    const upstreamPath = stripAuthQuery(req.url ?? "/");
    const headers = sanitizeProxyHeaders(req.headers, this.target.port);
    const upstream = http.request(
      {
        host: this.target.host,
        port: this.target.port,
        method: req.method,
        path: upstreamPath,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, sanitizeResponseHeaders(upstreamRes.headers));
        pipeline(upstreamRes, res, () => undefined);
      },
    );

    upstream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end("studio-upstream-unavailable");
    });
    pipeline(req, upstream, () => undefined);
  }

  private authorize(req: http.IncomingMessage): { authorized: boolean; fromQuery: boolean } {
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, `http://${LOOPBACK_HOST}`);
    const queryToken = url.searchParams.get(AUTH_QUERY_PARAM);
    if (queryToken === this.session.token) {
      return { authorized: true, fromQuery: true };
    }
    const headerToken = parseAuthorization(req.headers.authorization);
    if (headerToken === this.session.token) {
      return { authorized: true, fromQuery: false };
    }
    const cookieToken = parseCookie(req.headers.cookie ?? "")[AUTH_COOKIE_NAME];
    return { authorized: cookieToken === this.session.token, fromQuery: false };
  }
}

function parseAuthorization(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return undefined;
  return token;
}

function parseCookie(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey] = rawValue.join("=");
  }
  return result;
}

function stripAuthQuery(rawUrl: string): string {
  const url = new URL(rawUrl, `http://${LOOPBACK_HOST}`);
  url.searchParams.delete(AUTH_QUERY_PARAM);
  url.searchParams.delete("mystudioSessionId");
  return `${url.pathname}${url.search}${url.hash}`;
}

function sanitizeProxyHeaders(
  headers: http.IncomingHttpHeaders,
  upstreamPort: number,
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = { ...headers };
  delete next.connection;
  delete next.host;
  delete next["content-length"];
  delete next["proxy-authenticate"];
  delete next["proxy-authorization"];
  delete next["set-cookie"];
  delete next.te;
  delete next.trailer;
  delete next["transfer-encoding"];
  delete next.upgrade;
  next.host = `${LOOPBACK_HOST}:${upstreamPort}`;
  return next;
}

function sanitizeResponseHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = { ...headers };
  delete next.connection;
  delete next["content-length"];
  delete next["transfer-encoding"];
  return next;
}
