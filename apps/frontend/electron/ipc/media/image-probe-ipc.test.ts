import { describe, expect, it, vi } from "vitest";
import { registerImageProbeIpcHandlers } from "./image-probe-ipc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function register(overrides: Partial<Parameters<typeof registerImageProbeIpcHandlers>[0]> = {}) {
  registerImageProbeIpcHandlers({
    getDataDir: () => "/data",
    getMediaRoot: () => "/media",
    getAssetsRoot: () => "/assets",
    readFileHead: vi.fn(async (_filePath: string, _limit: number) => pngBytes(3840, 2160)),
    resolveProjectFile: () => "/data/p/img.png",
    resolveAssetFile: () => "/assets/a/b.png",
    resolveLocalMedia: () => "/media/m/c.png",
    ...overrides,
  });
  const handler = mocks.handlers.get("image-probe-size") as unknown as (
    event: unknown,
    url: string,
  ) => Promise<unknown>;
  // 直呼 ipcMain.handle 回调:第一参是 event 占位,真实载荷在第二参
  return (url: string) => handler(undefined, url);
}

describe("image-probe-size IPC", () => {
  it("probes project-file URLs via the project resolver and parses the header", async () => {
    const readFileHead = vi.fn(async () => pngBytes(3840, 2160));
    const resolveProjectFile = vi.fn(() => "/data/p/img.png");
    const handler = register({ readFileHead, resolveProjectFile });
    await expect(handler("project-file://p/workflow-images/img.png")).resolves.toEqual({
      width: 3840,
      height: 2160,
    });
    expect(resolveProjectFile).toHaveBeenCalledWith("/data", "project-file://p/workflow-images/img.png");
    expect(readFileHead).toHaveBeenCalledWith("/data/p/img.png", 128 * 1024);
  });

  it("routes asset-file and local-image schemes to their resolvers", async () => {
    const resolveAssetFile = vi.fn(() => "/assets/a/b.png");
    const resolveLocalMedia = vi.fn(() => "/media/m/c.png");
    const handler = register({ resolveAssetFile, resolveLocalMedia });
    await expect(handler("asset-file://role/hero.png")).resolves.toEqual({ width: 3840, height: 2160 });
    await expect(handler("local-image://frames/f.png")).resolves.toEqual({ width: 3840, height: 2160 });
    expect(resolveAssetFile).toHaveBeenCalledWith("/assets", "asset-file://role/hero.png");
    expect(resolveLocalMedia).toHaveBeenCalledWith("/media", "local-image://frames/f.png");
  });

  it("accepts file:// URLs by converting them to paths (dimensions only)", async () => {
    const readFileHead = vi.fn(async (_filePath: string, _limit: number) => pngBytes(2016, 1536));
    const handler = register({ readFileHead });
    await expect(handler("file:///tmp/pic.png")).resolves.toEqual({ width: 2016, height: 1536 });
    expect(readFileHead.mock.calls[0][0].endsWith("pic.png")).toBe(true);
  });

  it("returns null for unmanaged schemes so the renderer falls back", async () => {
    const readFileHead = vi.fn();
    const handler = register({ readFileHead });
    await expect(handler("https://cdn.example.com/x.png")).resolves.toBeNull();
    await expect(handler("data:image/png;base64,xxxx")).resolves.toBeNull();
    expect(readFileHead).not.toHaveBeenCalled();
  });

  it("returns null when the header cannot be parsed", async () => {
    const handler = register({ readFileHead: vi.fn(async () => new Uint8Array([1, 2, 3])) });
    await expect(handler("project-file://p/unknown.bin")).resolves.toBeNull();
  });

  it("swallows resolver and read errors as null instead of throwing", async () => {
    const handler = register({
      resolveProjectFile: () => {
        throw new Error("escapes storage root");
      },
    });
    await expect(handler("project-file://../evil.png")).resolves.toBeNull();

    const failing = register({
      resolveProjectFile: () => "/data/p/gone.png",
      readFileHead: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    await expect(failing("project-file://p/gone.png")).resolves.toBeNull();
  });
});
