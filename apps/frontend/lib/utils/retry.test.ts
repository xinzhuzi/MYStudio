import { describe, expect, it } from "vitest";
import { isRateLimitError } from "./retry";

describe("isRateLimitError", () => {
  it("recognizes structured status and code fields", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ code: 503 })).toBe(true);
  });

  it("respects an explicit non-retryable marker", () => {
    expect(isRateLimitError({ retryable: false, status: 429 })).toBe(false);
  });

  it("ignores non-string message values without throwing", () => {
    expect(isRateLimitError({ message: 429 })).toBe(false);
  });
});
