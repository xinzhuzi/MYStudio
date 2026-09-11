// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateImageMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn(),
}));

vi.mock("@/lib/ai/image-generation-engine", () => ({
  generateImage: generateImageMock,
}));

import {
  imageResultToBase64,
  installComfyCloudRelayExecutor,
} from "./comfy-cloud-relay-executor";

type RelayRequest = Parameters<
  NonNullable<Window["comfyCloudRelay"]>["onGenerateRequest"]
>[0] extends (request: infer R) => void ? R : never;

function installFakeRelay() {
  const requests: RelayRequest[] = [];
  const responses: Array<{ id: string; ok: boolean; imageB64?: string; error?: string }> = [];
  const listeners: Array<(request: RelayRequest) => void> = [];
  vi.stubGlobal("comfyCloudRelay", {
    onGenerateRequest: (listener: (request: RelayRequest) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    respond: async (response: { id: string; ok: boolean; imageB64?: string; error?: string }) => {
      responses.push(response);
      return true;
    },
  });
  return {
    requests,
    responses,
    dispatch: (request: RelayRequest) => {
      for (const listener of listeners) listener(request);
    },
  };
}

describe("installComfyCloudRelayExecutor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 preload 门面时静默缺席(返回空卸载器)", () => {
    vi.stubGlobal("comfyCloudRelay", undefined);
    const dispose = installComfyCloudRelayExecutor();
    expect(typeof dispose).toBe("function");
  });

  it("云链单源参数契约:prompt 直传 + raw + persistMedia:false + 参考 data URL 化", async () => {
    const relay = installFakeRelay();
    installComfyCloudRelayExecutor();
    generateImageMock.mockResolvedValue({ url: "data:image/png;base64,QUJD" });

    relay.dispatch({
      id: "r1",
      payload: { prompt: "一只猫", negativePrompt: "模糊", aspectRatio: "16:9", referenceB64s: ["QUJD"] },
    });
    await vi.waitFor(() => expect(relay.responses).toHaveLength(1));

    expect(generateImageMock).toHaveBeenCalledWith({
      prompt: "一只猫",
      negativePrompt: "模糊",
      aspectRatio: "16:9",
      referenceImages: ["data:image/png;base64,QUJD"],
      promptPolicy: "raw",
      persistMedia: false,
    });
    expect(relay.responses[0]).toEqual({ id: "r1", ok: true, imageB64: "QUJD" });
  });

  it("云链抛错 → ok:false + 大白话文案回引擎", async () => {
    const relay = installFakeRelay();
    installComfyCloudRelayExecutor();
    generateImageMock.mockRejectedValue(new Error("图片生成未配置：请在设置中配置服务"));

    relay.dispatch({ id: "r2", payload: { prompt: "x" } });
    await vi.waitFor(() => expect(relay.responses).toHaveLength(1));
    expect(relay.responses[0]).toEqual({
      id: "r2",
      ok: false,
      error: "图片生成未配置：请在设置中配置服务",
    });
  });
});

describe("imageResultToBase64", () => {
  it("http URL 拉取转 base64;非 data/http 地址与下载失败均抛大白话", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([65, 66, 67]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await imageResultToBase64("https://cdn.example.com/a.png")).toBe("QUJD");

    await expect(imageResultToBase64("local-image://x")).rejects.toThrow("不支持的图像地址");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 504 })));
    await expect(imageResultToBase64("https://cdn.example.com/b.png")).rejects.toThrow("下载失败");
    await expect(imageResultToBase64("data:")).rejects.toThrow("不完整");
  });
});
