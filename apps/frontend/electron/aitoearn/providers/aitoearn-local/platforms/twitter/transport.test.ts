import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createTwitterTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:twitter:account-1",
    platform: "twitter",
    providerAccountId: "user-1",
    displayName: "X account",
    credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "twitter", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/twitter", scopes: ["tweet.write", "users.read"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("X official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200, scope: "tweet.write users.read" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "user-auth", name: "X Auth", username: "x-auth", profile_image_url: "https://avatar.test/twitter.png" } })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createTwitterTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "twitter", providerAccountId: "user-auth", displayName: "X Auth", credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "X Auth", avatarUrl: "https://avatar.test/twitter.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.x.com/2/oauth2/token",
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      },
    });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code_verifier=");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
  });

  it("uploads media, creates a post, and deletes it through the verified v2 endpoints", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media-1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media-1" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "tweet-1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = createTwitterTransport(createRuntime(fetchMock));

    await expect(transport.publish({
      accountId: "aitoearn-local:twitter:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
      description: "Hello",
    })).resolves.toMatchObject({ taskId: "tweet-1", status: "success", resultUrl: "https://x.com/i/status/tweet-1" });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://assets.test/image.png",
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/media-1/append",
      "https://api.x.com/2/media/upload/finalize",
      "https://api.x.com/2/tweets",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({ text: "Hello", media: { media_ids: ["media-1"] } });

    await expect(transport.cancel({ accountId: "aitoearn-local:twitter:account-1", taskId: "tweet-1" }))
      .resolves.toMatchObject({ status: "canceled" });
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("DELETE");
  });
});
