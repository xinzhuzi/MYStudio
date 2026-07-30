import crypto from "node:crypto";
import path from "node:path";
import {
  startLoopbackRemotionStudioServer,
  type LoopbackStudioServer,
  type RemotionStudioInternalStartOptions,
} from "./remotion-studio-internals";
import {
  createStudioAuthToken,
  isStudioProxyUrlAllowed,
  StudioAuthProxy,
  type StudioAuthProxySnapshot,
} from "./studio-auth-proxy";

export interface RemotionStudioSessionIdentity {
  readonly projectId: string;
  readonly chapterId: string;
  readonly revision: number;
}

export interface RemotionStudioSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly chapterId: string;
  readonly revision: number;
  readonly proxyPort: number;
  readonly upstreamPort: number;
  readonly url: string;
}

export interface RemotionStudioServiceOptions {
  readonly startStudioServer?: (
    options: RemotionStudioInternalStartOptions,
  ) => Promise<LoopbackStudioServer>;
}

export function resolveProjectFixedStudioEntryPoint(
  studioRoot: string,
  projectId: string,
): string {
  if (!path.isAbsolute(studioRoot)) throw new Error("studioRoot 必须是绝对路径");
  if (!projectId.trim() || projectId === "." || projectId === ".." || projectId.includes("/") || projectId.includes("\\")) {
    throw new Error("projectId 不能用于 Studio projection 路径");
  }
  return path.join(studioRoot, projectId, "chapter-projection.tsx");
}

export class RemotionStudioService {
  private active:
    | {
        identity: RemotionStudioSessionIdentity;
        sessionId: string;
        server: LoopbackStudioServer;
        proxy: StudioAuthProxy;
      }
    | null = null;
  private starting: Promise<RemotionStudioSession> | null = null;
  private startingProjectId: string | null = null;

  constructor(private readonly options: RemotionStudioServiceOptions = {}) {}

  assertProjectCanEnsure(projectId: string): void {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) throw new Error("projectId 不能为空");
    const owningProjectId = this.active?.identity.projectId ?? this.startingProjectId;
    if (owningProjectId && owningProjectId !== normalizedProjectId) {
      throw new Error(
        `Remotion Studio 当前项目 ${owningProjectId} 尚未关闭，拒绝激活 ${normalizedProjectId}`,
      );
    }
  }

  async ensureSession(
    identity: RemotionStudioSessionIdentity,
    startOptions: RemotionStudioInternalStartOptions,
  ): Promise<RemotionStudioSession> {
    validateIdentity(identity);
    this.assertProjectCanEnsure(identity.projectId);
    if (this.active) {
      if (sameIdentity(this.active.identity, identity)) {
        return this.toSession(this.active.proxy.snapshot());
      }
      this.active.identity = identity;
      this.active.sessionId = crypto.randomUUID();
      return this.toSession(
        this.active.proxy.rotateSession({
          sessionId: this.active.sessionId,
          token: createStudioAuthToken(),
        }),
      );
    }

    if (this.starting) {
      const session = await this.starting;
      if (sameIdentity({
        projectId: session.projectId,
        chapterId: session.chapterId,
        revision: session.revision,
      }, identity)) return session;
      return this.ensureSession(identity, startOptions);
    }

    this.startingProjectId = identity.projectId;
    const start = (async () => {
      const server = await (this.options.startStudioServer ?? startLoopbackRemotionStudioServer)(
        startOptions,
      );
      const sessionId = crypto.randomUUID();
      const proxy = new StudioAuthProxy(
        { host: "127.0.0.1", port: server.upstreamPort },
        { sessionId, token: createStudioAuthToken() },
      );
      try {
        await proxy.listen();
        this.active = { identity, sessionId, server, proxy };
        return this.toSession(proxy.snapshot());
      } catch (error) {
        await proxy.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        throw error;
      }
    })();
    this.starting = start;
    try {
      return await start;
    } finally {
      if (this.starting === start) this.starting = null;
      this.startingProjectId = null;
    }
  }

  isNavigationAllowed(rawUrl: string): boolean {
    if (!this.active) return false;
    return isStudioProxyUrlAllowed(rawUrl, this.active.proxy.port);
  }

  async close(): Promise<void> {
    const starting = this.starting;
    if (starting) await starting.catch(() => undefined);
    const active = this.active;
    if (!active) return;
    const results = await Promise.allSettled([active.proxy.close(), active.server.close()]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const details = failures
        .map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
        .join("；");
      throw new Error(`Remotion Studio 资源未完全释放，拒绝关闭当前项目会话: ${details}`);
    }
    this.active = null;
  }

  getActiveIdentity(): RemotionStudioSessionIdentity | null {
    return this.active?.identity ?? null;
  }

  private toSession(snapshot: StudioAuthProxySnapshot): RemotionStudioSession {
    if (!this.active) {
      throw new Error("Remotion Studio session 尚未激活");
    }
    return {
      sessionId: snapshot.sessionId,
      projectId: this.active.identity.projectId,
      chapterId: this.active.identity.chapterId,
      revision: this.active.identity.revision,
      proxyPort: snapshot.port,
      upstreamPort: snapshot.target.port,
      url: snapshot.url,
    };
  }
}

function validateIdentity(identity: RemotionStudioSessionIdentity): void {
  if (!identity.projectId.trim()) throw new Error("projectId 不能为空");
  if (!identity.chapterId.trim()) throw new Error("chapterId 不能为空");
  if (!Number.isInteger(identity.revision) || identity.revision < 0) {
    throw new Error("revision 必须是非负整数");
  }
}

function sameIdentity(
  a: RemotionStudioSessionIdentity,
  b: RemotionStudioSessionIdentity,
): boolean {
  return a.projectId === b.projectId
    && a.chapterId === b.chapterId
    && a.revision === b.revision;
}
