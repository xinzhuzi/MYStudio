// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_PREVIEW_CREATE_CHANNEL,
  REMOTION_PREVIEW_RELEASE_CHANNEL,
  REMOTION_SHOT_PREVIEW_CREATE_CHANNEL,
} from "@rendering/plugins/remotion/preview/remotion-preview-ipc";

type IpcHandler = (...args: unknown[]) => unknown;
const electronState = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  removed: [] as string[],
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronState.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      electronState.removed.push(channel);
      electronState.handlers.delete(channel);
    }),
  },
}));

import { registerRemotionPreviewIpcHandlers } from "./remotion-preview-ipc";

beforeEach(() => {
  electronState.handlers.clear();
  electronState.removed.length = 0;
});

describe("registerRemotionPreviewIpcHandlers", () => {
  it("rejects caller-controlled create fields and releases only validated sessions", async () => {
    const service = {
      create: vi.fn(),
      release: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const registration = registerRemotionPreviewIpcHandlers({
      resolveSourcePath: (sourcePath) => sourcePath,
      service,
    });

    expect([...electronState.handlers.keys()].sort()).toEqual([
      REMOTION_PREVIEW_CREATE_CHANNEL,
      REMOTION_PREVIEW_RELEASE_CHANNEL,
      REMOTION_SHOT_PREVIEW_CREATE_CHANNEL,
    ].sort());
    await expect(electronState.handlers.get(REMOTION_PREVIEW_CREATE_CHANNEL)!({}, {
      plan: {},
      outputPath: "/tmp/out.mp4",
    })).rejects.toThrow("只允许 plan 字段");
    expect(service.create).not.toHaveBeenCalled();

    await expect(electronState.handlers.get(REMOTION_PREVIEW_RELEASE_CHANNEL)!({}, {
      sessionId: "preview-1",
    })).resolves.toEqual({ sessionId: "preview-1", released: true });
    expect(service.release).toHaveBeenCalledWith("preview-1");

    await registration.dispose();
    expect(service.dispose).toHaveBeenCalledOnce();
    expect(electronState.removed.sort()).toEqual([
      REMOTION_PREVIEW_CREATE_CHANNEL,
      REMOTION_PREVIEW_RELEASE_CHANNEL,
      REMOTION_SHOT_PREVIEW_CREATE_CHANNEL,
    ].sort());
  });
});
