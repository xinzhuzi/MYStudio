import { afterEach, describe, expect, it, vi } from "vitest";
import { freedomRetry, isRetryableFreedomError } from "./freedom-retry";

afterEach(() => {
  vi.useRealTimers();
});

describe("freedom retry", () => {
  it("classifies provider overloads but not aborts", () => {
    expect(isRetryableFreedomError({ status: 503, message: "unavailable" })).toBe(true);
    expect(isRetryableFreedomError(new Error("no available channel"))).toBe(true);
    expect(isRetryableFreedomError({ name: "AbortError", message: "aborted" })).toBe(false);
  });

  it("retries transport-level network failures but not task-level poll timeouts", () => {
    // 传输层失败:结构化标记 / 翻译后稳定前缀 / 原始 fetch 失败
    expect(isRetryableFreedomError(Object.assign(new Error("网络请求失败:域名解析失败"), { networkFailure: true }))).toBe(true);
    expect(isRetryableFreedomError(new Error("网络请求失败,未获取到具体原因(可能是断网、代理或防火墙拦截) · 目标 https://x.io"))).toBe(true);
    expect(isRetryableFreedomError(new TypeError("fetch failed"))).toBe(true);
    // 任务级轮询超时不整单重试(重复付费风险),用户取消仍不重试
    expect(isRetryableFreedomError(new Error("视频生成超时(已轮询 180 次、约 15 分钟仍未出片)"))).toBe(false);
    expect(isRetryableFreedomError(new Error("用户已取消"))).toBe(false);
  });

  it("rotates a key and retries with exponential delay", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { status: 429 }))
      .mockResolvedValue("ok");
    const keyManager = { handleError: vi.fn(() => true) };
    const result = freedomRetry(operation, "Image generation", keyManager);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(keyManager.handleError).toHaveBeenCalledWith(429, "quota");
  });

  it("does not retry unsupported models", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("model not found 503"));
    await expect(freedomRetry(operation, "Video generation")).rejects.toThrow("model not found");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("exhausts three attempts with 3s then 6s backoff", async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error("service unavailable"), { status: 503 });
    const operation = vi.fn().mockRejectedValue(error);
    const keyManager = { handleError: vi.fn(() => false) };

    const result = freedomRetry(operation, "Video generation", keyManager);
    const rejection = expect(result).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(2999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5999);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(operation).toHaveBeenCalledTimes(3);
    expect(keyManager.handleError).toHaveBeenCalledTimes(3);
  });

  it("retries code-only overloads without invoking the status key manager", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce({ code: 503, message: "upstream unavailable" })
      .mockResolvedValue("ok");
    const keyManager = { handleError: vi.fn(() => true) };

    const result = freedomRetry(operation, "Image generation", keyManager);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(keyManager.handleError).not.toHaveBeenCalled();
  });

  it("does not retry aborts or generic client errors", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError", status: 503 });
    const abortOperation = vi.fn().mockRejectedValue(abort);
    await expect(freedomRetry(abortOperation, "Video generation")).rejects.toBe(abort);
    expect(abortOperation).toHaveBeenCalledTimes(1);

    const clientError = Object.assign(new Error("bad request"), { status: 400 });
    const clientOperation = vi.fn().mockRejectedValue(clientError);
    await expect(freedomRetry(clientOperation, "Video generation")).rejects.toBe(clientError);
    expect(clientOperation).toHaveBeenCalledTimes(1);
  });
});
