import { describe, expect, it } from "vitest";
import { isRetryableHttpStatus, retryDelayMs } from "./retry-policy";

describe("shared polling retry policy", () => {
  it("retries only transient HTTP statuses", () => {
    expect([408, 425, 429, 500, 503].every(isRetryableHttpStatus)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryableHttpStatus)).toBe(false);
  });

  it("caps exponential backoff", () => {
    expect(retryDelayMs(0)).toBe(2000);
    expect(retryDelayMs(1)).toBe(4000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(9)).toBe(8000);
  });
});
