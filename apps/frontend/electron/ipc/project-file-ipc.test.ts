import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("image")),
  unlink: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    promises: {
      writeFile: mocks.writeFile,
      readFile: mocks.readFile,
      unlink: mocks.unlink,
    },
  },
}));

import { registerProjectFileIpcHandlers } from "./project-file-ipc";

describe("registerProjectFileIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.readFile.mockResolvedValue(Buffer.from("image"));
    registerProjectFileIpcHandlers({
      getDataDir: () => "/data",
      readImageSource: async () => ({ buffer: Buffer.from("source"), mimeType: "image/png" }),
      getMimeType: () => "image/png",
    });
  });

  it("registers all project-file channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "project-file-get-absolute-path",
      "project-file-read-base64",
      "project-file-remove-text",
      "project-file-save-image",
      "project-file-write-binary",
      "project-file-write-text",
    ]);
  });

  it("writes text and binary files with the established result shapes", async () => {
    await expect(mocks.handlers.get("project-file-write-text")?.({}, "projects/a.json", "{}"))
      .resolves.toEqual({ success: true, filePath: "/data/projects/a.json" });
    await expect(mocks.handlers.get("project-file-write-binary")?.({}, {
      projectId: "project-a",
      relativePath: "images/frame.png",
      bytes: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({
      success: true,
      url: "project-file://project-a/images/frame.png",
      filePath: "/data/_p/project-a/images/frame.png",
      size: 3,
    });
  });

  it("rejects empty binary files and preserves base64 read metadata", async () => {
    await expect(mocks.handlers.get("project-file-write-binary")?.({}, {
      projectId: "project-a",
      relativePath: "images/frame.png",
      bytes: new Uint8Array(),
    })).resolves.toEqual({ success: false, error: "项目文件为空" });

    await expect(mocks.handlers.get("project-file-read-base64")?.(
      {},
      "project-file://project-a/images/frame.png",
    )).resolves.toEqual({
      success: true,
      base64: "data:image/png;base64,aW1hZ2U=",
      mimeType: "image/png",
      size: 5,
    });
  });
});
