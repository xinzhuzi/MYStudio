import { describe, expect, it } from "vitest";
import { assertSafeOutboundRequestUrl, isBlockedOutboundRequestHost } from "./request-url-guard";

describe("isBlockedOutboundRequestHost", () => {
  it.each([
    "169.254.169.254",
    "169.254.0.1",
    "0.0.0.0",
    "[fe80::1]",
    "fe89::a",
    "metadata.google.internal",
    "metadata.goog",
  ])("blocks %s", (host) => {
    expect(isBlockedOutboundRequestHost(host)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "localhost",
    "192.168.1.10",
    "10.0.0.8",
    "172.16.4.4",
    "api.github.com",
    "[::1]",
    "2408:845a::1",
  ])("allows %s (loopback/private self-hosted APIs are real usage)", (host) => {
    expect(isBlockedOutboundRequestHost(host)).toBe(false);
  });
});

describe("assertSafeOutboundRequestUrl", () => {
  it("passes ordinary https API urls through unchanged", () => {
    expect(assertSafeOutboundRequestUrl("https://api.example.test/v1/images")).toBe(
      "https://api.example.test/v1/images",
    );
  });

  it("keeps private-network self-hosted endpoints reachable", () => {
    expect(assertSafeOutboundRequestUrl("http://192.168.1.10:3000/v1")).toBe(
      "http://192.168.1.10:3000/v1",
    );
  });

  it("rejects cloud metadata endpoints with a clear error", () => {
    expect(() => assertSafeOutboundRequestUrl("http://169.254.169.254/latest/meta-data/"))
      .toThrow(/安全策略拒绝/);
    expect(() => assertSafeOutboundRequestUrl("http://metadata.google.internal/computeMetadata/v1/"))
      .toThrow(/安全策略拒绝/);
  });

  it("rejects non-http protocols", () => {
    expect(() => assertSafeOutboundRequestUrl("file:///etc/passwd")).toThrow(/仅支持 http\/https/);
  });
});
