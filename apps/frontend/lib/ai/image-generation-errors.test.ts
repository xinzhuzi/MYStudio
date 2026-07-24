import { describe, expect, it } from "vitest";
import {
  isAmbiguousPaidImageError,
  isAmbiguousPaidImageException,
  isAmbiguousPaidImageResult,
  markAmbiguousPaidImageError,
} from "./image-generation-errors";

describe("paid image ambiguity guards", () => {
  it("marks and recognizes an ambiguous error without replacing the original error", () => {
    const original = new Error("transport failure");
    const marked = markAmbiguousPaidImageError(original);

    expect(marked).toBe(original);
    expect(marked.message).toBe("transport failure");
    expect(isAmbiguousPaidImageError(marked)).toBe(true);
    expect(isAmbiguousPaidImageError(new Error("ordinary failure"))).toBe(false);
  });

  it("treats server, compatibility, and statusless failures as ambiguous", () => {
    expect(isAmbiguousPaidImageResult({ status: 500 })).toBe(true);
    expect(isAmbiguousPaidImageResult({ status: 408 })).toBe(true);
    expect(isAmbiguousPaidImageResult({ error: "provider rejected prompt" })).toBe(false);
    expect(isAmbiguousPaidImageException({ status: 503 })).toBe(true);
    expect(isAmbiguousPaidImageException({ status: 403 })).toBe(false);
    expect(isAmbiguousPaidImageException(new Error("socket closed"))).toBe(true);
  });
});
