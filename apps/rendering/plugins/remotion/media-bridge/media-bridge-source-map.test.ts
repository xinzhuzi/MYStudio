// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaBridgeServer } from "./media-bridge-server";
import { buildMediaUrlMap } from "./media-bridge-source-map";

const servers: MediaBridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("media bridge source map", () => {
  it("reuses one opaque URL for clips that reference the same source path", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-media-map-"));
    const sourceA = path.join(fixtureRoot, "scene-a.mp4");
    const sourceB = path.join(fixtureRoot, "scene-b.mp4");
    fs.writeFileSync(sourceA, "source-a", "utf8");
    fs.writeFileSync(sourceB, "source-b", "utf8");
    const server = new MediaBridgeServer();
    servers.push(server);
    await server.listen();
    const session = server.createSession();
    try {
      const urls = buildMediaUrlMap(server, session, [
        { clipId: "clip-1", absolutePath: sourceA },
        { clipId: "clip-2", absolutePath: sourceA },
        { clipId: "clip-3", absolutePath: sourceB },
      ]);
      expect(urls["clip-1"]).toBe(urls["clip-2"]);
      expect(urls["clip-3"]).not.toBe(urls["clip-1"]);
      expect(session.size).toBe(2);
      expect(urls["clip-1"]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
      expect(urls["clip-1"]).not.toContain("scene-a");
    } finally {
      await server.revokeSession(session);
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate clip ids without exposing the source path", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-media-map-duplicate-"));
    const source = path.join(fixtureRoot, "private-name.mp4");
    fs.writeFileSync(source, "source", "utf8");
    const server = new MediaBridgeServer();
    servers.push(server);
    await server.listen();
    const session = server.createSession();
    try {
      expect(() => buildMediaUrlMap(server, session, [
        { clipId: "clip-1", absolutePath: source },
        { clipId: "clip-1", absolutePath: source },
      ])).toThrow("媒体桥 clipId 为空或重复: clip-1");
    } finally {
      await server.revokeSession(session);
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
