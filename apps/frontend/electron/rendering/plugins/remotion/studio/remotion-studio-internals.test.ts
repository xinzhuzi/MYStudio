// @vitest-environment node

import { RenderInternals } from "@remotion/renderer";
import { describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_REMOTION_STUDIO_VERSION,
  assertSupportedRemotionStudioInternals,
  readRemotionStudioVersions,
  startLoopbackRemotionStudioServer,
  type RemotionStudioInternalStartOptions,
} from "./remotion-studio-internals";

describe("Remotion Studio internal guards", () => {
  it("pins all Remotion internals to the supported version", () => {
    expect(SUPPORTED_REMOTION_STUDIO_VERSION).toBe("4.0.499");
    expect(readRemotionStudioVersions()).toEqual({
      remotion: "4.0.499",
      renderer: "4.0.499",
      studioServer: "4.0.499",
    });
    expect(() => assertSupportedRemotionStudioInternals()).not.toThrow();
  });

  it("patches host selection to loopback only while starting the internal server", async () => {
    const original = RenderInternals.getPortConfig(false);
    const closeConnections = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => {
      expect(RenderInternals.getPortConfig(false)).toEqual({
        host: "127.0.0.1",
        hostsToTry: ["127.0.0.1"],
      });
      return {
        type: "started" as const,
        port: 4321,
        liveEventsServer: { closeConnections },
        close,
      };
    });
    const server = await startLoopbackRemotionStudioServer(startOptions(), start);
    expect(server.upstreamPort).toBe(4321);
    expect(RenderInternals.getPortConfig(false)).toEqual(original);
    await server.close();
    expect(closeConnections).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects already-running results because they cannot be precisely cleaned up", async () => {
    await expect(
      startLoopbackRemotionStudioServer(startOptions(), async () => ({
        type: "already-running",
        port: 3000,
      })),
    ).rejects.toThrow("already-running");
  });
});

function startOptions(): RemotionStudioInternalStartOptions {
  return { forceIPv4: true, forceNew: true, port: null };
}

