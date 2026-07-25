import { describe, expect, it, vi } from "vitest";
import { registerPrivilegedSchemes, registerProtocolHandlers } from "./register-protocol-handlers";

describe("protocol registration", () => {
  it("registers the four privileged schemes with the desktop security contract", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerPrivilegedSchemes({ registerSchemesAsPrivileged } as never);
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith(
      ["local-image", "project-file", "studio-skill", "toonflow-asset"].map((scheme) => ({
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
      readFile: () => new Uint8Array([1, 2, 3]),
      resolveLocalMedia: () => "/media/frame.png",
      resolveProjectFile: () => "/data/project/file.txt",
      resolveToonflowAsset: () => "/assets/manual.md",
    });

    expect([...handlers.keys()]).toEqual(["local-image", "project-file", "studio-skill", "toonflow-asset"]);
    const response = await handlers.get("local-image")!(new Request("local-image://frames/frame.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("rejects studio skill paths that escape the configured root", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = new Map<string, (request: Request) => Promise<Response>>();
    registerProtocolHandlers({
      protocol: { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) } as never,
      getMediaRoot: () => "/media",
      getDataDir: () => "/data",
      getSkillsRoot: () => "/skills",
      readFile: vi.fn(),
    });
    const response = await handlers.get("studio-skill")!(new Request("studio-skill://..%2Foutside/file.md"));
    expect(response.status).toBe(404);
  });
});
