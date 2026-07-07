import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_TEST_TIMEOUT_MS,
  IMAGE_MODEL_TEST_TIMEOUT_MS,
  getModelTestTimeoutMs,
  prepareModelTestRequest,
  runModelTestRequest,
} from "./model-test";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import type { sdkGenerateImage } from "../ai/ai-sdk-bridge";

describe("prepareModelTestRequest", () => {
  beforeEach(() => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  it("stops before network when API key is missing", () => {
    expect(prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "",
        model: ["gpt-4o-mini"],
      },
      model: "gpt-4o-mini",
      type: "text",
    })).toMatchObject({
      success: false,
      error: "缺少 API Key",
    });
  });

  it("builds a controlled OpenAI-compatible text model request", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-4o-mini"],
      },
      model: "gpt-4o-mini",
      type: "text",
    });

    expect(prepared).toMatchObject({
      success: true,
      dryRun: false,
      endpoint: "https://relay.example.com/v1/chat/completions",
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared text request");
    }
    expect(prepared.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
      "anthropic-compatible",
      "gemini-compatible",
    ]);
    expect(prepared.attempts[1].endpoint).toBe("https://relay.example.com/v1/messages");
    expect(prepared.attempts[2].endpoint).toBe("https://relay.example.com/v1/models/gpt-4o-mini:generateContent");
    const body = prepared.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("回复 OK 和模型名称");
  });

  it("tries Anthropic-compatible messages when OpenAI-compatible chat fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "glm-5.1",
        content: [{ type: "text", text: "OK glm-5.1" }],
      }), { status: 200 }));

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "anthropic-compatible",
        name: "智谱 Anthropic",
        baseUrl: "https://open.bigmodel.cn/api/anthropic/",
        apiKey: "test-key",
        model: ["glm-5.1"],
      },
      model: "glm-5.1",
      type: "text",
    }, fetcher);

    expect(result).toMatchObject({
      success: true,
      protocol: "anthropic-compatible",
      status: 200,
    });
    expect(result.message).toContain("Anthropic 兼容");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe("https://open.bigmodel.cn/api/anthropic/v1/chat/completions");
    expect(fetcher.mock.calls[1][0]).toBe("https://open.bigmodel.cn/api/anthropic/v1/messages");
  });

  it("can fall through to Gemini-compatible generateContent", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "OK gemini" }] } }],
      }), { status: 200 }));

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "gemini-compatible",
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "test-key",
        model: ["gemini-2.5-flash"],
      },
      model: "gemini-2.5-flash",
      type: "text",
    }, fetcher);

    expect(result).toMatchObject({
      success: true,
      protocol: "gemini-compatible",
    });
    expect(result.message).toContain("Gemini 兼容");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
  });

  it("auto-enables highest thinking for reasoning models with a raised token budget", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["glm-4.6"],
      },
      model: "glm-4.6",
      type: "text",
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared text request");
    }
    const openai = prepared.attempts[0].body as { thinking?: unknown; max_tokens?: number };
    expect(openai.thinking).toEqual({ type: "enabled" });
    expect(openai.max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("leaves non-reasoning model tests without thinking params", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-4o-mini"],
      },
      model: "gpt-4o-mini",
      type: "text",
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared text request");
    }
    const openai = prepared.attempts[0].body as Record<string, unknown>;
    expect(openai.thinking).toBeUndefined();
    expect(openai.reasoning_effort).toBeUndefined();
    expect(openai.enable_thinking).toBeUndefined();
    expect(openai.max_tokens).toBe(32);
  });

  it("forces thinking on when the request explicitly enables it for an unrecognized model", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["house-llm-7b"],
      },
      model: "house-llm-7b",
      type: "text",
      thinkingEnabled: true,
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared text request");
    }
    const openai = prepared.attempts[0].body as { thinking?: unknown; max_tokens?: number };
    expect(openai.thinking).toEqual({ type: "enabled" });
    expect(openai.max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it("forces thinking off when the request explicitly disables it for a reasoning model", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["glm-4.6"],
      },
      model: "glm-4.6",
      type: "text",
      thinkingEnabled: false,
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared text request");
    }
    const openai = prepared.attempts[0].body as Record<string, unknown>;
    expect(openai.thinking).toBeUndefined();
    expect(openai.reasoning_effort).toBeUndefined();
    expect(openai.enable_thinking).toBeUndefined();
    expect(openai.max_tokens).toBe(32);
  });

  it("builds a real OpenAI-compatible image model test request", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
    });

    expect(prepared).toMatchObject({
      success: true,
      dryRun: false,
      endpoint: "https://relay.example.com/v1/images/generations",
    });
    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared image request");
    }
    expect(prepared.attempts).toHaveLength(2);
    expect(prepared.body).toMatchObject({
      model: "gpt-image-2",
      n: 1,
      size: "2048x1152",
    });
    expect(prepared.body.prompt).toEqual(expect.stringContaining("API 连通性测试图"));
    expect(prepared.body.prompt).toEqual(expect.stringContaining("clean image"));
    expect(prepared.body.prompt).toEqual(expect.stringContaining("low visual noise"));
    expect(prepared.attempts[1].body).toMatchObject({
      model: "gpt-image-2",
      n: 1,
      stream: false,
      aspect_ratio: "16:9",
      resolution: "2K",
    });
    expect(prepared.attempts[1].body.prompt).toEqual(expect.stringContaining("API 连通性测试图"));
    expect(prepared.attempts[1].body.prompt).toEqual(expect.stringContaining("clean image"));
  });

  it("builds image model test requests from image size settings", () => {
    const prepared = prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
      imageGenerationSettings: {
        defaultAspectRatio: "3:2",
        defaultResolution: "2K",
      },
    });

    if (!prepared.success || prepared.dryRun) {
      throw new Error("expected prepared image request");
    }
    expect(prepared.body).toMatchObject({ size: "2016x1344" });
    expect(prepared.attempts[1].body).toMatchObject({
      aspect_ratio: "3:2",
      resolution: "2K",
    });
  });

  it("tests gpt-image models through the AI SDK image bridge", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "should-not-be-used" }],
    }), { status: 200 }));
    const imageSdk = vi.fn<Parameters<typeof sdkGenerateImage>, ReturnType<typeof sdkGenerateImage>>()
      .mockResolvedValueOnce({
        success: true,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        size: "1024x1024",
        templateName: "openai-size",
      });

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
      operationId: "model-test-op",
    }, fetcher, undefined, imageSdk);

    expect(result).toMatchObject({
      success: true,
      status: 200,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(imageSdk).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
      }),
      model: "gpt-image-2",
      prompt: expect.stringContaining("API 连通性测试图"),
      aspectRatio: "16:9",
      resolution: "2K",
      operationId: "model-test-op",
      endpointFamily: "model-test",
      maxRetries: 0,
    }));
    expect(imageSdk).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("clean image"),
    }));
  });

  it("surfaces gpt-image quota failures from the AI SDK image bridge", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "订阅额度不足或未配置订阅: subscription quota insufficient, need=5000",
        code: "insufficient_user_quota",
      },
    }), { status: 403 }));
    const imageSdk = vi.fn<Parameters<typeof sdkGenerateImage>, ReturnType<typeof sdkGenerateImage>>()
      .mockResolvedValueOnce({
        success: false,
        status: 403,
        error: "图片生成额度不足或订阅未配置：subscription quota insufficient",
        size: "1024x1024",
        templateName: "openai-size",
      });

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
    }, fetcher, undefined, imageSdk);

    expect(result).toMatchObject({
      success: false,
      status: 403,
    });
    expect(result.error).toContain("subscription quota insufficient");
  });

  it("continues image model tests with the next configured key", async () => {
    const fetcher = vi.fn();
    const imageSdk = vi.fn<Parameters<typeof sdkGenerateImage>, ReturnType<typeof sdkGenerateImage>>()
      .mockResolvedValueOnce({
        success: false,
        status: 401,
        error: "API Key 无效或已过期",
        size: "1024x1024",
        templateName: "openai-size",
      })
      .mockResolvedValueOnce({
        success: true,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        size: "1024x1024",
        templateName: "openai-size",
      });

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-first\nsk-second",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
    }, fetcher, undefined, imageSdk);

    expect(result).toMatchObject({
      success: true,
      status: 200,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(imageSdk).toHaveBeenCalledTimes(2);
    expect(imageSdk.mock.calls[0][0].provider.apiKey).toBe("sk-first");
    expect(imageSdk.mock.calls[1][0].provider.apiKey).toBe("sk-second");
  });

  it("falls back to the provider extension image template", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "unsupported parameter: size" },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ url: "https://cdn.example.com/test.png" }],
      }), { status: 200 }));

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
    }, fetcher);

    expect(result).toMatchObject({
      success: true,
      status: 200,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      size: "2048x1152",
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      aspect_ratio: "16:9",
      resolution: "2K",
    });
  });

  it("gives image model tests a longer timeout than text model tests", () => {
    expect(getModelTestTimeoutMs("text")).toBe(DEFAULT_MODEL_TEST_TIMEOUT_MS);
    expect(getModelTestTimeoutMs("image")).toBe(IMAGE_MODEL_TEST_TIMEOUT_MS);
    expect(IMAGE_MODEL_TEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_MODEL_TEST_TIMEOUT_MS);
  });

  it("surfaces image model test aborts as a clear timeout error", async () => {
    const fetcher = vi.fn((_input: string, init: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("This operation was aborted", "AbortError"));
      }, { once: true });
    }));

    const result = await runModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["gpt-image-2"],
      },
      model: "gpt-image-2",
      type: "image",
    }, fetcher, 1);

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("图片模型测试超时");
  });

  it("still dry-runs video model tests in V1", () => {
    expect(prepareModelTestRequest({
      provider: {
        id: "provider-1",
        platform: "custom",
        name: "Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        model: ["veo-test"],
      },
      model: "veo-test",
      type: "video",
    })).toMatchObject({
      success: true,
      dryRun: true,
      message: "配置 dry-run 通过，V1 暂不调用 video 模型",
    });
  });

  it("allows the default local TTS backend to dry-run without an API key", () => {
    expect(prepareModelTestRequest({
      provider: {
        id: "provider-tts",
        platform: "tts-compatible",
        name: "TTS 后端",
        baseUrl: "http://127.0.0.1:17593",
        apiKey: "",
        model: ["qwen-tts-0.6B"],
      },
      model: "qwen-tts-0.6B",
      type: "tts",
    })).toMatchObject({
      success: true,
      dryRun: true,
      message: "配置 dry-run 通过，V1 暂不调用 tts 模型",
    });
  });
});
