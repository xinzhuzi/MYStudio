// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  RemotionStudioService,
  resolveProjectFixedStudioEntryPoint,
} from "./remotion-studio-service";
import type {
  LoopbackStudioServer,
  RemotionStudioInternalStartOptions,
} from "./remotion-studio-internals";

describe("RemotionStudioService", () => {
  it("keeps one project-fixed compiler entry across chapter and revision updates", () => {
    const root = path.resolve("/tmp/mystudio-studio");
    const first = resolveProjectFixedStudioEntryPoint(root, "project-a");
    const afterChapterUpdate = resolveProjectFixedStudioEntryPoint(root, "project-a");
    expect(afterChapterUpdate).toBe(first);
    expect(first).toBe(path.join(root, "project-a", "chapter-projection.tsx"));
    expect(resolveProjectFixedStudioEntryPoint(root, "project-b")).not.toBe(first);
  });

  it("starts one service for a project and reuses it for the same session", async () => {
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => fakeServer(4301, close));
    const service = new RemotionStudioService({ startStudioServer: start });
    const first = await service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    const second = await service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    expect(start).toHaveBeenCalledTimes(1);
    expect(second.proxyPort).toBe(first.proxyPort);
    expect(second.sessionId).toBe(first.sessionId);
    expect(service.isNavigationAllowed(first.url)).toBe(true);
    await service.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reuses the server when only the current chapter session changes", async () => {
    const start = vi.fn(async () => fakeServer(4302));
    const service = new RemotionStudioService({ startStudioServer: start });
    const first = await service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    const next = await service.ensureSession(identity("project-a", "chapter-2", 1), startOptions());
    expect(start).toHaveBeenCalledTimes(1);
    expect(next.proxyPort).toBe(first.proxyPort);
    expect(next.upstreamPort).toBe(first.upstreamPort);
    expect(next.sessionId).not.toBe(first.sessionId);
    await service.close();
  });

  it("blocks a second active project until the current service is closed", async () => {
    const service = new RemotionStudioService({ startStudioServer: async () => fakeServer(4303) });
    await service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    await expect(
      service.ensureSession(identity("project-b", "chapter-1", 1), startOptions()),
    ).rejects.toThrow("尚未关闭");
    await service.close();
    const afterClose = await service.ensureSession(identity("project-b", "chapter-1", 1), startOptions());
    expect(afterClose.projectId).toBe("project-b");
    await service.close();
  });

  it("keeps the current project fail-closed when server cleanup fails", async () => {
    const close = vi.fn(async (): Promise<void> => { throw new Error("port still open"); });
    const service = new RemotionStudioService({
      startStudioServer: async () => fakeServer(4306, close),
    });
    await service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());

    await expect(service.close()).rejects.toThrow("资源未完全释放");
    expect(service.getActiveIdentity()).toEqual(identity("project-a", "chapter-1", 1));
    await expect(service.ensureSession(identity("project-b", "chapter-1", 1), startOptions()))
      .rejects.toThrow("尚未关闭");
  });

  it("serializes concurrent startup and never starts two servers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const start = vi.fn(async () => {
      await gate;
      return fakeServer(4304);
    });
    const service = new RemotionStudioService({ startStudioServer: start });
    const first = service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    const second = service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    release();
    const sessions = await Promise.all([first, second]);
    expect(sessions[0]?.proxyPort).toBe(sessions[1]?.proxyPort);
    await service.close();
  });

  it("rejects a different project while startup is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new RemotionStudioService({
      startStudioServer: async () => {
        await gate;
        return fakeServer(4305);
      },
    });
    const first = service.ensureSession(identity("project-a", "chapter-1", 1), startOptions());
    await Promise.resolve();
    expect(() => service.assertProjectCanEnsure("project-b"))
      .toThrow("当前项目 project-a 尚未关闭");
    await expect(service.ensureSession(identity("project-b", "chapter-1", 1), startOptions()))
      .rejects.toThrow("当前项目 project-a 尚未关闭");
    release();
    await first;
    await service.close();
  });
});

function identity(projectId: string, chapterId: string, revision: number) {
  return { projectId, chapterId, revision };
}

function startOptions(): RemotionStudioInternalStartOptions {
  return { forceIPv4: true, forceNew: true, port: null };
}

function fakeServer(
  port: number,
  close: LoopbackStudioServer["close"] = vi.fn(async () => undefined),
): LoopbackStudioServer {
  return {
    upstreamPort: port,
    versions: {
      remotion: "4.0.499",
      renderer: "4.0.499",
      studioServer: "4.0.499",
    },
    close,
  };
}
