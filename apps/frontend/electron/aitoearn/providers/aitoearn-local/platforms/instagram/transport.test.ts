import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createInstagramTransport } from "./transport";

function createFetchMock() { return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(); }
function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = { id: "aitoearn-local:instagram:account-1", platform: "instagram", providerAccountId: "ig-1", displayName: "Instagram", credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" }, updatedAt: "2026-07-27T00:00:00.000Z" };
  return {
    config: { platformId: "instagram", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/instagram", scopes: ["instagram_business_content_publish"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Instagram official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-token", expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ig-auth", username: "instagram-auth", name: "Instagram Auth", profile_picture_url: "https://avatar.test/instagram.png" })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createInstagramTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "instagram", providerAccountId: "ig-auth", displayName: "Instagram Auth", credential: { kind: "oauth", accessToken: "long-token", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "Instagram Auth", avatarUrl: "https://avatar.test/instagram.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.instagram.com/oauth/access_token",
      expect.stringContaining("https://graph.instagram.com/access_token?"),
      expect.stringContaining("https://graph.instagram.com/v20.0/me?"),
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("access_token=long-token");
  });

  it("creates an HTTPS media container and publishes only after FINISHED", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: "FINISHED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permalink: "https://instagram.test/p/1" })));
    const transport = createInstagramTransport(createRuntime(fetchMock));
    await expect(transport.publish({ accountId: "aitoearn-local:instagram:account-1", contentType: "image-text", assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }], description: "Caption" }))
      .resolves.toMatchObject({ taskId: "container-1", status: "running" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://graph.instagram.com/v20.0/ig-1/media?");
    await expect(transport.poll({ accountId: "aitoearn-local:instagram:account-1", taskId: "container-1" }))
      .resolves.toMatchObject({ providerTaskId: "media-1", status: "success", resultUrl: "https://instagram.test/p/1" });
  });
});
