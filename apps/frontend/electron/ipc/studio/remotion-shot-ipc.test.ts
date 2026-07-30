// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_SHOT_RENDER_CANCEL_CHANNEL,
  REMOTION_SHOT_RENDER_CHANNEL,
} from "@rendering/plugins/remotion/renderer/remotion-shot-ipc";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), removed: [] as string[] }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => { state.removed.push(channel); state.handlers.delete(channel); }),
  },
}));

import { registerRemotionShotIpcHandlers } from "./remotion-shot-ipc";

beforeEach(() => {
  state.handlers.clear();
  state.removed.length = 0;
});

describe("Remotion shot IPC", () => {
  it("rejects caller-controlled fields before invoking the renderer", async () => {
    const service = {
      render: vi.fn(),
      cancel: vi.fn(() => ({ success: true, jobId: "shot:1", canceled: true })),
      dispose: vi.fn(async () => undefined),
    };
    const registration = registerRemotionShotIpcHandlers(service);
    await expect(state.handlers.get(REMOTION_SHOT_RENDER_CHANNEL)!({}, { plan: {}, outputPath: "/tmp/unsafe" }))
      .rejects.toThrow("只允许 plan 字段");
    expect(service.render).not.toHaveBeenCalled();
    await expect(state.handlers.get(REMOTION_SHOT_RENDER_CANCEL_CHANNEL)!({}, { jobId: "shot:1" }))
      .resolves.toMatchObject({ canceled: true });
    await registration.dispose();
    expect(service.dispose).toHaveBeenCalledOnce();
    expect(state.removed).toEqual(expect.arrayContaining([REMOTION_SHOT_RENDER_CHANNEL, REMOTION_SHOT_RENDER_CANCEL_CHANNEL]));
  });
});
