import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { resetFeatureRoundRobin } from "@/lib/ai/feature-router";
import { clearAllManagers } from "@/lib/ai/core";
import { generateFreedomImage } from "./freedom-api";
import { resetImagesEndpointPoisonMemory } from "./freedom-image-endpoint-memory";

const provider = {
  id: "torchai",
  platform: "custom",
  name: "torchai",
  baseUrl: "https://torchai.ai/v1",
  apiKey: "sk-test",
  model: ["gpt-image-2"],
};

describe("generateFreedomImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearAllManagers();
    resetFeatureRoundRobin();
    resetImagesEndpointPoisonMemory();
    useAPIConfigStore.setState({
      providers: [provider],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the standard size field for gpt-image requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({
      prompt: "old laborer character",
      negativePrompt: "no basket, no ragged backpack",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://torchai.ai/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-image-2",
      size: "2048x1152",
    });
    expect(requestBody.prompt).toContain("old laborer character");
    expect(requestBody.prompt).toContain("clean image");
    expect(requestBody.prompt).toContain("low visual noise");
    expect(requestBody.prompt).toContain("no basket");
    expect(requestBody.prompt).toContain("no ragged backpack");
    expect(requestBody.prompt).toContain("visual noise");
    expect(requestBody.prompt).toContain("dirty texture");
    expect(requestBody.prompt).toContain("unwanted calligraphy");
    expect(requestBody).not.toHaveProperty("aspect_ratio");
    expect(requestBody).not.toHaveProperty("resolution");
  });

  it("uses global image size settings when a freedom request omits size options", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "2K",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await generateFreedomImage({ prompt: "global freedom image" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.size).toBe("2016x1344");
  });

  it("retries gpt-image transport failures with a compact 1024 prompt before provider fallback", async () => {
    const longPrompt = [
      "男性角色四视图设定图，水墨国风，修仙古韵，工笔线描，写意晕染，宣纸质感。",
      "老苦力，年迈男性，面容沧桑，额纹与眼角细纹自然，颧骨略显，眉目沉稳疲惫。",
      "长期劳作后的瘦硬体态，粗布旧衣，破损袖口，电影质感，主体完整，细节很多。",
      "character design sheet, character turnaround, front view, side view, back view, cinematic ink wash style.",
      "plain background, readable silhouette, high quality production asset, no text, no watermark.",
    ].join("\n");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({
      prompt: longPrompt,
      aspectRatio: "16:9",
    });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.size).toBe("2048x1152");
    expect(firstBody.prompt).toContain(longPrompt);
    expect(firstBody.prompt).toContain("clean image");
    expect(firstBody.prompt).toContain("low visual noise");
    expect(firstBody.prompt).toContain("dirty texture");
    expect(firstBody.prompt).toContain("unwanted calligraphy");
    expect(retryBody.size).toBe("1024x1024");
    expect(retryBody.prompt).not.toContain("high quality production asset");
    expect(retryBody.prompt).toContain("避免文字和水印");
    expect(retryBody.prompt).toContain("clean image");
    expect(retryBody.prompt).toContain("low visual noise");
    expect(retryBody.prompt).toContain("dirty texture");
    expect(retryBody.prompt).toContain("unwanted calligraphy");
  });

  it("rotates to the next key when a gpt-image provider returns quota 403", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    useAPIConfigStore.setState({
      providers: [{
        ...provider,
        apiKey: "sk-bad\nsk-good",
      }],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: "用户额度不足, 剩余额度: ¥0.000000",
          code: "insufficient_user_quota",
        },
      }), { status: 403, statusText: "Forbidden" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateFreedomImage({
      prompt: "old laborer character",
      aspectRatio: "1:1",
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3000);

    const result = await generation;
    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Authorization ?? firstHeaders.authorization).toBe("Bearer sk-bad");
    expect(secondHeaders.Authorization ?? secondHeaders.authorization).toBe("Bearer sk-good");
  });
});

  it("falls back to chat/completions form when the images endpoint fails at the gateway (502 non-JSON)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "![image_1](data:image/png;base64,aGVsbG8=)" } }],
        }), { status: 200 });
      }
      return new Response("error code: 502", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({ prompt: "gateway fallback image" });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/chat/completions"));
    expect(chatCall).toBeTruthy();
    const chatBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(chatBody.model).toBe("gpt-image-2");
    expect(chatBody.messages[0].content[0].text).toContain("gateway fallback image");
  }, 20000);

  it("routes straight to chat form (base64 in-band) when transport=chat is requested", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "![image_1](data:image/png;base64,aGVsbG8=)" } }],
        }), { status: 200 });
      }
      // images 端点即使可用也不应被触达(transport=chat 必须绕过智能路由)
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.test/should-not-use.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFreedomImage({ prompt: "chat transport image", transport: "chat" });

    expect(result.url).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/images/generations"))).toBe(false);
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/chat/completions"));
    expect(chatCall).toBeTruthy();
  }, 20000);

  it("does not fall back to chat form on deterministic auth failures (401)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ error: { message: "Invalid API key" } }),
      { status: 401 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateFreedomImage({ prompt: "auth failure image" })).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/chat/completions"))).toBe(false);
  }, 20000);

  it("lists every attempted provider and its reason when the whole fallback chain fails", async () => {
    const backupProvider = {
      id: "backup",
      platform: "custom",
      name: "backup",
      baseUrl: "https://backup.example/v1",
      apiKey: "sk-test",
      model: ["gpt-image-2"],
    };
    useAPIConfigStore.setState({
      providers: [provider, backupProvider],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
        character_generation: ["backup:gpt-image-2"],
      },
    } as never);
    // 403 拒绝:确定性错误,不重试不回退 chat,每家只烧一次请求
    const fetchMock = vi.fn().mockImplementation(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const error: unknown = await generateFreedomImage({ prompt: "chain failure image" }).catch((err: unknown) => err);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("已依次尝试 2 家生图服务均失败");
    expect(message).toContain("1. torchai:");
    expect(message).toContain("2. backup:");
    expect(message).toContain("最后错误");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("skips the poisoned images endpoint on the next generation after a 200 non-JSON failure", async () => {
    const chatOk = new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "![image_1](data:image/png;base64,aGVsbG8=)" } }],
    }), { status: 200 });
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/chat/completions")) return chatOk.clone();
      // images 端点 200 但响应体非 JSON(钱咖API 08-28 实弹形态)
      return new Response("<html>not json</html>", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await generateFreedomImage({ prompt: "poison probe one" });
    expect(first.url).toBe("data:image/png;base64,aGVsbG8=");
    // 第一次:先试 images(必败)再回退 chat
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/images/generations"))).toBe(true);

    fetchMock.mockClear();
    const second = await generateFreedomImage({ prompt: "poison probe two" });
    expect(second.url).toBe("data:image/png;base64,aGVsbG8=");
    // 第二次:坏点记忆命中,直接走 chat,不再烧 images 请求
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/chat/completions"))).toBe(true);
  }, 20000);

  it("fails fast without chat fallback or next provider when a mikoto image request outcome is ambiguous", async () => {
    const backupProvider = {
      id: "backup",
      platform: "custom",
      name: "backup",
      baseUrl: "https://backup.example/v1",
      apiKey: "sk-test",
      model: ["gpt-image-2"],
    };
    useAPIConfigStore.setState({
      providers: [{
        id: "mikoto",
        platform: "custom",
        name: "mikoto",
        baseUrl: "https://api.mikoto.vip/",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      }, backupProvider],
      featureBindings: {
        freedom_image: ["mikoto:gpt-image-2"],
        character_generation: ["backup:gpt-image-2"],
      },
    } as never);
    // 51 秒 200 非 JSON 形态:请求很可能已被受理计费,结果不确定
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/chat/completions")) {
        throw new Error("chat must not be called for ambiguous mikoto results");
      }
      return new Response("binary-garbage", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const error: unknown = await generateFreedomImage({ prompt: "mikoto boundary" }).catch((err: unknown) => err);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBeTruthy();
    // 只烧一次 mikoto images 请求:无 SDK 重试、无 chat 回退、不换 backup 家
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.mikoto.vip");
  }, 20000);

  it("forces mikoto onto the async channel even when transport=chat is requested (sync channels closed)", async () => {
    useAPIConfigStore.setState({
      providers: [{
        id: "mikoto",
        platform: "custom",
        name: "mikoto",
        baseUrl: "https://api.mikoto.vip/",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      }, {
        id: "backup",
        platform: "custom",
        name: "backup",
        baseUrl: "https://backup.example/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      }],
      featureBindings: {
        freedom_image: ["mikoto:gpt-image-2"],
        character_generation: ["backup:gpt-image-2"],
      },
    } as never);
    // 用户裁定 08-28:mikoto 同步通道暂时关闭,显式 transport=chat 也强制异步
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/v1/images/generations/async")) {
        return new Response(JSON.stringify({ task_id: "chat-retry-task" }), { status: 200 });
      }
      if (target.endsWith("/images/tasks/chat-retry-task")) {
        return new Response(JSON.stringify({ status: "completed", resultUrl: "https://cdn.mikoto.example/retry.png" }), { status: 200 });
      }
      throw new Error(`sync endpoint must not be hit for mikoto: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const promise = generateFreedomImage({ prompt: "mikoto sync closed", transport: "chat" }).then(
      (value) => value,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(3001);
    const outcome = await promise;

    expect(outcome).toMatchObject({ url: "https://cdn.mikoto.example/retry.png" });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("chat/completions"))).toBe(true);
  }, 20000);

  it("keeps prior-provider context when a mikoto ambiguous failure stops the chain", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({ compatibilityRetryEnabled: false });
    useAPIConfigStore.setState({
      providers: [provider, {
        id: "mikoto",
        platform: "custom",
        name: "mikoto",
        baseUrl: "https://api.mikoto.vip/",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      }],
      featureBindings: {
        freedom_image: ["torchai:gpt-image-2"],
        character_generation: ["mikoto:gpt-image-2"],
      },
    } as never);
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.includes("torchai")) return new Response("forbidden", { status: 403 });
      // mikoto images 端点 200 非 JSON(51 秒形态)
      return new Response("binary-garbage", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const error: unknown = await generateFreedomImage({ prompt: "ambiguous chain context" }).catch((err: unknown) => err);
    const message = error instanceof Error ? error.message : String(error);
    // 模糊终止也要带上前置家失败原因,不能只报 mikoto
    expect(message).toContain("已依次尝试 1 家");
    expect(message).toContain("1. torchai");
    expect(message).toContain("api.mikoto.vip");
    // mikoto 模糊终止必须零 chat 回退(前面用例真定时器的残留异步调用会
    // 漏进本用例 mock,故只对本场景的 mikoto 域断言,不对全量调用断言)
    expect(fetchMock.mock.calls.some(([url]) => {
      const target = String(url);
      return target.includes("api.mikoto.vip") && target.includes("chat/completions");
    })).toBe(false);
  }, 20000);


