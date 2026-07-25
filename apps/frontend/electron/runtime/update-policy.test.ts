import { describe, expect, it } from "vitest";

import { compareVersions, normalizeUpdateManifest, sanitizeExternalUrl } from "./update-policy";

describe("update policy", () => {
  it("accepts only HTTP download URLs", () => {
    expect(sanitizeExternalUrl("https://example.test/release")).toBe("https://example.test/release");
    expect(sanitizeExternalUrl("http://example.test/release")).toBe("http://example.test/release");
    expect(sanitizeExternalUrl("file:///tmp/release")).toBeUndefined();
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeExternalUrl("not a url")).toBeUndefined();
  });

  it("compares prefixed and uneven semantic version parts", () => {
    expect(compareVersions("v1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta", "1.2.1")).toBe(-1);
  });

  it("normalizes text and falls back to configured download fields", () => {
    expect(normalizeUpdateManifest({
      version: " v2.0.0 ",
      notes: " 兼容说明 ",
      publishedAt: " 2026-07-15 ",
      githubUrl: "file:///unsafe",
      baiduCode: " 1234 ",
    }, {
      githubUrl: "https://github.test/default",
      baiduUrl: "https://baidu.test/default",
      baiduCode: "fallback",
    })).toEqual({
      version: "v2.0.0",
      releaseNotes: "兼容说明",
      publishedAt: "2026-07-15",
      githubUrl: "https://github.test/default",
      baiduUrl: "https://baidu.test/default",
      baiduCode: "1234",
    });
  });

  it("prefers releaseNotes and rejects a missing version", () => {
    expect(normalizeUpdateManifest({ version: "1.0.0", releaseNotes: " new ", notes: "old" }).releaseNotes)
      .toBe("new");
    expect(() => normalizeUpdateManifest({ notes: "missing" }))
      .toThrow("版本清单缺少有效的 version 字段");
  });
});
