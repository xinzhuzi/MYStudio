import { createHash, randomBytes } from "node:crypto";

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32));
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function assertOAuthCallback(callbackUrl: string, redirectUri: string, expectedState: string): URL {
  const callback = new URL(callbackUrl);
  const redirect = new URL(redirectUri);
  if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) {
    throw new Error("OAuth callback URI 不匹配");
  }
  if (callback.searchParams.get("state") !== expectedState) {
    throw new Error("OAuth state 校验失败");
  }
  const providerError = callback.searchParams.get("error");
  if (providerError) {
    throw new Error(callback.searchParams.get("error_description") || providerError);
  }
  if (!callback.searchParams.get("code")) {
    throw new Error("OAuth callback 缺少授权 code");
  }
  return callback;
}
