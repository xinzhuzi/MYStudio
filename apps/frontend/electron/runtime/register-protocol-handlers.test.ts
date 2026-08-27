import { describe, expect, it, vi } from "vitest";
import { registerPrivilegedSchemes, registerProtocolHandlers } from "./register-protocol-handlers";

describe("protocol registration", () => {
  it("registers the five privileged schemes with the desktop security contract", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerPrivilegedSchemes({ registerSchemesAsPrivileged } as never);
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith(
      ["asset-file", "local-image", "project-file", "studio-skill", "toonflow-asset"].map((scheme) => ({
        scheme,
        privileges: {
          secure: true,
          supportFetchAPI: true,
          bypassCSP: true,
          stream: true,
        },
      })),
    );
  });

  it("registers all handlers and preserves local media MIME responses", async () => {
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      readFile: () => new Uint8Array([1, 2, 3]),
      resolveLocalMedia: () => "/media/frame.png",
      resolveProjectFile: () => "/data/project/file.txt",
      resolveAssetFile: () => "/assets/files/role/hero.png",
      resolveToonflowAsset: () => "/assets/manual.md",
    });

    expect([...handlers.keys()]).toEqual(["local-image", "project-file", "asset-file", "studio-skill", "toonflow-asset"]);
    const response = await handlers.get("local-image")!(new Request("local-image://frames/frame.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const assetResponse = await handlers.get("asset-file")!(new Request("asset-file://role/hero.png"));
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe("image/png");
  });

  it.each([
    ["local-image", "local-image://frames/missing.png"],
    ["project-file", "project-file://project/missing.png"],
    ["asset-file", "asset-file://role/missing.png"],
    ["studio-skill", "studio-skill://manuals/missing.md"],
    ["toonflow-asset", "toonflow-asset://manuals/missing.png"],
  ])("converts asynchronous %s read failures into 404 responses", async (scheme, url) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((registeredScheme, handler) => handlers.set(registeredScheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      readFile: async () => {
        throw new Error("missing file");
      },
      resolveLocalMedia: () => "/media/missing.png",
      resolveProjectFile: () => "/data/project/missing.png",
      resolveAssetFile: () => "/assets/files/role/missing.png",
      resolveToonflowAsset: () => "/toonflow/missing.png",
    });

    const response = await handlers.get(scheme)!(new Request(url));
    expect(response.status).toBe(404);
  });

  it("falls back to original asset bytes when a requested thumbnail is missing", async () => {
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    const resolveAssetFile = vi.fn((_assetsRoot: string, url: string) =>
      url.includes("?") ? "/assets/thumbs/role/hero.png" : "/assets/files/role/hero.png",
    );
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath.includes("/thumbs/")) throw new Error("missing thumbnail");
      return new TextEncoder().encode("original-bytes");
    });
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      readFile,
      resolveAssetFile,
    });

    const response = await handlers.get("asset-file")!(new Request("asset-file://role/hero.png?thumb=1"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original-bytes");
    expect(resolveAssetFile).toHaveBeenNthCalledWith(1, "/assets", "asset-file://role/hero.png?thumb=1");
    expect(resolveAssetFile).toHaveBeenNthCalledWith(2, "/assets", "asset-file://role/hero.png");
  });

  it("serves an on-demand cached asset thumbnail when the pre-generated thumbnail is missing", async () => {
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath === "/assets/thumbs/role/hero.png") throw new Error("missing pre-generated thumbnail");
      return Buffer.from(`bytes:${filePath}`);
    });
    const getOrCreateThumb = vi.fn(async () => "/cache/hero.jpg");
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      getImageThumbDir: () => "/cache",
      createThumbCache: () => ({ getOrCreateThumb }),
      readFile,
      resolveAssetFile: (_assetsRoot, url) =>
        url.includes("?") ? "/assets/thumbs/role/hero.png" : "/assets/files/role/hero.png",
    });

    const response = await handlers.get("asset-file")!(new Request("asset-file://role/hero.png?thumb=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("bytes:/cache/hero.jpg");
    expect(getOrCreateThumb).toHaveBeenCalledWith("/assets/files/role/hero.png");
  });

  it("rejects studio skill paths that escape the configured root", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      readFile: vi.fn(),
    });
    const response = await handlers.get("studio-skill")!(new Request("studio-skill://..%2Foutside/file.md"));
    expect(response.status).toBe(404);
  });
  it("serves generated thumbnails for ?thumb=1 project-file requests", async () => {
    const readFile = vi.fn(async (filePath: string) => new TextEncoder().encode(`bytes:${filePath}`));
    const resolveProjectFile = vi.fn(() => "/data/p/img.png");
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      getImageThumbDir: () => "/thumbs",
      createThumbCache: ({ cacheDir }: { cacheDir: string }) => ({
        getOrCreateThumb: async () => `${cacheDir}/abc.jpg`,
      }),
      readFile,
      resolveProjectFile,
    });

    const response = await handlers.get("project-file")!(new Request("project-file://p/img.png?thumb=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("bytes:/thumbs/abc.jpg");
    // resolver 必须拿到剥掉 query 的干净 URL
    expect(resolveProjectFile).toHaveBeenCalledWith("/data", "project-file://p/img.png");
  });

  it("falls back to the original bytes when thumbnail generation is unavailable", async () => {
    const readFile = vi.fn(async (filePath: string) => new TextEncoder().encode(`bytes:${filePath}`));
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      getImageThumbDir: () => "/thumbs",
      createThumbCache: () => ({
        getOrCreateThumb: async () => null,
      }),
      readFile,
      resolveProjectFile: () => "/data/p/img.png",
    });

    const response = await handlers.get("project-file")!(new Request("project-file://p/img.png?thumb=1"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bytes:/data/p/img.png");
  });

  it("does not treat project-file thumb=0 as a thumbnail request", async () => {
    const readFile = vi.fn(async (filePath: string) => Buffer.from(`bytes:${filePath}`));
    const getOrCreateThumb = vi.fn(async () => "/thumbs/never.jpg");
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      getImageThumbDir: () => "/thumbs",
      createThumbCache: () => ({ getOrCreateThumb }),
      readFile,
      resolveProjectFile: () => "/data/p/img.png",
    });

    const response = await handlers.get("project-file")!(new Request("project-file://p/img.png?thumb=0"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bytes:/data/p/img.png");
    expect(getOrCreateThumb).not.toHaveBeenCalled();
  });

  it("keeps no-query project-file requests byte-identical with the pre-thumb behavior", async () => {
    const readFile = vi.fn(async (filePath: string) => new TextEncoder().encode(`bytes:${filePath}`));
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      getAssetsRoot: () => "/assets",
      getImageThumbDir: () => "/thumbs",
      createThumbCache: () => ({
        getOrCreateThumb: async () => "/thumbs/never.jpg",
      }),
      readFile,
      resolveProjectFile: () => "/data/p/img.png",
    });

    const response = await handlers.get("project-file")!(new Request("project-file://p/img.png"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bytes:/data/p/img.png");
  });
});
