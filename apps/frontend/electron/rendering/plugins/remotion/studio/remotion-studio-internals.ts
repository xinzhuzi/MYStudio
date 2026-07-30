import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { RenderInternals } from "@remotion/renderer";

export const SUPPORTED_REMOTION_STUDIO_VERSION = "4.0.499";
const LOOPBACK_PORT_CONFIG = Object.freeze({
  host: "127.0.0.1",
  hostsToTry: ["127.0.0.1"],
});

const require = createRequire(import.meta.url);
let hostPatchActive = false;

export interface RemotionStudioInternalVersions {
  readonly remotion: string;
  readonly renderer: string;
  readonly studioServer: string;
}

export interface RemotionStudioLiveEventsServer {
  closeConnections: () => Promise<void>;
}

export type RemotionStudioStartServerResult =
  | {
      type: "started";
      port: number;
      liveEventsServer: RemotionStudioLiveEventsServer;
      close: () => Promise<void>;
    }
  | {
      type: "already-running";
      port: number;
    };

export type RemotionStudioInternalStartOptions = Record<string, unknown> & {
  forceIPv4: boolean;
  forceNew: boolean;
  port: number | null;
};

export type RemotionStudioStartServer = (
  options: RemotionStudioInternalStartOptions,
) => Promise<RemotionStudioStartServerResult>;

export interface LoopbackStudioServer {
  readonly upstreamPort: number;
  readonly versions: RemotionStudioInternalVersions;
  close: () => Promise<void>;
}

export function assertSupportedRemotionStudioInternals(): {
  readonly versions: RemotionStudioInternalVersions;
  readonly startServer: RemotionStudioStartServer;
} {
  const versions = readRemotionStudioVersions();
  for (const [name, version] of Object.entries(versions)) {
    if (version !== SUPPORTED_REMOTION_STUDIO_VERSION) {
      throw new Error(
        `Remotion Studio 内部适配器仅支持 ${SUPPORTED_REMOTION_STUDIO_VERSION}，${name}=${version}`,
      );
    }
  }
  const startServer = loadInternalStartServer();
  const renderInternals = RenderInternals as { getPortConfig?: unknown };
  if (typeof renderInternals.getPortConfig !== "function") {
    throw new Error("Remotion RenderInternals.getPortConfig API shape 不匹配");
  }
  return { versions, startServer };
}

export async function startLoopbackRemotionStudioServer(
  options: RemotionStudioInternalStartOptions,
  startServerOverride?: RemotionStudioStartServer,
): Promise<LoopbackStudioServer> {
  const { versions, startServer } = assertSupportedRemotionStudioInternals();
  const start = startServerOverride ?? startServer;
  const result = await withLoopbackPortConfig(() =>
    start({
      ...options,
      forceIPv4: true,
      forceNew: true,
      port: null,
    }),
  );
  if (result.type !== "started") {
    throw new Error(
      `Remotion Studio 内部 server 返回 already-running，缺少受控 close handle: port=${result.port}`,
    );
  }
  assertStartedServerShape(result);
  return {
    upstreamPort: result.port,
    versions,
    close: async () => {
      await result.liveEventsServer.closeConnections();
      await result.close();
    },
  };
}

export function readRemotionStudioVersions(): RemotionStudioInternalVersions {
  return {
    remotion: readPackageVersion("remotion"),
    renderer: readPackageVersion("@remotion/renderer"),
    studioServer: readPackageVersion("@remotion/studio-server"),
  };
}

async function withLoopbackPortConfig<T>(run: () => Promise<T>): Promise<T> {
  if (hostPatchActive) {
    throw new Error("Remotion Studio host patch 已在运行，拒绝并发启动第二个 Studio server");
  }
  const renderInternals = RenderInternals as {
    getPortConfig: (preferIpv4: boolean) => { host: string; hostsToTry: string[] };
  };
  const original = renderInternals.getPortConfig;
  hostPatchActive = true;
  renderInternals.getPortConfig = () => LOOPBACK_PORT_CONFIG;
  try {
    return await run();
  } finally {
    renderInternals.getPortConfig = original;
    hostPatchActive = false;
  }
}

function loadInternalStartServer(): RemotionStudioStartServer {
  const packageRoot = path.dirname(require.resolve("@remotion/studio-server/package.json"));
  const internalPath = path.join(packageRoot, "dist", "preview-server", "start-server.js");
  const mod = require(internalPath) as { startServer?: unknown };
  if (typeof mod.startServer !== "function") {
    throw new Error("@remotion/studio-server preview startServer API shape 不匹配");
  }
  return mod.startServer as RemotionStudioStartServer;
}

function assertStartedServerShape(value: RemotionStudioStartServerResult): asserts value is Extract<
  RemotionStudioStartServerResult,
  { type: "started" }
> {
  if (
    value.type !== "started"
    || !Number.isInteger(value.port)
    || value.port <= 0
    || typeof value.close !== "function"
    || typeof value.liveEventsServer?.closeConnections !== "function"
  ) {
    throw new Error("Remotion Studio started result API shape 不匹配");
  }
}

function readPackageVersion(packageName: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${packageName} package.json 缺少有效 version`);
  }
  return parsed.version;
}

