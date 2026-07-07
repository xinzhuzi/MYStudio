import { describe, expect, it, vi } from "vitest";
import { observedFetch } from "./network";

describe("observedFetch", () => {
  it("logs start and completion with sanitized network metadata", async () => {
    const logEvent = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await observedFetch(
      "https://relay.example.com/v1/chat/completions?api_key=secret",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt", prompt: "长提示词".repeat(80) }),
      },
      {
        operationId: "op-1",
        endpointFamily: "chat-completions",
        providerId: "relay",
        providerName: "Relay",
        model: "gpt",
        fetcher,
        logEvent,
      },
    );

    expect(response.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: "debug",
      category: "network",
      operationId: "op-1",
      message: "HTTP request started",
    }));
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: "info",
      category: "network",
      operationId: "op-1",
      message: "HTTP request completed",
      context: expect.objectContaining({
        baseUrlHost: "relay.example.com",
        pathTemplate: "/v1/chat/completions",
        status: 200,
        endpointFamily: "chat-completions",
      }),
    }));
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("secret");
  });

  it("summarizes JSON request bodies without storing full prompts", async () => {
    const logEvent = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] }), { status: 200 }));
    const prompt = "生成一个白底红色圆形，测试图片接口。".repeat(20);

    await observedFetch(
      "https://relay.example.com/v1/images/generations",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt,
          n: 1,
          stream: false,
          aspect_ratio: "1:1",
          resolution: "1K",
          image_urls: ["data:image/png;base64," + "A".repeat(800)],
        }),
      },
      {
        operationId: "op-body",
        endpointFamily: "images-generations",
        templateName: "provider-extension",
        fetcher,
        logEvent,
      },
    );

    const startCall = logEvent.mock.calls.find(([entry]) => entry.message === "HTTP request started");
    expect(startCall?.[0].context).toMatchObject({
      bodyKeys: expect.arrayContaining(["model", "prompt", "aspect_ratio", "resolution", "image_urls"]),
      requestModel: "gpt-image-2",
      templateName: "provider-extension",
      aspectRatio: "1:1",
      resolution: "1K",
      referenceImageCount: 1,
      prompt: expect.objectContaining({
        promptLength: prompt.length,
        promptHash: expect.any(String),
        truncated: true,
      }),
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(prompt);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("A".repeat(200));
  });

  it("logs HTTP errors with a bounded response summary", async () => {
    const logEvent = vi.fn();
    const fetcher = vi.fn(async () => new Response("bad key ".repeat(300), {
      status: 401,
      statusText: "Unauthorized",
    }));

    await observedFetch("https://relay.example.com/v1/images/generations", {}, {
      operationId: "op-2",
      endpointFamily: "images-generations",
      fetcher,
      logEvent,
    });

    const errorCall = logEvent.mock.calls.find(([entry]) => entry.message === "HTTP request failed");
    expect(errorCall?.[0]).toMatchObject({
      level: "error",
      category: "network",
      operationId: "op-2",
      context: expect.objectContaining({
        status: 401,
        statusText: "Unauthorized",
        responseSummary: expect.any(String),
      }),
    });
    expect(errorCall?.[0].context.responseSummary.length).toBeLessThanOrEqual(1024);
  });

  it("logs thrown network errors with elapsed time", async () => {
    const logEvent = vi.fn();
    const fetcher = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expect(observedFetch("https://relay.example.com/v1/chat/completions", {}, {
      operationId: "op-3",
      endpointFamily: "chat-completions",
      timeoutMs: 15_000,
      fetcher,
      logEvent,
    })).rejects.toThrow("The operation was aborted");

    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      category: "network",
      operationId: "op-3",
      message: "HTTP request errored",
      context: expect.objectContaining({
        timeoutMs: 15_000,
        errorName: "AbortError",
      }),
    }));
  });

  it("routes image requests through the Electron main-process proxy when available", async () => {
    const logEvent = vi.fn();
    const directFetch = vi.fn();
    const imageRequest = vi.fn(async (_payload: any) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }),
    }));
    vi.stubGlobal("fetch", directFetch);
    vi.stubGlobal("window", { electronAPI: { imageRequest } });

    const response = await observedFetch(
      "https://relay.example.com/v1/images/generations",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: "old laborer", size: "1024x1024" }),
      },
      {
        operationId: "op-image",
        endpointFamily: "images-generations",
        providerId: "relay",
        providerName: "Relay",
        model: "gpt-image-2",
        timeoutMs: 180_000,
        templateName: "openai-size",
        logEvent,
      },
    );

    expect(response.status).toBe(200);
    expect(directFetch).not.toHaveBeenCalled();
    expect(imageRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://relay.example.com/v1/images/generations",
      method: "POST",
      operationId: "op-image",
      endpointFamily: "images-generations",
      model: "gpt-image-2",
      timeoutMs: 180_000,
      templateName: "openai-size",
    }));
    const payload = imageRequest.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(JSON.parse(payload!.body)).toMatchObject({
      model: "gpt-image-2",
      size: "1024x1024",
    });
  });
});
