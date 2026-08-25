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
