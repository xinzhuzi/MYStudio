import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertOAuthCallback, createOAuthState, createPkcePair } from "./oauth-state";

describe("official platform OAuth state", () => {
  it("creates high-entropy state and a valid S256 PKCE pair", () => {
    const state = createOAuthState();
    const { verifier, challenge } = createPkcePair();
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(verifier.length).toBeGreaterThanOrEqual(80);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  it("accepts only the exact callback path, state, and authorization code", () => {
    expect(assertOAuthCallback(
      "https://localhost/mystudio/oauth?state=state-1&code=code-1",
      "https://localhost/mystudio/oauth",
      "state-1",
    ).searchParams.get("code")).toBe("code-1");
    expect(() => assertOAuthCallback("https://localhost/other?state=state-1&code=code-1", "https://localhost/mystudio/oauth", "state-1")).toThrow("URI 不匹配");
    expect(() => assertOAuthCallback("https://localhost/mystudio/oauth?state=wrong&code=code-1", "https://localhost/mystudio/oauth", "state-1")).toThrow("state 校验失败");
    expect(() => assertOAuthCallback("https://localhost/mystudio/oauth?state=state-1", "https://localhost/mystudio/oauth", "state-1")).toThrow("缺少授权 code");
  });
});
