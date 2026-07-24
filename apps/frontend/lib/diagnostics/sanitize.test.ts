import { describe, expect, it } from "vitest";
import {
  sanitizeDiagnosticsData,
  sanitizeDiagnosticsError,
  summarizeResponseBody,
} from "./sanitize";

describe("diagnostics sanitizers", () => {
  it("redacts secret-like keys and strips URL credentials/query fragments", () => {
    const sanitized = sanitizeDiagnosticsData({
      authorization: "Bearer sk-secret",
      apiKey: "sk-secret",
      callbackUrl: "https://user:pass@example.com/path?token=secret#hash",
    });

    expect(sanitized).toEqual({
      authorization: "[redacted]",
      apiKey: "[redacted]",
      callbackUrl: "https://example.com/path",
    });
  });

  it("summarizes prompts and binary payloads instead of dumping raw data", () => {
    const prompt = "镜头".repeat(80);
    const binary = "a".repeat(520);
    const sanitized = sanitizeDiagnosticsData({ prompt, image: binary });

    expect(sanitized).toMatchObject({
      prompt: {
        promptLength: prompt.length,
        promptHash: expect.any(String),
        promptPreview: prompt.slice(0, 120),
        truncated: true,
      },
      image: {
        binaryPayload: true,
        length: binary.length,
        hash: expect.any(String),
      },
    });
  });

  it("bounds nested structures and error stacks", () => {
    const nested = { a: { b: { c: { d: { e: { f: { g: { h: "too deep" } } } } } } } };
    expect(sanitizeDiagnosticsData(nested)).toMatchObject({
      a: { b: { c: { d: { e: { f: { g: "[depth-limit]" } } } } } },
    });

    const error = new Error("failed with sk-secret token");
    const sanitizedError = sanitizeDiagnosticsError(error);
    expect(sanitizedError.name).toBe("Error");
    expect(sanitizedError.message).toBe("failed with sk-secret token");
    expect(sanitizedError.stack?.length).toBeLessThanOrEqual(2000);
  });

  it("summarizes response bodies after binary sanitization", () => {
    const summary = summarizeResponseBody("data:image/png;base64," + "a".repeat(520));

    expect(summary).toContain('"binaryPayload":true');
    expect(summary).not.toContain("a".repeat(200));
  });
});
