import { afterEach, describe, expect, it, vi } from "vitest";

import { isAmbiguousPaidImageError } from "@/lib/ai/image-generation-errors";
import { generateMikotoImageViaAsync } from "./mikoto-async";

/** mikoto 专用异步通道单测(协议级,不经 freedom 兜底链——链路级拦截测试在 freedom-api.test.ts) */
describe("generateMikotoImageViaAsync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mikoto async channel: multipart edits/async submit then task poll returns result URL", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/images/edits/async")) {
        expect(init?.method).toBe("POST");
        const form = init?.body as FormData;
        expect(form.get("prompt")).toBe("async shot");
        expect(form.get("size")).toBe("1280x720");
        expect(form.get("image")).toBeInstanceOf(Blob);
        return new Response(JSON.stringify({ id: "img-task-9" }), { status: 200 });
      }
      if (target.endsWith("/images/tasks/img-task-9")) {
        return new Response(JSON.stringify({ status: "completed", resultUrl: "https://cdn.mikoto.example/out.png" }), { status: 200 });
      }
      throw new Error(`unexpected endpoint hit: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const promise = generateMikotoImageViaAsync(
      { prompt: "async shot", aspectRatio: "16:9", resolution: "1K", referenceImages: ["data:image/png;base64,aGVsbG8="] },
      "gpt-image-2",
      "sk-test",
      "https://api.mikoto.vip",
      (url) => `media:${url}`,
    );
    await vi.advanceTimersByTimeAsync(3001);
    const result = await promise;

    expect(result.url).toBe("https://cdn.mikoto.example/out.png");
    expect(result.mediaId).toBe("media:https://cdn.mikoto.example/out.png");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.mikoto.vip/images/edits/async");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://api.mikoto.vip/images/tasks/img-task-9");
  }, 20000);

  it("mikoto async channel: task failure after acceptance is marked ambiguous (paid boundary)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/images/edits/async")) {
        return new Response(JSON.stringify({ id: "img-task-fail" }), { status: 200 });
      }
      if (target.endsWith("/images/tasks/img-task-fail")) {
        return new Response(JSON.stringify({ status: "failed", error: "upstream blew up" }), { status: 200 });
      }
      throw new Error(`unexpected endpoint hit: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    // catch 必须与 promise 同步挂载:fake timers 下 rejection 先于 await 到达
    const promise = generateMikotoImageViaAsync(
      { prompt: "async failure", referenceImages: ["data:image/png;base64,aGVsbG8="] },
      "gpt-image-2",
      "sk-test",
      "https://api.mikoto.vip",
      () => undefined,
    ).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3001);
    const error: unknown = await promise;
    expect(error instanceof Error ? error.message : "").toContain("mikoto 异步任务失败");
    expect(isAmbiguousPaidImageError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("mikoto async channel: reference-free generation uses JSON generations/async", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/images/generations/async")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ model: "gpt-image-2", prompt: "text only", n: 1, size: "1280x720" });
        return new Response(JSON.stringify({ task_id: "txt-task-1" }), { status: 200 });
      }
      if (target.endsWith("/images/tasks/txt-task-1")) {
        return new Response(JSON.stringify({ status: "completed", data: [{ url: "https://cdn.mikoto.example/txt.png" }] }), { status: 200 });
      }
      throw new Error(`unexpected endpoint hit: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const promise = generateMikotoImageViaAsync(
      { prompt: "text only", aspectRatio: "16:9", resolution: "1K" },
      "gpt-image-2",
      "sk-test",
      "https://api.mikoto.vip",
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(3001);
    const result = await promise;
    expect(result.url).toBe("https://cdn.mikoto.example/txt.png");
  }, 20000);
});
