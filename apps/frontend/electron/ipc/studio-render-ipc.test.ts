import { describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));

import { registerStudioRenderIpcHandlers } from "./studio-render-ipc";

describe("registerStudioRenderIpcHandlers", () => {
  it("registers all Studio render and evidence channels", () => {
    registerStudioRenderIpcHandlers({
      getMediaRoot: () => "/media",
      resolveSourcePath: (value) => value,
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog: vi.fn(),
    });
    expect([...handlers.keys()].sort()).toEqual([
      "studio-list-assets", "studio-merge-episode", "studio-probe-media-evidence",
      "studio-render-track-candidate", "studio-save-material", "studio-timeline-render",
      "studio-timeline-render-cancel",
    ]);
  });
});
