import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createYoutubeTransport } from "./transport";

function createFetchMock() {
  return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>();
}

function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = {
    id: "aitoearn-local:youtube:account-1",
    platform: "youtube",
    providerAccountId: "channel-1",
    displayName: "YouTube account",
    credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  return {
    config: { platformId: "youtube", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/youtube", scopes: ["https://www.googleapis.com/auth/youtube.upload"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("YouTube official transport", () => {
  it("authenticates through the official endpoints and lists the saved channel", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200, scope: "youtube.upload" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "channel-auth", snippet: { title: "YouTube Auth", thumbnails: { default: { url: "https://avatar.test/youtube.png" } } } }] })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createYoutubeTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "youtube", providerAccountId: "channel-auth", displayName: "YouTube Auth", credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "YouTube Auth", avatarUrl: "https://avatar.test/youtube.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code_verifier=");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
  });

  it("uses a resumable upload and projects the resulting watch URL", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://upload.youtube.test/session-1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "video-1" }), { status: 200 }));
    const transport = createYoutubeTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:youtube:account-1",
      contentType: "video",
      assets: [{ assetId: "video-1", kind: "video", url: "https://assets.test/video.mp4" }],
      title: "Video title",
      scheduledAt: "2026-08-01T00:00:00.000Z",
    })).resolves.toMatchObject({
      taskId: "video-1",
      status: "success",
      resultUrl: "https://www.youtube.com/watch?v=video-1",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("uploadType=resumable");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      snippet: { title: "Video title", categoryId: "22" },
      status: { privacyStatus: "private", publishAt: "2026-08-01T00:00:00.000Z" },
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://upload.youtube.test/session-1");
  });
});
