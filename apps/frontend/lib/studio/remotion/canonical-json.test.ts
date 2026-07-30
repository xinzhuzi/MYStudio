import { describe, expect, it } from "vitest";
import { canonicalJson, sha256CanonicalJson } from "./canonical-json";

describe("canonical JSON and SHA-256", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const left = {
      z: [{ beta: 2, alpha: 1 }],
      a: { d: 4, c: 3 },
    };
    const right = {
      a: { c: 3, d: 4 },
      z: [{ alpha: 1, beta: 2 }],
    };

    expect(canonicalJson(left)).toBe('{"a":{"c":3,"d":4},"z":[{"alpha":1,"beta":2}]}');
    expect(canonicalJson(right)).toBe(canonicalJson(left));
  });

  it("produces the standard SHA-256 digest for canonical JSON", async () => {
    await expect(sha256CanonicalJson({ b: 2, a: 1 })).resolves.toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("rejects non-JSON values instead of hashing an ambiguous projection", () => {
    expect(() => canonicalJson({ missing: undefined })).toThrow("undefined");
    expect(() => canonicalJson({ invalid: Number.POSITIVE_INFINITY })).toThrow("finite");
    expect(() => canonicalJson(new Date(0))).toThrow("plain object");
  });

  it("rejects cyclic input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cyclic");
  });
});
