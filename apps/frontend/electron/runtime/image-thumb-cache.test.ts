import { describe, expect, it, vi } from "vitest";
import { createImageThumbCache, type ImageThumbCacheDeps } from "./image-thumb-cache";

function pngHeaderBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeDeps(overrides: Partial<ImageThumbCacheDeps> = {}) {
  const existing = new Set<string>();
  const deps: ImageThumbCacheDeps = {
    execFile: vi.fn((_cmd, args, callback) => {
      existing.add(args[args.length - 1]);
      callback(null);
    }),
    statFile: vi.fn(async () => ({ mtimeMs: 1000, size: 4096 })),
    readHead: vi.fn(async () => pngHeaderBytes(3840, 2160)),
    exists: (p: string) => existing.has(p),
    mkdir: vi.fn(),
    ...overrides,
  };
  return { deps, existing };
}

describe("createImageThumbCache", () => {
  it("generates a thumb via sips on first request and hits cache afterwards", async () => {
    const { deps } = makeDeps();
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    const first = await cache.getOrCreateThumb("/data/p/a.png");
    expect(first).toMatch(/^\/thumbs\/[0-9a-f]{40}\.jpg$/);
    const second = await cache.getOrCreateThumb("/data/p/a.png");
    expect(second).toBe(first);
    expect(deps.execFile).toHaveBeenCalledTimes(1);
  });

  it("returns null without spawning sips when the source is already small", async () => {
    const { deps } = makeDeps({ readHead: vi.fn(async () => pngHeaderBytes(480, 270)) });
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    await expect(cache.getOrCreateThumb("/data/p/small.png")).resolves.toBeNull();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it("returns null when sips fails", async () => {
    const { deps } = makeDeps({
      execFile: vi.fn((_c, _a, cb) => cb(new Error("sips missing"))),
    });
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    await expect(cache.getOrCreateThumb("/data/p/a.png")).resolves.toBeNull();
  });

  it("returns null when the source cannot be stat-ed", async () => {
    const { deps } = makeDeps({
      statFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    await expect(cache.getOrCreateThumb("/data/p/gone.png")).resolves.toBeNull();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it("invalidates when the source mtime changes", async () => {
    let mtime = 1000;
    const { deps } = makeDeps({ statFile: vi.fn(async () => ({ mtimeMs: mtime, size: 4096 })) });
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    const first = await cache.getOrCreateThumb("/data/p/a.png");
    mtime = 2000;
    const second = await cache.getOrCreateThumb("/data/p/a.png");
    expect(second).not.toBe(first);
    expect(deps.execFile).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent requests for the same source", async () => {
    let calls = 0;
    const created = new Set<string>();
    const deps: ImageThumbCacheDeps = {
      execFile: (_cmd, args, callback) => {
        calls += 1;
        setTimeout(() => {
          created.add(args[args.length - 1]);
          callback(null);
        }, 10);
      },
      statFile: async () => ({ mtimeMs: 1000, size: 4096 }),
      readHead: async () => pngHeaderBytes(3840, 2160),
      exists: (p: string) => created.has(p),
      mkdir: () => {},
    };
    const cache = createImageThumbCache({ cacheDir: "/thumbs", deps });
    const [a, b] = await Promise.all([
      cache.getOrCreateThumb("/data/p/a.png"),
      cache.getOrCreateThumb("/data/p/a.png"),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
