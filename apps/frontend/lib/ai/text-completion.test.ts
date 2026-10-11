import { describe, expect, it, vi } from "vitest";
import {
  prepareTextCompletionRequest,
  runTextCompletionRequest,
  runTextCompletionStreamRequest,
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

  // 1011 复审补:HTTP 一次性各失败路的 stopReason 分类锁——AbortError/TimeoutError→timeout,
  // 网络失败/HTTP 5xx→error,成功→stop;截断/超时/失败从此结构化可辨。
  it("classifies the structured stopReason across HTTP one-shot return paths", async () => {
    const request = {
      provider,
      model: "gpt-4o-mini",
      messages: [{ role: "user" as const, content: "回复 OK" }],
    };

    const aborted = await runTextCompletionRequest(request, async () => {
      throw new DOMException("This operation was aborted", "AbortError");
    }, 300000);
    expect(aborted.success).toBe(false);
    expect(aborted.stopReason).toBe("timeout");

    // TimeoutError 名(如 abort(reason) 带超时 DOMException)与 AbortError 同判 timeout
    const timeoutNamed = await runTextCompletionRequest(request, async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    }, 300000);
    expect(timeoutNamed.success).toBe(false);
    expect(timeoutNamed.stopReason).toBe("timeout");

    const networkFailed = await runTextCompletionRequest(request, async () => {
      throw new TypeError("fetch failed");
    }, 300000);
    expect(networkFailed.success).toBe(false);
    expect(networkFailed.stopReason).toBe("error");

    const httpFailed = await runTextCompletionRequest(request, async () =>
      new Response("upstream exploded", { status: 500 }));
    expect(httpFailed.success).toBe(false);
    expect(httpFailed.stopReason).toBe("error");

    const ok = await runTextCompletionRequest(request, async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }));
    expect(ok.success).toBe(true);
    expect(ok.stopReason).toBe("stop");
  });

  it("marks shared-budget exhaustion as the timeout stopReason", async () => {
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
      expect(result.error).toContain("总超时");
      expect(result.stopReason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  // 1011 复审补(欠账④):运行时协议路由收敛到 types.ts 单源推断表后的行为锁——
  // memefast 补进表按 openai 兼容;custom 照旧钉 openai 兼容(不放宽成全协议尝试);
  // 真未知平台照旧返回全部三个协议 attempt(全协议尝试语义,硬约束不许变)。
  it("keeps runtime protocol routing semantics after converging on the single-source inference table", () => {
    const request = (platform: string) => ({
      provider: { ...provider, platform },
      model: "m",
      messages: [{ role: "user" as const, content: "hi" }],
    });

    const memefast = prepareTextCompletionRequest(request("memefast"));
    expect(memefast.success && memefast.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
    ]);

    const custom = prepareTextCompletionRequest(request("custom"));
    expect(custom.success && custom.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
    ]);

    const unknown = prepareTextCompletionRequest(request("totally-unknown-platform"));
    expect(unknown.success && unknown.attempts.map((attempt) => attempt.protocol)).toEqual([
      "openai-compatible",
      "anthropic-compatible",
      "gemini-compatible",
    ]);
  });
});

describe("text completion stream (SSE)", () => {
  // 10-11 装机实配同款：platform="custom" + apiProtocol="anthropic-compatible" +
  // bigmodel anthropic 口（带尾斜杠、无 /v1）。
  const glmProvider = {
    id: "glm",
    platform: "custom",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/anthropic/",
    apiKey: "sk-test",
    model: ["glm-5.3"],
    apiProtocol: "anthropic-compatible" as const,
  };
  const relayProvider = {
    id: "relay",
    platform: "custom",
    name: "Relay",
    baseUrl: "https://relay.example.com/v1",
    apiKey: "sk-test",
    model: ["gpt-4o-mini"],
  };

  function sseResponse(events: string[]): Response {
    return new Response(events.join("\n"), { status: 200 });
  }

  type StreamFetcher = (
    endpoint: string,
    init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal },
  ) => Promise<Response>;

  it("streams anthropic-compatible SSE deltas instead of degrading to one-shot", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'event: message_start',
        'data: {"type":"message_start","message":{}}',
        '',
        'event: ping',
        'data: {"type":"ping"}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}',
        '',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ]),
    );
    const deltas: string[] = [];

    const result = await runTextCompletionStreamRequest(
      {
        provider: glmProvider,
        model: "glm-5.3",
        messages: [
          { role: "system", content: "SYS" },
          { role: "user", content: "你好" },
        ],
      },
      (delta) => deltas.push(delta),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "你好", status: 200 });
    expect(deltas).toEqual(["你", "好"]);
    // 端点=归一后的 /v1/messages，头=anthropic 契约，体=system 抽离 + stream:true
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe("https://open.bigmodel.cn/api/anthropic/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body) as { model: string; system?: string; stream: boolean; messages: Array<{ role: string }> };
    expect(body).toMatchObject({ model: "glm-5.3", system: "SYS", stream: true });
    expect(body.messages).toEqual([{ role: "user", content: "你好" }]);
  });

  it("falls back to one-shot when the anthropic stream emits an error event", async () => {
    const endpoints: string[] = [];
    const fetcher = vi.fn<StreamFetcher>(async (endpoint) => {
      endpoints.push(endpoint);
      if (endpoints.length === 1) {
        return sseResponse(['data: {"type":"error","error":{"type":"overloaded_error","message":"上游过载"}}', '']);
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: "one-shot ok" }] }), { status: 200 });
    });
    const deltas: string[] = [];

    const result = await runTextCompletionStreamRequest(
      { provider: glmProvider, model: "glm-5.3", messages: [{ role: "user", content: "你好" }] },
      (delta) => deltas.push(delta),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "one-shot ok" });
    expect(endpoints).toEqual([
      "https://open.bigmodel.cn/api/anthropic/v1/messages",
      "https://open.bigmodel.cn/api/anthropic/v1/messages",
    ]);
    expect(deltas).toEqual(["one-shot ok"]);
    // 回退一次性不带 stream
    const fallbackBody = JSON.parse(fetcher.mock.calls[1]![1].body) as { stream?: boolean };
    expect(fallbackBody.stream).toBeUndefined();
  });

  it("keeps gemini-compatible protocol on the one-shot path", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gem" }] } }] }), { status: 200 }),
    );
    const deltas: string[] = [];

    const result = await runTextCompletionStreamRequest(
      { provider: { ...relayProvider, apiProtocol: "gemini-compatible" as const }, model: "gemini-x", messages: [{ role: "user", content: "hi" }] },
      (delta) => deltas.push(delta),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "gem" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["gem"]);
  });

  it("still streams OpenAI-compatible SSE after the anthropic refactor", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"he"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"llo"}}]}',
        '',
        'data: [DONE]',
        '',
      ]),
    );
    const deltas: string[] = [];

    const result = await runTextCompletionStreamRequest(
      { provider: relayProvider, model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      (delta) => deltas.push(delta),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "hello" });
    expect(deltas).toEqual(["he", "llo"]);
    const [endpoint] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe("https://relay.example.com/v1/chat/completions");
  });

  // 1011 复审补:anthropic SSE 的 thinking 转发与流内终态解析锁——
  // thinking_delta 走 kind='thinking' 不混正文;text_delta 走 kind='text';
  // message_delta.stop_reason='max_tokens' 归一为 stopReason='length'。
  it("forwards anthropic thinking_delta as thinking chunks and maps message_delta stop_reason", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先想"}}',
        '',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"清楚"}}',
        '',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"正文"}}',
        '',
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
        '',
      ]),
    );
    const chunks: Array<[string, "text" | "thinking"]> = [];

    const result = await runTextCompletionStreamRequest(
      { provider: glmProvider, model: "glm-5.3", messages: [{ role: "user", content: "你好" }] },
      (delta, kind) => chunks.push([delta, kind]),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "正文", stopReason: "length" });
    expect(chunks).toEqual([["先想", "thinking"], ["清楚", "thinking"], ["正文", "text"]]);
  });

  it("maps anthropic end_turn to the stop stopReason", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}',
        '',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
        '',
      ]),
    );

    const result = await runTextCompletionStreamRequest(
      { provider: glmProvider, model: "glm-5.3", messages: [{ role: "user", content: "你好" }] },
      () => undefined,
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "好", stopReason: "stop" });
  });

  // 1011 复审补:openai 兼容 SSE 的思考增量(reasoning_content)与 finish_reason 解析锁。
  it("forwards OpenAI reasoning_content as thinking chunks and maps finish_reason", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"推理"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"ans"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        '',
        'data: [DONE]',
        '',
      ]),
    );
    const chunks: Array<[string, "text" | "thinking"]> = [];

    const result = await runTextCompletionStreamRequest(
      { provider: relayProvider, model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      (delta, kind) => chunks.push([delta, kind]),
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, text: "ans", stopReason: "length" });
    expect(chunks).toEqual([["推理", "thinking"], ["ans", "text"]]);
  });

  // 1011 复审补(欠账①收尾):normalizeSseStopReason 是两协议共用归一器——部分网关把
  // anthropic 风格的 max_tokens 当 openai finish_reason 回传,与 'stop' 自然结束各锁一档。
  it("maps OpenAI finish_reason max_tokens and stop through the shared normalizer", async () => {
    const runWithFinishReason = async (finishReason: string) => {
      const fetcher = vi.fn<StreamFetcher>(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"答"}}]}',
          '',
          `data: {"choices":[{"delta":{},"finish_reason":"${finishReason}"}]}`,
          '',
          'data: [DONE]',
          '',
        ]),
      );
      return runTextCompletionStreamRequest(
        { provider: relayProvider, model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
        () => undefined,
        fetcher as never,
      );
    };

    expect(await runWithFinishReason("max_tokens")).toMatchObject({ success: true, stopReason: "length" });
    expect(await runWithFinishReason("stop")).toMatchObject({ success: true, stopReason: "stop" });
  });

  // 1011 复审补(欠账③):anthropic 官方契约 message_start 带 message.usage.input_tokens、
  // message_delta 带 usage.output_tokens——此前可得未取,现聚合成结构化终态用量。
  it("collects anthropic usage tokens from message_start and message_delta into the final result", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}',
        '',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答"}}',
        '',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","usage":{"output_tokens":34}}}',
        '',
      ]),
    );

    const result = await runTextCompletionStreamRequest(
      { provider: glmProvider, model: "glm-5.3", messages: [{ role: "user", content: "你好" }] },
      () => undefined,
      fetcher as never,
    );

    expect(result).toMatchObject({
      success: true,
      stopReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  // 1011 复审补(欠账③):openai 腿请求体带 stream_options.include_usage,
  // 收尾 usage 块(prompt/completion_tokens)聚合成终态用量。
  it("requests OpenAI stream usage via stream_options and aggregates the usage tail chunk", async () => {
    const fetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"答"}}]}',
        '',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":9}}',
        '',
        'data: [DONE]',
        '',
      ]),
    );

    const result = await runTextCompletionStreamRequest(
      { provider: relayProvider, model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      () => undefined,
      fetcher as never,
    );

    expect(result).toMatchObject({ success: true, usage: { inputTokens: 7, outputTokens: 9 } });
    const body = JSON.parse(fetcher.mock.calls[0]![1].body) as { stream_options?: { include_usage?: boolean } };
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  // 1011 复审补(欠账④):SSE 分派收敛到单源表后的行为锁——未声明协议的 gemini 平台
  // 直接走一次性(不再盲试 openai SSE 再回退);未声明协议的 anthropic 平台照旧 anthropic SSE。
  it("routes undeclared gemini platforms to one-shot and undeclared anthropic platforms to anthropic SSE", async () => {
    const geminiFetcher = vi.fn<StreamFetcher>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gem" }] } }] }), { status: 200 }),
    );
    const gemini = await runTextCompletionStreamRequest(
      {
        provider: { ...relayProvider, platform: "gemini-compatible", apiProtocol: undefined },
        model: "gemini-x",
        messages: [{ role: "user", content: "hi" }],
      },
      () => undefined,
      geminiFetcher as never,
    );
    expect(gemini).toMatchObject({ success: true, text: "gem", protocol: "gemini-compatible" });
    expect(geminiFetcher).toHaveBeenCalledTimes(1);

    const anthropicFetcher = vi.fn<StreamFetcher>(async () =>
      sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答"}}',
        '',
      ]),
    );
    const anthropic = await runTextCompletionStreamRequest(
      {
        provider: { ...relayProvider, platform: "anthropic-compatible", apiProtocol: undefined, baseUrl: "https://anthropic-relay.example.com" },
        model: "claude-x",
        messages: [{ role: "user", content: "hi" }],
      },
      () => undefined,
      anthropicFetcher as never,
    );
    expect(anthropic).toMatchObject({ success: true, text: "答" });
    const [endpoint] = anthropicFetcher.mock.calls[0]!;
    expect(endpoint).toBe("https://anthropic-relay.example.com/v1/messages");
  });
});
