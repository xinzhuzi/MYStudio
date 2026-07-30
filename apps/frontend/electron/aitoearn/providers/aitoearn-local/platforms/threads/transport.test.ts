import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createThreadsTransport } from "./transport";

function createFetchMock() { return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(); }
function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = { id: "aitoearn-local:threads:account-1", platform: "threads", providerAccountId: "threads-1", displayName: "Threads", credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" }, updatedAt: "2026-07-27T00:00:00.000Z" };
  return {
    config: { platformId: "threads", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/threads", scopes: ["threads_content_publish"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Threads official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-token", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-token", expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "threads-auth", username: "threads-auth", name: "Threads Auth", threads_profile_picture_url: "https://avatar.test/threads.png" })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createThreadsTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "threads", providerAccountId: "threads-auth", displayName: "Threads Auth", credential: { kind: "oauth", accessToken: "long-token", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "Threads Auth", avatarUrl: "https://avatar.test/threads.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://graph.threads.net/oauth/access_token",
      expect.stringContaining("https://graph.threads.net/access_token?"),
      "https://graph.threads.net/me?fields=id%2Cusername%2Cname%2Cthreads_profile_picture_url",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({ authorization: "Bearer long-token" });
  });

  it("uses the Threads host and its own create/status/publish contract", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1", status: "FINISHED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "post-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permalink: "https://threads.test/post-1" })));
    const transport = createThreadsTransport(createRuntime(fetchMock));
    await expect(transport.publish({ accountId: "aitoearn-local:threads:account-1", contentType: "image-text", assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }], description: "Thread" }))
      .resolves.toMatchObject({ taskId: "container-1", status: "running" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://graph.threads.net/threads-1/threads");
    await expect(transport.poll({ accountId: "aitoearn-local:threads:account-1", taskId: "container-1" }))
      .resolves.toMatchObject({ providerTaskId: "post-1", status: "success", resultUrl: "https://threads.test/post-1" });
  });
});
