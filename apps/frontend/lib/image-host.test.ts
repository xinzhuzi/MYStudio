// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadToImageHost } from "./image-host";
import { useAPIConfigStore, type ImageHostProvider } from "@/stores/api-config-store";

const provider = (overrides: Partial<ImageHostProvider> = {}): ImageHostProvider => ({
  id: "test-host",
  platform: "custom",
  name: "Test Host",
  baseUrl: "https://upload.example.test",
  uploadPath: "/upload",
  apiKey: "secret",
  enabled: true,
  apiKeyOptional: false,
  imageField: "image",
  imagePayloadType: "base64",
  responseUrlField: "url",
  ...overrides,
});

describe("uploadToImageHost remote image reads", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.imageHostUploader = undefined;
    localStorage.clear();
    useAPIConfigStore.setState({ imageHostProviders: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAPIConfigStore.setState({ imageHostProviders: [] });
  });

  it("rejects non-OK remote reads before base64 uploads", async () => {
    useAPIConfigStore.setState({ imageHostProviders: [provider()] });
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToImageHost("https://cdn.example.test/missing.png", { providerId: "test-host" }))
      .resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("请求失败: 404"),
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized remote reads before file uploads", async () => {
    useAPIConfigStore.setState({ imageHostProviders: [provider({ imagePayloadType: "file" })] });
    const fetchMock = vi.fn(async () => new Response("tiny", {
      status: 200,
      headers: { "content-length": String(512 * 1024 * 1024 + 1) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToImageHost("https://cdn.example.test/huge.png", {
      providerId: "test-host",
      name: "huge.png",
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("图片超过"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still uploads successful remote file payloads with existing form contracts", async () => {
    useAPIConfigStore.setState({ imageHostProviders: [provider({ imagePayloadType: "file", imageField: "file" })] });
    let uploadedForm: FormData | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        uploadedForm = init.body as FormData;
        return new Response(JSON.stringify({ url: "https://cdn.example.test/uploaded.png" }), { status: 200 });
      }
      return new Response("image", {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToImageHost("https://cdn.example.test/image.png", {
      providerId: "test-host",
      name: "scene",
    })).resolves.toEqual({
      success: true,
      url: "https://cdn.example.test/uploaded.png",
      deleteUrl: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadedForm?.get("file")).toBeInstanceOf(Blob);
    expect(uploadedForm?.get("name")).toBe("scene");
  });
});
