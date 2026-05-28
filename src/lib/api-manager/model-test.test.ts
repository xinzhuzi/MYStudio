import { describe, expect, it, vi } from "vitest";
import { prepareModelTestRequest, runModelTestRequest } from "./model-test";

describe("prepareModelTestRequest", () => {
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

  it("dry-runs non-text model tests in V1", () => {
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
