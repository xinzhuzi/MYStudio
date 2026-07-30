// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), removed: [] as string[] }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => { state.removed.push(channel); state.handlers.delete(channel); }),
  },
}));

import {
  REMOTION_STUDIO_CLOSE_SESSION_CHANNEL,
  REMOTION_STUDIO_ENSURE_SESSION_CHANNEL,
  registerRemotionStudioIpcHandlers,
  validateRemotionStudioEnsureSessionReply,
  validateRemotionStudioEnsureSessionRequest,
} from "./remotion-studio-ipc";

beforeEach(() => { state.handlers.clear(); state.removed.length = 0; });

describe("Remotion Studio IPC", () => {
  it("fails closed for malformed identity payloads", () => {
    for (const value of [null, {}, { projectId: "p", chapterId: "c", revision: 1, entryPoint: "/tmp/x" }, { projectId: "p/a", chapterId: "c", revision: 1 }, { projectId: "p", chapterId: "c", revision: 0 }]) {
      expect(validateRemotionStudioEnsureSessionRequest(value).success).toBe(false);
    }
  });

  it("returns only a safe ready projection and validates projection identity", async () => {
    const ensureSession = vi.fn(async () => ({
      sessionId: "session-1", projectId: "project-a", chapterId: "chapter-1", revision: 3,
      proxyPort: 4400, upstreamPort: 4401, url: "http://127.0.0.1:4400/?session=session-1",
    }));
    const registration = registerRemotionStudioIpcHandlers({ ensureSession });
    const handler = state.handlers.get(REMOTION_STUDIO_ENSURE_SESSION_CHANNEL)!;
    await expect(handler({}, { projectId: "project-a", chapterId: "chapter-1", revision: 3 })).resolves.toEqual({
      status: "ready", sessionId: "session-1", url: "http://127.0.0.1:4400/?session=session-1",
      projectId: "project-a", chapterId: "chapter-1", revision: 3,
    });
    expect(ensureSession).toHaveBeenCalledWith({ projectId: "project-a", chapterId: "chapter-1", revision: 3 });
    await registration.dispose();
    expect(state.removed).toEqual([
      REMOTION_STUDIO_ENSURE_SESSION_CHANNEL,
      REMOTION_STUDIO_CLOSE_SESSION_CHANNEL,
    ]);
  });

  it("returns structured blocked and rejects unsafe reply URLs", async () => {
    const registration = registerRemotionStudioIpcHandlers({
      ensureSession: async () => { throw new Error("当前章缺少合法 current shot 输出"); },
    });
    const handler = state.handlers.get(REMOTION_STUDIO_ENSURE_SESSION_CHANNEL)!;
    await expect(handler({}, { projectId: "project-a", chapterId: "chapter-1", revision: 3 })).resolves.toMatchObject({
      status: "blocked", projectId: "project-a", chapterId: "chapter-1", revision: 3,
    });
    expect(validateRemotionStudioEnsureSessionReply({
      status: "ready", sessionId: "x", url: "http://0.0.0.0:3000", projectId: "p", chapterId: "c", revision: 1,
    }).success).toBe(false);
    await registration.dispose();
  });

  it("closes only the requested project session through the narrow bridge", async () => {
    const closeSession = vi.fn(async () => undefined);
    const registration = registerRemotionStudioIpcHandlers({
      ensureSession: async () => { throw new Error("blocked"); },
      closeSession,
    });
    const handler = state.handlers.get(REMOTION_STUDIO_CLOSE_SESSION_CHANNEL)!;
    await expect(handler({}, { projectId: "project-a" })).resolves.toEqual({
      status: "closed",
      projectId: "project-a",
    });
    expect(closeSession).toHaveBeenCalledWith("project-a");
    await expect(handler({}, { projectId: "project/a" })).rejects.toThrow("projectId 无效");
    await registration.dispose();
  });
});
