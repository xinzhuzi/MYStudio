import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn((_target?: unknown) => true),
  mkdirSync: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("image")),
  unlink: vi.fn(async () => undefined),
  renameSync: vi.fn(),
  rm: vi.fn(async () => undefined),
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
      rm: mocks.rm,
    },
    renameSync: mocks.renameSync,
  },
}));

import { registerProjectFileIpcHandlers } from "./project-file-ipc";
import { setProjectLocationResolver } from "../../storage/storage-paths";

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
      "project-file-delete",
      "project-file-get-absolute-path",
      "project-file-list",
      "project-file-move",
      "project-file-read-base64",
      "project-file-read-text",
      "project-file-remove-text",
      "project-file-save-image",
      "project-file-write-binary",
      "project-file-write-text",
    ]);
  });

  it("deletes project files with force semantics; directory removal (no recursive) rejects to error shape", async () => {
    const del = mocks.handlers.get("project-file-delete")!;
    await expect(del({}, { projectId: "project-a", relativePath: "media/ai-image/2026-09/a.png" }))
      .resolves.toEqual({ success: true });
    // 项目根遏制:路径穿越拒绝
    const escape = await del({}, { projectId: "project-a", relativePath: "../escape.png" });
    expect(escape).toMatchObject({ success: false });
    // 目录(readdir 形状的 ENOTDIR/EPERM 等)→ 失败形状而非抛出
    mocks.rm.mockRejectedValueOnce(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }));
    await expect(del({}, { projectId: "project-a", relativePath: "media/ai-image/2026-09" }))
      .resolves.toMatchObject({ success: false });
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

  it("moves project files within the project scope and rejects missing sources / existing targets", async () => {
    const move = mocks.handlers.get("project-file-move")!;
    const payload = {
      projectId: "project-a",
      fromRelative: "workflow-images/storyboard-flow-chapter-001-005",
      toRelative: "workflow-images/chapter-001/storyboard-flow-chapter-001-005",
    };

    mocks.existsSync.mockImplementation((target: unknown) => String(target).includes("storyboard-flow-chapter-001-005") && !String(target).includes("chapter-001/storyboard-flow"));
    await expect(move({}, payload)).resolves.toMatchObject({ success: true });
    expect(mocks.renameSync).toHaveBeenCalled();

    mocks.existsSync.mockReturnValue(true);
    await expect(move({}, payload)).resolves.toMatchObject({ success: false, error: "目标路径已存在" });
    mocks.existsSync.mockReturnValue(false);

    mocks.existsSync.mockReturnValue(false);
    await expect(move({}, payload)).resolves.toMatchObject({ success: false, error: "源路径不存在" });

    await expect(move({}, {
      projectId: "project-a",
      fromRelative: "../../etc/passwd",
      toRelative: "workflow-images/x",
    })).resolves.toMatchObject({ success: false });
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

describe("project-file-write-text 的 _p 虚拟键重定向", () => {
  it("已注册外部位置的项目：文本键直达项目目录，磁盘上不出现 _p 中间层", async () => {
    setProjectLocationResolver(() => "/projects/IP/MA");
    try {
      await expect(
        mocks.handlers.get("project-file-write-text")?.({}, "_p/project-ext/novel/source-bible.md", "# 原著圣经"),
      ).resolves.toEqual({ success: true, filePath: "/projects/IP/MA/novel/source-bible.md" });
    } finally {
      setProjectLocationResolver(null);
    }
  });

  it("store 布局 v1：白名单段的文本键落 <项目根>/store/（README 守护与 file-storage 通道同位）", async () => {
    setProjectLocationResolver(() => "/projects/IP/MA");
    try {
      await expect(
        mocks.handlers.get("project-file-write-text")?.({}, "_p/project-ext/studio-workflow/README.md", "# 分片目录"),
      ).resolves.toEqual({ success: true, filePath: "/projects/IP/MA/store/studio-workflow/README.md" });
      // 非白名单段（novel 镜像等）不受影响
      await expect(
        mocks.handlers.get("project-file-write-text")?.({}, "_p/project-ext/novel/source-bible.md", "# 原著圣经"),
      ).resolves.toEqual({ success: true, filePath: "/projects/IP/MA/novel/source-bible.md" });
    } finally {
      setProjectLocationResolver(null);
    }
  });

  it("未注册位置的项目保持 legacy userData/_p 回退", async () => {
    await expect(
      mocks.handlers.get("project-file-write-text")?.({}, "_p/project-a/novel/source-bible.md", "# 原著圣经"),
    ).resolves.toEqual({ success: true, filePath: "/data/_p/project-a/novel/source-bible.md" });
  });
});
