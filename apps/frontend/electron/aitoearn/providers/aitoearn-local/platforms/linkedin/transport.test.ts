import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createLinkedinTransport } from "./transport";

function createFetchMock() { return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(); }
function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = { id: "aitoearn-local:linkedin:account-1", platform: "linkedin", providerAccountId: "person-1", displayName: "LinkedIn", credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" }, updatedAt: "2026-07-27T00:00:00.000Z" };
  return {
    config: { platformId: "linkedin", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/linkedin", scopes: ["openid", "profile", "w_member_social"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("LinkedIn official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200, scope: "openid profile w_member_social" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: "person-auth", name: "LinkedIn Auth", picture: "https://avatar.test/linkedin.png" })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createLinkedinTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "linkedin", providerAccountId: "person-auth", displayName: "LinkedIn Auth", credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "LinkedIn Auth", avatarUrl: "https://avatar.test/linkedin.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://www.linkedin.com/oauth/v2/accessToken",
      "https://api.linkedin.com/v2/userinfo",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
  });

  it("initializes/uploads an image and creates a REST post with the owner URN", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { uploadUrl: "https://upload.linkedin.test/image", image: "urn:li:image:1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "urn:li:share:1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const transport = createLinkedinTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:linkedin:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
      description: "LinkedIn post",
      visibility: "public",
    })).resolves.toMatchObject({ taskId: "urn:li:share:1", status: "success" });
    const postBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(postBody).toMatchObject({
      author: "urn:li:person:person-1",
      commentary: "LinkedIn post",
      visibility: "PUBLIC",
      content: { multiImage: { images: [{ id: "urn:li:image:1" }] } },
    });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({ "linkedin-version": "202605" });
    await expect(transport.cancel({ accountId: "aitoearn-local:linkedin:account-1", taskId: "urn:li:share:1" }))
      .resolves.toMatchObject({ status: "canceled" });
  });
});
