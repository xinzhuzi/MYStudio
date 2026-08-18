import { describe, expect, it } from "vitest";

import {
  compareVersions,
  normalizeUpdateManifest,
  sanitizeExternalUrl,
  sanitizeUpdateDownloadUrl,
} from "./update-policy";

describe("update policy", () => {
  it("accepts only HTTP download URLs", () => {
    expect(sanitizeExternalUrl("https://example.test/release")).toBe("https://example.test/release");
    expect(sanitizeExternalUrl("http://example.test/release")).toBe("http://example.test/release");
    expect(sanitizeExternalUrl("file:///tmp/release")).toBeUndefined();
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeExternalUrl("not a url")).toBeUndefined();
  });

  it("restricts update download links to HTTPS on allowlisted hosts", () => {
    expect(sanitizeUpdateDownloadUrl("https://github.com/xinzhuzi/MYStudio/releases/tag/v1.2.0"))
      .toBe("https://github.com/xinzhuzi/MYStudio/releases/tag/v1.2.0");
    expect(sanitizeUpdateDownloadUrl("https://release-assets.githubusercontent.com/123/dmg"))
      .toBe("https://release-assets.githubusercontent.com/123/dmg");
    expect(sanitizeUpdateDownloadUrl("https://pan.baidu.com/s/abc")).toBe("https://pan.baidu.com/s/abc");
    // 明文 HTTP 与非 allowlist 域一律丢弃(HTTP 清单内容视同不可信)
    expect(sanitizeUpdateDownloadUrl("http://github.com/xinzhuzi/MYStudio")).toBeUndefined();
    expect(sanitizeUpdateDownloadUrl("https://evil.example/dmg")).toBeUndefined();
    expect(sanitizeUpdateDownloadUrl("https://not-github.com.attacker.test/dmg")).toBeUndefined();
    expect(sanitizeUpdateDownloadUrl("file:///tmp/dmg")).toBeUndefined();
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
      githubUrl: "https://github.com/xinzhuzi/MYStudio",
      baiduUrl: "https://pan.baidu.com/s/default",
      baiduCode: "fallback",
    })).toEqual({
      version: "v2.0.0",
      releaseNotes: "兼容说明",
      publishedAt: "2026-07-15",
      githubUrl: "https://github.com/xinzhuzi/MYStudio",
      baiduUrl: "https://pan.baidu.com/s/default",
      baiduCode: "1234",
    });
  });

  it("drops manifest download links that are not HTTPS or not on allowlisted hosts", () => {
    const manifest = normalizeUpdateManifest({
      version: "2.0.0",
      githubUrl: "http://attacker.test/dmg",
      baiduUrl: "https://mirror.evil.test/dmg",
    });
    expect(manifest.githubUrl).toBeUndefined();
    expect(manifest.baiduUrl).toBeUndefined();
  });

  it("prefers releaseNotes and rejects a missing version", () => {
    expect(normalizeUpdateManifest({ version: "1.0.0", releaseNotes: " new ", notes: "old" }).releaseNotes)
      .toBe("new");
    expect(() => normalizeUpdateManifest({ notes: "missing" }))
      .toThrow("版本清单缺少有效的 version 字段");
  });
});
