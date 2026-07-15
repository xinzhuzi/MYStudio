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
});
