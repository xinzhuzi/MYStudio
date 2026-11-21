import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createGoogleBusinessTransport } from "./transport";

function createFetchMock() { return vi.fn<(input: URL | RequestInfo, init?: RequestInit) => Promise<Response>>(); }
function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = { id: "aitoearn-local:googleBusiness:account-1", platform: "googleBusiness", providerAccountId: "accounts/1/locations/2", displayName: "测试商家 · 总店", credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" }, updatedAt: "2026-07-27T00:00:00.000Z" };
  return {
    config: { platformId: "googleBusiness", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/google-business", scopes: ["https://www.googleapis.com/auth/business.manage"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Google Business official transport", () => {
  it("authenticates through Google OAuth and saves one account per business location", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 3600, scope: "https://www.googleapis.com/auth/business.manage" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accounts: [
          { name: "accounts/1", accountName: "测试商家", type: "LOCATION_GROUP" },
          { name: "accounts/9", accountName: "用户组", type: "USER_GROUP" },
        ],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [{ name: "locations/2", title: "总店" }] })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createGoogleBusinessTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({
      platform: "googleBusiness",
      providerAccountId: "accounts/1/locations/2",
      displayName: "测试商家 · 总店",
      credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T01:00:00.000Z" },
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations?readMask=name%2Ctitle%2CstorefrontAddress",
    ]);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code_verifier=");
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: account?.displayName, status: "online" }]);
  });

  it("creates a Local Post with public media and reports the Google search URL", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "accounts/1/locations/2/localPosts/3", searchUrl: "https://posts.gle/abc", state: "LIVE" })));
    const transport = createGoogleBusinessTransport(createRuntime(fetchMock));

    await expect(transport.publish({
      accountId: "aitoearn-local:googleBusiness:account-1",
      contentType: "image-text",
      assets: [
        { assetId: "image-1", kind: "image", url: "https://assets.test/a.png" },
        { assetId: "image-2", kind: "image", url: "https://assets.test/b.png" },
      ],
      title: "标题",
      description: "正文",
      topics: ["活动"],
    })).resolves.toMatchObject({ taskId: "accounts/1/locations/2/localPosts/3", status: "success", resultUrl: "https://posts.gle/abc" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      languageCode: "zh-CN",
      summary: "标题\n\n正文\n\n#活动",
      topicType: "STANDARD",
      media: [
        { mediaFormat: "PHOTO", sourceUrl: "https://assets.test/a.png" },
        { mediaFormat: "PHOTO", sourceUrl: "https://assets.test/b.png" },
      ],
    });
  });

  it("requires a publicly reachable HTTPS media URL for video posts", async () => {
    const transport = createGoogleBusinessTransport(createRuntime(createFetchMock()));
    await expect(transport.publish({
      accountId: "aitoearn-local:googleBusiness:account-1",
      contentType: "video",
      assets: [{ assetId: "video-1", kind: "video", url: "/Users/me/movie.mp4" }],
      description: "视频",
    })).rejects.toThrow("HTTPS");
  });

  it("polls the Local Post state and deletes it for cancellation", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "PROCESSING" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "LIVE", searchUrl: "https://posts.gle/abc" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const transport = createGoogleBusinessTransport(createRuntime(fetchMock));

    await expect(transport.poll({ accountId: "aitoearn-local:googleBusiness:account-1", taskId: "accounts/1/locations/2/localPosts/3" }))
      .resolves.toMatchObject({ status: "running", progress: 75 });
    await expect(transport.poll({ accountId: "aitoearn-local:googleBusiness:account-1", taskId: "accounts/1/locations/2/localPosts/3" }))
      .resolves.toMatchObject({ status: "success", resultUrl: "https://posts.gle/abc" });
    await expect(transport.cancel({ accountId: "aitoearn-local:googleBusiness:account-1", taskId: "accounts/1/locations/2/localPosts/3" }))
      .resolves.toMatchObject({ status: "canceled" });
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });

  it("rejects a malformed post resource name before any network call", async () => {
    const fetchMock = createFetchMock();
    const transport = createGoogleBusinessTransport(createRuntime(fetchMock));
    await expect(transport.poll({ accountId: "aitoearn-local:googleBusiness:account-1", taskId: "../accounts/1" }))
      .rejects.toThrow("资源名无效");
    await expect(transport.cancel({ accountId: "aitoearn-local:googleBusiness:account-1", taskId: "accounts/1/localPosts/2" }))
      .rejects.toThrow("资源名无效");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
