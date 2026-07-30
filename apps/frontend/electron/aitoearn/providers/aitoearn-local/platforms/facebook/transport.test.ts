import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createFacebookTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:facebook:account-1",
    platform: "facebook",
    providerAccountId: "page-1",
    displayName: "Facebook Page",
    credential: { kind: "oauth", accessToken: "page-token", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "facebook", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/facebook", scopes: ["pages_manage_posts"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Facebook official transport", () => {
  it("authenticates through the official endpoints and lists the saved page", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-token", expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "page-auth", name: "Facebook Auth Page", access_token: "page-auth-token", picture: { data: { url: "https://avatar.test/facebook.png" } } }] })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createFacebookTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({
      platform: "facebook",
      providerAccountId: "page-auth",
      displayName: "Facebook Auth Page",
      credential: { kind: "oauth", accessToken: "page-auth-token", expiresAt: "2026-07-27T02:00:00.000Z" },
    });
    await expect(transport.listAccounts()).resolves.toEqual([{
      accountId: account?.id,
      displayName: "Facebook Auth Page",
      avatarUrl: "https://avatar.test/facebook.png",
      status: "online",
    }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("https://graph.facebook.com/v20.0/oauth/access_token?"),
      expect.stringContaining("https://graph.facebook.com/v20.0/oauth/access_token?"),
      expect.stringContaining("https://graph.facebook.com/v20.0/me/accounts?"),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("code=code-1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("grant_type=fb_exchange_token");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("access_token=long-token");
  });

  it("publishes to the selected page and uses the post ID for poll/delete", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "photo-1", post_id: "page-1_post-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "page-1_post-1", permalink_url: "https://facebook.test/post-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    const transport = createFacebookTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:facebook:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
      description: "Post body",
    })).resolves.toMatchObject({ taskId: "page-1_post-1", status: "success" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/page-1/photos?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("access_token=page-token");
    await expect(transport.poll({ accountId: "aitoearn-local:facebook:account-1", taskId: "page-1_post-1" }))
      .resolves.toMatchObject({ status: "success", resultUrl: "https://facebook.test/post-1" });
    await expect(transport.cancel({ accountId: "aitoearn-local:facebook:account-1", taskId: "page-1_post-1" }))
      .resolves.toMatchObject({ status: "canceled" });
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });
});
