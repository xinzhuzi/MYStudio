import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 3 })),
  unlink: vi.fn((_path: string, callback: () => void) => callback()),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from("image")),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  httpGet: vi.fn(),
  httpsGet: vi.fn(),
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
    writeFileSync: mocks.writeFileSync,
    statSync: mocks.statSync,
    unlink: mocks.unlink,
    unlinkSync: mocks.unlinkSync,
    readFileSync: mocks.readFileSync,
    renameSync: mocks.renameSync,
    copyFileSync: mocks.copyFileSync,
    createWriteStream: mocks.createWriteStream,
  },
}));

vi.mock("node:http", () => ({
  default: {
    get: mocks.httpGet,
  },
}));

vi.mock("node:https", () => ({
  default: {
    get: mocks.httpsGet,
  },
}));

import { registerLocalMediaIpcHandlers } from "./local-media-ipc";

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  on: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emitBody: () => void;
};

function createFakeWriteStream() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stream = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
      return stream;
    }),
    write: vi.fn(),
    end: vi.fn(() => {
      for (const callback of listeners.get("finish") ?? []) callback();
    }),
    close: vi.fn(),
    destroy: vi.fn(),
  };
  return stream;
}

function createFakeResponse(options: {
  statusCode?: number;
  headers?: Record<string, string | string[] | undefined>;
  chunks?: Array<Buffer | string>;
} = {}): FakeResponse {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const response = {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? {},
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
      return response;
    }),
    resume: vi.fn(),
    destroy: vi.fn((error?: Error) => {
      if (error) {
        for (const callback of listeners.get("error") ?? []) callback(error);
      }
      return response;
    }),
    emitBody: () => {
      for (const chunk of options.chunks ?? [Buffer.from("image")]) {
        for (const callback of listeners.get("data") ?? []) callback(chunk);
      }
      for (const callback of listeners.get("end") ?? []) callback();
    },
  };
  return response;
}

function createFakeRequest() {
  const request = {
    on: vi.fn(() => request),
  };
  return request;
}

function mockHttpResponse(getMock: ReturnType<typeof vi.fn>, response: FakeResponse) {
  getMock.mockImplementationOnce((_url: URL, callback: (response: FakeResponse) => void) => {
    callback(response);
    queueMicrotask(response.emitBody);
    return createFakeRequest();
  });
}

describe("registerLocalMediaIpcHandlers", () => {
  const originalMaxBytes = process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES;

  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    mocks.createWriteStream.mockImplementation(() => createFakeWriteStream());
    delete process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES;
    registerLocalMediaIpcHandlers({ getMediaRoot: () => "/media" });
  });

  afterEach(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES;
    } else {
      process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES = originalMaxBytes;
    }
  });

  it("registers the established local media channels", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "delete-image",
      "get-absolute-path",
      "get-image-path",
      "move-image",
      "read-image-base64",
      "save-image",
    ]);
  });

  it("decodes data URLs into a category-scoped local image", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "data:image/png;base64,aW1hZ2U=",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({
      success: true,
      localPath: "local-image://storyboards/1000_.png",
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      "/media/storyboards/1000_.png",
      Buffer.from("image"),
    );
  });

  it("rejects an unsafe move category without changing files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(mocks.handlers.get("move-image")?.({}, {
      localPath: "local-image://storyboards/frame.png",
      category: "../outside",
    })).resolves.toEqual({ success: false, error: "Error: Invalid media category" });
    expect(mocks.renameSync).not.toHaveBeenCalled();
  });

  it("rejects an unsafe save category before creating directories or writing files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "data:image/png;base64,aW1hZ2U=",
      category: "../outside",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Error: Invalid media category" });

    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects unsupported remote URL protocols before opening a request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "file:///etc/passwd",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Error: Unsupported media URL protocol" });

    expect(mocks.httpGet).not.toHaveBeenCalled();
    expect(mocks.httpsGet).not.toHaveBeenCalled();
    expect(mocks.createWriteStream).not.toHaveBeenCalled();
  });

  it("resolves relative redirects before downloading the final remote image", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockHttpResponse(mocks.httpsGet, createFakeResponse({
      statusCode: 302,
      headers: { location: "/final.png" },
      chunks: [],
    }));
    mockHttpResponse(mocks.httpsGet, createFakeResponse({
      statusCode: 200,
      headers: { "content-length": "5" },
      chunks: [Buffer.from("image")],
    }));

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "https://images.example.test/start",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({
      success: true,
      localPath: "local-image://storyboards/1000_.png",
    });

    expect(mocks.httpsGet).toHaveBeenCalledTimes(2);
    expect(String(mocks.httpsGet.mock.calls[1][0])).toBe("https://images.example.test/final.png");
  });

  it("rejects remote media with an oversized content length before writing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES = "4";
    mockHttpResponse(mocks.httpsGet, createFakeResponse({
      statusCode: 200,
      headers: { "content-length": "5" },
      chunks: [Buffer.from("image")],
    }));

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "https://images.example.test/frame.png",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Error: Media file exceeds 4 bytes" });

    expect(mocks.createWriteStream).not.toHaveBeenCalled();
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });

  it("rejects remote media when the streamed body exceeds the byte limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES = "4";
    const response = createFakeResponse({
      statusCode: 200,
      chunks: [Buffer.from("image")],
    });
    mockHttpResponse(mocks.httpsGet, response);

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "https://images.example.test/frame.png",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Error: Media file exceeds 4 bytes" });

    expect(response.destroy).toHaveBeenCalled();
    expect(mocks.createWriteStream).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized data URLs before decoding and writing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.MYSTUDIO_LOCAL_MEDIA_MAX_BYTES = "4";

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "data:image/png;base64,aW1hZ2U=",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Media file exceeds 4 bytes" });

    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("returns a stable error when moving a missing source file", async () => {
    await expect(mocks.handlers.get("move-image")?.({}, {
      localPath: "local-image://storyboards/missing.png",
      category: "assets",
    })).resolves.toEqual({ success: false, error: "File not found" });
    expect(mocks.renameSync).not.toHaveBeenCalled();
    expect(mocks.copyFileSync).not.toHaveBeenCalled();
  });

  it("removes an empty saved file and reports the zero-byte failure", async () => {
    mocks.statSync.mockReturnValueOnce({ size: 0 });

    await expect(mocks.handlers.get("save-image")?.({}, {
      url: "data:image/png;base64,aW1hZ2U=",
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error: "Saved file is 0 bytes" });
    expect(mocks.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["data:image/png;base64,", "Invalid data URL format"],
    ["data:image/png;base64,====", "Decoded base64 data is empty (0 bytes)"],
  ])("rejects an invalid data URL (%s) without writing", async (url, error) => {
    await expect(mocks.handlers.get("save-image")?.({}, {
      url,
      category: "storyboards",
      filename: "frame.png",
    })).resolves.toEqual({ success: false, error });
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("keeps missing-file operations non-throwing", async () => {
    await expect(mocks.handlers.get("get-image-path")?.({}, "local-image://storyboards/missing.png")).resolves.toBeNull();
    await expect(mocks.handlers.get("delete-image")?.({}, "local-image://storyboards/missing.png")).resolves.toBe(true);
    await expect(mocks.handlers.get("read-image-base64")?.({}, "local-image://storyboards/missing.png"))
      .resolves.toEqual({ success: false, error: "File not found" });
    await expect(mocks.handlers.get("get-absolute-path")?.({}, "local-image://storyboards/missing.png")).resolves.toBeNull();
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
    expect(mocks.readFileSync).not.toHaveBeenCalled();
  });
});
