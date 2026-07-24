import { describe, expect, it } from "vitest";
import { normalizeSClassLegacyConcurrency } from "./sclass-legacy-video-generation";

describe("normalizeSClassLegacyConcurrency", () => {
  it.each([
    [0, 1],
    [-2, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [2.8, 2],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeSClassLegacyConcurrency(input)).toBe(expected);
  });

  it("preserves a positive integer batch size", () => {
    expect(normalizeSClassLegacyConcurrency(3)).toBe(3);
  });
});
