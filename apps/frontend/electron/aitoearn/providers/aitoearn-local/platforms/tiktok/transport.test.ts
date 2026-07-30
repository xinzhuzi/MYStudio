import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createTiktokTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function runtimeWithFetch(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:tiktok:account-1",
    platform: "tiktok",
    providerAccountId: "open-1",
    displayName: "TikTok account",
    credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "tiktok", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/tiktok", scopes: ["user.info.basic", "video.publish", "video.upload"] },
    vault: {
      get: vi.fn(async () => account),
      list: vi.fn(async () => [{ ...account, credential: undefined }]),
    } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("TikTok official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200, open_id: "open-auth", scope: "user.info.basic,video.publish" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: { open_id: "open-auth", display_name: "TikTok Auth", avatar_url: "https://avatar.test/tiktok.png" } } })));
    const { runtime, records } = withMemoryAccountVault(runtimeWithFetch(fetchMock));
    const transport = createTiktokTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "tiktok", providerAccountId: "open-auth", displayName: "TikTok Auth", credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "TikTok Auth", avatarUrl: "https://avatar.test/tiktok.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://open.tiktokapis.com/v2/oauth/token/",
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code_verifier=");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
  });

  it("initializes, uploads, polls, and cancels a video publish without external network", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { publish_id: "publish-1", upload_url: "https://upload.tiktok.test/video" } })))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "PUBLISH_COMPLETE" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    const transport = createTiktokTransport(runtimeWithFetch(fetchMock));

    await expect(transport.publish({
      accountId: "aitoearn-local:tiktok:account-1",
      contentType: "video",
      assets: [{ assetId: "video-1", kind: "video", url: "https://assets.test/video.mp4" }],
      title: "Title",
      description: "Description",
      visibility: "public",
    })).resolves.toMatchObject({ taskId: "publish-1", status: "running" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      source_info: { source: "FILE_UPLOAD", video_size: 3, total_chunk_count: 1 },
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });

    await expect(transport.poll({ accountId: "aitoearn-local:tiktok:account-1", taskId: "publish-1" }))
      .resolves.toMatchObject({ status: "success", progress: 100 });
    await expect(transport.cancel({ accountId: "aitoearn-local:tiktok:account-1", taskId: "publish-1" }))
      .resolves.toMatchObject({ status: "canceled" });
  });

  it("uses TikTok's direct-photo contract only for HTTPS image URLs", async () => {
    const fetchMock = createFetchMock().mockImplementation(async () => new Response(JSON.stringify({ data: { publish_id: "photo-1" } })));
    const transport = createTiktokTransport(runtimeWithFetch(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:tiktok:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
    })).resolves.toMatchObject({ taskId: "photo-1", status: "running" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      media_type: "PHOTO",
      source_info: { source: "PULL_FROM_URL", photo_images: ["https://assets.test/image.png"] },
    });
  });
});
