import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createBilibiliTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:bilibili:account-1",
    platform: "bilibili",
    providerAccountId: "openid-1",
    displayName: "B站账号",
    credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "bilibili", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/bilibili", scopes: [] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Bilibili official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { openid: "openid-auth", name: "B站认证账号", face: "https://avatar.test/bilibili.png" } })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createBilibiliTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({
      platform: "bilibili",
      providerAccountId: "openid-auth",
      displayName: "B站认证账号",
      avatarUrl: "https://avatar.test/bilibili.png",
      credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" },
    });
    await expect(transport.listAccounts()).resolves.toEqual([{
      accountId: account?.id,
      displayName: "B站认证账号",
      avatarUrl: "https://avatar.test/bilibili.png",
      status: "online",
    }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.bilibili.com/x/account-oauth2/v1/token",
      "https://member.bilibili.com/arcopen/fn/user/account/info",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "access-token": "auth-token" });
  });

  it("runs signed init, chunk upload, complete, submit, and review polling", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { upload_token: "upload-1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({})))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { resource_id: "resource-1" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { resource_id: "resource-1", addit_info: { state: 0, state_desc: "开放" } } })));
    const transport = createBilibiliTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:bilibili:account-1",
      contentType: "video",
      assets: [{ assetId: "video-1", kind: "video", url: "https://assets.test/video.mp4" }],
      title: "视频标题",
      options: { tid: 171 },
    })).resolves.toMatchObject({ taskId: "resource-1", status: "running" });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://assets.test/video.mp4",
      "https://member.bilibili.com/arcopen/fn/archive/video/init",
      "https://openupos.bilivideo.com/video/v2/part/upload?upload_token=upload-1&part_number=1",
      "https://member.bilibili.com/arcopen/fn/archive/video/complete?upload_token=upload-1",
      "https://member.bilibili.com/arcopen/fn/archive/add-by-utoken?upload_token=upload-1",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-bili-accesskeyid": "client-1",
      "x-bili-signature-method": "HMAC-SHA256",
    });
    await expect(transport.poll({ accountId: "aitoearn-local:bilibili:account-1", taskId: "resource-1" }))
      .resolves.toMatchObject({ status: "success", progress: 100 });
  });

  it("fails closed when the required Bilibili category ID is absent", async () => {
    const transport = createBilibiliTransport(createRuntime(createFetchMock()));
    await expect(transport.publish({ accountId: "aitoearn-local:bilibili:account-1", contentType: "video", assets: [{ assetId: "video-1", kind: "video", url: "https://assets.test/video.mp4" }] }))
      .rejects.toThrow("分区 ID");
  });
});
