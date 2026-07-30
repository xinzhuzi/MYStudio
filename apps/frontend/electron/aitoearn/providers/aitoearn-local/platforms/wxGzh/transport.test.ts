import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createWxGzhTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:wxGzh:account-1",
    platform: "wxGzh",
    providerAccountId: "app-1",
    displayName: "公众号",
    credential: { kind: "oauth", accessToken: "stored-token", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "wxGzh", clientId: "app-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/wxGzh", scopes: [] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("WeChat Official transport", () => {
  it("authenticates with app credentials and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "official-auth-token", expires_in: 7200 })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createWxGzhTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "wxGzh", providerAccountId: "app-1", displayName: "微信公众号 · app-1", credential: { kind: "oauth", accessToken: "official-auth-token", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "微信公众号 · app-1", status: "online" }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=app-1&secret=secret-1");
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("uploads the thumb, creates a draft, submits it, and polls the publish ID", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "official-token", expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ media_id: "thumb-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ media_id: "draft-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ publish_id: "publish-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "official-token", expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ publish_status: 0, article_id: "article-1", article_url: "https://mp.weixin.qq.com/s/1" })));
    const transport = createWxGzhTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:wxGzh:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
      cover: { assetId: "image-1", kind: "image", url: "https://assets.test/image.png" },
      title: "文章标题",
      description: "正文",
    })).resolves.toMatchObject({ taskId: "publish-1", status: "running" });
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/draft/add?");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("/freepublish/submit?");
    await expect(transport.poll({ accountId: "aitoearn-local:wxGzh:account-1", taskId: "publish-1" }))
      .resolves.toMatchObject({ status: "success", resultUrl: "https://mp.weixin.qq.com/s/1" });
  });
});
