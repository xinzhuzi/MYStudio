import { describe, expect, it, vi } from "vitest";
import {
  prepareTextCompletionRequest,
  runTextCompletionRequest,
} from "./text-completion";

describe("text completion request adapter", () => {
  const provider = {
    id: "relay",
    platform: "custom",
    name: "Relay",
    baseUrl: "https://relay.example.com/v1",
    apiKey: "sk-test",
    model: ["gpt-4o-mini"],
  };

  it("defaults custom runtime text completion to OpenAI-compatible protocol", () => {
    const prepared = prepareTextCompletionRequest({
      provider,
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "回复 OK" }],
      maxTokens: 64,
      temperature: 0,
    });

    expect(prepared.success).toBe(true);
    expect(prepared.success && prepared.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
    ]);
  });

  it("pins runtime OpenAI-compatible providers to the OpenAI-compatible protocol", () => {
    const prepared = prepareTextCompletionRequest({
      provider: {
        ...provider,
        platform: "openai-compatible",
        name: "OpenAI 兼容中转站",
      },
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "回复 OK" }],
    });

    expect(prepared.success).toBe(true);
    expect(prepared.success && prepared.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
    ]);
  });

  it("runs the first successful compatible text request", async () => {
    const result = await runTextCompletionRequest(
      {
        provider,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "回复 OK" }],
      },
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "OK gpt-4o-mini" } }] }), {
          status: 200,
        }),
    );

    expect(result).toMatchObject({
      success: true,
      text: "OK gpt-4o-mini",
      protocol: "openai-compatible",
    });
  });

  it("surfaces the undici cause instead of a bare fetch failed message", async () => {
    const result = await runTextCompletionRequest(
      {
        provider,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "回复 OK" }],
      },
      async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND relay.example.com"), { code: "ENOTFOUND" }),
        });
      },
      300000,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("OpenAI 兼容");
    expect(result.error).toContain("网络请求失败");
    expect(result.error).toContain("域名解析失败");
    expect(result.error).toContain("relay.example.com");
  });

  it("shares the timeout budget across protocols instead of per-protocol full timeouts", async () => {
    vi.useFakeTimers();
    try {
      const result = await runTextCompletionRequest(
        {
          provider,
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "回复 OK" }],
        },
        (_endpoint, init) => new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          }, { once: true });
        }),
        100,
      );

      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      expect(result.success).toBe(false);
      // 第一协议吃光预算后,后续协议直接按总超时短路,不再各拿一份满额超时
      expect(result.error).toContain("总超时");
      expect(result.error).toContain("后续协议未再尝试");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports aborts as a readable timeout with the configured budget", async () => {
    const result = await runTextCompletionRequest(
      {
        provider,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "回复 OK" }],
      },
      async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      300000,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("文本模型调用超时 (300s)");
  });
});
