import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerImageHostIpcHandlers } from "./image-host-ipc";

describe("registerImageHostIpcHandlers", () => {
  const writeDiagnosticsLog = vi.fn();
  const readImageSource = vi.fn(async () => ({ buffer: Buffer.from("image"), mimeType: "image/png" }));

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { url: "https://cdn.example.com/image.png" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    registerImageHostIpcHandlers({
      createOperationId: () => "image-host-1",
      writeDiagnosticsLog,
      readImageSource,
    });
  });

  it("returns the existing configuration error and records start/completion diagnostics", async () => {
    await expect(handlers.get("image-host-upload")?.({}, {
      provider: { name: "Missing", platform: "custom" },
      apiKey: "",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({ success: false, error: "图床上传地址未配置" });

    expect(writeDiagnosticsLog).toHaveBeenCalledTimes(2);
    expect(writeDiagnosticsLog).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: "image-host-1",
      message: "Image host upload failed",
    }));
  });

  it("rejects malformed renderer payloads without throwing", async () => {
    await expect(handlers.get("image-host-upload")?.({}, null)).resolves.toEqual({
      success: false,
      error: "图床上传参数无效",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not return non-http response URLs from configured fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { url: "javascript:alert(1)", delete_url: "file:///tmp/image" } }),
      { status: 200 },
    )));
    await expect(handlers.get("image-host-upload")?.({}, {
      provider: { name: "Custom", platform: "custom", baseUrl: "https://upload.example.com", responseUrlField: "data.url" },
      apiKey: "",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({ success: false, error: "图床 Custom 上传成功但未返回 URL" });
  });

  it("extracts a configured nested response URL", async () => {
    await expect(handlers.get("image-host-upload")?.({}, {
      provider: {
        name: "Custom",
        platform: "custom",
        baseUrl: "https://upload.example.com",
        responseUrlField: "data.url",
      },
      apiKey: "secret",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({
      success: true,
      url: "https://cdn.example.com/image.png",
      deleteUrl: undefined,
    });
  });

  it("injects local image reading and provider auth into file uploads", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ url: "https://cdn.example.com/file.webp", delete_url: "https://cdn.example.com/delete" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(handlers.get("image-host-upload")?.({}, {
      provider: {
        name: "FileHost",
        platform: "custom",
        baseUrl: "https://upload.example.com",
        uploadPath: "/v1/upload",
        imagePayloadType: "file",
        imageField: "file",
        apiKeyParam: "key",
        apiKeyHeader: "X-Api-Key",
        apiKeyFormField: "token",
        expirationParam: "expires",
        nameField: "filename",
      },
      apiKey: "secret",
      imageData: "local-image://input.webp",
      options: { name: "scene-1.webp", expiration: 3600 },
    })).resolves.toEqual({
      success: true,
      url: "https://cdn.example.com/file.webp",
      deleteUrl: "https://cdn.example.com/delete",
    });

    expect(readImageSource).toHaveBeenCalledWith("local-image://input.webp");
    expect(capturedUrl).toBe("https://upload.example.com/v1/upload?key=secret&expires=3600");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["X-Api-Key"]).toBe("secret");
    const body = capturedInit?.body as FormData;
    expect(body.get("token")).toBe("secret");
    expect(body.get("filename")).toBe("scene-1.webp");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("uses the injected reader for project-file inputs and keeps data URLs inline", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("image")).toBe("aW1hZ2U=");
      return new Response("https://cdn.example.com/text-response.png", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(handlers.get("image-host-upload")?.({}, {
      provider: {
        name: "DataHost",
        platform: "custom",
        baseUrl: "https://upload.example.com",
      },
      apiKey: "",
      imageData: "data:image/png;base64,aW1hZ2U=",
    })).resolves.toEqual({ success: true, url: "https://cdn.example.com/text-response.png" });
    expect(readImageSource).not.toHaveBeenCalled();

    await expect(handlers.get("image-host-upload")?.({}, {
      provider: {
        name: "ProjectFileHost",
        platform: "custom",
        baseUrl: "https://upload.example.com",
      },
      apiKey: "",
      imageData: "project-file://project-1/assets/input.png",
    })).resolves.toEqual({ success: true, url: "https://cdn.example.com/text-response.png" });
    expect(readImageSource).toHaveBeenCalledWith("project-file://project-1/assets/input.png");
  });
});
