import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));

import { registerStudioRenderIpcHandlers } from "./studio-render-ipc";

beforeEach(() => {
  handlers.clear();
});

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!;
}

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

  it("returns the stable empty-material error without writing a file", async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), "mystudio-studio-ipc-"));
    try {
      registerStudioRenderIpcHandlers({
        getMediaRoot: () => mediaRoot,
        resolveSourcePath: (value) => value,
        createOperationId: (prefix) => `${prefix}-1`,
        writeDiagnosticsLog: vi.fn(),
      });

      await expect(getHandler("studio-save-material")({}, {
        name: "empty.png",
        bytes: new Uint8Array(),
      })).resolves.toEqual({ success: false, error: "素材文件为空" });
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  });

  it("rejects an invalid timeline render request envelope before FFmpeg", async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), "mystudio-timeline-ipc-"));
    try {
      registerStudioRenderIpcHandlers({
        getMediaRoot: () => mediaRoot,
        resolveSourcePath: (value) => value,
        createOperationId: (prefix) => `${prefix}-1`,
        writeDiagnosticsLog: vi.fn(),
      });

      await expect(getHandler("studio-timeline-render")({}, {})).resolves.toEqual({
        success: false,
        jobId: "unknown",
        canceled: false,
        error: "schemaVersion: 仅支持渲染请求 schemaVersion=1; requestedRenderer: 渲染器必须是 remotion 或 ffmpeg; plan: 渲染计划必须是对象",
      });
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  });
});
